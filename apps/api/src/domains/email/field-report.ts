import * as React from "react";
import { render } from "@react-email/render";
import { FieldReportEmail } from "@sitepix/email-templates";
import {
  idempotencyKeyFrom,
  requestIdFrom,
  writeAuditLog,
} from "../../lib/audit";
import { jsonError } from "../../lib/errors";
import {
  beginIdempotency,
  completeIdempotency,
  releaseIdempotency,
} from "../../lib/idempotency";
import {
  clientRateKey,
  rateLimit,
  rateLimitHeaders,
} from "../../lib/rate-limit";
import { sendEmail } from "../../lib/send-email";
import { getSupabaseAdmin, requireUser } from "../../lib/supabase";
import { fieldReportBodySchema } from "./schemas";

const SITE_NAME = "Everbreeze SitePix";
const BUCKET = "field-reports";
const EXPIRES_IN_DAYS = 7;
const EXPIRES_IN_SECONDS = EXPIRES_IN_DAYS * 24 * 60 * 60;

function mergeHeaders(base: HeadersInit, extra?: HeadersInit): Headers {
  const headers = new Headers(base);
  if (extra) {
    new Headers(extra).forEach((v, k) => headers.set(k, v));
  }
  return headers;
}

export async function handleFieldReportEmail(
  request: Request,
): Promise<Response> {
  const started = Date.now();
  const requestId = requestIdFrom(request);
  const idemKey = idempotencyKeyFrom(request);
  let userId: string | null = null;
  let idemRecordId: string | null = null;

  try {
    const user = await requireUser(request);
    if (!user?.email) return jsonError(401, "unauthorized", "Unauthorized");
    userId = user.id;

    const emailLimit = Number(process.env.EMAIL_RATE_LIMIT ?? 10);
    const emailWindowMs = Number(process.env.EMAIL_RATE_WINDOW_MS ?? 3_600_000);
    const limit = Number.isFinite(emailLimit) && emailLimit > 0 ? emailLimit : 10;
    const windowMs =
      Number.isFinite(emailWindowMs) && emailWindowMs > 0
        ? emailWindowMs
        : 3_600_000;
    const rl = rateLimit({
      key: `email-report:${clientRateKey(request, user.id)}`,
      limit,
      windowMs,
    });
    const rlHeaders = rateLimitHeaders(rl, limit);
    if (!rl.ok) {
      writeAuditLog({
        userId,
        route: "/v1/email/field-report",
        op: "email.fieldReport",
        httpStatus: 429,
        durationMs: Date.now() - started,
        requestId,
        idempotencyKey: idemKey,
        errorCode: "rate_limited",
      });
      return Response.json(
        { code: "rate_limited", message: "Too many email requests" },
        {
          status: 429,
          headers: mergeHeaders(rlHeaders, { "X-Request-Id": requestId }),
        },
      );
    }

    const claim = await beginIdempotency({
      userId: user.id,
      scope: "email:field-report",
      key: idemKey,
    });
    if (claim.kind === "replay") {
      writeAuditLog({
        userId,
        route: "/v1/email/field-report",
        op: "email.fieldReport",
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
        userId,
        route: "/v1/email/field-report",
        op: "email.fieldReport",
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

    const recipient = user.email;
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      if (idemRecordId) await releaseIdempotency(idemRecordId);
      return jsonError(400, "invalid_json", "Invalid JSON");
    }

    const parsed = fieldReportBodySchema.safeParse(raw);
    if (!parsed.success) {
      if (idemRecordId) await releaseIdempotency(idemRecordId);
      writeAuditLog({
        userId,
        route: "/v1/email/field-report",
        op: "email.fieldReport",
        httpStatus: 400,
        durationMs: Date.now() - started,
        requestId,
        idempotencyKey: idemKey,
        errorCode: "validation_error",
      });
      return Response.json(
        {
          code: "validation_error",
          message: "Invalid body",
          details: parsed.error.flatten(),
        },
        {
          status: 400,
          headers: mergeHeaders(rlHeaders, { "X-Request-Id": requestId }),
        },
      );
    }
    const { subject, pdfBase64, pdfName } = parsed.data;

    const admin = getSupabaseAdmin();
    const cleanBase64 = pdfBase64.replace(/^data:.*;base64,/, "");
    const binary = Uint8Array.from(atob(cleanBase64), (c) => c.charCodeAt(0));
    const objectId = crypto.randomUUID();
    const safeName = pdfName.replace(/[^\w.\- ]/g, "_");
    const objectPath = `${user.id}/${objectId}/${safeName}`;

    const { error: uploadErr } = await admin.storage.from(BUCKET).upload(
      objectPath,
      binary,
      { contentType: "application/pdf", upsert: false },
    );
    if (uploadErr) {
      console.error("field-report upload failed", uploadErr);
      if (idemRecordId) await releaseIdempotency(idemRecordId);
      writeAuditLog({
        userId,
        route: "/v1/email/field-report",
        op: "email.fieldReport",
        httpStatus: 500,
        durationMs: Date.now() - started,
        requestId,
        idempotencyKey: idemKey,
        errorCode: "storage_failed",
      });
      return Response.json(
        { code: "storage_failed", message: "Failed to store report" },
        {
          status: 500,
          headers: mergeHeaders(rlHeaders, { "X-Request-Id": requestId }),
        },
      );
    }

    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(objectPath, EXPIRES_IN_SECONDS, { download: safeName });
    if (signErr || !signed?.signedUrl) {
      console.error("field-report sign failed", signErr);
      if (idemRecordId) await releaseIdempotency(idemRecordId);
      writeAuditLog({
        userId,
        route: "/v1/email/field-report",
        op: "email.fieldReport",
        httpStatus: 500,
        durationMs: Date.now() - started,
        requestId,
        idempotencyKey: idemKey,
        errorCode: "sign_failed",
      });
      return Response.json(
        { code: "sign_failed", message: "Failed to create download link" },
        {
          status: 500,
          headers: mergeHeaders(rlHeaders, { "X-Request-Id": requestId }),
        },
      );
    }

    const element = React.createElement(FieldReportEmail, {
      siteName: SITE_NAME,
      subject,
      downloadUrl: signed.signedUrl,
      expiresInDays: EXPIRES_IN_DAYS,
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });

    const { id: messageId } = await sendEmail({
      to: recipient,
      subject,
      html,
      text,
    });

    const okBody = { ok: true as const, sentTo: recipient, messageId };
    if (idemRecordId) {
      await completeIdempotency(idemRecordId, 200, okBody);
    }
    writeAuditLog({
      userId,
      route: "/v1/email/field-report",
      op: "email.fieldReport",
      httpStatus: 200,
      durationMs: Date.now() - started,
      requestId,
      idempotencyKey: idemKey,
    });

    return Response.json(okBody, {
      headers: mergeHeaders(rlHeaders, { "X-Request-Id": requestId }),
    });
  } catch (e) {
    console.error("email-report error", e);
    if (idemRecordId) await releaseIdempotency(idemRecordId);
    writeAuditLog({
      userId,
      route: "/v1/email/field-report",
      op: "email.fieldReport",
      httpStatus: 500,
      durationMs: Date.now() - started,
      requestId,
      idempotencyKey: idemKey,
      errorCode: "internal_error",
    });
    return jsonError(500, "internal_error", "Internal error");
  }
}
