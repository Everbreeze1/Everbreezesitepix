import { useQuery } from "@tanstack/react-query";
import { checkIsPlatformAdmin, type AdminRole } from "@/lib/admin.functions";

/**
 * What the signed-in admin is allowed to do, for deciding what to OFFER.
 *
 * Capabilities were enforced on every mutating service from the day roles
 * landed, and surfaced nowhere. So a `support` admin saw the full set of
 * billing and superadmin controls, and found out which ones were theirs by
 * pressing one and reading a 403 in a toast. Disabled controls that explain
 * themselves are the difference between a permission system and a trap.
 *
 * NOT A SECURITY BOUNDARY. `requirePlatformAdmin(userId, capability)` on the
 * server is what decides, re-read from the database on every request; this only
 * decides what the screen bothers to render. Hiding a button has never stopped
 * anyone from calling the op.
 *
 * Mirrors ROLE_CAPABILITIES in apps/api/src/lib/admin-context.ts. Keep the two
 * in step - the failure mode of drift is a control that looks available and
 * 403s, which is exactly what this exists to remove.
 */
export type AdminCapability = "read" | "support" | "billing" | "owner";

const ROLE_CAPABILITIES: Record<AdminRole, ReadonlySet<AdminCapability>> = {
  support: new Set<AdminCapability>(["read", "support"]),
  billing: new Set<AdminCapability>(["read", "billing"]),
  superadmin: new Set<AdminCapability>(["read", "support", "billing", "owner"]),
};

/** Shown on a disabled control, so the reason is where the confusion is. */
export const CAPABILITY_LABEL: Record<AdminCapability, string> = {
  read: "read",
  support: "support",
  billing: "billing",
  owner: "superadmin",
};

export function useAdminRole() {
  const { data, isPending } = useQuery({
    queryKey: ["admin", "check"],
    queryFn: () => checkIsPlatformAdmin(),
    staleTime: 5 * 60_000,
  });

  const role = data?.role ?? null;

  /*
   * Unknown role resolves to "allowed".
   *
   * While the check is in flight, or against a database where the `role` column
   * has not been added yet, the honest answer is "we do not know" - and
   * disabling everything on that basis would make the console look broken for
   * an admin who is in fact a superadmin. The server refuses anything the
   * caller may not do, so an optimistic UI costs a clear 403 at worst; a
   * pessimistic one costs a support person their whole screen.
   */
  const can = (capability: AdminCapability): boolean =>
    role === null ? true : ROLE_CAPABILITIES[role].has(capability);

  return {
    role,
    isPending,
    can,
    /** A sentence for a disabled control's tooltip, or null when it is allowed. */
    denyReason: (capability: AdminCapability): string | null =>
      can(capability)
        ? null
        : `Needs ${CAPABILITY_LABEL[capability]} access. Your admin role is ${role}.`,
  };
}
