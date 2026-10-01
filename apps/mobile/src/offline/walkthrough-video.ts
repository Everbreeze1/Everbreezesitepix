import { getDb } from "./db";
import { DeferredError, saveRowPayload, type OutboxRow } from "./outbox";

/**
 * A recorded walkthrough, queued: everything that happens after Stop.
 *
 * The web recorder does these steps in one go while its tab is open: make the
 * walkthrough row, upload the video, record its path, finish the session,
 * transcribe, write the AI report, then build the client report from it. On a
 * phone the walk usually ends where the signal does, so the same steps run
 * here as one outbox row instead, in the same order, and each step that lands
 * is saved on the row (`saveRowPayload`). A retry after a dropped connection,
 * or after the app was killed, starts at the next step rather than making a
 * second walkthrough or uploading the video twice.
 *
 * Kept free of the app's API modules (they arrive as `steps`) so the order and
 * the resume rules can be tested against the real queue.
 */

export type WalkthroughVideoPayload = {
  userId: string;
  projectId: string;
  title: string;
  /** When Record was pressed (ISO), so a walkthrough made later keeps its real start. */
  startedAt: string;
  durationSeconds: number;
  mimeType: string;
  /** The walkthrough on the server; null until it exists. */
  sessionId: string | null;
  /** Where the video went in storage, once it has. */
  videoPath?: string | null;
  uploaded?: boolean;
  pathSaved?: boolean;
  finished?: boolean;
  transcribed?: boolean;
  /** The transcription ran and heard nothing to write down. */
  transcriptEmpty?: boolean;
  reportGenerated?: boolean;
  reportCreated?: boolean;
  reportId?: string | null;
  /** Failed tries per step, for the steps allowed to give up. */
  tries?: Record<string, number>;
  /** Steps that were given up on, with what the server said. */
  softFailures?: Record<string, string>;
};

/** What the queue calls to do each step. The handler passes the real API. */
export type WalkthroughVideoSteps = {
  createSession(
    projectId: string,
    title: string,
    options: { startedAt: string; idempotencyKey: string },
  ): Promise<{ id: string }>;
  videoPath(userId: string, projectId: string, walkthroughId: string, extension: string): string;
  uploadVideo(options: { localUri: string; storagePath: string; mimeType: string }): Promise<void>;
  updateVideoPath(walkthroughId: string, videoPath: string, mimeType: string): Promise<void>;
  finish(walkthroughId: string, durationSeconds: number): Promise<void>;
  transcribe(
    walkthroughId: string,
    storagePath: string,
    mimeType: string,
    options: { idempotencyKey: string },
  ): Promise<{ ok: boolean; message: string | null; empty: boolean }>;
  generateReport(walkthroughId: string, options: { idempotencyKey: string }): Promise<void>;
  createReport(walkthroughId: string): Promise<{ reportId: string | null }>;
};

/**
 * How often a step that may give up is tried before it does. The video, its
 * path and the finished session are never given up on: without them there is
 * no walkthrough. The AI steps are, the way web carries on past them.
 */
export const SOFT_STEP_TRIES = 3;

/** How long the report waits before looking again for the walk's photos. */
export const SNAP_WAIT_MS = 30_000;

type SnapRowPayload = { walkthroughId?: string | null; videoRowId?: string | null };

function parse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Give this walkthrough's queued snaps the walkthrough's id.
 *
 * A walk recorded with no signal has no walkthrough yet when its snaps are
 * queued, so they carry the video row's id instead and wait. Rows being sent
 * are left alone; the only row being sent is this one.
 */
export async function linkQueuedSnaps(videoRowId: string, walkthroughId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; payload: string }>(
    `SELECT id, payload FROM outbox WHERE kind = 'walkthrough_photo' AND state != 'sending'`,
  );
  let linked = 0;
  for (const row of rows) {
    const payload = parse<SnapRowPayload & Record<string, unknown>>(row.payload);
    if (!payload || payload.videoRowId !== videoRowId || payload.walkthroughId) continue;
    await db.runAsync(`UPDATE outbox SET payload = ? WHERE id = ?`, [
      JSON.stringify({ ...payload, walkthroughId }),
      row.id,
    ]);
    linked += 1;
  }
  return linked;
}

/** The walkthrough a queued walkthrough video has made, if it has made one yet. */
export async function queuedWalkthroughId(videoRowId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ payload: string }>(
    `SELECT payload FROM outbox WHERE id = ? AND kind = 'walkthrough_video'`,
    [videoRowId],
  );
  if (!row) return null;
  return parse<WalkthroughVideoPayload>(row.payload)?.sessionId ?? null;
}

/**
 * This walkthrough's snaps still on their way. A snap that has given up
 * (`failed`) is not waited for: it waits for the person instead, and the
 * report goes without it rather than never.
 */
