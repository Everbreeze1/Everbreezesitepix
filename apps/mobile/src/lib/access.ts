/**
 * Who may see what, as rules.
 *
 * Import-free so it can be tested. Two gates live here and both are decided by
 * the server; the app only reads the answer.
 *
 * **Platform admin** is membership of `platform_admins`, which has no client
 * access at all. `checkIsPlatformAdmin` is the only way to ask, and it is the
 * same op the web's admin layout and sidebar ask. Anything other than a clear
 * yes is a no: showing the console to a subscriber exposes other customers'
 * data, while hiding it from staff costs them one trip to the web.
 *
 * **Account owner** is `myRole === "owner"` on the caller's team, from
 * `getMyTeam`, the same field the web sidebar branches on. The Portfolio is the
 * company's public face and the owner decides it; invited members (admins,
 * managers and below) do not get the menu row or the screen. Not knowing yet is
 * also a no, so the row appears once the answer arrives rather than flashing
 * for somebody who then loses it.
 */

export type AdminRole = "support" | "billing" | "superadmin";

export type AdminAccess = { isAdmin: boolean; role: AdminRole | null };

/** Reads `checkIsPlatformAdmin`'s answer, failing closed on any other shape. */
export function readAdminAccess(result: unknown): AdminAccess {
  const value = (result ?? {}) as { isAdmin?: unknown; isPlatformAdmin?: unknown; role?: unknown };
  const isAdmin = value.isAdmin === true || value.isPlatformAdmin === true;
  const role =
    value.role === "support" || value.role === "billing" || value.role === "superadmin"
      ? value.role
      : null;
  return { isAdmin, role: isAdmin ? role : null };
}

/** Owner of the account: the team's `owner` role, and nothing less. */
export function isAccountOwner(team: { myRole?: string | null } | null | undefined): boolean {
  return team?.myRole === "owner";
}

export type AccessFacts = { isPlatformAdmin: boolean; isAccountOwner: boolean };

/** Whether a menu row with these flags is drawn for this person. */
export function canSeeGatedItem(
  item: { adminOnly?: boolean; ownerOnly?: boolean },
  facts: AccessFacts,
): boolean {
  if (item.adminOnly && !facts.isPlatformAdmin) return false;
  if (item.ownerOnly && !facts.isAccountOwner) return false;
  return true;
}

/**
 * What an admin role may do, mirroring `ROLE_CAPABILITIES` in
 * `apps/api/src/lib/admin-context.ts` and the web's `use-admin-role.ts`.
 *
 * For deciding what to OFFER, never the boundary: every op re-reads the role
 * server-side. An unknown role (the check in flight, or a database without the
 * column) resolves to allowed, as it does on the web, because the server
 * refuses anything the caller may not do.
 */
export type AdminCapability = "read" | "support" | "billing" | "owner";

const ROLE_CAPABILITIES: Record<AdminRole, AdminCapability[]> = {
  support: ["read", "support"],
  billing: ["read", "billing"],
  superadmin: ["read", "support", "billing", "owner"],
};

export function adminCan(role: AdminRole | null, capability: AdminCapability): boolean {
  return role === null ? true : ROLE_CAPABILITIES[role].includes(capability);
}
