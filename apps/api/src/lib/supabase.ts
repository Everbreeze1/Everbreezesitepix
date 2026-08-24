import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@everlumen/db";

/** Set via env - Railway project vars in production, apps/api/.env locally. */
export function requireEverlumenSupabaseUrl(): string {
  const url = process.env.EVERLUMEN_SUPABASE_URL;
  if (!url) throw new Error("Missing EVERLUMEN_SUPABASE_URL");
  return url;
}

export function requireEverlumenSupabasePublishableKey(): string {
  const key = process.env.EVERLUMEN_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("Missing EVERLUMEN_SUPABASE_PUBLISHABLE_KEY");
  return key;
}

let _admin: SupabaseClient<Database> | undefined;

/** Service-role client. Server-only - never ship to browsers. */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (_admin) return _admin;
  const key = process.env.EVERLUMEN_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("Missing EVERLUMEN_SUPABASE_SERVICE_ROLE_KEY");
  }
  _admin = createClient<Database>(requireEverlumenSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

export function bearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

export async function requireUser(request: Request) {
  const token = bearerToken(request);
  if (!token) return null;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}
