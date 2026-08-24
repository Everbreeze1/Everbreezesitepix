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
  roleDescriptionForTier,
  roleLabelForTier,
  tierHasJobScoping,
  type TeamRole,
} from "@everlumen/shared/team-permissions";

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

  /*
   * Manager used to sit on Pro. It moved.
   *
   * With Manager on Pro, a Pro customer held Admin / Manager / Standard - two
   * thirds of the hierarchy - and Team added one row on top of it. "Advanced
   * roles & permissions" then described something Pro mostly already had,
   * which is the same complaint that produced this matrix, one tier down. Pro
   * is flat on purpose now: Admin and Member, one level apart.
   */
  it("Pro is flat: Admin and Member, nothing between and nothing scoped", () => {
    expect(roleAllowedOnTier("admin", "pro")).toBe(true);
    expect(roleAllowedOnTier("standard", "pro")).toBe(true);
    expect(roleAllowedOnTier("manager", "pro")).toBe(false);
    expect(roleAllowedOnTier("restricted", "pro")).toBe(false);
    expect(assignableRoles("pro", { assignmentsEnforced: true })).toEqual(["admin", "standard"]);
  });

  it("the middle tier and the scoped tier are both Team's", () => {
    expect(roleAllowedOnTier("manager", "team")).toBe(true);
    expect(roleAllowedOnTier("restricted", "team")).toBe(true);
    expect(assignableRoles("team", { assignmentsEnforced: true })).toEqual([
      "admin",
      "manager",
      "standard",
      "restricted",
    ]);
  });

  it("Starter and Pro offer the same two roles, so Pro's depth is seats not roles", () => {
    expect(assignableRoles("starter", { assignmentsEnforced: true })).toEqual(
      assignableRoles("pro", { assignmentsEnforced: true }),
    );
  });
});

