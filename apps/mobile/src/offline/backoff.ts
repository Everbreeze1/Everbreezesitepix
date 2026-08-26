/**
 * Retry timing for the outbox.
 *
 * Split out from `outbox.ts` so it can be tested without a SQLite connection.
 * The scheduling rules are the part most likely to be got wrong and the least
 * likely to be noticed: a queue that retries too eagerly flattens a battery,
 * and one that gives up too early loses a photo.
 */

/**
 * Delay before each retry, in milliseconds, indexed by attempts already made.
 *
 * Deliberately coarse. A phone that has been out of signal for an hour gains
 * nothing from having retried two hundred times while it was, and every retry
 * wakes the radio, which is the most expensive thing an app can do to a
 * battery. Past the end of the table it settles at hourly.
 */
export const BACKOFF_MS: readonly number[] = [5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000];

export const MAX_BACKOFF_MS = 60 * 60_000;

/**
 * Attempts before a row stops retrying on its own and waits for the user.
 *
 * A row that has failed this often is not failing for lack of signal. It is a
 * permission problem, a deleted project, or a bug, and retrying forever hides
 * the real error behind a queue that never empties.
 */
export const MAX_ATTEMPTS = 8;

/** Delay to apply after `attempts` failures. */
export function backoffFor(attempts: number): number {
  if (!Number.isFinite(attempts) || attempts < 0) return BACKOFF_MS[0];
  return BACKOFF_MS[attempts] ?? MAX_BACKOFF_MS;
}

/** Whether a row has run out of automatic retries. */
export function isExhausted(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

/** Epoch milliseconds for the next attempt after a failure at `attempts`. */
export function nextAttemptAt(attempts: number, now: number): number {
  return now + backoffFor(attempts);
}
