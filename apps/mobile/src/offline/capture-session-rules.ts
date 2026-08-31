/**
 * When a capture session has finished, and what it should log.
 *
 * Import-free so the decision can be tested without a database, because it is
 * the whole feature: the Daily Log is supposed to appear on its own when a
 * technician finishes uploading, and everything else here is plumbing around
 * this one judgement.
 *
 * **Why it is not simply "when the camera closes".** On the web a capture is an
 * upload that either completes or does not, so the browser calls `autoDailyLog`
 * the moment it finishes. On the phone the shots go to the outbox and are
 * delivered whenever there is signal, which on a job site can be hours later
 * and in several passes. The session outlives the screen that made it, the
 * photo ids do not exist until each upload lands, and the app may well have
 * been killed and reopened in between.
 *
 * So "finished" is a question about the queue, and the rule below answers it.
 */

/** One queued photo from a capture session, joined against the outbox. */
export type SessionPhotoRow = {
  outboxId: string;
  sessionId: string;
  projectId: string;
  /** The real photo id, written when the upload lands. Null until then. */
  photoId: string | null;
  /** "camera" or "upload", for the wording of the log's section heading. */
  source: string | null;
  /** The technician's own UTC offset at capture time, in minutes. */
  tzOffset: number | null;
  createdAt: number;
  /**
   * The outbox row's state, or null when there is no outbox row any more.
   *
   * Null is the ordinary success case: `markDone` deletes the row. It is also
   * what a row cleared by hand from the queue screen leaves behind.
   */
  outboxState: string | null;
};

/** A session ready to be written up. */
export type ReadySession = {
  sessionId: string;
  projectId: string;
  photoIds: string[];
  source: "camera" | "upload" | undefined;
  tzOffsetMinutes: number | undefined;
  outboxIds: string[];
};

/**
 * Is this photo still on its way?
 *
 * Only `pending` and `sending` count. A `failed` row has exhausted its retries
 * or hit a permanent error, and waiting for it means the log for a day's work
 * never appears because one photograph of the twenty could not be delivered.
 * The nineteen that landed are still the day's record, and the failed one is
 * already surfaced on the queue screen where somebody can retry it.
 */
export function stillInFlight(row: SessionPhotoRow): boolean {
  if (row.photoId) return false;
  return row.outboxState === "pending" || row.outboxState === "sending";
}

/**
 * Sessions whose photos have all settled, one way or the other.
 *
 * A session with nothing delivered at all yields nothing: `autoDailyLog`
 * requires at least one photo id, and a log saying a technician uploaded
 * nothing is not worth writing. Its rows still come back in `outboxIds` so the
 * caller can clear them, because otherwise a session where every upload failed
 * would sit in the table forever.
 */
export function readySessions(rows: SessionPhotoRow[]): ReadySession[] {
  const bySession = new Map<string, SessionPhotoRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.sessionId);
    if (list) list.push(row);
    else bySession.set(row.sessionId, [row]);
  }

  const out: ReadySession[] = [];
  for (const [sessionId, group] of bySession) {
    if (group.some(stillInFlight)) continue;

    // Oldest first: the log reads as the order the photographs were taken,
    // which is the order somebody walked the site.
    const ordered = [...group].sort((a, b) => a.createdAt - b.createdAt);
    const photoIds = ordered.map((row) => row.photoId).filter((id): id is string => Boolean(id));

    const first = ordered[0];
    out.push({
      sessionId,
      projectId: first.projectId,
      photoIds,
      source: first.source === "camera" || first.source === "upload" ? first.source : undefined,
      tzOffsetMinutes: typeof first.tzOffset === "number" ? first.tzOffset : undefined,
      outboxIds: ordered.map((row) => row.outboxId),
    });
  }
  return out;
}

/**
 * The most photos one `autoDailyLog` call may carry.
 *
 * The server's own cap (`MAX_SESSION_PHOTOS` in
 * `apps/api/src/domains/projects/daily-log.ts`) is 60, and it rejects the whole
 * request rather than trimming. A technician who shoots eighty in one pass
 * would otherwise get no log at all, and no error either, because this runs in
 * the background where there is nobody to show one to.
 */
export const MAX_LOG_PHOTOS = 60;

/**
 * Split a ready session into calls the server will accept.
 *
 * Sequential batches rather than one truncated call, because the log is
 * appended to rather than rewritten: two sections for one long session reads
 * fine, and losing twenty photographs off the end does not.
 */
export function logBatches(session: ReadySession): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < session.photoIds.length; i += MAX_LOG_PHOTOS) {
    out.push(session.photoIds.slice(i, i + MAX_LOG_PHOTOS));
  }
  return out;
}