describe("each tier names the base seat the way it sells it", () => {
  it("Team calls it Standard, flatter tiers call it Member", () => {
    expect(roleLabelForTier("standard", "team")).toBe("Standard");
    expect(roleLabelForTier("standard", "pro")).toBe("Member");
    expect(roleLabelForTier("standard", "starter")).toBe("Member");
    // The historical column value renders as the same thing as the spec's name.
    expect(roleLabelForTier("member", "pro")).toBe("Member");
    expect(roleLabelForTier("member", "team")).toBe("Standard");
  });

  it("every other role keeps one name on every tier", () => {
    for (const tier of ["starter", "pro", "team"] as const) {
      for (const role of ["owner", "admin", "manager", "restricted"] as const) {
        expect(roleLabelForTier(role, tier)).toBe(ROLE_LABEL[role]);
      }
    }
  });

  it("a legacy role a tier can no longer hold still renders as itself", () => {
    // A Pro workspace that held a Manager before the tier moved must not draw
    // that person as nothing, or as a Member they are not.
    expect(roleLabelForTier("manager", "pro")).toBe("Manager");
    expect(roleDescriptionForTier("manager", "pro")).toBe(ROLE_DESCRIPTION.manager);
  });

  it("every role has a one-liner on every tier, because the picker renders one", () => {
    for (const tier of ["starter", "pro", "team"] as const) {
      for (const role of ALL) {
        expect(roleDescriptionForTier(role, tier).length).toBeGreaterThan(10);
      }
    }
  });

  it("the flat plans say out loud that Member is one level below Admin", () => {
    expect(roleDescriptionForTier("standard", "pro")).toMatch(/one level below admin/i);
    expect(roleDescriptionForTier("standard", "team")).toBe(ROLE_DESCRIPTION.standard);
  });

  it("job scoping is Team's, and is the same answer as the Restricted role", () => {
    expect(tierHasJobScoping("starter")).toBe(false);
    expect(tierHasJobScoping("pro")).toBe(false);
    expect(tierHasJobScoping("team")).toBe(true);
    for (const tier of ["starter", "pro", "team"] as const) {
      expect(tierHasJobScoping(tier)).toBe(roleAllowedOnTier("restricted", tier));
    }
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

describe("family: the roster shows the role, and the picker explains it", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

  /*
   * Two reports, one root cause: the Team roster held the whole permission
   * model and displayed almost none of it.
   *
   *   "there's no way to see what role a member currently has (no badge on
   *    their row, and reopening the Manage menu shows no checkmark or
   *    indicator next to their current role)"
   *   "none of the three roles have any explanation of what they actually
   *    grant, so an admin is guessing when they assign one"
   *
   * `ROLE_LABEL` and `ROLE_DESCRIPTION` had both existed in this file for a
   * round while the roster printed only the description, in grey, as though it
   * were status text - and the menu deleted the current role from the list
   * entirely, which is the one row that answers "where do they stand now".
   * These assertions are here because a constant that exists and is not
   * rendered is indistinguishable from a shipped feature.
   */
  it("every member row carries a role badge", () => {
    const src = read("apps/web/src/features/teams/pages/TeamsPage.tsx");
    expect(src).toMatch(/<RoleBadge role=\{m\.role\} tier=\{plan\}/);
  });

  it("the badge names and explains the role the way this tier does", () => {
    const src = read("apps/web/src/features/teams/components/RoleBadge.tsx");
    expect(src).toMatch(/roleLabelForTier\(/);
    expect(src).toMatch(/roleDescriptionForTier\(/);
  });

  it("the Manage menu keeps the current role in the list and marks it", () => {
    const src = read("apps/web/src/features/teams/pages/TeamsPage.tsx");
    // The filter that removed it is what made the menu unable to answer
    // "what are they now?".
    expect(src).not.toMatch(/\.filter\(\(role\) => role !== normaliseRole\(m\.role\)\)/);
    expect(src).toMatch(/const currentRole = normaliseRole\(m\.role\)/);
    expect(src).toMatch(/const isCurrent = role === currentRole/);
    // A role this plan can no longer hand out is still listed for whoever
    // holds it, or the tick would be missing for exactly the rows whose role
    // is least obvious - a Manager left on a workspace that downgraded.
    expect(src).toMatch(/current, not on this plan/);
    expect(src).toMatch(/<Check className="h-4 w-4 text-primary" \/>/);
  });

  it("every role option renders its one-liner", () => {
    const src = read("apps/web/src/features/teams/pages/TeamsPage.tsx");
    expect(src).toMatch(/\{roleTitle\(role, plan\)\}/);
  });

  it("the job-scoping row is gated on the tier that has scoping", () => {
    const src = read("apps/web/src/features/teams/pages/TeamsPage.tsx");
    expect(src).toMatch(/tierHasJobScoping\(plan\)/);
  });
});

describe("family: one role vocabulary, not one per screen", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

  /*
   * Three screens showed a role and all three had invented their own words for
   * it. The roster printed the description in grey and no name at all; Settings
   * called an Admin a "Project manager" and defaulted everything it did not
   * recognise - Manager, Standard, Restricted - to "Workspace admin", so a
   * Restricted member opened their own settings and was told they were a
   * workspace admin; Collaborators held a three-entry map and fell through to
   * the raw column, rendering "restricted" in lower case under a CSS capitalize.
   *
   * The client's report was "there's no way to see what role a member currently
   * has". The narrow reading is a missing badge on one list. The actual state
   * was three inconsistent answers to the same question, one of which was
   * wrong, and wrong is worse than missing: missing information makes you go
   * and look.
   *
   * So the rule is that a screen showing a role renders `RoleBadge`, which
   * reads the one matrix. These assertions are what keeps a fourth vocabulary
   * from being added the next time somebody needs a role on a page.
   */
  const ROLE_SURFACES = [
    "apps/web/src/features/teams/pages/TeamsPage.tsx",
    "apps/web/src/features/teams/pages/CollaboratorsPage.tsx",
    "apps/web/src/features/settings/pages/SettingsPage.tsx",
    "apps/web/src/features/projects/components/AssignTeammatesDialog.tsx",
  ];

  it("every screen that shows a role uses the shared badge", () => {
    for (const path of ROLE_SURFACES) {
      expect(read(path), path).toMatch(/<RoleBadge\b/);
    }
  });

  /*
   * Two things are removed before matching.
   *
   * Comments: the retired names are quoted in the notes that record why they
   * went, and a test that forbade naming a mistake would push the next person
   * to delete the explanation rather than the code.
   *
   * Placeholders: "Project manager" is also a perfectly good thing to type into
   * the free-text Job title field on the profile form, and that placeholder has
   * nothing to do with workspace roles. Flagging it would be the test failing to
   * make the distinction this whole describe block is about.
   */
  const strip = (src: string) =>
    src
      .replace(/(?<![\w"'])\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/placeholder="[^"]*"/g, "");

  it("no screen keeps a private map of role names", () => {
    for (const path of ROLE_SURFACES) {
      const src = strip(read(path));
      // The three shapes that were actually there: two local label lookups and
      // the Settings helper that renamed Admin to "Project manager".
      expect(src, path).not.toMatch(/const \w*[rR]ole\w*: Record<string, string> =/);
      expect(src, path).not.toMatch(/function roleTitleFor\(/);
      expect(src, path).not.toMatch(/"Project manager"|"Crew member"|"Workspace admin"/);
    }
  });
});

describe("family: the invite page states the offer accurately", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

  /*
   * The last place a raw role reached a person, and the highest-stakes one.
   *
   * `/invite/$token` printed `invite.role` straight from the column under a CSS
   * capitalize - the same unfriendly-value pattern the roster, Settings and
   * Collaborators each carried - and then promised, for every role alike,
   * "access to all of the team's projects, photos, and reports". For a
   * Restricted invite that was flatly untrue: they get the jobs they are ticked
   * into and nothing else. It is the one screen somebody reads while deciding
   * whether to accept, so a wrong promise there is the worst version of this
   * bug, not the mildest.
   */
  it("names the role through the shared matrix, not the raw column", () => {
    const src = read("apps/web/src/routes/invite.$token.tsx");
    expect(src).toMatch(/roleLabelForTier\(invite\.role, tier\)/);
    /*
     * The role explanation on this page is written in SECOND person from the
     * matrix rather than lifted from ROLE_DESCRIPTION, which addresses the
     * admin doing the assigning: rendering it verbatim told a Restricted
     * invitee "Sees only the jobs you assign them", making the reader both the
     * assigner and the assignee in one sentence.
     */
    expect(src).toMatch(/can\(invite\.role, "billing"\)/);
    expect(src).not.toMatch(/capitalize text-foreground">\{invite\.role\}/);
  });

  it("promises blanket access only to roles that actually have it", () => {
    const src = read("apps/web/src/routes/invite.$token.tsx");
    expect(src).toMatch(/can\(invite\.role, "view_all_projects"\)/);
    // The matrix is what makes the two branches correct.
    expect(can("standard", "view_all_projects")).toBe(true);
    expect(can("restricted", "view_all_projects")).toBe(false);
  });

  it("the lookup returns the tier, or the page cannot name the seat", () => {
    // Team calls the base seat Standard and flatter plans call it Member, so
    // without the tier this page had to guess - and guessed wrong for one of
    // them whichever way it went.
    const src = read("apps/api/src/domains/teams/service.ts");
    expect(src).toMatch(
      /const tier = await callerTierForTeam\(supabaseAdmin, \(invite as any\)\.team_id\)/,
    );
    expect(src).toMatch(/return \{ invite, team, tier \}/);
  });
});
