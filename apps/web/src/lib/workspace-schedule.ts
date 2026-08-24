/**
 * What the workspace calendar is made of.
 *
 * The client, on the projects page:
 *
 *   "There's no way to see what's happening across all jobs at once. With
 *    dozens of active projects, there's no single place to answer 'what's due
 *    today' or 'what's scheduled this week' without opening each project
 *    individually."
 *
 * The Calendar that already existed answers a different question. It is
 * `PhotoCalendar`, it lives inside one project, and it plots capture activity:
 * which days the crew shot photos on that job. That is a record of what
 * happened, on one job, looking backwards. It is still there and unchanged;
 * this is the other axis.
 *
 * Two things in the database point forwards, and until now neither had a
 * screen that read them across every project at once:
 *
 *   - `tasks.due_date` - a real calendar date, per task, per project.
 *   - `projects.scheduled_date` - the day a job is booked for, added by
 *     20260923000000_project_scheduled_date.sql because a pipeline stage
 *     called "Scheduled" says where a job is in the process and never when it
 *     happens.
 *
 * This module turns both into one flat list of dated entries, and is
 * deliberately pure: no Supabase, no React, no `new Date()` except through an
 * injected `now`. That is what lets tests/workspace-schedule.test.ts pin the
 * bucketing and the overdue rules to fixed days instead of to whenever the
 * suite happens to run.
 *
 * Every date here is a "YYYY-MM-DD" calendar date and is compared as one. See
 * packages/shared/src/calendar-date.ts for why that is not negotiable: a due
 * date read through `new Date("2026-08-20")` moves back a day west of
 * Greenwich, which on a calendar means an entry drawn in the wrong cell.
 */

import {
  isScheduledStageName,
  parseCalendarDate,
  todayCalendarDate,
  type ProjectStatus,
} from "@everlumen/shared";

/** The columns of a project this view needs. A superset of these is fine. */
export interface SchedulableProject {
  id: string;
  name: string;
  status?: string | null;
  archived?: boolean | null;
  pipeline_stage_id?: string | null;
  /**
   * Present only once 20260923000000_project_scheduled_date.sql has been
   * applied. `undefined` therefore means "this database has no such column",
   * which is a different thing from `null` ("no day booked yet") and is what
   * `supportsScheduledDate` below reads.
   */
  scheduled_date?: string | null;
}

export type TaskPriority = "low" | "normal" | "high" | "urgent";

/** The columns of a task this view needs. */
export interface SchedulableTask {
  id: string;
  project_id: string;
  title: string;
  status: string;
  priority?: string | null;
  due_date: string | null;
  assignee_email?: string | null;
}

/** A pipeline column, reduced to what an entry has to render. */
export interface StageLite {
  id: string;
  name: string;
  color: string;
}

export type ScheduleEntryKind = "task" | "job";

export interface ScheduleEntry {
  /** Stable React key. Prefixed because a task and a project can share an id. */
  key: string;
  kind: ScheduleEntryKind;
  /** "YYYY-MM-DD" - the cell this lands in. */
  date: string;
  title: string;
  projectId: string;
  projectName: string;
  /** Dot colour: the stage's colour for a job, the priority tint for a task. */
  color: string;
  /** A done task, or a job whose project has been completed. */
  done: boolean;
  /** In the past and still open. Never true for something already finished. */
  overdue: boolean;
  /**
   * The second line's extra: the stage a booked job sits in, or the address a
   * task is assigned to. Null when there is neither. A task's project name is
   * NOT in here - the rail always shows that, so folding it in would render it
   * twice on any task nobody has been given.
   */
  detail: string | null;
  /** Set for tasks, so the link can open the project on that one task. */
  taskId: string | null;
}

/**
 * What an entry IS, in words, for a screen reader and for the legend.
 *
 * The client, looking at the first grid:
 *
 *   "The calendar pulls in multiple item types - pipeline/job status entries
 *    (like Scheduled or Completed), checklists, and tasks - but they all render
 *    identically on the grid. Each type should get its own badge or marker
 *    style so users can tell what they're looking at without opening it."
 *
 * They are right about the symptom and the fix. Every chip was the same shape
 * with a coloured dot, and colour alone is not a distinction: it fails for
 * anyone who cannot separate the hues, and it was already spent on the stage
 * colour and the task priority, so it could not also carry the type.
 *
 * So each type gets a marker with a SHAPE and an ICON as well as a colour, and
 * this function is the words behind them. Kept here rather than in the view so
 * the chip's `aria-label`, the rail row and the legend cannot drift apart, and
 * so a test can hold the vocabulary still.
 *
 * On checklists, which the report lists as a third type: they are not on the
 * calendar and cannot be. `project_checklists` has no due date and no
 * scheduled date - only `created_at` and `completed_at` - so there is no day
 * to draw one on. Adding one is a data-model change, not a rendering one.
 */
