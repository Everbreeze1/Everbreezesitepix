import type { Json } from "@everlumen/db";
import { getSupabaseAdmin } from "./supabase";

const PENDING_STALE_MS = 2 * 60_000;
const COMPLETED_TTL_MS = 24 * 60 * 60_000;

export type IdempotencyBegin =
  | { kind: "skip" }
  | { kind: "proceed"; recordId: string }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "in_progress" };

type Row = {
  id: string;
  status: string;
  created_at: string;
  response_status: number | null;
  response_body: Json | null;
};

/**
 * Claim an idempotency key for an expensive op.
 * Returns `skip` when no key, missing tables, or DB unavailable.
 */
export async function beginIdempotency(options: {
  userId: string;
  scope: string;
  key: string | null;
}): Promise<IdempotencyBegin> {
  if (!options.key) return { kind: "skip" };

  try {
    const admin = getSupabaseAdmin();
    const { data: inserted, error: insertErr } = await admin
      .from("api_idempotency_keys")
      .insert({
        user_id: options.userId,
        scope: options.scope,
        key: options.key,
        status: "pending",
      })
      .select("id")
      .maybeSingle();

    if (!insertErr && inserted?.id) {
      return { kind: "proceed", recordId: inserted.id };
    }

    // Unique violation or other - look up existing
    const { data: existing, error: selectErr } = await admin
      .from("api_idempotency_keys")
      .select("id, status, created_at, response_status, response_body")
      .eq("user_id", options.userId)
      .eq("scope", options.scope)
      .eq("key", options.key)
      .maybeSingle();

    if (selectErr || !existing) {
      // Tables missing or race - proceed without guarantee
      console.error("idempotency_begin_failed", selectErr?.message ?? insertErr?.message);
      return { kind: "skip" };
    }

    const row = existing as Row;
    const ageMs = Date.now() - new Date(row.created_at).getTime();

    if (row.status === "completed" && row.response_status != null) {
      if (ageMs > COMPLETED_TTL_MS) {
        await admin.from("api_idempotency_keys").delete().eq("id", row.id);
        const retry = await admin
          .from("api_idempotency_keys")
          .insert({
            user_id: options.userId,
            scope: options.scope,
            key: options.key,
            status: "pending",
          })
          .select("id")
          .maybeSingle();
        if (retry.data?.id) return { kind: "proceed", recordId: retry.data.id };
        return { kind: "skip" };
      }
      return {
        kind: "replay",
        status: row.response_status,
        body: row.response_body ?? {},
      };
    }

    if (row.status === "pending") {
      if (ageMs < PENDING_STALE_MS) return { kind: "in_progress" };
      // Stale pending - reclaim
      const { error: reclaimErr } = await admin
        .from("api_idempotency_keys")
        .update({
          status: "pending",
          updated_at: new Date().toISOString(),
          response_status: null,
          response_body: null,
        })
        .eq("id", row.id);
      if (reclaimErr) return { kind: "in_progress" };
      return { kind: "proceed", recordId: row.id };
    }

    // failed - allow retry
    const { error: resetErr } = await admin
      .from("api_idempotency_keys")
      .update({
        status: "pending",
        updated_at: new Date().toISOString(),
        response_status: null,
        response_body: null,
      })
      .eq("id", row.id);
    if (resetErr) return { kind: "skip" };
    return { kind: "proceed", recordId: row.id };
  } catch (e) {
    console.error("idempotency_begin_failed", e);
    return { kind: "skip" };
  }
}

export async function completeIdempotency(
  recordId: string,
  status: number,
  body: unknown,
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    await admin
      .from("api_idempotency_keys")
      .update({
        status: "completed",
        response_status: status,
        response_body: body as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", recordId);
  } catch (e) {
    console.error("idempotency_complete_failed", e);
  }
}

/** Mark failed / delete so the same key can retry. */
export async function releaseIdempotency(recordId: string): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    await admin.from("api_idempotency_keys").delete().eq("id", recordId);
  } catch (e) {
    console.error("idempotency_release_failed", e);
  }
}
