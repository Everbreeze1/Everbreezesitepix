import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isScheduledStageName } from "../packages/shared/src/pipeline-stages";
import { isPlausibleCalendarDate } from "../packages/shared/src/calendar-date";
import {
  addCalendarDays,
  attentionCount,
  buildWorkspaceSchedule,
  coversRange,
  entryTypeLabel,
  supportsScheduledDate,
  type SchedulableProject,
  type SchedulableTask,
  type StageLite,
} from "../apps/web/src/lib/workspace-schedule";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const MIGRATION = read("supabase/migrations/20260923000000_project_scheduled_date.sql");
const PROJECTS_PAGE = read("apps/web/src/features/projects/pages/ProjectsPage.tsx");
const SCHEDULE = read("apps/web/src/features/projects/components/WorkspaceSchedule.tsx");
const LIB = read("apps/web/src/lib/workspace-schedule.ts");
const PHOTO_CALENDAR = read("apps/web/src/features/gallery/components/PhotoCalendar.tsx");
const DETAIL_PAGE = read("apps/web/src/features/projects/pages/ProjectDetailPage.tsx");
const INDEX_ROUTE = read("apps/web/src/routes/_app.projects.index.tsx");
const HOOK = read("apps/web/src/hooks/use-workspace-schedule.ts");
const TASKS = read("apps/web/src/features/projects/components/ProjectTasks.tsx");

/*
 * The client's report, in full:
 *
 *   "We should add a workspace-level Calendar as a fourth tab on the Projects
 *    page, alongside Projects / Groups / Pipelines. Right now there's no way to
 *    see what's happening across all jobs at once - the existing Calendar only
 *    exists per-project and just shows capture activity (which days photos were
 *    taken on that specific job), not scheduling. With dozens of active
 *    projects, there's no single place to answer 'what's due today' or 'what's
 *    scheduled this week' without opening each project individually. This new
 *    tab should aggregate task due dates and Pipeline 'Scheduled' stage jobs
 *    from every project into one forward-looking calendar view, with each entry
 *    clickable to jump straight to that project. Keep the existing per-project
 *    Calendar as-is."
 *
 * Every test below is one clause of that.
 */

/** 20 August 2026, local, which is the day every fixture is measured against. */
const NOW = new Date(2026, 7, 20, 14, 30);
const TODAY = "2026-08-20";

const SCHEDULED_STAGE: StageLite = { id: "s-sched", name: "Scheduled", color: "#3b82f6" };
const LEAD_STAGE: StageLite = { id: "s-lead", name: "Lead/Quoted", color: "#64748b" };
const UNSCHEDULED_STAGE: StageLite = { id: "s-un", name: "Unscheduled", color: "#94a3b8" };

const STAGES = new Map<string, StageLite>([
  [SCHEDULED_STAGE.id, SCHEDULED_STAGE],
  [LEAD_STAGE.id, LEAD_STAGE],
  [UNSCHEDULED_STAGE.id, UNSCHEDULED_STAGE],
]);

const project = (over: Partial<SchedulableProject> & { id: string }): SchedulableProject => ({
  name: `Project ${over.id}`,
  status: "active",
  archived: false,
  pipeline_stage_id: null,
  scheduled_date: null,
  ...over,
});

const task = (over: Partial<SchedulableTask> & { id: string; project_id: string }) => ({
  title: `Task ${over.id}`,
  status: "open",
  priority: "normal",
  due_date: null,
  assignee_email: null,
  ...over,
});

const build = (projects: SchedulableProject[], tasks: SchedulableTask[] = []) =>
  buildWorkspaceSchedule({ projects, tasks, stagesById: STAGES, now: NOW });