export function entryTypeLabel(entry: Pick<ScheduleEntry, "kind" | "done" | "overdue">): string {
  if (entry.kind === "job") {
    if (entry.done) return "Job completed";
    return entry.overdue ? "Job overdue" : "Job booked";
  }
  if (entry.done) return "Task done";
  return entry.overdue ? "Task overdue" : "Task due";
}

/** A job in a "Scheduled"-shaped stage that nobody has given a day to yet. */
export interface AwaitingDateJob {
  projectId: string;
  projectName: string;
  stageName: string;
  stageColor: string;
}

/**
 * How much of the answer is actually in the answer.
 *
 * Task due dates are read inside a bounded window and under a row cap, and the
 * month grid pages without limit, so the two do not line up: page far enough
 * and every cell goes empty. That empty month is indistinguishable from a
 * genuinely quiet one, and booked jobs are NOT windowed, so it would render as
 * half-true - jobs drawn, tasks silently absent.
 *
 * PhotoCalendar states the same problem in its own words ("the calendar's
 * whole job is the counts, so a count that is quietly short is worse than no
 * calendar") and answers it the same way: carry the limits out with the data
 * and let the view say so.
 */
export interface TaskCoverage {
  /** Inclusive "YYYY-MM-DD" bounds the task read actually covered. */
  from: string;
  to: string;
  /** True when the row cap was hit, so even inside the window there is more. */
  capped: boolean;
}

export interface ScheduleData {
  entries: ScheduleEntry[];
  /** Keyed by "YYYY-MM-DD", each already in display order. */
  byDate: Map<string, ScheduleEntry[]>;
  /** Open and in the past, soonest-slipped last. Ordered oldest first. */
  overdue: ScheduleEntry[];
  /** Everything landing on today, done or not. */
  today: ScheduleEntry[];
  /** Open entries from today to six days out, the "this week" answer. */
  next7: ScheduleEntry[];
  awaitingDate: AwaitingDateJob[];
  /** Null while the task read has not reported yet. */
  taskCoverage: TaskCoverage | null;
}

/** Does the task read cover this whole "YYYY-MM-DD" span? */
export function coversRange(coverage: TaskCoverage | null, from: string, to: string): boolean {
  if (!coverage) return true;
  return coverage.from <= from && coverage.to >= to;
}

/**
 * Task dot colours.
 *
 * Deliberately not the project's or the stage's colour: on a month grid a task
 * and a booked job in the same cell have to be told apart at a glance, and
 * priority is the thing a person is scanning a punch list for. Jobs take the
 * stage colour the team chose, so the calendar and the pipeline board agree.
 */
const PRIORITY_COLOR: Record<TaskPriority, string> = {
  urgent: "#ef4444",
  high: "#f59e0b",
  normal: "#3b82f6",
  low: "#94a3b8",
};

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

const priorityOf = (value: string | null | undefined): TaskPriority =>
  value === "urgent" || value === "high" || value === "low" ? value : "normal";

/** The colour a booked job falls back to when it is in no pipeline at all. */
const UNSTAGED_JOB_COLOR = "#0f766e";

/**
 * Whether this database has `projects.scheduled_date`.
 *
 * The projects page reads `select("*")`, so PostgREST returns the key on every
 * row the moment the column exists and omits it entirely until then. That
 * makes the probe free: no extra round trip, no version table, no try/catch
 * around a write. Until the migration is applied the calendar still plots
 * every task due date and still lists the Scheduled-stage jobs, it just cannot
 * put a day on one, and the UI hides the date controls rather than offering a
 * button that can only fail.
 */
export function supportsScheduledDate(projects: readonly SchedulableProject[]): boolean {
  return projects.some((p) => "scheduled_date" in p);
}

/**
 * The "YYYY-MM-DD" that addresses a cell, or null if there isn't one.
 *
 * A `date` column arrives as the bare form and that is the whole story. The
 * leading-date tolerance is for the other case: `projects.scheduled_date`
 * already existed in at least one deployed database before the migration that
 * declares it, so its type there is not something this code can assume. If it
 * turns out to be a timestamp, every value would arrive as
 * "2026-08-20T00:00:00+00:00" and a strict match would drop every booked job
 * off the calendar without saying a word. A day that is occasionally one out
 * beats a grid that is silently always empty, and
 * 20260923000000_project_scheduled_date.sql raises a notice naming the column
 * to fix if that is what it finds.
 *
 * Anything that is not a real calendar date at all is still rejected:
 * `parseCalendarDate` is what refuses "2026-02-31".
 */
const asCalendarDate = (value: string | null | undefined): string | null => {
  const leading = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(String(value ?? "").trim());
  if (!leading) return null;
  return parseCalendarDate(leading[1]) ? leading[1] : null;
};

/**
 * The whole calendar, from the rows the projects page already holds plus one
 * read of `tasks`.
 *
 * Archived projects are left out on purpose. Archiving is how a job is taken
 * off the active list, and a forward-looking calendar that still books time
 * for archived work is the same complaint in a new place. A task whose project
 * is not in `projects` is dropped for the same reason: that is a deleted or
 * out-of-scope job, and the entry would be a row nobody could click through
 * to.
 */
