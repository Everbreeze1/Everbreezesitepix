import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  assignableRoles,
  can,
  canManageMember,
  normaliseRole,
  roleAllowedOnTier,
  type TeamRole,
} from "@sitepix/shared/team-permissions";

const ALL: TeamRole[] = ["owner", "admin", "manager", "standard", "restricted"];

describe("the matrix matches the Team Management spec, section 4", () => {
  it("only Admin and Owner reach billing", () => {
    expect(can("owner", "billing")).toBe(true);
    expect(can("admin", "billing")).toBe(true);
    expect(can("manager", "billing")).toBe(false);
    expect(can("standard", "billing")).toBe(false);
    expect(can("restricted", "billing")).toBe(false);
  });

  it("company-wide user management stops above Manager", () => {
    expect(can("admin", "manage_users")).toBe(true);
    // "no billing or company-wide user management" - a Manager has crew, not users.
    expect(can("manager", "manage_users")).toBe(false);
    expect(can("manager", "manage_own_crew")).toBe(true);
    expect(can("standard", "manage_own_crew")).toBe(false);
  });

  it("Restricted is the only role that cannot see every project", () => {
    for (const role of ALL) {
      if (role === "restricted") {
        expect(can(role, "view_all_projects")).toBe(false);
        expect(can(role, "assigned_projects_only")).toBe(true);
      } else {
        expect(can(role, "view_all_projects")).toBe(true);
        expect(can(role, "assigned_projects_only")).toBe(false);
      }
    }
  });

  it("destructive actions stay with Owner and Admin", () => {
    expect(can("owner", "destructive_actions")).toBe(true);
    expect(can("admin", "destructive_actions")).toBe(true);
    // The spec says "Limited" for Manager. A Manager who can delete a project
    // is not limited in any sense a customer would recognise.
    expect(can("manager", "destructive_actions")).toBe(false);
  });
});

describe("unknown and legacy roles fail closed", () => {
  it("the historical `member` row is Standard", () => {
    expect(normaliseRole("member")).toBe("standard");
    expect(can("member", "view_all_projects")).toBe(true);
    expect(can("member", "manage_users")).toBe(false);
  });

  it("a role we do not recognise never reaches an admin capability", () => {
    for (const junk of ["superuser", "", "ADMIN", "root", null, undefined]) {
      expect(can(junk as never, "billing")).toBe(false);
      expect(can(junk as never, "manage_users")).toBe(false);
      expect(can(junk as never, "destructive_actions")).toBe(false);
    }
  });
});

describe("roles are gated by tier, which is what the pricing page sells", () => {
  it("Starter holds an Admin and a Standard, and nothing in between", () => {
    expect(roleAllowedOnTier("admin", "starter")).toBe(true);
    expect(roleAllowedOnTier("standard", "starter")).toBe(true);
    expect(roleAllowedOnTier("manager", "starter")).toBe(false);
    expect(roleAllowedOnTier("restricted", "starter")).toBe(false);
  });

  it("Manager is the Pro differentiator, Restricted is the Team one", () => {
    expect(roleAllowedOnTier("manager", "pro")).toBe(true);
    expect(roleAllowedOnTier("restricted", "pro")).toBe(false);
    expect(roleAllowedOnTier("restricted", "team")).toBe(true);
  });
});

describe("Restricted is not offered until its scoping is actually enforced", () => {
  /*
   * The failure this guards against is silent and total: assign someone
   * Restricted while the project-assignment RLS is unbuilt and they do not get
   * a narrower view, they get the full one, because nothing is filtering.
   */
  it("is withheld from the picker while assignments are unenforced", () => {
    expect(assignableRoles("team", { assignmentsEnforced: false })).not.toContain("restricted");
    expect(assignableRoles("team", { assignmentsEnforced: true })).toContain("restricted");
  });

  it("never offers owner, which is transferred rather than granted", () => {
    for (const tier of ["starter", "pro", "team"] as const) {
      expect(assignableRoles(tier, { assignmentsEnforced: true })).not.toContain("owner");
    }
  });

  it("offers Starter only Admin and Standard", () => {
    expect(assignableRoles("starter", { assignmentsEnforced: true })).toEqual([
      "admin",
      "standard",
    ]);
  });
});

describe("who may act on whom", () => {
  it("the owner row is immune to everyone", () => {
    for (const actor of ALL) expect(canManageMember(actor, "owner")).toBe(false);
  });

  it("a Manager reaches their own crew and no further", () => {
    expect(canManageMember("manager", "standard")).toBe(true);
    expect(canManageMember("manager", "restricted")).toBe(true);
    expect(canManageMember("manager", "manager")).toBe(false);
    expect(canManageMember("manager", "admin")).toBe(false);
  });

  it("Standard and Restricted may not act on anyone", () => {
    for (const target of ALL) {
      expect(canManageMember("standard", target)).toBe(false);
      expect(canManageMember("restricted", target)).toBe(false);
    }
  });
});

describe("every role is presentable", () => {
  it("has a label and a description", () => {
    for (const role of ALL) {
      expect(ROLE_LABEL[role]).toBeTruthy();
      expect(ROLE_DESCRIPTION[role]).toBeTruthy();
    }
  });
});