describe("what a 'Scheduled' stage is called", () => {
  it("recognises the columns a booked job actually sits in", () => {
    for (const name of ["Scheduled", "scheduled", "Booked", "Dispatch", "On-site appointment"]) {
      expect(isScheduledStageName(name), name).toBe(true);
    }
  });

  /*
   * The half that matters. "Unscheduled" and "To schedule" are ordinary column
   * names for the queue of work with NO date, and they all contain the word. A
   * plain /schedul/ match would have listed the entire un-booked backlog as
   * booked work, which is the opposite of the question being asked.
   */
  it("does not mistake the not-yet-booked queue for booked work", () => {
    for (const name of [
      "Unscheduled",
      "To schedule",
      "To Be Scheduled",
      "Needs scheduling",
      "Awaiting scheduling",
      "Pending scheduling",
    ]) {
      expect(isScheduledStageName(name), name).toBe(false);
    }
  });

  it("says no to the columns that have nothing to do with a date", () => {
    for (const name of ["Lead/Quoted", "In Progress", "Invoiced", "Paid", ""]) {
      expect(isScheduledStageName(name), name).toBe(false);
    }
  });
});

describe("the two things the calendar aggregates", () => {
  it("puts a task on the day its due date says, from any project", () => {
    const schedule = build(
      [project({ id: "p1", name: "Maple St" }), project({ id: "p2", name: "Oak Ave" })],
      [
        task({ id: "t1", project_id: "p1", due_date: TODAY, title: "Snag the render" }),
        task({ id: "t2", project_id: "p2", due_date: "2026-08-22", title: "Chase the part" }),
      ],
    );

    expect(schedule.byDate.get(TODAY)?.map((e) => e.title)).toEqual(["Snag the render"]);
    expect(schedule.byDate.get("2026-08-22")?.map((e) => e.title)).toEqual(["Chase the part"]);
    // The click target: the project, and the one task inside it.
    expect(schedule.byDate.get(TODAY)![0].projectId).toBe("p1");
    expect(schedule.byDate.get(TODAY)![0].taskId).toBe("t1");
  });

  it("puts a booked job on the day it is booked for, named after the project", () => {
    const schedule = build([
      project({
        id: "p1",
        name: "Maple St",
        pipeline_stage_id: SCHEDULED_STAGE.id,
        scheduled_date: "2026-08-24",
      }),
    ]);

    const [entry] = schedule.byDate.get("2026-08-24")!;
    expect(entry.kind).toBe("job");
    expect(entry.title).toBe("Maple St");
    expect(entry.detail).toBe("Scheduled");
    expect(entry.color).toBe(SCHEDULED_STAGE.color);
    expect(entry.taskId).toBeNull();
    expect(entry.projectId).toBe("p1");
  });

  /*
   * A date somebody typed is a date somebody typed. Gating the grid on the
   * stage name as well would mean a job booked for Tuesday vanishing off the
   * calendar the moment it was dragged to "In Progress", which is the one
   * moment you most want to know it is happening.
   */
  it("plots a booked job whatever column it is standing in", () => {
    const schedule = build([
      project({ id: "p1", pipeline_stage_id: LEAD_STAGE.id, scheduled_date: "2026-08-24" }),
      project({ id: "p2", pipeline_stage_id: null, scheduled_date: "2026-08-24" }),
    ]);
    expect(schedule.byDate.get("2026-08-24")).toHaveLength(2);
  });

  it("reads a date as a calendar date, so it never lands a day early", () => {
    // The bug packages/shared/src/calendar-date.ts exists to prevent: parsed as
    // a UTC instant, "2026-08-20" renders as the 19th west of Greenwich.
    const schedule = build(
      [project({ id: "p1" })],
      [task({ id: "t1", project_id: "p1", due_date: TODAY })],
    );
    expect(schedule.entries[0].date).toBe(TODAY);
    expect(schedule.today).toHaveLength(1);
  });

  it("ignores a value that is not a calendar date at all", () => {
    const schedule = build(
      [project({ id: "p1", scheduled_date: "not a date" })],
      [
        task({ id: "t1", project_id: "p1", due_date: "" }),
        task({ id: "t2", project_id: "p1", due_date: "2026-02-31" }),
      ],
    );
    expect(schedule.entries).toHaveLength(0);
  });

  /*
   * `projects.scheduled_date` already existed in a deployed database before the
   * migration that declares it, created outside this repo, so its type there is
   * not something the browser can assume. A timestamp column hands back
   * "2026-08-20T00:00:00+00:00", and a strict "YYYY-MM-DD" match would have
   * dropped every booked job off the grid without a word. The migration raises
   * a notice naming the column to convert; this is what keeps the calendar
   * usable in the meantime.
   */
  it("still finds the day when the column hands back a full timestamp", () => {
    const schedule = build([
      project({ id: "p1", scheduled_date: "2026-08-24T00:00:00+00:00" }),
      project({ id: "p2", scheduled_date: "2026-08-24 09:30:00" }),
    ]);
    expect(schedule.byDate.get("2026-08-24")).toHaveLength(2);
  });
});

