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
 * Two of the web dashboard's numbers are read here too, documentation health
 * and needs review, with the web's own definitions so the phone and the desk
 * agree. The sparkline and the activity feed are not: those are questions
 * somebody asks at a desk.
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

/** Same ceiling the photo reads use for `.in()` lists. */
const IN_CHUNK = 200;

/** How far back a photo counts toward documentation health. Matches the web. */
const HEALTH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The ids of the given jobs that got a photo in the last seven days.
 *
 * The same read the web dashboard makes for its "Documentation health" tile, so
 * the phone and the desk show the same percentage for the same board. The
 * arithmetic is `documentationHealth` in the view module.
 */
export async function listRecentlyPhotographedProjects(projectIds: string[]): Promise<string[]> {
  if (projectIds.length === 0) return [];
  const since = new Date(Date.now() - HEALTH_WINDOW_MS).toISOString();
  const found = new Set<string>();
  for (let i = 0; i < projectIds.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("photos")
      .select("project_id")
      .in("project_id", projectIds.slice(i, i + IN_CHUNK))
      .is("deleted_at", null)
      .gte("created_at", since);
    if (error) throw new Error(error.message);
    for (const row of (data as { project_id: string }[]) ?? []) found.add(row.project_id);
  }
  return Array.from(found);
}

/**
 * Photos still waiting for somebody to look at them: no tags at all.
 *
 * The web dashboard's "Needs review" definition, and the one the gallery's
 * Needs review filter applies, so tapping the tile lands on exactly the photos
 * it counted. A head request: the count comes back in a header and no rows are
 * transferred.
 */
export async function countPhotosNeedingReview(): Promise<number> {
  const { count, error } = await supabase
    .from("photos")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .or("tags.is.null,tags.eq.{}");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type ProjectPhotoStats = {
  photoCount: number;
  /** When the newest photo was taken (or uploaded, when it has no capture time). */
  lastPhotoAt: string | null;
};

/**
 * Photo count and newest photo per job, for a handful of jobs.
 *
 * One bounded request per job rather than a download of the photo table: the
 * count comes back in the Content-Range header and at most one row is sent.
 * The web map makes the same trade, and for the same reason: PostgREST cannot
 * group without a view, and a view is a migration.
 *
 * Meant for a few ids (the home screen's recent jobs, one tapped pin), not a
 * whole board.
 */
export async function listProjectPhotoStats(
  projectIds: string[],
): Promise<Record<string, ProjectPhotoStats>> {
  const out: Record<string, ProjectPhotoStats> = {};
  await Promise.all(
    projectIds.map(async (projectId) => {
      const { data, count, error } = await supabase
        .from("photos")
        .select("taken_at, created_at", { count: "exact" })
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      const newest = (data as { taken_at: string | null; created_at: string }[] | null)?.[0];
      out[projectId] = {
        photoCount: count ?? 0,
        lastPhotoAt: newest ? (newest.taken_at ?? newest.created_at) : null,
      };
    }),
  );
  return out;
}
