import { getDb } from "./db";
import { readySessions, logBatches, type SessionPhotoRow } from "./capture-session-rules";
import { autoDailyLog } from "@/api/daily-log";

/**
 * The Daily Log's half of the outbox.
 *
 * The feature is specified as writing itself: "auto-generate Daily Log the
 * moment a technician finishes a Capture/photo upload session ... rather than
 * something requiring a trip to Reports to manually generate". The phone is
 * where capture happens, and the phone was the one client that never called it.
 *
 * It could not, in the shape the web uses. There, an upload finishes and the
 * photo ids are in hand, so the call is one line after it. Here the shots go to
 * the outbox and land whenever there is signal, each one getting its id only as
 * its upload completes, quite possibly after the app has been killed and
 * reopened. So the session is recorded locally as the photos are queued,
 * completed as they land, and written up once the queue has nothing left to say
 * about it.
 *
 * The decision itself is in `capture-session-rules.ts` and tested there.
 */

/** Record a queued photo against the session that shot it. */
export async function recordSessionPhoto(input: {
  outboxId: string;
  sessionId: string;
  projectId: string;
  source: "camera" | "upload";
  tzOffsetMinutes: number;
}): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO capture_session_photos
       (outbox_id, session_id, project_id, photo_id, source, tz_offset, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
    [
      input.outboxId,
      input.sessionId,
      input.projectId,
      input.source,
      input.tzOffsetMinutes,
      Date.now(),
    ],
  );
}

/**
 * The upload landed: here is the id it was given.
 *
 * A no-op for a photo that was not part of a tracked session, which covers
 * every row queued by a build that predates this and every capture started
 * somewhere other than the camera screen.
 */
export async function completeSessionPhoto(outboxId: string, photoId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE capture_session_photos SET photo_id = ? WHERE outbox_id = ?`, [
    photoId,
    outboxId,
  ]);
}

async function clearSession(outboxIds: string[]): Promise<void> {
  if (outboxIds.length === 0) return;
  const db = await getDb();
  const holes = outboxIds.map(() => "?").join(", ");
  await db.runAsync(`DELETE FROM capture_session_photos WHERE outbox_id IN (${holes})`, outboxIds);
}

/**
 * Write up every capture session the queue has finished with.
 *
 * Called at the end of a drain pass. Deliberately quiet: this runs in the
 * background with no screen in front of it, so a failure has nobody to tell.
 *
 * A failed call leaves the session rows in place, so the next drain tries
 * again. That is the right way round for something whose whole promise is that
 * the log appears on its own, and every call carries an idempotency key so a
 * retry after a lost response replays rather than writing the day up twice.
 */
export async function flushCaptureSessions(): Promise<void> {
  let rows: SessionPhotoRow[];
  try {
    const db = await getDb();
    /*
     * The left join is what makes "finished" exact rather than a timeout. A
     * successful upload deletes its outbox row, so `o.state` comes back null; a
     * row still queued comes back 'pending' or 'sending'; one that gave up
     * comes back 'failed' and is not waited for.
     */
    const raw = await db.getAllAsync<{
      outbox_id: string;
      session_id: string;
      project_id: string;
      photo_id: string | null;
      source: string | null;
      tz_offset: number | null;
      created_at: number;
      state: string | null;
    }>(
      `SELECT s.outbox_id, s.session_id, s.project_id, s.photo_id, s.source,
              s.tz_offset, s.created_at, o.state AS state
         FROM capture_session_photos s
         LEFT JOIN outbox o ON o.id = s.outbox_id`,
    );
    rows = raw.map((row) => ({
      outboxId: row.outbox_id,
      sessionId: row.session_id,
      projectId: row.project_id,
      photoId: row.photo_id,
      source: row.source,
      tzOffset: row.tz_offset,
      createdAt: row.created_at,
      outboxState: row.state,
    }));
  } catch {
    // The local database is unavailable. The next drain will try again.
    return;
  }

  for (const session of readySessions(rows)) {
    if (session.photoIds.length === 0) {
      // Every upload in it failed. Nothing to write up, but the rows have to go
      // or they are re-read on every drain for the life of the install.
      await clearSession(session.outboxIds).catch(() => {});
      continue;
    }

    try {
      const batches = logBatches(session);
      for (let i = 0; i < batches.length; i += 1) {
        await autoDailyLog({
          projectId: session.projectId,
          photoIds: batches[i],
          source: session.source,
          tzOffsetMinutes: session.tzOffsetMinutes,
          // Stable across retries, and distinct per batch. Without it the
          // narrow failure below writes the day up twice.
          idempotencyKey: `daily-log:${session.sessionId}:${i}`,
        });
      }
      await clearSession(session.outboxIds);
    } catch {
      /*
       * Left in place on purpose, so the next drain retries.
       *
       * The failure worth naming is the narrow one: the server wrote the
       * section and the response was lost on the way back. Without an
       * idempotency key that retry appends a second copy of the same day's
       * work, which is why every call above carries one.
       */
      continue;
    }
  }
}
