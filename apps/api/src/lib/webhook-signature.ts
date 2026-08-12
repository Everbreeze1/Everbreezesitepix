import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Standard Webhooks signature verification.
 *
 * Supabase Auth's HTTP hooks do NOT send `Authorization: Bearer <secret>`.
 * They sign the request per the Standard Webhooks spec and send:
 *
 *   webhook-id:        <opaque message id>
 *   webhook-timestamp: <unix seconds>
 *   webhook-signature: v1,<base64 hmac> [v1,<base64 hmac> ...]
 *
 * where the HMAC-SHA256 is taken over `{id}.{timestamp}.{rawBody}` using the
 * secret with its `v1,whsec_` prefix stripped and the remainder base64-decoded.
 *
 * Implemented here rather than pulling in the `standardwebhooks` package: it is
 * ~30 lines, and the dependency would be the only one in the API that exists
 * purely to concatenate three strings and call createHmac.
 */

/** Reject anything older than this, so a captured request can't be replayed. */
const TOLERANCE_SECONDS = 5 * 60;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * True when `rawBody` carries a valid Standard Webhooks signature for `secret`.
 * Returns false — never throws — so callers can fall through to another scheme.
 */
export function verifyStandardWebhook(
  request: Request,
  rawBody: string,
  secret: string | undefined,
): boolean {
  if (!secret) return false;

  const id = request.headers.get("webhook-id");
  const timestamp = request.headers.get("webhook-timestamp");
  const signatureHeader = request.headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;

  // `v1,whsec_<base64>` is the format Supabase stores. Tolerate a bare
  // `whsec_<base64>` or raw base64 too, so a hand-copied secret still works.
  const base64Secret = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  let key: Buffer;
  try {
    key = Buffer.from(base64Secret, "base64");
  } catch {
    return false;
  }
  if (!key.length) return false;

  const expected = createHmac("sha256", key)
    .update(`${id}.${ts}.${rawBody}`)
    .digest("base64");

  // The header may carry several space-separated versioned signatures; any
  // matching v1 entry is enough.
  for (const part of signatureHeader.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    if (safeEqual(value, expected)) return true;
  }
  return false;
}
