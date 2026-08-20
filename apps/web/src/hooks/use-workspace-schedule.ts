import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { todayCalendarDate } from "@sitepix/shared";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { qk } from "@/lib/query-keys";
import {
  addCalendarDays,
  buildWorkspaceSchedule,
  supportsScheduledDate,
  type SchedulableProject,
  type SchedulableTask,
  type StageLite,
  type TaskCoverage,
  type ScheduleData,
} from "@/lib/workspace-schedule";

/**
 * The one read the workspace calendar adds, and the shaping around it.
 *
 * The projects page already holds every project the viewer can see and every
 * pipeline board, so the booked-job half of the calendar costs nothing: it is
 * `projects.scheduled_date`, which arrives with the `select("*")` that page
 * already runs. Only the task due dates are new, and they are one query for
 * the whole workspace rather than one per project.
 *
 * It lives in a hook rather than inside the calendar component because the tab
 * strip needs the count before anybody opens the tab. "Calendar 3" is the
 * feature stated in one number, and a badge that only appears once you are
 * already looking at the thing it describes is not a badge.
 */

/**
 * How far either side of today the read reaches.
 *
 * Backwards, because overdue work is the first thing the rail shows and a task
 * that slipped last quarter is exactly the one nobody has looked at. Forwards,
 * far enough that paging through next year's months never hits a wall.
 *
 * Both ends are bounded rather than absent so the query cost is a function of
 * the window and not of how long the workspace has existed.
 */
const LOOK_BACK_DAYS = 180;
const LOOK_AHEAD_DAYS = 550;

/**
 * A ceiling on rows, well above what a real workspace puts in an 18-month
 * window, so a runaway import cannot turn opening a tab into a several-megabyte
 * download.
 */
const TASK_LIMIT = 2000;

interface DatedTasks {
  tasks: SchedulableTask[];
  coverage: TaskCoverage;
}

async function loadDatedTasks(): Promise<DatedTasks> {
  const today = todayCalendarDate();
  const from = addCalendarDays(today, -LOOK_BACK_DAYS);
  const to = addCalendarDays(today, LOOK_AHEAD_DAYS);

  const { data, error } = await supabase
    .from("tasks" as any)
    .select("id, project_id, title, status, priority, due_date, assignee_email")
    .not("due_date", "is", null)
    .gte("due_date", from)
    .lte("due_date", to)
    .order("due_date", { ascending: true })
    .limit(TASK_LIMIT);

  if (error) {
    // Same tolerance ProjectTasks applies: a database that predates the tasks
    // table should render an empty calendar, not a red banner.
    if (String(error.message).includes("does not exist")) {
      return { tasks: [], coverage: { from, to, capped: false } };
    }
    throw new Error(error.message);
  }

  const tasks = (data ?? []) as unknown as SchedulableTask[];
  /*
   * A full page is the only evidence there is that rows were left behind, so
   * it is treated as "capped" even in the rare case the count landed exactly
   * on the limit. Ordered ascending, so what the cap drops is the far end of
   * the window: `to` is walked back to the last date actually returned rather
   * than left claiming a reach the read did not have.
   */
  const capped = tasks.length >= TASK_LIMIT;
  const lastDate = capped ? (tasks[tasks.length - 1]?.due_date ?? to) : to;
  return { tasks, coverage: { from, to: lastDate, capped } };
}

export interface WorkspaceScheduleState {
  schedule: ScheduleData;
  loading: boolean;
  /** The task read's failure, if any. Null is not the same as "no entries". */
  error: string | null;
  refetch: () => void;
  /** False until 20260923000000_project_scheduled_date.sql has been applied. */
  canSchedule: boolean;
}

export function useWorkspaceSchedule(
  projects: readonly SchedulableProject[],
  stagesById: ReadonlyMap<string, StageLite>,
): WorkspaceScheduleState {
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const tasksQuery = useQuery({
    queryKey: qk.workspaceSchedule(userId),
    queryFn: loadDatedTasks,
    enabled: !!user,
    staleTime: 60_000,
  });

  const tasks = tasksQuery.data;
  const schedule = useMemo(
    () =>
      buildWorkspaceSchedule({
        projects,
        tasks: tasks?.tasks ?? [],
        stagesById,
        taskCoverage: tasks?.coverage ?? null,
      }),
    [projects, tasks, stagesById],
  );

  return {
    schedule,
    loading: tasksQuery.isPending,
    error: tasksQuery.error ? ((tasksQuery.error as Error).message ?? "Load failed") : null,
    refetch: () => void tasksQuery.refetch(),
    canSchedule: supportsScheduledDate(projects),
  };
}
