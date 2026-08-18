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