describe("jobs in a Scheduled stage that nobody has given a day to", () => {
  it("lists them, so the tab does not silently drop them", () => {
    const schedule = build([
      project({ id: "p1", name: "Maple St", pipeline_stage_id: SCHEDULED_STAGE.id }),
      project({ id: "p2", name: "Oak Ave", pipeline_stage_id: LEAD_STAGE.id }),
    ]);
    expect(schedule.awaitingDate).toHaveLength(1);
    expect(schedule.awaitingDate[0]).toMatchObject({
      projectId: "p1",
      projectName: "Maple St",
      stageName: "Scheduled",
    });
  });

  it("drops out of the list the moment the job has a day", () => {
    const schedule = build([
      project({
        id: "p1",
        pipeline_stage_id: SCHEDULED_STAGE.id,
        scheduled_date: "2026-08-25",
      }),
    ]);
    expect(schedule.awaitingDate).toHaveLength(0);
    expect(schedule.byDate.get("2026-08-25")).toHaveLength(1);
  });

  it("does not treat an 'Unscheduled' column as booked work waiting on a date", () => {
    const schedule = build([project({ id: "p1", pipeline_stage_id: UNSCHEDULED_STAGE.id })]);
    expect(schedule.awaitingDate).toHaveLength(0);
  });
});

describe("what does not belong on a forward-looking calendar", () => {
  it("leaves archived projects out entirely", () => {
    const schedule = build(
      [project({ id: "p1", archived: true, scheduled_date: TODAY })],
      [task({ id: "t1", project_id: "p1", due_date: TODAY })],
    );
    // Both halves: the job itself, and the tasks hanging off it.
    expect(schedule.entries).toHaveLength(0);
  });

  it("leaves an archived job out of the awaiting-a-date list too", () => {
    const schedule = build([
      project({ id: "p1", archived: true, pipeline_stage_id: SCHEDULED_STAGE.id }),
    ]);
    expect(schedule.awaitingDate).toHaveLength(0);
  });

  /*
   * A task whose project the viewer cannot see is a row that renders a name it
   * does not have and links somewhere that 404s. Dropped rather than shown as
   * "Unknown project".
   */
  it("drops a task whose project is not in the visible set", () => {
    const schedule = build(
      [project({ id: "p1" })],
      [task({ id: "t1", project_id: "deleted-project", due_date: TODAY })],
    );
    expect(schedule.entries).toHaveLength(0);
  });
});

describe("overdue, which is the thing people actually get caught by", () => {
  it("marks open work whose day has passed", () => {
    const schedule = build(
      [project({ id: "p1" })],
      [task({ id: "t1", project_id: "p1", due_date: "2026-08-18" })],
    );
    expect(schedule.overdue.map((e) => e.key)).toEqual(["task:t1"]);
  });

  it("never marks something already finished", () => {
    const schedule = build(
      [project({ id: "p1", status: "completed", scheduled_date: "2026-08-01" })],
      [task({ id: "t1", project_id: "p1", due_date: "2026-08-18", status: "done" })],
    );
    expect(schedule.overdue).toHaveLength(0);
    expect(schedule.entries.every((e) => e.done)).toBe(true);
  });

  it("does not call today overdue", () => {
    const schedule = build(
      [project({ id: "p1" })],
      [task({ id: "t1", project_id: "p1", due_date: TODAY })],
    );
    expect(schedule.overdue).toHaveLength(0);
    expect(schedule.today).toHaveLength(1);
  });

  it("counts a slipped booked job as overdue as well as a slipped task", () => {
    const schedule = build([project({ id: "p1", scheduled_date: "2026-08-10" })]);
    expect(schedule.overdue).toHaveLength(1);
    expect(schedule.overdue[0].kind).toBe("job");
  });
});

