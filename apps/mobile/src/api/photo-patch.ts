/**
 * What a photo edit writes, free of imports so it can be tested directly.
 *
 * Same convention as `task-status.ts` and `task-dates.ts`. Everything here
 * decides the shape of a row in `photos`, which the web gallery, the public
 * share pages, the report builder and every PDF read back. A value this app
 * invents is a value nothing else can render.
 */

/** Phase as the UI names it. The column is nullable; "untagged" is a UI word. */
export type PhotoPhaseValue = "before" | "after" | "untagged";

/** The columns the phone is allowed to change on an existing photo. */
export type PhotoPatch = {
  phase?: string | null;
  tags?: string[] | null;
  caption?: string | null;
  /** Moving a photo to another project. */
  project_id?: string;
  /** An ISO timestamp trashes; `null` restores. */
  deleted_at?: string | null;
};

/**
 * Ids per request, matching `IN_CHUNK_SIZE` in `apps/api/src/lib/chunked-in.ts`.
 *
 * PostgREST echoes the request filter back in the `Content-Location` response
 * header. At roughly 37 bytes per id that header crosses Node's 16KB limit at
 * about 400 ids and the request fails outright. Measured on this project: 398
 * ids fine, 400 ids fail.
 *
 * The phone is less likely than the web app to select 400 photos, but "select
 * all" on a busy project reaches it, and the failure mode is bad: a bulk trash
 * that silently does nothing above the limit.
 */
export const PHOTO_IN_CHUNK_SIZE = 200;

export function chunkIds<T>(items: readonly T[], size = PHOTO_IN_CHUNK_SIZE): T[][] {
  if (items.length <= size) return items.length ? [items as T[]] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
  return out;
}

/**
 * Add tags without dropping the ones already there.
 *
 * Computed per photo against what that photo currently has, because a bulk
 * write of one merged array would overwrite each photo's own tags with the
 * union of everyone's.
 */
export function mergeTags(current: string[] | null, adding: string[]): string[] {
  const seen = new Set((current ?? []).map((t) => t.trim()).filter(Boolean));
  for (const tag of adding) {
    const clean = tag.trim();
    if (clean) seen.add(clean);
  }
  return Array.from(seen);
}

/** Removes one tag, leaving the rest untouched. */
export function withoutTag(current: string[] | null, tag: string): string[] {
  return (current ?? []).filter((t) => t !== tag);
}

/**
 * `untagged` is a UI word for "no phase", so it is stored as null.
 *
 * Writing the literal string would produce a phase no web filter matches, and
 * those photos would disappear from Before, After and Untagged alike.
 */
export function phasePatch(phase: PhotoPhaseValue): PhotoPatch {
  return { phase: phase === "untagged" ? null : phase };
}

/**
 * Move photos to the trash.
 *
 * A soft delete, exactly as web does it. The row stays and every read in the
 * product excludes it by hand, because `deleted_at` has no RLS predicate behind
 * it.
 */
export function trashPhotos(now: () => Date = () => new Date()): PhotoPatch {
  return { deleted_at: now().toISOString() };
}

/**
 * Bring photos back from the trash.
 *
 * The API has a `restorePhotos` op, and this deliberately does not call it. The
 * op's own implementation is `update({ deleted_at: null })`, the same write RLS
 * already allows from the client, and going through `/v1` would make restore
 * the one photo action that cannot be queued offline.
 */
export function restorePhotos(): PhotoPatch {
  return { deleted_at: null };
}
