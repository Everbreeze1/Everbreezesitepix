import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { roleAllowedOnTier, tierHasJobScoping } from "@everlumen/shared/team-permissions";
import { attributionText } from "../apps/web/src/features/projects/utils/contributor-attribution";

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

describe("family: the crew is a decision, the log is a record", () => {
  /*
   * Managers staffing a job read the old header as one list with two names for
   * it: "Crew · Sam" and "3 contributors" sat forty pixels apart, a number
   * next to an avatar stack reads as a headcount no matter what word is
   * attached, and the only explanation appeared in a hover panel a phone never
   * opens.
   *
   * The activity side is now an attribution line - "Logged by Dana · 12
   * photos added · 2h ago" - beside the photos it describes, and the crew
   * keeps the header with a permanent caption saying what it is.
   */
  it("writes the attribution as a log line, not a headcount", () => {
    const rules = read("apps/web/src/features/projects/utils/contributor-attribution.ts");
    expect(rules).toMatch(/export function attributionText\(/);
    expect(rules).toMatch(/Logged by/);
    expect(rules).toMatch(/photos added/);
    // The reason this replaced the chip: no "N contributors" count anywhere.
    expect(rules).not.toMatch(/contributors\.length/);
    // And the component really renders it next to the photos.
    const line = read("apps/web/src/features/projects/components/ProjectActivityLine.tsx");
    expect(line).toContain("attributionText(contributors)");
    expect(line).toContain("Who has been adding photos here");
  });

  it("attributes photos to the people who actually added them", () => {
    const hour = 3600 * 1000;
    const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * hour).toISOString();
    const base = { email: "x@example.com", avatarUrl: null, tasks: 0, reports: 0 };
    const one = { userId: "1", fullName: "Dana Rojas", photos: 12, lastAt: at(2), ...base };
    const two = { userId: "2", fullName: "Marcus Klein", photos: 3, lastAt: at(5), ...base };
    const three = { userId: "3", fullName: "Ada Lovelace", photos: 1, lastAt: at(8), ...base };

    expect(attributionText([one])).toBe("Logged by Dana Rojas · 12 photos added · 2h ago");
    expect(attributionText([one, two])).toBe(
      "Logged by Dana Rojas and Marcus Klein · 15 photos added · 2h ago",
    );
    expect(attributionText([one, two, three])).toBe(
      "Logged by Dana Rojas, Marcus Klein and 1 other · 16 photos added · 2h ago",
    );
  });

  it("the most recent activity leads and the count sums the photos", () => {
    // `two` uploaded later than `one`, so their order must not matter.
    const hour = 3600 * 1000;
    const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * hour).toISOString();
    const base = { email: "x@example.com", avatarUrl: null, tasks: 0, reports: 0 };
    const one = { userId: "1", fullName: "Dana Rojas", photos: 12, lastAt: at(5), ...base };
    const two = { userId: "2", fullName: "Marcus Klein", photos: 3, lastAt: at(1), ...base };
    expect(attributionText([one, two])).toBe(
      "Logged by Marcus Klein and Dana Rojas · 15 photos added · 1h ago",
    );
  });

  it("says nothing on a job nobody has shot yet", () => {
    expect(attributionText([])).toBeNull();
    expect(
      attributionText([
        {
          userId: "1",
          fullName: "Dana",
          email: "d@x.com",
          avatarUrl: null,
          photos: 0,
          tasks: 4,
          reports: 0,
          lastAt: "2026-09-09T00:00:00.000Z",
        },
      ]),
    ).toBeNull();
  });

  it("keeps only people with photos on the photos section's line", () => {
    // A task-writer with no photos must not crowd out the photo attribution.
    const rows = [
      {
        userId: "1",
        fullName: "Dana",
        email: "d@x.com",
        avatarUrl: null,
        photos: 10,
        tasks: 0,
        reports: 0,
        lastAt: "2026-09-09T00:00:00.000Z",
      },
      {
        userId: "2",
        fullName: "Marcus",
        email: "m@x.com",
        avatarUrl: null,
        photos: 0,
        tasks: 9,
        reports: 0,
        lastAt: "2026-09-10T00:00:00.000Z",
      },
    ];
    expect(attributionText(rows)).toContain("Logged by Dana");
    expect(attributionText(rows)).not.toContain("Marcus");
  });

  it("the header is for the crew; the attribution lives with the photos", () => {
    const src = read("apps/web/src/features/projects/pages/ProjectDetailPage.tsx");
    // No contributor chip beside the Assign control any more.
    expect(src).not.toMatch(/<ContributorsChip/);
    // The header (everything before the Visual documentation section) has no
    // attribution; the photos section has it, directly under its heading.
    const header = src.slice(0, src.indexOf("Visual documentation"));
    expect(header).not.toMatch(/Logged by/);
    const docs = src.slice(src.indexOf("Visual documentation"));
    expect(docs).toContain("The field, on record");
    expect(docs).toMatch(/ProjectActivityLine contributors=\{contributorRows\}/);
  });

  it("the crew explains itself in permanent words, not a hover", () => {
    const crew = read("apps/web/src/features/projects/components/ProjectCrew.tsx");
    expect(crew).toContain("caption?: string");
    const detail = read("apps/web/src/features/projects/pages/ProjectDetailPage.tsx");
    const usage = detail.slice(detail.indexOf("<ProjectCrew"));
    expect(usage.slice(0, 500)).toContain(`caption="Who this job is assigned to."`);
  });

  it("crew and attribution are different things, because they answer different questions", () => {
    const crew = read("apps/web/src/features/projects/components/ProjectCrew.tsx");
    expect(crew).toMatch(/Deliberately a different thing from the attribution line/);
  });

  it("the project header labels the crew persistently", () => {
    /*
     * Both header rows opened as bare initials, and the crew's initials read as
     * an unexplained count. The header now says "Crew · Sam, Alex" without a
     * hover; the projects grid keeps the bare stack, so the label is an opt-in
     * the header takes and the cards do not.
     */
    const crew = read("apps/web/src/features/projects/components/ProjectCrew.tsx");
    expect(crew).toContain("labeled = false");
    expect(crew).toMatch(/`Crew /);
    const detail = read("apps/web/src/features/projects/pages/ProjectDetailPage.tsx");
    const usage = detail.slice(detail.indexOf("<ProjectCrew"));
    expect(usage.slice(0, 300)).toContain("labeled");
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