describe("'what's scheduled this week'", () => {
  it("is today plus the next six days, open work only", () => {
    const schedule = build(
      [project({ id: "p1" })],
      [
        task({ id: "yesterday", project_id: "p1", due_date: "2026-08-19" }),
        task({ id: "today", project_id: "p1", due_date: TODAY }),
        task({ id: "sixth-day", project_id: "p1", due_date: "2026-08-26" }),
        task({ id: "seventh-day", project_id: "p1", due_date: "2026-08-27" }),
        task({ id: "done-today", project_id: "p1", due_date: TODAY, status: "done" }),
      ],
    );
    expect(schedule.next7.map((e) => e.taskId).sort()).toEqual(["sixth-day", "today"]);
  });

  it("counts a whole week without a daylight-saving boundary sliding it", () => {
    // 25 October 2026 is the European clock change; 1 November is the US one.
    expect(addCalendarDays("2026-10-24", 6)).toBe("2026-10-30");
    expect(addCalendarDays("2026-10-29", 6)).toBe("2026-11-04");
    expect(addCalendarDays("2026-08-20", -1)).toBe("2026-08-19");
  });
});

describe("the order things read in inside one day", () => {
  it("puts the site visit above the punch list, and urgent above the rest", () => {
    const schedule = build(
      [project({ id: "p1", name: "Maple St", scheduled_date: TODAY })],
      [
        task({ id: "t-normal", project_id: "p1", due_date: TODAY, title: "Normal" }),
        task({
          id: "t-urgent",
          project_id: "p1",
          due_date: TODAY,
          title: "Urgent",
          priority: "urgent",
        }),
        task({
          id: "t-done",
          project_id: "p1",
          due_date: TODAY,
          title: "Already done",
          priority: "urgent",
          status: "done",
        }),
      ],
    );
    expect(schedule.byDate.get(TODAY)!.map((e) => e.title)).toEqual([
      "Maple St",
      "Urgent",
      "Normal",
      "Already done",
    ]);
  });

  it("sorts the days themselves oldest first", () => {
    const schedule = build(
      [project({ id: "p1" })],
      [
        task({ id: "b", project_id: "p1", due_date: "2026-09-01" }),
        task({ id: "a", project_id: "p1", due_date: "2026-08-01" }),
      ],
    );
    expect(schedule.entries.map((e) => e.date)).toEqual(["2026-08-01", "2026-09-01"]);
  });
});

describe("the number on the tab", () => {
  it("is open work that has landed or is late, not everything ever dated", () => {
    const schedule = build(
      [project({ id: "p1" })],
      [
        task({ id: "late", project_id: "p1", due_date: "2026-08-01" }),
        task({ id: "today", project_id: "p1", due_date: TODAY }),
        task({ id: "done-today", project_id: "p1", due_date: TODAY, status: "done" }),
        task({ id: "next-spring", project_id: "p1", due_date: "2027-04-01" }),
      ],
    );
    expect(attentionCount(schedule)).toBe(2);
  });

  it("is zero on a quiet workspace rather than a number nobody has to act on", () => {
    const schedule = build(
      [project({ id: "p1" })],
      [task({ id: "later", project_id: "p1", due_date: "2026-12-01" })],
    );
    expect(attentionCount(schedule)).toBe(0);
  });
});

