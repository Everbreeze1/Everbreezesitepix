/**
 * The team permission matrix - one definition, both apps.
 *
 * Before this file the product had three roles (`owner`, `admin`, `member`) and
 * no plan gate on any of them, so "Advanced roles & permissions" on the Team
 * pricing card described something a Starter account already had. The matrix
 * below is the client's Team Management spec, section 4.
 *
 * WHY IT LIVES IN `shared` RATHER THAN IN EITHER APP.
 * The web app hides controls with it and the API refuses calls with it, and
 * those two answers must never diverge - a hidden button is not enforcement,
 * but a *visible* button the server then rejects is worse, because the user
 * has already decided they can do the thing. One table, imported by both.
 *
 * WHAT THIS FILE DOES NOT DO.
 * It answers "may this role do X", not "may this role do X to THAT project".
 * `restricted` is defined here as seeing only assigned projects, but the
 * assignment table and the RLS that reads it are a separate change; until that
 * lands, `restricted` must not be assignable. `assignableRoles` enforces that
 * by refusing to offer a role whose scoping is not yet enforced.
 */

/**
 * `member` is the historical name for what the spec calls Standard. Rows in
 * `team_members` still carry it, so it stays in the type and normalises to
 * `standard` rather than being migrated - a data migration that rewrites a role
 * column is a much bigger risk than one extra branch in a lookup.
 */
export type StoredTeamRole = "owner" | "admin" | "manager" | "standard" | "restricted" | "member";

/** The roles the product actually talks about. `member` normalises away. */
export type TeamRole = "owner" | "admin" | "manager" | "standard" | "restricted";

/**
 * A role that can be handed to somebody.
 *
 * `owner` is excluded in the TYPE, not just at runtime, so a caller passing an
 * `assignableRoles()` result straight into `updateMemberRole` cannot compile
 * unless owner is genuinely impossible - which is the guarantee that function
 * makes and now has to keep.
 */
export type AssignableRole = Exclude<TeamRole, "owner">;

export type Capability =
  /** Subscription, seats, payment method, invoices. */
  | "billing"
  /** Invite, remove and re-role anyone on the team. */
  | "manage_users"
  /** Manager's narrower version: re-role their own crew, no billing, no admins. */
  | "manage_own_crew"
  /** Sees every project in the workspace. */
  | "view_all_projects"
  /** Sees only projects they are explicitly assigned to. */
  | "assigned_projects_only"
  /** Deleting projects and other irreversible workspace-level actions. */
  | "destructive_actions"
  /** Editing the shared template and blueprint libraries. */
  | "manage_templates";

/**
 * Read this as the spec's table, transposed.
 *
 * `owner` and `admin` are deliberately identical here. They differ in exactly
 * one way, and it is not a capability: an owner cannot be removed or re-roled,
 * which `canManageMember` handles below. Giving admins a strictly smaller
 * capability set instead would have quietly demoted every existing admin.
 */
const MATRIX: Record<TeamRole, ReadonlySet<Capability>> = {
  owner: new Set<Capability>([
    "billing",
    "manage_users",
    "manage_own_crew",
    "view_all_projects",
    "destructive_actions",
    "manage_templates",
  ]),
  admin: new Set<Capability>([
    "billing",
    "manage_users",
    "manage_own_crew",
    "view_all_projects",
    "destructive_actions",
    "manage_templates",
  ]),
  // "Manager can promote a Standard user to lead/sub-manager over their own
  // crew only (no billing or company-wide user management)." So: crew, not
  // users. And "Limited" on destructive actions reads as no - a Manager who
  // can delete a project is not limited in any sense that matters.
  // No `manage_templates`. Section 4 spells Manager's row out in full and the
  // shared template library is not on it, so granting it here would widen a
  // permission on the strength of nothing but a guess. Add it the day the spec
  // does.
  manager: new Set<Capability>(["manage_own_crew", "view_all_projects"]),
  standard: new Set<Capability>(["view_all_projects"]),
  restricted: new Set<Capability>(["assigned_projects_only"]),
};

/** Historical `member` rows are Standard. */
export function normaliseRole(role: StoredTeamRole | string | null | undefined): TeamRole {
  if (role === "member" || role == null) return "standard";
  return role in MATRIX ? (role as TeamRole) : "standard";
}

/**
 * The single question every gate should ask.
 *
 * Deny is the default: an unrecognised role normalises to `standard`, which is
 * the least privileged role that can still use the product. A role we do not
 * recognise must never fall through to admin.
 */
export function can(
  role: StoredTeamRole | string | null | undefined,
  capability: Capability,
): boolean {
  return MATRIX[normaliseRole(role)].has(capability);
}

/**
 * Which tier may hold this role.
 *
 * Starter is one Admin plus one Technician and nothing else, so it cannot hold
 * the middle of the matrix at all. `restricted` is Team-only: it is the same
 * capability as subcontractor access - scoping a person to named projects
 * rather than the whole company - and that scoping is what Team sells.
 */
export type BillingTier = "starter" | "pro" | "team";

