import { z } from "zod";
import {
  idempotencyKeyFrom,
  requestIdFrom,
  writeAuditLog,
} from "../../lib/audit";
import { jsonError, jsonFromUnknownError, validationMessage } from "../../lib/errors";
import {
  beginIdempotency,
  completeIdempotency,
  releaseIdempotency,
} from "../../lib/idempotency";
import { requireAuthedContext, type ServiceContext } from "../../lib/user-context";
import {
  clientRateKey,
  rateLimit,
  rateLimitHeaders,
} from "../../lib/rate-limit";
import { PUBLIC_RPC_OPS, rpcBodySchema, rpcRegistry } from "./registry";

function rpcLimits() {
  const limit = Number(process.env.RPC_RATE_LIMIT ?? 120);
  const windowMs = Number(process.env.RPC_RATE_WINDOW_MS ?? 60_000);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 120,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000,
  };
}

function mergeHeaders(
  base: HeadersInit,
  extra?: HeadersInit,
): Headers {
  const headers = new Headers(base);
  if (extra) {
    const e = new Headers(extra);
    e.forEach((v, k) => headers.set(k, v));
  }
  return headers;
}

export async function handleRpc(request: Request): Promise<Response> {
  const started = Date.now();
  const requestId = requestIdFrom(request);
  const idemKey = idempotencyKeyFrom(request);

  if (request.method !== "POST") {
    return jsonError(405, "method_not_allowed", "POST required");
  }

  let body: z.infer<typeof rpcBodySchema>;
  try {
    const json = await request.json();
    body = rpcBodySchema.parse(json);
  } catch {
    return jsonError(400, "invalid_body", "Expected JSON body { op, data? }");
  }

  const entry = rpcRegistry[body.op];
  if (!entry) {
    return jsonError(404, "unknown_op", `Unknown operation: ${body.op}`);
  }

  let ctx: ServiceContext | null = null;
  if (!entry.public) {
    try {
      const authed = await requireAuthedContext(request);
      ctx = { supabase: authed.supabase, userId: authed.userId, claims: authed.claims };
    } catch (err) {
      return jsonFromUnknownError(err, 401);
    }
  } else if (!PUBLIC_RPC_OPS.has(body.op)) {
    return jsonError(500, "internal_error", "Public op misconfigured");
  }

  const { limit, windowMs } = rpcLimits();
  const key = `rpc:${clientRateKey(request, ctx?.userId)}`;
  const rl = rateLimit({ key, limit, windowMs });
  const rlHeaders = rateLimitHeaders(rl, limit);
  if (!rl.ok) {
    writeAuditLog({
      userId: ctx?.userId,
      route: "/v1/rpc",
      op: body.op,
      httpStatus: 429,
      durationMs: Date.now() - started,
      requestId,
      idempotencyKey: idemKey,
      errorCode: "rate_limited",
    });
    return Response.json(
      { code: "rate_limited", message: "Too many requests" },
      {
        status: 429,
        headers: mergeHeaders(rlHeaders, { "X-Request-Id": requestId }),
      },
    );
  }

  let idemRecordId: string | null = null;
  if (entry.idempotent && ctx?.userId) {
    const claim = await beginIdempotency({
      userId: ctx.userId,
      scope: `rpc:${body.op}`,
      key: idemKey,
    });
    if (claim.kind === "replay") {
      writeAuditLog({
        userId: ctx.userId,
        route: "/v1/rpc",
        op: body.op,
        httpStatus: claim.status,
        durationMs: Date.now() - started,
        requestId,
        idempotencyKey: idemKey,
        meta: { replay: true },
      });
      return Response.json(claim.body, {
        status: claim.status,
        headers: mergeHeaders(rlHeaders, {
          "X-Request-Id": requestId,
          "Idempotent-Replay": "true",
        }),
      });
    }
    if (claim.kind === "in_progress") {
      writeAuditLog({
        userId: ctx.userId,
        route: "/v1/rpc",
        op: body.op,
        httpStatus: 409,
        durationMs: Date.now() - started,
        requestId,
        idempotencyKey: idemKey,
        errorCode: "idempotency_in_progress",
      });
      return Response.json(
        {
          code: "idempotency_in_progress",
          message: "A request with this Idempotency-Key is already in progress",
        },
        {
          status: 409,
          headers: mergeHeaders(rlHeaders, { "X-Request-Id": requestId }),
        },
      );
    }
    if (claim.kind === "proceed") idemRecordId = claim.recordId;
  }

  try {
    const result = await entry.handle(ctx, body.data ?? {});
    if (idemRecordId) {
      await completeIdempotency(idemRecordId, 200, result);
    }
    writeAuditLog({
      userId: ctx?.userId,
      route: "/v1/rpc",
      op: body.op,
      httpStatus: 200,
      durationMs: Date.now() - started,
      requestId,
      idempotencyKey: idemKey,
    });
    return Response.json(result, {
      headers: mergeHeaders(rlHeaders, { "X-Request-Id": requestId }),
    });
  } catch (err) {
    if (idemRecordId) await releaseIdempotency(idemRecordId);

    if (err instanceof z.ZodError) {
      writeAuditLog({
        userId: ctx?.userId,
        route: "/v1/rpc",
        op: body.op,
        httpStatus: 400,
        durationMs: Date.now() - started,
        requestId,
        idempotencyKey: idemKey,
        errorCode: "validation_error",
      });
      return Response.json(
        // NOT `err.message` — that is the raw issue array as JSON, and the web
        // client renders `message` directly in a toast. The structured form
        // stays available under `details` for debugging.
        {
          code: "validation_error",
          message: validationMessage(err),
          details: err.flatten(),
        },
        {
          status: 400,
          headers: mergeHeaders(rlHeaders, { "X-Request-Id": requestId }),
        },
      );
    }
    const res = jsonFromUnknownError(err);
    let errorCode = "internal_error";
    try {
      const parsed = (await res.clone().json()) as { code?: string };
      if (typeof parsed.code === "string") errorCode = parsed.code;
    } catch {
      // ignore
    }
    writeAuditLog({
      userId: ctx?.userId,
      route: "/v1/rpc",
      op: body.op,
      httpStatus: res.status,
      durationMs: Date.now() - started,
      requestId,
      idempotencyKey: idemKey,
      errorCode,
    });
    const headers = mergeHeaders(res.headers, rlHeaders);
    headers.set("X-Request-Id", requestId);
    return new Response(res.body, { status: res.status, headers });
  }
}