describe("a database where the migration has not been applied yet", () => {
  /*
   * `select("*")` returns the key on every row once the column exists and omits
   * it until then, so the presence of the key is the probe. `null` means "no
   * day booked", which is a different answer from "this database has no such
   * column" and must not be confused with it.
   */
  it("tells 'column is missing' apart from 'no day booked'", () => {
    expect(supportsScheduledDate([{ id: "p1", name: "A" }])).toBe(false);
    expect(supportsScheduledDate([{ id: "p1", name: "A", scheduled_date: null }])).toBe(true);
    expect(supportsScheduledDate([{ id: "p1", name: "A", scheduled_date: TODAY }])).toBe(true);
  });

  it("still shows every task due date and every Scheduled-stage job", () => {
    const withoutColumn: SchedulableProject[] = [
      { id: "p1", name: "Maple St", archived: false, pipeline_stage_id: SCHEDULED_STAGE.id },
    ];
    const schedule = buildWorkspaceSchedule({
      projects: withoutColumn,
      tasks: [task({ id: "t1", project_id: "p1", due_date: TODAY })],
      stagesById: STAGES,
      now: NOW,
    });
    expect(schedule.today).toHaveLength(1);
    expect(schedule.awaitingDate).toHaveLength(1);
  });
});

/*
 * Caught reviewing the first cut of this, not by any of the tests above.
 *
 * Task due dates are read inside a bounded window and under a row cap. Booked
 * jobs are not: they ride along on the projects the page already holds. The
 * month grid pages without limit, so paging past the window drew the jobs and
 * silently none of the tasks - a month that is half true and reads as a quiet
 * one. PhotoCalendar had already written down why that is the worst possible
 * failure for a calendar ("a count that is quietly short is worse than no
 * calendar") and shipped a `capped` warning for it; this had neither.
 */
describe("saying when the answer is short", () => {
  it("treats a month inside the window as fully covered", () => {
    const coverage = { from: "2026-02-21", to: "2028-02-21", capped: false };
    expect(coversRange(coverage, "2026-08-01", "2026-08-31")).toBe(true);
  });

  it("flags a month the task read never reached", () => {
    const coverage = { from: "2026-02-21", to: "2028-02-21", capped: false };
    expect(coversRange(coverage, "2025-03-01", "2025-03-31")).toBe(false);
    expect(coversRange(coverage, "2028-06-01", "2028-06-30")).toBe(false);
  });

  it("says nothing while the read is still in flight, rather than crying wolf", () => {
    expect(coversRange(null, "1999-01-01", "2099-12-31")).toBe(true);
  });

  it("flags the month the window ends in, not just the ones past it", () => {
    // Half a month of tasks is still a month drawn short.
    const coverage = { from: "2026-02-21", to: "2026-08-15", capped: false };
    expect(coversRange(coverage, "2026-08-01", "2026-08-31")).toBe(false);
  });

  it("carries the coverage out with the schedule so the view can render it", () => {
    const coverage = { from: "2026-02-21", to: "2026-08-15", capped: true };
    const schedule = buildWorkspaceSchedule({
      projects: [project({ id: "p1" })],
      tasks: [],
      stagesById: STAGES,
      taskCoverage: coverage,
      now: NOW,
    });
    expect(schedule.taskCoverage).toEqual(coverage);
  });

  it("is null when nothing has reported, which is the loading state", () => {
    expect(build([project({ id: "p1" })]).taskCoverage).toBeNull();
  });

  it("is stated on screen both ways", () => {
    expect(SCHEDULE).toContain("coversRange");
    expect(SCHEDULE).toContain("Task due dates aren&apos;t loaded this far out");
    expect(SCHEDULE).toContain("schedule.taskCoverage?.capped");
  });

  it("walks the window's far end back to what the capped read actually returned", () => {
    // Claiming the full window after the cap cut it short would be the same
    // silent lie one level down.
    expect(HOOK).toContain("tasks.length >= TASK_LIMIT");
    expect(HOOK).toContain("to: lastDate");
  });
});

/*
 * "Please check the year-segment handling on that date input."
 *
 * `<input type="date">` emits a COMPLETE, VALID value on every segment change.
 * Typing the year 2026 therefore produces 0002, 0020, 0202 and then 2026, and
 * the first cut wrote all four to the database with a toast each, moving the
 * booked job two millennia up the grid between keystrokes.
 */
