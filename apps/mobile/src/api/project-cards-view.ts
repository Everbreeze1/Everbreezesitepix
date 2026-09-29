/**
 * The Projects tab's rich cards: the pure half.
 *
 * Import-free so the rules can be tested without a phone. The fetching half is
 * `project-cards.ts`.
 */

/** How many recent photos a card shows in its strip. */
export const STRIP_SIZE = 4;

/** What a card knows about a job's photographs. */
export type ProjectCardPhotos = {
  /** Signed thumbnail URLs, newest first, at most `STRIP_SIZE`. */
  urls: string[];
  /** Every live photo on the job, or null when the count could not be read. */
  count: number | null;
  /** When the newest photo was taken or uploaded. */
  latestAt: string | null;
};

/** Everything the card query brings back for one job. */
export type ProjectCardExtras = ProjectCardPhotos & {
  /** The pipeline stage the job is standing in, when it is on a board. */
  stageId: string | null;
};

/** "No photos", "1 photo", "24 photos". Null (unknown) says nothing. */
export function photoCountLabel(count: number | null): string | null {
  if (count === null) return null;
  if (count <= 0) return "No photos";
  return count === 1 ? "1 photo" : `${count} photos`;
}

/**
 * How many photos the strip does not show, for its "+N" tile.
 *
 * Zero when the count is unknown: a "+0" or a guessed number is worse than
 * the strip simply ending.
 */
export function stripOverflow(count: number | null, shown: number): number {
  if (count === null) return 0;
  return Math.max(0, count - shown);
}

/**
 * The job's last activity: whichever is later of its own last edit and its
 * newest photo. A crew that only captures photos never edits the project row,
 * so reading `updated_at` alone makes the busiest job look idle.
 */
export function lastActivityAt(updatedAt: string, latestPhotoAt: string | null): string {
  if (!latestPhotoAt) return updatedAt;
  const a = Date.parse(updatedAt);
  const b = Date.parse(latestPhotoAt);
  if (Number.isNaN(b)) return updatedAt;
  if (Number.isNaN(a)) return latestPhotoAt;
  return b > a ? latestPhotoAt : updatedAt;
}

/**
 * Card columns for the width on hand.
 *
 * One on a phone. A tablet gets a grid, with each card kept near the width it
 * was designed at (about 340pt) rather than stretched across a 1000pt screen.
 */
export function cardColumns(width: number): number {
  if (width < 700) return 1;
  return Math.max(2, Math.min(4, Math.floor(width / 340)));
}

/**
 * Group newest-first photo rows into per-project strips.
 *
 * Used when the one-query embed is not available and the rows come back flat:
 * the first `perProject` rows of each project win because the rows are already
 * newest first. Counts are not derived here, since a flat read is capped and a
 * count taken from it would be wrong exactly on the busiest jobs.
 */
export function groupStrips<T extends { project_id: string }>(
  rows: T[],
  perProject = STRIP_SIZE,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const row of rows) {
    const list = (out[row.project_id] ??= []);
    if (list.length < perProject) list.push(row);
  }
  return out;
}

/** The count PostgREST returns for an embedded `photos(count)`. */
export function embeddedCount(value: unknown): number | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0] as { count?: unknown } | null;
  return typeof first?.count === "number" ? first.count : null;
}