export function buildWorkspaceSchedule(input: {
  projects: readonly SchedulableProject[];
  tasks: readonly SchedulableTask[];
  /** Every pipeline column the viewer can see, keyed by stage id. */
  stagesById: ReadonlyMap<string, StageLite>;
  /** What the task read reached. Null while it is still in flight. */
  taskCoverage?: TaskCoverage | null;
  now?: Date;
}): ScheduleData {
  const { stagesById, now = new Date() } = input;
  const today = todayCalendarDate(now);

  const projects = input.projects.filter((p) => !p.archived);
  const byId = new Map(projects.map((p) => [p.id, p]));

  const entries: ScheduleEntry[] = [];
  const awaitingDate: AwaitingDateJob[] = [];
  /** Parallel to `entries`, so the sort can see a task's priority. */
  const rank = new Map<string, number>();

  for (const project of projects) {
    const stage = project.pipeline_stage_id
      ? (stagesById.get(project.pipeline_stage_id) ?? null)
      : null;
    const date = asCalendarDate(project.scheduled_date);

    if (date) {
      const finished = (project.status as ProjectStatus | undefined) === "completed";
      entries.push({
        key: `job:${project.id}`,
        kind: "job",
        date,
        title: project.name,
        projectId: project.id,
        projectName: project.name,
        color: stage?.color ?? UNSTAGED_JOB_COLOR,
        done: finished,
        overdue: date < today && !finished,
        detail: stage?.name ?? null,
        taskId: null,
      });
      rank.set(`job:${project.id}`, -1);
      continue;
    }

    // No day yet. Worth surfacing only when the team has said out loud that
    // this job is meant to be booked, which is what the stage name is.
    if (stage && isScheduledStageName(stage.name)) {
      awaitingDate.push({
        projectId: project.id,
        projectName: project.name,
        stageName: stage.name,
        stageColor: stage.color,
      });
    }
  }

  for (const task of input.tasks) {
    const project = byId.get(task.project_id);
    if (!project) continue;
    const date = asCalendarDate(task.due_date);
    if (!date) continue;
    const done = task.status === "done";
    const priority = priorityOf(task.priority);
    const key = `task:${task.id}`;
    entries.push({
      key,
      kind: "task",
      date,
      title: task.title,
      projectId: project.id,
      projectName: project.name,
      color: PRIORITY_COLOR[priority],
      done,
      overdue: date < today && !done,
      detail: task.assignee_email ?? null,
      taskId: task.id,
    });
    rank.set(key, PRIORITY_RANK[priority]);
  }

  /*
   * Order inside one day: jobs first, then open before finished, then by
   * priority, then alphabetically.
   *
   * The job is the reason the crew is going out; the tasks are what they do
   * once they are there. A cell that leads with a task and pushes the site
   * visit under "+3 more" answers the wrong question. Priority is read out of
   * `rank` rather than off the entry, so the sort never has to reverse-engineer
   * it from a rendered colour.
   */
  const ordered = (a: ScheduleEntry, b: ScheduleEntry): number => {
    if (a.kind !== b.kind) return a.kind === "job" ? -1 : 1;
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ra = rank.get(a.key) ?? 2;
    const rb = rank.get(b.key) ?? 2;
    if (ra !== rb) return ra - rb;
    return a.title.localeCompare(b.title);
  };

  entries.sort((a, b) => (a.date === b.date ? ordered(a, b) : a.date < b.date ? -1 : 1));

  const byDate = new Map<string, ScheduleEntry[]>();
  for (const e of entries) {
    const bucket = byDate.get(e.date);
    if (bucket) bucket.push(e);
    else byDate.set(e.date, [e]);
  }

  const horizon = addCalendarDays(today, 6);
  return {
    entries,
    byDate,
    overdue: entries.filter((e) => e.overdue),
    today: byDate.get(today) ?? [],
    next7: entries.filter((e) => !e.done && e.date >= today && e.date <= horizon),
    awaitingDate: awaitingDate.sort((a, b) => a.projectName.localeCompare(b.projectName)),
    taskCoverage: input.taskCoverage ?? null,
  };
}

/**
 * N days after a calendar date, still as a calendar date.
 *
 * Built through the local-midnight Date the shared helper produces rather than
 * by adding milliseconds to a UTC instant, so a daylight-saving boundary
 * inside the window cannot slide the answer by a day.
 */
export function addCalendarDays(date: string, days: number): string {
  const base = parseCalendarDate(date);
  if (!base) return date;
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return todayCalendarDate(next);
}

/**
 * The badge on the Calendar tab.
 *
 * It counts what is actually being asked for - open work that has landed or is
 * late - rather than every dated thing in the workspace. A tab reading "184"
 * because a task is due next spring tells nobody anything; "3" when three
 * things are waiting on you today is the whole feature in one number.
 */
export function attentionCount(schedule: ScheduleData): number {
  return schedule.overdue.length + schedule.today.filter((e) => !e.done).length;
}