const MIN_TIER: Record<TeamRole, BillingTier> = {
  owner: "starter",
  admin: "starter",
  // Starter's second seat is a Technician with no billing and no settings,
  // which is Standard.
  standard: "starter",
  /*
   * Manager is Team-only, and that is a deliberate reversal.
   *
   * It used to sit on Pro, which left Pro holding two thirds of the hierarchy
   * (Admin / Manager / Standard) and Team adding only the Restricted row on
   * top. "Advanced roles & permissions" then described something a Pro
   * customer mostly already had, which is the same complaint that produced
   * this file in the first place - one tier down.
   *
   * Pro is now flat on purpose: Admin and Member, one level apart, and every
   * Member sits at the same level below the Admin. Everything that makes the
   * hierarchy a hierarchy - a middle tier, and scoping a person to named jobs
   * - is what Team sells.
   */
  manager: "team",
  restricted: "team",
};

const TIER_RANK: Record<BillingTier, number> = { starter: 0, pro: 1, team: 2 };

export function roleAllowedOnTier(role: StoredTeamRole | string, tier: BillingTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[MIN_TIER[normaliseRole(role)]];
}

/**
 * The roles a team on this tier may actually assign, in matrix order.
 *
 * `owner` is never in the list: it is not granted, it is held by whoever owns
 * the account, and moving it is a transfer rather than a role change.
 *
 * `restricted` is withheld until `assignmentsEnforced` is true. Offering it
 * while the project-assignment RLS is unbuilt would hand someone a role that
 * silently grants full visibility - the worst possible failure for a role
 * whose entire purpose is to restrict.
 */
export function assignableRoles(
  tier: BillingTier,
  opts: { assignmentsEnforced: boolean },
): AssignableRole[] {
  const order: AssignableRole[] = ["admin", "manager", "standard", "restricted"];
  return order.filter((role) => {
    if (role === "restricted" && !opts.assignmentsEnforced) return false;
    return roleAllowedOnTier(role, tier);
  });
}

/**
 * May `actor` change or remove `target`?
 *
 * The owner row is immune to everyone, including itself, which is what stops a
 * workspace from ending up with no one who can pay the bill. A Manager reaches
 * only Standard and Restricted - never another Manager, and never an Admin -
 * which is the whole of "own crew only".
 */
export function canManageMember(
  actorRole: StoredTeamRole | string,
  targetRole: StoredTeamRole | string,
): boolean {
  const actor = normaliseRole(actorRole);
  const target = normaliseRole(targetRole);
  if (target === "owner") return false;
  if (actor === "owner" || actor === "admin") return true;
  if (actor === "manager") return target === "standard" || target === "restricted";
  return false;
}

/** Human label for a role, used in the roster and the invite dialog. */
export const ROLE_LABEL: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  standard: "Standard",
  restricted: "Restricted",
};

/**
 * One line explaining what the role actually grants.
 *
 * Not decoration. Until this was rendered next to the role options, an admin
 * picking between Manager and Standard was choosing between two words, with
 * the difference between them written down only in this file. A picker that
 * does not say what it grants is a guess with a confirmation toast on it.
 */
export const ROLE_DESCRIPTION: Record<TeamRole, string> = {
  owner: "Full control, including billing. Cannot be removed.",
  admin: "Full control, including billing, team and every project.",
  manager: "Runs their own crew and sees every project. No billing, no admins.",
  standard: "Works on every project. Cannot manage the team or billing.",
  restricted: "Sees only the jobs you assign them. Nothing else in the workspace.",
};

/*
 * ===========================================================================
 * HOW A TIER TALKS ABOUT ITS ROLES
 * ===========================================================================
 * The matrix above is the same on every plan; the vocabulary is not.
 *
 * Team ships a hierarchy, so its middle seat has a name that distinguishes it
 * from the one above and the one below: Standard. Pro ships two levels, so the
 * seat below Admin is just the Member - calling it "Standard" there implies a
 * Manager and a Restricted it does not have, and invites exactly the question
 * ("standard compared to what?") the flat design exists to avoid.
 *
 * Both funcs take the tier so no screen has to remember the rule, and both
 * fall back to the canonical label for roles a tier cannot hold - a Pro team
 * that still has a legacy Manager row must render it as a Manager rather than
 * as nothing.
 */

/** The base seat's name on this tier. Team calls it Standard, flatter tiers Member. */
export function roleLabelForTier(
  role: StoredTeamRole | string | null | undefined,
  tier: BillingTier,
): string {
  const r = normaliseRole(role);
  if (r === "standard" && tier !== "team") return "Member";
  return ROLE_LABEL[r];
}

/** The one-liner for this role as this tier's customers experience it. */
export function roleDescriptionForTier(
  role: StoredTeamRole | string | null | undefined,
  tier: BillingTier,
): string {
  const r = normaliseRole(role);
  if (r === "standard" && tier !== "team") {
    // Says the level out loud. On a flat plan "one level below the Admin" is
    // the entire permission model, so it is the sentence worth spending.
    return "One level below Admin. Works on every project, but cannot manage the team or billing.";
  }
  return ROLE_DESCRIPTION[r];
}

/**
 * Does this tier have per-user job scoping at all?
 *
 * Two different things get called "assigning" and only one of them is gated.
 * Putting a teammate on a job - the crew list on a project - is ordinary
 * workspace behaviour and every plan has it. SCOPING a person so that the jobs
 * you ticked are the only ones they can see is the Restricted role, and that
 * is Team's. A Pro screen must therefore show the crew picker and must not
 * show the "choose their jobs" picker, because on Pro the second one would
 * appear to restrict somebody and do nothing.
 */
export function tierHasJobScoping(tier: BillingTier): boolean {
  return roleAllowedOnTier("restricted", tier);
}
