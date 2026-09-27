import { nearestJobsFirst, type Coord, type Locatable } from "../api/map-view";

/**
 * How close the nearest job has to be for the camera button to assume it.
 *
 * Wider than `ON_SITE_METRES` (the "You're here" callout) on purpose: that one
 * is a claim printed on a row, this one only picks where the camera opens, and
 * the job's name is on the viewfinder with a one-tap switch beside it. A big
 * site, a car park and a Balanced fix fit comfortably inside a kilometre.
 */
export const NEAR_JOB_METRES = 1000;

type CaptureCandidate = Locatable & {
  status?: string | null;
  archived?: boolean | null;
};

/** Finished and archived jobs are still offered by the picker, just not assumed. */
function isOpen(row: CaptureCandidate): boolean {
  return !row.archived && row.status !== "completed";
}

/**
 * The job the camera button opens straight into, or null when there is none.
 *
 * `rows` arrive last-worked-on first (`listProjects` orders by `updated_at`).
 * The nearest open job wins when the phone is standing within
 * `NEAR_JOB_METRES` of it; otherwise the most recently worked on open job; and
 * only when every job is closed, the most recent of those. A crew member in a
 * van between jobs gets the one they were just on, not one that happens to be
 * two towns closer.
 *
 * Import-free apart from the map arithmetic, so it can be tested.
 */
export function pickCaptureJob<T extends CaptureCandidate>(
  rows: T[],
  here: Coord | null,
): T | null {
  if (rows.length === 0) return null;
  const open = rows.filter(isOpen);
  const pool = open.length > 0 ? open : rows;
  if (here) {
    const [nearest] = nearestJobsFirst(pool, here);
    if (nearest && nearest.metres !== null && nearest.metres <= NEAR_JOB_METRES) {
      return pool.find((row) => row.id === nearest.id) ?? null;
    }
  }
  return pool[0] ?? null;
}