describe("typing a year into a date field", () => {
  it("rejects the years that are only half typed", () => {
    for (const partial of ["0002-08-24", "0020-08-24", "0202-08-24"]) {
      expect(isPlausibleCalendarDate(partial), partial).toBe(false);
    }
  });

  it("accepts the year once it is finished", () => {
    expect(isPlausibleCalendarDate("2026-08-24")).toBe(true);
    expect(isPlausibleCalendarDate("1999-12-31")).toBe(true);
  });

  /*
   * The check has to be a RANGE and not a length: the browser zero-pads, so
   * "0202" is four characters and a length check would wave it through.
   */
  it("cannot be replaced by a length check, because the browser zero-pads", () => {
    expect("0202-08-24".length).toBe("2026-08-24".length);
    expect(isPlausibleCalendarDate("0202-08-24")).toBe(false);
  });

  it("still refuses what was never a date", () => {
    expect(isPlausibleCalendarDate("2026-02-31")).toBe(false);
    expect(isPlausibleCalendarDate("not a date")).toBe(false);
    expect(isPlausibleCalendarDate("")).toBe(false);
    expect(isPlausibleCalendarDate(null)).toBe(false);
  });

  it("is what the schedule's date field commits through", () => {
    expect(SCHEDULE).toContain("function ScheduleDateInput");
    expect(SCHEDULE).toContain("isPlausibleCalendarDate(next)");
    expect(SCHEDULE).toContain("isPlausibleCalendarDate(draft)");
  });

  /*
   * The same defect, found one screen over while checking this one, and worse
   * there: the task list's bulk due-date field writes across EVERY selected
   * task and then calls notifyTaskChanged on each, so typing a year on a batch
   * of six sent three rounds of "your task is due" mail announcing the years 2,
   * 20 and 202 before the real one. It is uncontrolled, so it needed the guard
   * and not the draft.
   */
  it("also guards the bulk due-date field, which writes N rows and sends N emails", () => {
    expect(TASKS).toContain("isPlausibleCalendarDate(e.target.value)");
    expect(TASKS).not.toContain("e.target.value &&\n                void bulkPatch(");
  });

  /*
   * The other half. A field controlled on the SAVED value re-renders the
   * segments from whatever was last written while the person is still typing
   * into them, so the field holds its own draft and only follows the saved
   * value when that changes underneath it.
   */
  it("holds a draft, so nothing rewrites the segments mid-keystroke", () => {
    expect(SCHEDULE).toContain("const [draft, setDraft] = useState(value)");
    expect(SCHEDULE).toContain("setDraft(value)");
    // The two raw controlled inputs the fix replaced are gone.
    expect(SCHEDULE).not.toContain("value={entry.date}\n            onChange=");
    expect(SCHEDULE).not.toContain('value=""\n            onChange=');
  });
});

describe("the column that makes a booked day possible", () => {
  it("is a date, for the same reason tasks.due_date is", () => {
    expect(MIGRATION).toContain("ADD COLUMN IF NOT EXISTS scheduled_date date");
    expect(MIGRATION).not.toMatch(/scheduled_date\s+timestamptz/);
  });

  it("is indexed only where it is set, since most of a pipeline has no date", () => {
    expect(MIGRATION).toContain("projects_scheduled_date_idx");
    expect(MIGRATION).toContain("WHERE scheduled_date IS NOT NULL");
  });

  /*
   * 20260922000000_pipeline_stage_status.sql tied projects.status to the stage
   * because those two were one fact recorded twice. A stage and a date are two
   * different facts: a job can be booked for the 22nd and still be at
   * "Lead/Quoted". Wiring them would make dragging a card invent or destroy a
   * date nobody chose.
   */
  it("does not tie itself to the pipeline stage in either direction", () => {
    expect(MIGRATION).not.toMatch(/CREATE\s+(OR REPLACE\s+)?TRIGGER/i);
    expect(MIGRATION).not.toMatch(/UPDATE\s+public\.projects\s+SET\s+scheduled_date/i);
  });
});

