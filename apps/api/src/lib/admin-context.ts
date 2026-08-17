import { AuthError } from "./user-context";
import { getSupabaseAdmin } from "./supabase";

/** Throws AuthError(403) unless the user is in platform_admins. Server-only check - never trust a client-supplied flag. */
export async function requirePlatformAdmin(userId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data, error } = await (admin as any)
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) {
    throw Object.assign(new AuthError("Forbidden - platform admin access required"), {
      status: 403,
    });
  }
}
