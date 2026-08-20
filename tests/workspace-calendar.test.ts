import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isScheduledStageName } from "../packages/shared/src/pipeline-stages";
import {
  addCalendarDays,
  attentionCount,
  buildWorkspaceSchedule,
  supportsScheduledDate,
  type SchedulableProject,
  type SchedulableTask,
  type StageLite,
} from "../apps/web/src/lib/workspace-calendar";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const MIGRATION = read("supabase/migrations/20260923000000_project_scheduled_date.sql");
const PROJECTS_PAGE = read("apps/web/src/features/projects/pages/ProjectsPage.tsx");
const CALENDAR = read("apps/web/src/features/projects/components/WorkspaceCalendar.tsx");
const PHOTO_CALENDAR = read("apps/web/src/features/gallery/components/PhotoCalendar.tsx");
const DETAIL_PAGE = read("apps/web/src/features/projects/pages/ProjectDetailPage.tsx");
const INDEX_ROUTE = read("apps/web/src/routes/_app.projects.index.tsx");

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
    expect(PROJECTS_PAGE).toContain('type TabKey = "projects" | "groups" | "boards" | "calendar"');
    expect(PROJECTS_PAGE).toContain('{ key: "calendar", label: "Calendar"');
    expect(PROJECTS_PAGE).toContain("<WorkspaceCalendar");
  });

  it("has an address, so it can be linked to and bookmarked", () => {
    expect(INDEX_ROUTE).toContain("validateSearch");
    expect(INDEX_ROUTE).toContain('"calendar"');
    expect(PROJECTS_PAGE).toContain('routeSearch.tab ?? "projects"');
  });

  it("counts on the tab strip what needs acting on, not what exists", () => {
    expect(PROJECTS_PAGE).toContain("attentionCount(schedule)");
  });

  it("sends every entry straight to its project, and a task to that task", () => {
    expect(CALENDAR).toContain('to="/projects/$projectId"');
    expect(CALENDAR).toContain("{ task: entry.taskId }");
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
    expect(CALENDAR).not.toContain('from("photos"');
    expect(CALENDAR).not.toContain("site-photos");
    expect(PHOTO_CALENDAR).not.toContain('from("tasks"');
  });
});