describe("the tab itself", () => {
  it("is the fourth destination, not a filter over the project list", () => {
    expect(PROJECTS_PAGE).toContain('type TabKey = "projects" | "groups" | "boards" | "schedule"');
    expect(PROJECTS_PAGE).toContain('{ key: "schedule", label: "Schedule"');
    expect(PROJECTS_PAGE).toContain("<WorkspaceSchedule");
  });

  /*
   * "This new workspace-level tab is currently called 'Calendar,' which
   * collides with the existing per-project 'Calendar' tab (the historical
   * photo capture log) - two different features with the same name will
   * confuse users."
   *
   * The word "Calendar" now belongs to exactly one thing in this product, and
   * that thing is the per-project capture log.
   */
  it("does not call itself Calendar anywhere a person can read", () => {
    expect(PROJECTS_PAGE).not.toContain('label: "Calendar"');
    expect(SCHEDULE).not.toContain("Workspace calendar");
    expect(SCHEDULE).toContain("Workspace schedule");
  });

  it("has an address, so it can be linked to and bookmarked", () => {
    expect(INDEX_ROUTE).toContain("validateSearch");
    expect(INDEX_ROUTE).toContain('"schedule"');
    expect(PROJECTS_PAGE).toContain('routeSearch.tab ?? "projects"');
  });

  /*
   * `?tab=calendar` was live for a release and the group page linked to it.
   * A rename must not break an address somebody already sent.
   */
  it("still opens on a link written before the rename", () => {
    expect(INDEX_ROUTE).toContain("RENAMED");
    expect(INDEX_ROUTE).toContain('calendar: "schedule"');
  });

  it("counts on the tab strip what needs acting on, not what exists", () => {
    expect(PROJECTS_PAGE).toContain("attentionCount(schedule)");
  });

  /*
   * Caught by the browser driver on a slow load, not by any assertion here.
   *
   * "Nothing is dated yet" is a claim about the data, and it was being made
   * while the pipelines read was still in flight - so `stagesById` was empty,
   * no project matched a Scheduled stage, the awaiting rail came out empty and
   * the tab showed an empty state over a workspace that had a booked job in
   * it. It corrected itself when the boards landed, which is exactly what
   * makes it the kind of bug people report as "it flickers".
   */
  it("waits for all three reads before claiming the workspace is empty", () => {
    expect(PROJECTS_PAGE).toContain("scheduleLoading || loading || boardsLoading");
    expect(SCHEDULE).toContain("!loading && !error && schedule.entries.length === 0");
  });

  it("sends every entry straight to its project, and a task to that task", () => {
    expect(SCHEDULE).toContain('to: "/projects/$projectId" as const');
    expect(SCHEDULE).toContain("{ task: entry.taskId }");
  });
});

/*
 * "Clicking a task directly on the calendar grid does nothing - only the same
 * item in the sidebar is clickable - the grid items need the same click-to-open
 * behavior."
 *
 * The cell was one `<button>` with inert `<span>` chips in it. A link cannot be
 * nested inside a button, so the fix is a full-bleed day button UNDER the
 * content with the chips as real links above it.
 */