export async function pendingSnapCount(
  videoRowId: string,
  walkthroughId: string | null,
): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ payload: string }>(
    `SELECT payload FROM outbox
      WHERE kind = 'walkthrough_photo' AND state IN ('pending', 'sending')`,
  );
  return rows.filter((row) => {
    const payload = parse<SnapRowPayload>(row.payload);
    if (!payload) return false;
    return (
      payload.videoRowId === videoRowId ||
      (Boolean(walkthroughId) && payload.walkthroughId === walkthroughId)
    );
  }).length;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** A plan refusal: the client report is Pro and Team only. */
function isPlanRefusal(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 403;
}

/**
 * Run a queued walkthrough from wherever it got to.
 *
 * @returns the payload as it ended, every step recorded.
 * @throws an ordinary error to retry the row with backoff, or `DeferredError`
 *   while the walk's snaps are still uploading.
 */
export async function runWalkthroughVideo(
  row: OutboxRow,
  steps: WalkthroughVideoSteps,
): Promise<WalkthroughVideoPayload> {
  const payload = JSON.parse(row.payload) as WalkthroughVideoPayload;
  payload.tries ??= {};
  payload.softFailures ??= {};
  const save = () => saveRowPayload(row.id, payload);

  /*
   * A step allowed to give up: it throws to be retried with the row until it
   * has failed `SOFT_STEP_TRIES` times, then it is written down and the walk
   * carries on without it, as web does when its AI steps fail.
   */
  const giveUpOrRetry = async (step: string, message: string): Promise<void> => {
    const tries = (payload.tries![step] ?? 0) + 1;
    payload.tries![step] = tries;
    if (tries < SOFT_STEP_TRIES) {
      await save();
      throw new Error(message);
    }
    payload.softFailures![step] = message;
  };

  // 1. The walkthrough itself, once. Made at Record when there was signal.
  if (!payload.sessionId) {
    const created = await steps.createSession(payload.projectId, payload.title, {
      startedAt: payload.startedAt,
      idempotencyKey: `${row.id}-session`,
    });
    payload.sessionId = created.id;
    await save();
  }
  const walkthroughId = payload.sessionId;
  // Snaps queued before the walkthrough existed can go now.
  await linkQueuedSnaps(row.id, walkthroughId);

  // 2. The video, then its path on the walkthrough.
  if (!payload.uploaded) {
    if (!row.local_uri) throw new Error("The walkthrough video is no longer on the device");
    const path =
      payload.videoPath ?? steps.videoPath(payload.userId, payload.projectId, walkthroughId, "mp4");
    await steps.uploadVideo({
      localUri: row.local_uri,
      storagePath: path,
      mimeType: payload.mimeType,
    });
    payload.videoPath = path;
    payload.uploaded = true;
    await save();
  }
  const videoPath = payload.videoPath!;

  if (!payload.pathSaved) {
    await steps.updateVideoPath(walkthroughId, videoPath, payload.mimeType);
    payload.pathSaved = true;
    await save();
  }

  /*
   * Web also re-checks its photo links here (`ensureWalkthroughPhotoLinks`).
   * The phone has no list of photo ids to check: each snap writes its own
   * link as it lands (`saveWalkthroughPhoto`), so there is nothing to add.
   */

  // 3. Finished, with the length of the video.
  if (!payload.finished) {
    await steps.finish(walkthroughId, payload.durationSeconds);
    payload.finished = true;
    await save();
  }

  // 4. The transcript. Nothing heard is written down, not retried.
  if (!payload.transcribed) {
    const result = await steps.transcribe(walkthroughId, videoPath, payload.mimeType, {
      idempotencyKey: `${row.id}-transcribe`,
    });
    if (result.ok) {
      if (result.empty) {
        payload.transcriptEmpty = true;
        payload.softFailures.transcribe = result.message ?? "No speech was heard in the recording";
      }
    } else {
      await giveUpOrRetry("transcribe", result.message ?? "Could not transcribe the recording");
    }
    payload.transcribed = true;
    await save();
  }

  // 5. The report, once every snap of the walk is in it.
  if (!payload.reportGenerated || !payload.reportCreated) {
    const waiting = await pendingSnapCount(row.id, walkthroughId);
    if (waiting > 0) {
      throw new DeferredError(
        `Waiting for ${waiting} walkthrough photo${waiting === 1 ? "" : "s"} to upload`,
        SNAP_WAIT_MS,
      );
    }
  }

  if (!payload.reportGenerated) {
    try {
      await steps.generateReport(walkthroughId, { idempotencyKey: `${row.id}-report` });
    } catch (error) {
      await giveUpOrRetry("report", messageOf(error, "Could not write the report"));
    }
    payload.reportGenerated = true;
    await save();
  }

  // 6. The client report in Reports. Not on every plan, and that is not a failure.
  if (!payload.reportCreated) {
    try {
      const built = await steps.createReport(walkthroughId);
      payload.reportId = built.reportId;
    } catch (error) {
      if (isPlanRefusal(error)) {
        payload.softFailures.clientReport = messageOf(error, "Not on this plan");
      } else {
        await giveUpOrRetry("clientReport", messageOf(error, "Could not build the report"));
      }
    }
    payload.reportCreated = true;
    await save();
  }

  return payload;
}
