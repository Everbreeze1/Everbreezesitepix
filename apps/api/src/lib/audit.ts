import type { Json } from "@sitepix/db";
import { getSupabaseAdmin } from "./supabase";

export type AuditLogInput = {
  userId?: string | null;
  route: string;
  op?: string | null;
  httpStatus: number;
  durationMs?: number | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
  errorCode?: string | null;
  meta?: Record<string, unknown> | null;
};

/** Fire-and-forget audit write. Never throws to callers. */
export function writeAuditLog(input: AuditLogInput): void {
  void (async () => {
    try {
      const admin = getSupabaseAdmin();
      const { error } = await admin.from("api_audit_logs").insert({
        user_id: input.userId ?? null,
        route: input.route,
        op: input.op ?? null,
        http_status: input.httpStatus,
        duration_ms: input.durationMs ?? null,
        request_id: input.requestId ?? null,
        idempotency_key: input.idempotencyKey ?? null,
        error_code: input.errorCode ?? null,
        meta: (input.meta ?? null) as Json | null,
      });
      if (error) console.error("audit_log_write_failed", error.message);
    } catch (e) {
      console.error("audit_log_write_failed", e);
    }
  })();
}

export function requestIdFrom(request: Request): string {
  const incoming = request.headers.get("x-request-id")?.trim();
  if (incoming && incoming.length <= 128) return incoming;
  return crypto.randomUUID();
}

export function idempotencyKeyFrom(request: Request): string | null {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) return null;
  if (key.length > 128) return null;
  return key;
}