describe("clicking an item on the grid", () => {
  it("makes every chip a link, not a span inside the day button", () => {
    expect(SCHEDULE).toContain("function EntryChip");
    expect(SCHEDULE).toContain("pointer-events-auto");
    expect(SCHEDULE).toContain("entryLink(entry)");
  });

  it("routes the grid chip and the rail row through one link builder", () => {
    // Two call sites, one definition: the same item cannot lead to two places.
    expect(SCHEDULE.match(/entryLink\(entry\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the day itself selectable, behind the chips", () => {
    expect(SCHEDULE).toContain("absolute inset-0 rounded-xl");
    expect(SCHEDULE).toContain("pointer-events-none relative flex min-w-0");
  });

  it("does not nest a link inside a button, which no browser agrees on", () => {
    /*
     * The invariant, stated where it can actually be checked: the day surface
     * is a self-closing element. A button with no children cannot contain a
     * link, whatever anyone edits around it. Anchored on the class that is
     * unique to it rather than on a regex sweep of the file, which would match
     * any button and any link anywhere and prove nothing.
     */
    expect(SCHEDULE).toMatch(/ring-primary\/50"\s*\/>/);
    // The old shape: one <button> wrapping the day number AND the entries.
    expect(SCHEDULE).not.toContain("flex min-h-[74px] flex-col gap-1 rounded-xl border p-1.5");
  });
});

/*
 * "The calendar pulls in multiple item types ... but they all render
 * identically on the grid. Each type should get its own badge or marker style
 * so users can tell what they're looking at without opening it."
 */
describe("telling one kind of item from another", () => {
  it("names every type and state in words, for the legend and the screen reader", () => {
    const job = { kind: "job" as const, done: false, overdue: false };
    expect(entryTypeLabel(job)).toBe("Job booked");
    expect(entryTypeLabel({ ...job, overdue: true })).toBe("Job overdue");
    expect(entryTypeLabel({ ...job, done: true })).toBe("Job completed");

    const task = { kind: "task" as const, done: false, overdue: false };
    expect(entryTypeLabel(task)).toBe("Task due");
    expect(entryTypeLabel({ ...task, overdue: true })).toBe("Task overdue");
    expect(entryTypeLabel({ ...task, done: true })).toBe("Task done");
  });

  it("carries the type on the chip's own label, not only in its colour", () => {
    expect(SCHEDULE).toContain("aria-label={`${entryTypeLabel(entry)}: ${entry.title}`}");
  });

  /*
   * Colour cannot be the distinction: it is already spent on the stage and on
   * the task priority, and it is no distinction at all for a reader who cannot
   * separate the hues. Shape and icon carry the type instead.
   */
  it("gives each type a shape and an icon, not just a hue", () => {
    // Icon for the job chip, priority dot for the task chip.
    expect(SCHEDULE).toContain("<Layers aria-hidden");
    // Square marker for a job, round for a task, on the grid and in the rail.
    expect(SCHEDULE).toContain('e.kind === "job" ? "rounded-[1px]" : "rounded-full"');
    expect(SCHEDULE).toContain('entry.kind === "job" ? "rounded-[2px]" : "rounded-full"');
  });

  /*
   * The key and the chips have to say the same words. Hardcoding them in the
   * legend meant two copies of the vocabulary that could drift the first time
   * anyone reworded one, so the legend reads its labels out of the same
   * function the chips' aria-labels come from.
   */
  it("prints a key, worded by the same function as the chips", () => {
    expect(SCHEDULE).toContain("function Legend");
    expect(SCHEDULE).toContain("<Legend />");
    expect(SCHEDULE).toContain(
      'const JOB_LABEL = entryTypeLabel({ kind: "job", done: false, overdue: false })',
    );
    expect(SCHEDULE).toContain("{JOB_LABEL}");
    expect(SCHEDULE).toContain("{TASK_LABEL}");
  });

  /*
   * The report lists checklists as a third type on the grid. They are not
   * there, and they cannot be: `project_checklists` carries created_at and
   * completed_at and no due or scheduled date, so there is no day to draw one
   * on. Probed against the live database on 2026-08-21, because the migration
   * folder is not a reliable picture of that schema. This test exists so the
   * next person reads the reason rather than the absence.
   */
  it("has no checklist type, because a checklist has no date to be drawn on", () => {
    expect(SCHEDULE).not.toContain("project_checklists");
    expect(LIB).toContain("project_checklists");
    expect(LIB).toContain("no due date");
  });
});

describe("the per-project Calendar the client asked to keep", () => {
  /*
   * "Keep the existing per-project Calendar as-is - it's still useful for
   * reviewing capture history on a single job - this is a separate, additive
   * view at the workspace level, not a replacement."
   */
  it("is still the capture calendar, and is still what the project page renders", () => {
    expect(PHOTO_CALENDAR).toContain("Capture calendar");
    expect(PHOTO_CALENDAR).toContain("listTimelineActivity");
    expect(DETAIL_PAGE).toContain("<PhotoCalendar");
  });

  it("is a different component from the workspace one, reading different tables", () => {
    // The workspace calendar must never grow a photo read, and the capture
    // calendar must never grow a task read. They answer opposite questions.
    expect(SCHEDULE).not.toContain('from("photos"');
    expect(SCHEDULE).not.toContain("site-photos");
    expect(PHOTO_CALENDAR).not.toContain('from("tasks"');
  });
});