describe("family: the matrix is actually enforced, not just declared", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

  /*
   * `canManageMember` was defined and unit-tested for a round while the role
   * change endpoint still hard-required `team.owner_id === userId`. Both halves
   * of section 4 were therefore unreachable: an Admin had `manage_users` and
   * could not use it, and a Manager's entire purpose - promoting someone over
   * their own crew - was impossible. A tested pure function that nothing calls
   * is indistinguishable from a shipped feature until someone tries it.
   */
  it("the role-change endpoint asks the matrix, not the owner column", () => {
    const src = read("apps/api/src/domains/teams/service.ts");
    expect(src).toMatch(/canManageMember\(\(caller as any\)\.role, \(target as any\)\.role\)/);
    expect(src).not.toMatch(/Only the owner can change roles\./);
  });

  it("the roster menu gates on the same function the server uses", () => {
    const src = read("apps/web/src/features/teams/pages/TeamsPage.tsx");
    expect(src).toMatch(/canManageMember\(myRole, m\.role\)/);
    expect(src).not.toMatch(/canEdit = myRole === "owner"/);
  });
});

describe("family: page access follows the matrix, and billing is gated separately", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

  /*
   * The Teams page was owner-only, which locked an Admin out of `manage_users`
   * and a Manager out of `manage_own_crew` - the only screen either capability
   * exists on. Opening it is safe specifically because that page carries no
   * billing controls; the Stripe portal lives in Settings and is gated on its
   * own capability. These two facts have to stay true together, so both are
   * asserted here rather than in separate files.
   */
  it("the Teams page admits anyone who can manage people", () => {
    const src = read("apps/web/src/features/teams/pages/TeamsPage.tsx");
    expect(src).toMatch(/can\(data\.myRole, "manage_users"\)/);
    expect(src).toMatch(/can\(data\.myRole, "manage_own_crew"\)/);
    expect(src).not.toMatch(/if \(data\.myRole !== "owner"\)/);
  });

  it("the Teams page still has no billing action on it", () => {
    const src = read("apps/web/src/features/teams/pages/TeamsPage.tsx");
    // If a Stripe control ever lands here, the reasoning that made it safe to
    // open the page to Admins and Managers silently stops holding.
    expect(src).not.toMatch(/createBillingPortalSession|createCheckoutSession/);
  });

  it("billing is enforced on the capability, on the server", () => {
    const src = read("apps/api/src/domains/billing/service.ts");
    expect(src).toMatch(/can\(\(membership as any\)\.role, "billing"\)/);
    expect(src).not.toMatch(/role !== "owner"/);
  });

  it("the Settings billing section agrees with the server", () => {
    const src = read("apps/web/src/features/settings/pages/SettingsPage.tsx");
    expect(src).toMatch(/can\(myTeamRole, "billing"\)/);
  });

  it("only Owner and Admin hold billing, so widening the page did not widen money", () => {
    expect(can("owner", "billing")).toBe(true);
    expect(can("admin", "billing")).toBe(true);
    expect(can("manager", "billing")).toBe(false);
    expect(can("standard", "billing")).toBe(false);
    expect(can("restricted", "billing")).toBe(false);
  });
});

describe("family: no capability is declared without a call site", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

  /*
   * The failure this catches has now happened twice: `canManageMember` sat
   * tested-but-uncalled for a round, and `manage_templates` was granted to
   * Manager while the only screen that edits templates still hardcoded
   * owner/admin. Both looked shipped and neither was. A capability nothing asks
   * about is a claim, not a permission.
   */
  const CAPABILITIES = [
    "billing",
    "manage_users",
    "manage_own_crew",
    "view_all_projects",
    "assigned_projects_only",
    "destructive_actions",
    "manage_templates",
  ];

  const SOURCES = [
    "apps/api/src/domains/teams/service.ts",
    "apps/api/src/domains/billing/service.ts",
    "apps/web/src/features/teams/pages/TeamsPage.tsx",
    "apps/web/src/features/settings/pages/SettingsPage.tsx",
    "apps/web/src/features/settings/pages/TemplatesPage.tsx",
  ]
    .map(read)
    .join("\n");

  it("every capability in the matrix is asked about somewhere", () => {
    const unused = CAPABILITIES.filter((c) => !SOURCES.includes(`"${c}"`));
    /*
     * These three are enforced in Postgres, not TypeScript, so no call site
     * here can show them:
     *   view_all_projects      - `are_teammates()`, every shared-resource policy
     *   assigned_projects_only - `member_can_reach_project()` (20260911000000)
     *   destructive_actions    - by the ABSENCE of a DELETE policy, which is the
     *                            strongest form and the least greppable
     * Anything else showing up in this list is a capability that was written
     * down and never wired.
     */
    expect(unused).toEqual(["view_all_projects", "assigned_projects_only", "destructive_actions"]);
  });

  it("Manager holds only what section 4 lists", () => {
    expect(can("manager", "manage_own_crew")).toBe(true);
    expect(can("manager", "view_all_projects")).toBe(true);
    expect(can("manager", "billing")).toBe(false);
    expect(can("manager", "manage_users")).toBe(false);
    expect(can("manager", "destructive_actions")).toBe(false);
    expect(can("manager", "manage_templates")).toBe(false);
  });
});
