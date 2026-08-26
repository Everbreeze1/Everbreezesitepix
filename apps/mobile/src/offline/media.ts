import { Directory, File, Paths } from "expo-file-system";

/**
 * Durable copies of queued captures.
 *
 * A camera or picker URI points into a cache directory the OS owns and is free
 * to empty whenever it wants storage back. That is fine for an upload that
 * happens immediately, and fatal for one that waits out a drive back from site:
 * the row would drain hours later against a file that no longer exists, and the
 * photo is gone with no way to get it back.
 *
 * So a queued capture is copied into the document directory, which is backed up
 * and never reclaimed under the app, and the copy is deleted only once the row
 * reaches `done`.
 */

const OUTBOX_DIRNAME = "outbox";

function outboxDirectory(): Directory {
  const dir = new Directory(Paths.document, OUTBOX_DIRNAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Copy a capture into app storage, named after the outbox row that owns it.
 *
 * Naming by row id makes this safe to call twice: a retry that re-enters before
 * the first copy was recorded finds the file already there and reuses it rather
 * than duplicating a multi-megabyte photo.
 */
export function persistCapture(sourceUri: string, outboxId: string): string {
  const target = new File(outboxDirectory(), `${outboxId}.jpg`);
  if (target.exists) return target.uri;

  const source = new File(sourceUri);
  if (!source.exists) throw new Error("Capture is no longer on the device");

  source.copySync(target);
  return target.uri;
}

/**
 * Delete a queued file once its row is done or discarded.
 *
 * Scoped to the outbox directory on purpose. `local_uri` for a row that was
 * never copied still points at the camera cache or, worse, at the user's photo
 * library, and deleting there would destroy an original the app does not own.
 */
export function discardCapture(localUri: string | null | undefined): void {
  if (!localUri) return;
  if (!localUri.includes(`/${OUTBOX_DIRNAME}/`)) return;
  try {
    const file = new File(localUri);
    if (file.exists) file.delete();
  } catch {
    // A file that cannot be deleted is reclaimed by `sweepOrphans` later, and
    // is never a reason to fail the upload that just succeeded.
  }
}

/** Total bytes held by queued captures, for the Account screen. */
export function queuedBytes(): number {
  try {
    let total = 0;
    for (const entry of outboxDirectory().list()) {
      if (entry instanceof File) total += entry.size ?? 0;
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Delete outbox files no live row refers to.
 *
 * These accumulate from crashes between the copy and the row insert, and from
 * deletes that failed. Nothing else will ever look at them, so without a sweep
 * they are a permanent, invisible chunk of the user's storage.
 */
export function sweepOrphans(liveUris: readonly string[]): number {
  const live = new Set(liveUris);
  let removed = 0;
  try {
    for (const entry of outboxDirectory().list()) {
      if (!(entry instanceof File)) continue;
      if (live.has(entry.uri)) continue;
      try {
        entry.delete();
        removed += 1;
      } catch {
        // Skip and try again on the next sweep.
      }
    }
  } catch {
    return removed;
  }
  return removed;
}
