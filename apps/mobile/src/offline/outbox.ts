import { randomUUID } from "expo-crypto";
import { backoffFor, isExhausted, MAX_ATTEMPTS } from "./backoff";
import { getDb } from "./db";
import { discardCapture, sweepOrphans } from "./media";

/**
 * The durable queue of work that has to survive a dead connection.
 *
 * Every mutation a user can make away from signal is written here first and
 * sent afterwards, so the UI never waits on the network and nothing is lost
 * when the app is killed mid-send.
 */

export { MAX_ATTEMPTS };

export type OutboxKind =
  | "photo_upload"
  | "checklist_item_patch"
  | "task_create"
  | "task_patch"
  | "task_edit"
  | "photo_patch"
  | "project_patch"
  | "workflow_item_patch"
  | "workflow_phase_patch"
  | "site_log_patch";

export type OutboxState = "pending" | "sending" | "failed" | "done";

export type OutboxRow = {
  id: string;
  kind: OutboxKind;
  project_id: string | null;
  payload: string;
  local_uri: string | null;
  state: OutboxState;
  attempts: number;
  next_attempt: number;
  last_error: string | null;
  created_at: number;
};

export type OutboxCounts = {
  pending: number;
  sending: number;
  failed: number;
  /** Everything not yet delivered, which is what a banner should show. */
  outstanding: number;
};

export type EnqueueInput = {
  kind: OutboxKind;
  payload: unknown;
  projectId?: string | null;
  /** Path to a durable copy of the media this row sends, if any. */
  localUri?: string | null;
  /**
   * Row id, when the caller needs to know it before enqueuing, which the photo
   * path does: the file is copied to a name derived from the id.
   */
  id?: string;
};

/** A new id, usable as a row id and as the deterministic key derived from it. */
export function newOutboxId(): string {
  return randomUUID();
}

export async function enqueue(input: EnqueueInput): Promise<string> {
  const db = await getDb();
  const id = input.id ?? newOutboxId();

  await db.runAsync(
    `INSERT OR REPLACE INTO outbox
       (id, kind, project_id, payload, local_uri, state, attempts, next_attempt, last_error, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, 0, NULL, ?)`,
    [
      id,
      input.kind,
      input.projectId ?? null,
      JSON.stringify(input.payload),
      input.localUri ?? null,
      Date.now(),
    ],
  );

  return id;
}

/**
 * Claim the next row that is due, one per project.
 *
 * Ordering is per project rather than global on purpose. A single stuck upload
 * at the head of one job must not hold back work on another: the person is
 * standing on a different site by then, and a queue that stops entirely because
 * of one bad row reads as "the app is broken".
 *
 * The claim flips the row to `sending` in the same statement that selects it,
 * so a second drain pass starting while the first is awaiting the network
 * cannot pick up the same row and send it twice.
 */
export async function claimNext(
  excludeProjectIds: readonly string[] = [],
): Promise<OutboxRow | null> {
  const db = await getDb();
  const now = Date.now();

  // `project_id IS NULL` rows share one lane, keyed by the empty string.
  const excluded = excludeProjectIds.map((id) => id || "");
  const placeholders = excluded.map(() => "?").join(", ");
  const exclusion = excluded.length ? `AND COALESCE(project_id, '') NOT IN (${placeholders})` : "";

  const candidate = await db.getFirstAsync<OutboxRow>(
    `SELECT * FROM outbox
      WHERE state = 'pending'
        AND next_attempt <= ?
        ${exclusion}
      ORDER BY created_at ASC
      LIMIT 1`,
    [now, ...excluded],
  );

  if (!candidate) return null;

  const claim = await db.runAsync(
    `UPDATE outbox SET state = 'sending' WHERE id = ? AND state = 'pending'`,
    [candidate.id],
  );

  // Lost the race to another pass. The caller loops, so returning null here
  // would end the drain early; report it as a miss and let the caller retry.
  if (claim.changes === 0) return claimNext(excludeProjectIds);

  return { ...candidate, state: "sending" };
}

