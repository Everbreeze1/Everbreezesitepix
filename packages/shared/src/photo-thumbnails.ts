/**
 * Where a photo's pre-generated thumbnail lives.
 *
 * Shared rather than duplicated because upload and delete have to agree
 * exactly: the writer derives the path from the original, and every delete path
 * derives it again to clean up. A divergence between the two would not fail
 * loudly — it would quietly orphan a thumbnail per deleted photo, in a bucket
 * nothing else enumerates.
 *
 * The suffix is appended, never prefixed. `site-photos` RLS keys off the first
 * two path segments (`{userId}/{projectId}/...`), so a thumbnail has to stay
 * under the same prefix as its original to inherit the same policies. Putting
 * these under a `thumbs/` directory would place them outside the owner's folder
 * and make them unwritable.
 */
const THUMB_SUFFIX = ".thumb.jpg";

/** Thumbnail object path for a photo's `storage_path`. */
export function thumbPathFor(storagePath: string): string {
  return `${storagePath}${THUMB_SUFFIX}`;
}

/** True when a path is itself a thumbnail rather than an original. */
export function isThumbPath(path: string): boolean {
  return path.endsWith(THUMB_SUFFIX);
}

/**
 * Thumbnail paths for a batch of originals, skipping anything already a
 * thumbnail so a list can be passed through twice without compounding.
 */
export function thumbPathsFor(storagePaths: readonly string[]): string[] {
  return storagePaths.filter((p) => p && !isThumbPath(p)).map(thumbPathFor);
}

/**
 * Every object a photo owns, for delete and orphan-reclaim paths.
 *
 * The thumbnail is included by derivation rather than only when the caller
 * knows about one. `thumb_path` is null for photos predating thumbnails and for
 * any upload where generation failed, but a thumbnail may still exist — from a
 * later re-save, or a partial failure that stored the object without recording
 * it. Removing a path that isn't there is a no-op; leaving one behind orphans
 * it forever, because every delete path in the product keys off the DB row.
 */
export function photoObjectPaths(storagePath: string, thumbPath?: string | null): string[] {
  const paths = [storagePath, thumbPath || thumbPathFor(storagePath)];
  return Array.from(new Set(paths.filter(Boolean)));
}

/** `photoObjectPaths` across a batch of rows. */
export function allPhotoObjectPaths(
  rows: ReadonlyArray<{ storage_path: string; thumb_path?: string | null }>,
): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (!r.storage_path) continue;
    for (const p of photoObjectPaths(r.storage_path, r.thumb_path)) out.add(p);
  }
  return Array.from(out);
}
