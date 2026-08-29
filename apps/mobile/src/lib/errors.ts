import { describeError, formatForSupport, pushRecord, type ErrorRecord } from "./error-redaction";

/**
 * Where errors go.
 *
 * The app had nowhere. `ErrorBoundary` wrote to `console.error`, which reaches
 * the Metro console during development and absolutely nobody in production: a
 * crew hits a bug on a roof, and the only account of it is what they can
 * remember by the time they mention it.
 *
 * This is deliberately **not** Sentry. Adding a crash service is a decision with
 * an account, a bill, a data-processing agreement and a row in the Play data
 * safety form behind it, and none of those should be made as a side effect of
 * wanting somewhere to put an error. What this is instead is the seam: one
 * function everything reports through, a bounded buffer somebody can read out
 * to support, and a single place to add a transport when that decision is made.
 *
 * Everything is redacted on the way in, once, by `error-redaction.ts`. Errors
 * here carry access tokens, share links and the signed-in user's email, and the
 * moment one is read aloud to support or pasted into a ticket, all of it is
 * disclosed. Redacting at the boundary means no later consumer has to remember.
 */

let records: ErrorRecord[] = [];
const listeners = new Set<() => void>();

/**
 * Record a failure.
 *
 * Never throws. It is called from `componentDidCatch` and from query error
 * handlers, and a second failure inside the error path is the worst place for
 * one: it replaces a recoverable bug with a crash loop.
 */
export function reportError(error: unknown, context: string): void {
  try {
    records = pushRecord(records, {
      at: new Date().toISOString(),
      context,
      message: describeError(error),
    });
    listeners.forEach((listener) => listener());
  } catch {
    // Nothing to do, and nowhere to report it to. Swallowing is correct.
  }

  if (__DEV__) {
    // The raw error, unredacted, to the Metro console only. On a developer's
    // machine the token is already in their own `.env`; the redacted copy is
    // for anything that leaves the device.
    console.error(`[everlumen] ${context}`, error);
  }
}

/** Everything recorded on this phone, newest first. */
export function recentErrors(): ErrorRecord[] {
  return records;
}

/** The block of text somebody reads out or pastes into a ticket. */
export function errorsForSupport(): string {
  return formatForSupport(records);
}

/** Forget them. Offered on the Account screen so a report starts clean. */
export function clearErrors(): void {
  records = [];
  listeners.forEach((listener) => listener());
}

/** Subscribe, for a screen that shows the count. Returns an unsubscribe. */
export function onErrorsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