/**
 * Mark a row delivered and release the file it was holding.
 *
 * The delete is conditional on the row still being `sending`, which matters for
 * the kinds that reuse a deterministic id. A checklist item edited again while
 * its previous edit is in flight replaces the row and puts it back to
 * `pending`; an unconditional delete here would then throw away that newer
 * answer the moment the older one landed, and the tick would silently revert.
 */
export async function markDone(row: OutboxRow): Promise<void> {
  const db = await getDb();
  const result = await db.runAsync(`DELETE FROM outbox WHERE id = ? AND state = 'sending'`, [
    row.id,
  ]);
  // Only release the file if this row really is gone. A superseded row still
  // needs whatever it is holding.
  if (result.changes > 0) discardCapture(row.local_uri);
}

/**
 * Record a failure and schedule the retry.
 *
 * `permanent` is for errors that will never succeed on a retry, such as a
 * project the user no longer has access to. Those go straight to `failed` so
 * the user is told, instead of retrying hourly forever against a wall.
 */
export async function markFailed(row: OutboxRow, error: string, permanent = false): Promise<void> {
  const db = await getDb();
  const attempts = row.attempts + 1;
  const exhausted = permanent || isExhausted(attempts);

  await db.runAsync(
    `UPDATE outbox
        SET state = ?, attempts = ?, next_attempt = ?, last_error = ?
      WHERE id = ?`,
    [
      exhausted ? "failed" : "pending",
      attempts,
      exhausted ? 0 : Date.now() + backoffFor(row.attempts),
      error.slice(0, 500),
      row.id,
    ],
  );
}

/**
 * Return anything left mid-flight to `pending`.
 *
 * Called on startup. A row in `sending` when the process died is not actually
 * being sent by anyone, and without this it would sit in that state forever,
 * invisible to the drain and permanently stuck in the banner's count.
 */
export async function recoverInterrupted(): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(`UPDATE outbox SET state = 'pending' WHERE state = 'sending'`);
  return result.changes;
}

export async function counts(): Promise<OutboxCounts> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ state: OutboxState; n: number }>(
    `SELECT state, COUNT(*) AS n FROM outbox GROUP BY state`,
  );

  const by = (state: OutboxState) => rows.find((r) => r.state === state)?.n ?? 0;
  const pending = by("pending");
  const sending = by("sending");
  const failed = by("failed");

  return { pending, sending, failed, outstanding: pending + sending + failed };
}

export async function listRows(limit = 100): Promise<OutboxRow[]> {
  const db = await getDb();
  return db.getAllAsync<OutboxRow>(`SELECT * FROM outbox ORDER BY created_at ASC LIMIT ?`, [limit]);
}

/** Put failed rows back in line, at the front of their backoff. */
export async function retryFailed(id?: string): Promise<void> {
  const db = await getDb();
  if (id) {
    await db.runAsync(
      `UPDATE outbox SET state = 'pending', attempts = 0, next_attempt = 0, last_error = NULL
        WHERE id = ? AND state = 'failed'`,
      [id],
    );
    return;
  }
  await db.runAsync(
    `UPDATE outbox SET state = 'pending', attempts = 0, next_attempt = 0, last_error = NULL
      WHERE state = 'failed'`,
  );
}

/** Drop a row the user has given up on, and the file it was holding. */
export async function discard(id: string): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<OutboxRow>(`SELECT * FROM outbox WHERE id = ?`, [id]);
  await db.runAsync(`DELETE FROM outbox WHERE id = ?`, [id]);
  if (row) discardCapture(row.local_uri);
}

/** Delete outbox files that no row references any more. */
export async function sweepOrphanedMedia(): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ local_uri: string | null }>(
    `SELECT local_uri FROM outbox WHERE local_uri IS NOT NULL`,
  );
  return sweepOrphans(rows.map((r) => r.local_uri).filter((uri): uri is string => Boolean(uri)));
}
