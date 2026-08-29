import { supabase } from "@/lib/supabase";
import type { DashTask } from "./dashboard-view";

/**
 * What the home screen reads.
 *
 * Direct RLS queries rather than an rpc, because there is no dashboard op on
 * the API and inventing one would put a second definition of "what needs me"
 * on the server that could drift from this one. The reads are cheap: two
 * queries, both indexed, both bounded.
 *
 * Deliberately **not** a copy of the web dashboard's data. That page computes a
 * seven-day sparkline, a documentation-health percentage and a thirty-row
 * activity feed, which are questions somebody asks at a desk. None of them is
 * loaded here.
 */

const TASK_FIELDS = "id, project_id, title, status, priority, due_date";

/**
 * Open tasks assigned to this person, across every project.
 *
 * Filtered on the server rather than in JavaScript: a workspace with two
 * thousand tasks would otherwise send all of them to a phone to find the four
 * that matter. `status` is excluded rather than `completed_at` checked, because
 * the status column is what the runner writes and the two can disagree on a row
 * closed by an older client.
 */
export async function listMyOpenTasks(userId: string): Promise<DashTask[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_FIELDS)
    .eq("assignee_user_id", userId)
    .neq("status", "done")
    // Nulls last, so a task with no date never crowds out a dated one. Postgres
    // sorts nulls first on ascending by default, which would put every undated
    // task at the top of a list whose whole purpose is dates.
    .order("due_date", { ascending: true, nullsFirst: false })
    // A hard cap. Anyone with more than fifty overdue tasks has a problem this
    // screen cannot solve, and loading four hundred to say "50+" is waste.
    .limit(50);

  if (error) throw new Error(error.message);
  return (data as DashTask[]) ?? [];
}

/**
 * When today's photos were taken, for the day's capture count.
 *
 * Bounded to the last 48 hours and to timestamps only: the count is computed
 * from local calendar dates in `countToday`, and the window has to be wide
 * enough that a timezone cannot push today's captures outside it.
 */
export async function listRecentCaptureTimes(): Promise<string[]> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("photos")
    .select("taken_at, created_at")
    // The soft delete has no database-level enforcement, so every `photos` read
    // excludes the trash by hand. Without it the count includes photos the crew
    // already deleted.
    .is("deleted_at", null)
    .gte("created_at", since)
    .limit(500);

  if (error) throw new Error(error.message);
  // `taken_at` is when the shutter fired; `created_at` is when it finished
  // uploading. A photo shot offline last night and synced this morning belongs
  // to last night.
  return ((data as { taken_at: string | null; created_at: string }[]) ?? []).map(
    (row) => row.taken_at ?? row.created_at,
  );
}
