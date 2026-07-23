import { getSupabaseAdmin } from "./supabase";

/** Constant-time string compare (no Node crypto — safe for Worker + Vite graphs). */
function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/** Verify `x-cron-secret` against Supabase Vault RPC `get_cron_shared_secret`. */
export async function verifyCronSecret(request: Request): Promise<boolean> {
  const provided = request.headers.get("x-cron-secret") ?? "";
  if (!provided) return false;
  const admin = getSupabaseAdmin();
  const { data: expected, error } = await admin.rpc("get_cron_shared_secret");
  if (error || !expected) return false;
  return safeEqualString(provided, String(expected));
}

export function verifyBearerSecret(
  request: Request,
  envName: string,
): boolean {
  const secret = process.env[envName];
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : auth.trim();
  return safeEqualString(token, secret);
}
