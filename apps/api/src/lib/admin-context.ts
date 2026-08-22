import { AuthError } from "./user-context";
import { getSupabaseAdmin } from "./supabase";
import { isMissingColumn } from "./postgrest";

export type AdminRole = "support" | "billing" | "superadmin";

/**
 * What an admin action needs, rather than who is allowed to do it.
 *
 * - `read`    - open the console and look at customer data.
 * - `support` - act on one account: password resets, suspend, triage feedback.
 * - `billing` - change plans, comp teams, cancel subscriptions.
 * - `owner`   - the irreversible and self-referential ones: delete an account,
 *               grant or revoke platform admin, revoke share links.
 */
export type AdminCapability = "read" | "support" | "billing" | "owner";

/*
 * Which roles hold which capability.
 *
 * `owner` is superadmin-only on purpose, and grant/revoke of admin itself lives
 * there: an admin who can promote is an admin who can promote themselves out of
 * every other restriction, which would make the whole table decorative.
 */
const ROLE_CAPABILITIES: Record<AdminRole, ReadonlySet<AdminCapability>> = {
  support: new Set<AdminCapability>(["read", "support"]),
  billing: new Set<AdminCapability>(["read", "billing"]),
  superadmin: new Set<AdminCapability>(["read", "support", "billing", "owner"]),
};

function forbidden(message: string): never {
  throw Object.assign(new AuthError(message), { status: 403 });
}

/**
 * Throws AuthError(403) unless the user is in platform_admins with a role that
 * holds `capability`. Server-only check - never trust a client-supplied flag.
 *
 * Defaults to `read` so every existing call site keeps its current meaning:
 * being an admin at all is enough to look. The narrower capabilities are opted
 * into by the services that mutate.
 */
export async function requirePlatformAdmin(
  userId: string,
  capability: AdminCapability = "read",
): Promise<AdminRole> {
  const role = await getPlatformAdminRole(userId);
  if (!role) forbidden("Forbidden - platform admin access required");
  if (!ROLE_CAPABILITIES[role].has(capability)) {
    forbidden(`Forbidden - this action needs ${capability} access and your admin role is ${role}.`);
  }
  return role;
}

/** The caller's admin role, or null if they are not an admin at all. */
export async function getPlatformAdminRole(userId: string): Promise<AdminRole | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await (admin as any)
    .from("platform_admins")
    .select("user_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    /*
     * The `role` column arrives with 20260822150000_admin_roles.sql, applied by
     * hand, so this code reliably ships before the column exists. PostgREST
     * rejects the WHOLE select over one unknown column, which would lock every
     * admin out of the console until the SQL ran. Retry without it and treat
     * the caller as a superadmin - which is exactly what they are today, before
     * roles exist.
     */
    if (!isMissingColumn(error)) return null;
    const { data: legacy } = await (admin as any)
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    return legacy ? "superadmin" : null;
  }

  if (!data) return null;
  const role = (data as any).role as string | undefined;
  return role === "support" || role === "billing" ? role : "superadmin";
}
