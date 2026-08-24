import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { roleAllowedOnTier, tierHasJobScoping } from "@everlumen/shared/team-permissions";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

/**
 * Putting somebody on a job, from where the job is.
 *
 * `project_assignments` existed for a round with exactly one writer: the
 * Restricted member's "choose their jobs" picker, buried in Team Settings. So
 * the product had an assignment table, an assignment RLS function and no way to
 * answer "who is on this one" from the project you are looking at. Reported as
 * "I'd like to be able to assign them projects from the projects page" and "I
 * should also be able to assign a project directly from that project page to a
 * team member".
 *
 * These are path-based on purpose, the same as the rest of the family tests
 * here: what they guard is not a pure function but the wiring, and wiring is
 * exactly what goes missing.
 */
describe("family: a job can be staffed from the project, not only from Team settings", () => {
  it("the RPC exists on both ends of the wire", () => {
    const registry = read("apps/api/src/domains/rpc/registry.ts");
    expect(registry).toMatch(/getProjectAssignees: authed\(/);
    expect(registry).toMatch(/setProjectAssignees: authed\(/);

    const web = read("apps/web/src/lib/teams.functions.ts");
    expect(web).toMatch(/rpcOp<\s*\{ projectIds: string\[\] \}/);
    expect(web).toMatch(/rpcOp<\s*\{ projectId: string; userIds: string\[\] \}/);
  });

  it("the server decides who may staff a job, and says so in its answer", () => {
    const src = read("apps/api/src/domains/teams/service.ts");
    // Same capabilities the roster gates on, not a second hand-rolled rule.
    expect(src).toMatch(/function mayAssignCrew\(/);
    expect(src).toMatch(
      /can\(role as string, "manage_users"\) \|\| can\(role as string, "manage_own_crew"\)/,
    );
    // `canAssign` travels with the data so the button cannot appear on a write
    // the server would refuse.
    expect(src).toMatch(/canAssign: mayAssignCrew\(/);
  });

  it("ids from the browser are checked against the caller's own team", () => {
    const src = read("apps/api/src/domains/teams/service.ts");
    // project_assignments has no team column, so both ends have to be proved.
    expect(src).toMatch(/That project is not part of your team\./);
    expect(src).toMatch(/That person is not on your team\./);
  });

  it("reading the crew respects what the caller can actually see", () => {
    /*
     * The read filters through `ctx.supabase`, the caller's own RLS-scoped
     * client, rather than the service role. A Restricted member is on the team
     * and fenced to a few of its jobs; answering "who is on job X" for a job
     * they cannot open would hand back exactly what their role withholds.
     */
    const src = read("apps/api/src/domains/teams/service.ts");
    expect(src).toMatch(/const \{ data: visible \} = await ctx\.supabase/);
  });

  it("only the people newly added are notified", () => {
    // Re-saving the dialog unchanged must not re-notify the whole crew.
    const src = read("apps/api/src/domains/teams/service.ts");
    expect(src).toMatch(/\.filter\(\(id\) => !existing\.has\(id\)\)/);
    expect(src).toMatch(/type: "project_assigned"/);
  });

  it("the notification type is allowed by the database", () => {
    // The CHECK constraint is the whole difference between a notification and a
    // 500 nobody sees until somebody assigns their first teammate.
    const sql = read("supabase/migrations/20260919000000_project_assignment_notifications.sql");
    expect(sql).toMatch(/'project_assigned'/);
    expect(sql).toMatch(/entity_type IN \(/);
    expect(sql).toMatch(/'project'/);
    const api = read("apps/api/src/domains/notifications/service.ts");
    expect(api).toMatch(/\| "project_assigned"/);
  });

  it("both screens the client named can open the dialog", () => {
    const list = read("apps/web/src/features/projects/pages/ProjectsPage.tsx");
    expect(list).toMatch(/<AssignTeammatesDialog/);
    expect(list).toMatch(/Assign teammates/);

    const detail = read("apps/web/src/features/projects/pages/ProjectDetailPage.tsx");
    expect(detail).toMatch(/<AssignTeammatesDialog/);
    expect(detail).toMatch(/<ProjectCrew/);
  });

  it("the pipeline board can staff a job too", () => {
    /*
     * A pipeline is where staffing actually gets decided: you move a job into
     * Scheduled and the next question is who is doing it. Leaving the board out
     * would have made "assign from the projects page" true of one of that
     * page's two views.
     */
    const board = read("apps/web/src/features/projects/components/PipelineBoardView.tsx");
    expect(board).toMatch(/useProjectAssignees\(/);
    expect(board).toMatch(/<AssignTeammatesDialog/);
    // Display only on the card itself: the card is the drag handle, and an
    // interactive chip inside it competes with the gesture that moves the job.
    expect(board).toMatch(/<ProjectCrew userIds=\{crew\} canAssign=\{false\}/);
  });

  it("the grid resolves every visible card in one request", () => {
    // One query per card is sixty requests to draw one screen.
    const list = read("apps/web/src/features/projects/pages/ProjectsPage.tsx");
    expect(list).toMatch(/useProjectAssignees\(/);
    expect(list).toMatch(/projects\.slice\(0, 200\)\.map\(\(p\) => p\.id\)/);
  });
});

describe("family: 'contributor' says what it means now", () => {
  /*
   * "Right now on the individual project page there are a few places that say
   * Contributor but when I hover over it there is no information."
   *
   * There were two, both a bare `<span>` holding a number and a word, forty
   * pixels apart in the same header. One is gone; the other is a chip that
   * names the people, says what each of them did here, and distinguishes a
   * contributor (what has happened) from the crew (what someone decided).
   */
  it("the header chip carries the names and the explanation", () => {
    const src = read("apps/web/src/features/projects/components/ProjectContributors.tsx");
    expect(src).toMatch(/export function ContributorsChip\(/);
    expect(src).toMatch(/People who have added photos, tasks or documents here/);
    // Names, and what each of them actually did, not just a count in a box.
    expect(src).toMatch(/function contributionLine\(/);
  });

  it("the project header no longer prints an unexplained count", () => {
    const src = read("apps/web/src/features/projects/pages/ProjectDetailPage.tsx");
    expect(src).toMatch(/<ContributorsChip contributors=\{contributorRows\}/);
    // The bare hero span and its duplicate in the stats rail.
    expect(src).not.toMatch(/\{contributors\.length\}\{" "\}/);
    expect(src).not.toMatch(
      /\{contributors\.length\} \{contributors\.length === 1 \? "contributor" : "contributors"\}/,
    );
  });

  it("crew and contributors are different components, because they answer different questions", () => {
    const crew = read("apps/web/src/features/projects/components/ProjectCrew.tsx");
    expect(crew).toMatch(/Deliberately a different thing from `ProjectContributors`/);
  });
});

describe("staffing a job is not the same permission as scoping a person", () => {
  /*
   * The line the pricing page sells. Everyone can be put on a job, on every
   * plan - that is a crew list and grants nothing, because every role except
   * Restricted already reaches every project. Scoping somebody so the ticked
   * jobs are the ONLY ones they can open is the Restricted role, and that is
   * Team's. Collapsing the two would either hand Pro the thing Team sells, or
   * take crew lists away from Pro for no reason.
   */
  it("Pro staffs jobs but cannot scope anybody", () => {
    expect(tierHasJobScoping("pro")).toBe(false);
    expect(roleAllowedOnTier("restricted", "pro")).toBe(false);
  });

  it("the dialog only warns about scoping when somebody scoped is ticked", () => {
    const src = read("apps/web/src/features/projects/components/AssignTeammatesDialog.tsx");
    expect(src).toMatch(/restrictedSelected > 0/);
  });

  it("the roster's scoping picker stays behind the tier that has scoping", () => {
    const src = read("apps/web/src/features/teams/pages/TeamsPage.tsx");
    expect(src).toMatch(/tierHasJobScoping\(plan\) &&/);
  });
});
