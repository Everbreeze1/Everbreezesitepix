import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canScopeProjects,
  memberLabel,
  needsProjectScope,
  scopeChanged,
  scopeChangeWarning,
  scopeSummary,
  sortedProjects,
  toggledProject,
} from "../apps/mobile/src/api/member-projects-view";

/*
 * Scoping a Restricted member to particular jobs.
 *
 * The phone could already demote somebody to Restricted and had no way to say
 * which jobs they may see, which leaves that person fenced to NOTHING until
 * somebody opens the web. Half a permission change is worse than none: the
 * manager believes they have scoped a colleague, and the colleague opens the
 * app to an empty list.
 *
 * Both rules under test decide whether a control appears at all, and both exist
 * to avoid showing something that would be refused or would do nothing.
 */

describe("needsProjectScope", () => {
  it("applies to a Restricted member and nobody else", () => {
    /*
     * Everyone else sees every job on the team by role. Offering to pick their
     * jobs would imply a limit that does not exist - and saving it would
     * quietly staff them onto those jobs as crew, because it is the same
     * `project_assignments` table.
     */
    expect(needsProjectScope({ role: "restricted" })).toBe(true);
    for (const role of ["owner", "admin", "manager", "standard"]) {
      expect(needsProjectScope({ role }), role).toBe(false);
    }
  });

  it("does not treat an unrecognised role as Restricted", () => {
    // Deliberately the exact string, not a normaliser: a role nobody knows must
    // not be silently fenced to nothing.
    expect(needsProjectScope({ role: "Restricted" })).toBe(false);
    expect(needsProjectScope({ role: "wizard" })).toBe(false);
    expect(needsProjectScope({ role: "" })).toBe(false);
  });
});

describe("canScopeProjects", () => {
  it("takes the narrow permission the server actually gates on", () => {
    /*
     * The service checks `manage_users` and nothing else. The team screen's own
     * `canManageUsers` is broader - it also allows `manage_own_crew` - so
     * reusing that would put this control in front of somebody whose save is
     * refused with a 403.
     */
    expect(canScopeProjects({ manageUsers: true })).toBe(true);
    expect(canScopeProjects({ manageUsers: false })).toBe(false);
  });
});

describe("toggledProject", () => {
  it("adds and removes without mutating", () => {
    const before = ["a"];
    expect(toggledProject(before, "b")).toEqual(["a", "b"]);
    expect(toggledProject(["a", "b"], "a")).toEqual(["b"]);
    expect(before).toEqual(["a"]);
  });
});

describe("scopeChanged", () => {
  it("ignores order, because the server replaces the whole set", () => {
    expect(scopeChanged(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("catches an addition, a removal and a swap", () => {
    expect(scopeChanged(["a"], ["a", "b"])).toBe(true);
    expect(scopeChanged(["a", "b"], ["a"])).toBe(true);
    // Same size, different jobs: what a length check alone would miss.
    expect(scopeChanged(["a"], ["b"])).toBe(true);
  });

  it("is false for two empty sets", () => {
    expect(scopeChanged([], [])).toBe(false);
  });
});

describe("scopeSummary", () => {
  it("calls out the empty case rather than printing a zero", () => {
    // It is the state that leaves somebody staring at an empty app, and the one
    // a manager most needs to notice.
    expect(scopeSummary(0)).toContain("see nothing");
    expect(scopeSummary(1)).toBe("1 job");
    expect(scopeSummary(4)).toBe("4 jobs");
  });
});

describe("scopeChangeWarning", () => {
  it("warns only when the list is being emptied", () => {
    /*
     * Emptying is legitimate - it is how somebody is parked without being
     * removed from the team - but it is indistinguishable from a mistake unless
     * the consequence is stated.
     */
    expect(scopeChangeWarning([], "Sam")).toContain("not be able to see any jobs");
    expect(scopeChangeWarning(["a"], "Sam")).toBeNull();
  });

  it("names the person, so the sentence is about somebody", () => {
    expect(scopeChangeWarning([], "Sam Whitfield")).toContain("Sam Whitfield");
  });
});

describe("sortedProjects", () => {
  const projects = [
    { id: "c", name: "Zeta" },
    { id: "a", name: "Alpha" },
    { id: "b", name: "Mid" },
  ];

  it("puts the jobs they already hold first, then alphabetical", () => {
    expect(sortedProjects(projects, ["b"]).map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("does not mutate what it was given", () => {
    const before = projects.map((p) => p.id);
    sortedProjects(projects, ["b"]);
    expect(projects.map((p) => p.id)).toEqual(before);
  });

  it("sorts an unnamed job without throwing", () => {
    const withNull = [{ id: "x", name: null }, ...projects];
    expect(() => sortedProjects(withNull, [])).not.toThrow();
    expect(sortedProjects(withNull, [])).toHaveLength(4);
  });
});

describe("memberLabel", () => {
  it("prefers a name, then the handle in the email, then a placeholder", () => {
    expect(memberLabel({ fullName: "Sam", email: "s@x.test" })).toBe("Sam");
    /*
     * The handle, not the whole address. A row title is one line at heading
     * weight and an address is wider than one: on the team roster the same
     * fallback rendered the workspace owner as "marklagura223@gmail" above
     * ".com". Every name in the app now goes through `personName`.
     *
     * The one exception is `watcherName`, which keeps the full address on
     * purpose, because the watcher list answers "who is getting mailed about
     * this" and the domain is the informative half there.
     */
    expect(memberLabel({ fullName: null, email: "s@x.test" })).toBe("s");
    expect(memberLabel({ fullName: "  ", email: null })).toBe("Teammate");
  });
});

describe("the phone and the server agree", () => {
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/teams/service.ts"), "utf8");
  const registry = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/rpc/registry.ts"), "utf8");
  const client = () =>
    readFileSync(join(process.cwd(), "apps/mobile/src/api/member-projects.ts"), "utf8");

  it("sends the field names the inline schemas read", () => {
    const at = registry().indexOf("setMemberProjects: authed(");
    expect(at).toBeGreaterThan(-1);
    const block = registry().slice(at, at + 500);
    expect(block).toContain("memberId");
    expect(block).toContain("projectIds");
    const c = client();
    expect(c).toContain("memberId");
    expect(c).toContain("projectIds");
  });

  it("allows an empty list, which is how somebody is parked", () => {
    // The schema has `.max(500)` and no `.min()`, and the registry says so.
    const at = registry().indexOf("setMemberProjects: authed(");
    const block = registry().slice(at, at + 500);
    expect(block).toContain("max(500)");
    expect(block).not.toContain("min(1)");
  });

  it("gates on manage_users, which is what the client mirrors", () => {
    const s = service();
    const at = s.indexOf("export async function setMemberProjectsService");
    expect(s.slice(at, at + 600)).toContain('can((caller as any).role, "manage_users")');

    /*
     * And the screen asks for that permission specifically rather than reusing
     * its own broader `canManageUsers`, which also accepts `manage_own_crew`.
     */
    const screen = readFileSync(join(process.cwd(), "apps/mobile/app/(app)/team.tsx"), "utf8");
    expect(screen).toContain('canScopeProjects({ manageUsers: can(myRole, "manage_users") })');
  });

  it("is the same table the project crew uses", () => {
    /*
     * Worth pinning because it is surprising: ticking a job here also staffs
     * that person onto it. There is no separate "visible but not assigned".
     */
    const s = service();
    const at = s.indexOf("export async function setMemberProjectsService");
    expect(s.slice(at, at + 2000)).toContain("project_assignments");
  });
});
