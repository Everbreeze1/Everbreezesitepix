import { todayCalendarDate } from "@everlumen/shared";
import { supabase } from "@/lib/supabase";
import {
  addCalendarDays,
  type SchedulableProject,
  type SchedulableTask,
  type TaskCoverage,
} from "./workspace-schedule-view";

/**
 * The reads and the one write behind the workspace Schedule.
 *
 * The same Supabase calls the web's Schedule tab makes
 * (`apps/web/src/hooks/use-workspace-schedule.ts` and `setScheduledDate` on
 * the projects page): the projects with their booked day, one query for every
 * dated task in a bounded window, and a direct update of
 * `projects.scheduled_date` to book or clear a job's day.
 */

/** How far either side of today the task read reaches, as on the web. */
const LOOK_BACK_DAYS = 180;
const LOOK_AHEAD_DAYS = 550;
/** A ceiling on rows, so a runaway import cannot make opening this a big download. */
const TASK_LIMIT = 2000;

const PROJECT_COLUMNS = "id, name, status, archived, pipeline_stage_id";

/**
 * Every live project with the columns the schedule reads.
 *
 * `scheduled_date` is asked for by name, and the read is retried without it
 * when the database predates that column: the schedule then still plots every
 * task due date, it just cannot book a job (`supportsScheduledDate` reads the
 * missing key and the screen hides the booking controls).
 */
export async function listSchedulableProjects(): Promise<SchedulableProject[]> {
  const read = (columns: string) =>
    supabase
      .from("projects")
      .select(columns)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });

  let { data, error } = await read(`${PROJECT_COLUMNS}, scheduled_date`);
  if (error && /scheduled_date/.test(error.message)) {
    ({ data, error } = await read(PROJECT_COLUMNS));
  }
  if (error) throw new Error(error.message);
  return (data as unknown as SchedulableProject[]) ?? [];
}

export type DatedTasks = { tasks: SchedulableTask[]; coverage: TaskCoverage };

/** Every task with a due date in the window, across every project. */
export async function listDatedTasks(): Promise<DatedTasks> {
  const today = todayCalendarDate();
  const from = addCalendarDays(today, -LOOK_BACK_DAYS);
  const to = addCalendarDays(today, LOOK_AHEAD_DAYS);

  const { data, error } = await supabase
    .from("tasks")
    .select("id, project_id, title, status, priority, due_date, assignee_email")
    .not("due_date", "is", null)
    .gte("due_date", from)
    .lte("due_date", to)
    .order("due_date", { ascending: true })
    .limit(TASK_LIMIT);

  if (error) {
    // A database without the tasks table shows an empty schedule, not an error.
    if (String(error.message).includes("does not exist")) {
      return { tasks: [], coverage: { from, to, capped: false } };
    }
    throw new Error(error.message);
  }

  const tasks = (data as unknown as SchedulableTask[]) ?? [];
  // A full page is the only sign rows were left behind; the far end is what
  // the cap drops, so `to` walks back to the last date actually returned.
  const capped = tasks.length >= TASK_LIMIT;
  const lastDate = capped ? (tasks[tasks.length - 1]?.due_date ?? to) : to;
  return { tasks, coverage: { from, to: lastDate, capped } };
}

/** Book a job for a day, or clear its day with `null`. */
export async function setProjectScheduledDate(
  projectId: string,
  date: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({ scheduled_date: date } as never)
    .eq("id", projectId);
  if (error) throw new Error(error.message);
}
