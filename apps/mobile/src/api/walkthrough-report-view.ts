/**
 * Turning a walkthrough into a client report.
 *
 * Import-free so the wording can be tested, and the wording is the whole of it:
 * the op is idempotent by lookup rather than by key, so the same tap twice
 * produces the same report and the screen must not claim otherwise.
 *
 * Also the rules around it on the detail screen: what a transcription retry
 * says when it finishes, and whether photos still in the upload queue should
 * hold the report back.
 */

/** What the service answers with. */
export type WalkthroughReportResult = {
  reportId: string | null;
  alreadyExisted: boolean;
};

/**
 * What to say after the tap.
 *
 * The two cases are genuinely different and reporting them the same way is a
 * small lie that costs trust: somebody who taps twice and is told "Report
 * created" twice reasonably concludes they now have two reports to go and
 * delete.
 */
export function reportResultMessage(result: WalkthroughReportResult): string {
  if (!result.reportId) {
    return "The report could not be created.";
  }
  return result.alreadyExisted
    ? "This walkthrough already had a report. Opening it."
    : "Report created from this walkthrough.";
}

/**
 * What to say beside the report buttons when there is no transcript, or null.
 *
 * Not a refusal. The buttons used to be dead without a transcript, but the
 * server builds the report from the photos and their captions when nobody spoke
 * (a silent walk, or one whose audio could not be read), and the web lets that
 * happen. The phone now does the same and says what the report will be made of.
 */
export function reportNote(hasTranscript: boolean): string | null {
  return hasTranscript ? null : "No transcript yet, so reports are built from the photos.";
}

/**
 * Whether there is anything to open after the call.
 *
 * Separate from the message because the screen navigates on this and speaks on
 * the other, and a missing id with a cheerful message would push a route with
 * `undefined` in it.
 */
export function canOpenReport(result: WalkthroughReportResult): boolean {
  return Boolean(result.reportId);
}

/** How a transcription run ended, as the server reports it. */
export type TranscriptionState = "running" | "done" | "partial" | "empty" | "failed";

/**
 * The transcription op's answer, and the status op's.
 *
 * Every field but `transcript` is optional because a server from before the
 * outcome was recorded answers `{ transcript }` and nothing else.
 */
export type TranscriptionOutcome = {
  transcript?: string;
  state?: TranscriptionState | null;
  empty?: boolean;
  failedPieces?: number;
  totalPieces?: number;
  message?: string | null;
  inProgress?: boolean;
};

function minutes(n: number): string {
  return `${n} ${n === 1 ? "minute" : "minutes"}`;
}

/** The outcome's state, worked out from the transcript alone for an older server. */
export function transcriptionState(outcome: TranscriptionOutcome): TranscriptionState {
  if (outcome.inProgress) return "running";
  if (outcome.state) return outcome.state;
  if (outcome.empty || !outcome.transcript?.trim()) return "empty";
  return (outcome.failedPieces ?? 0) > 0 ? "partial" : "done";
}

/**
 * What the retry button says when it is done, or while it waits.
 *
 * The server's own sentence wins when there is one. These are the words for an
 * older server, and they make the same distinction: "nothing was heard" and
 * "some minutes were lost" are different problems with different next steps.
 */
export function transcriptionNotice(outcome: TranscriptionOutcome): string {
  const state = transcriptionState(outcome);
  if (state === "running") {
    return outcome.message ?? "Transcribing. A long walk can take a few minutes.";
  }
  if (state === "done") return "Transcript ready.";
  if (outcome.message) return outcome.message;
  const lost = outcome.failedPieces ?? 0;
  switch (state) {
    case "partial":
      return `${minutes(lost)} could not be transcribed. The rest was saved.`;
    case "empty":
      return "No speech was found in the recording. Reports are built from the photos instead.";
    default:
      return lost > 0
        ? `${minutes(lost)} could not be transcribed.`
        : "The recording could not be transcribed.";
  }
}

/** Whether the notice is bad news, so the screen can mark it as a warning. */
export function transcriptionIsProblem(outcome: TranscriptionOutcome): boolean {
  const state = transcriptionState(outcome);
  return state === "partial" || state === "empty" || state === "failed";
}

/** How long a retry waits between status checks, and how long it waits in all. */
export const TRANSCRIBE_POLL_MS = 4_000;
export const TRANSCRIBE_POLL_LIMIT_MS = 15 * 60 * 1000;

/** Enough of an outbox row to count it. */
export type QueuedRow = { kind: string; state: string; payload: string };

/** Photos of one walkthrough still in the phone's upload queue. */
export type QueuedWalkthroughPhotos = { uploading: number; failed: number };

/**
 * Count the walkthrough's snaps that have not reached the server.
 *
 * A snap is queued as a `walkthrough_photo` row at Stop and sent when there is
 * signal, so a report written straight after a walk in a basement is written
 * without them. Failed rows are counted apart: they will not arrive on their
 * own, so waiting for them would be waiting forever.
 */
export function queuedWalkthroughPhotos(
  rows: readonly QueuedRow[],
  walkthroughId: string,
): QueuedWalkthroughPhotos {
  let uploading = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.kind !== "walkthrough_photo" || row.state === "done") continue;
    let id: unknown = null;
    try {
      id = (JSON.parse(row.payload) as { walkthroughId?: unknown })?.walkthroughId;
    } catch {
      continue;
    }
    if (id !== walkthroughId) continue;
    if (row.state === "failed") failed += 1;
    else uploading += 1;
  }
  return { uploading, failed };
}

function photos(n: number): string {
  return `${n} ${n === 1 ? "photo" : "photos"}`;
}

/**
 * Why the report should wait, or null when nothing is outstanding.
 *
 * A hold, not a lock: the screen offers "Generate anyway", because a photo
 * stuck on a dead connection must not keep the whole report hostage.
 */
export function uploadHoldMessage(queued: QueuedWalkthroughPhotos): string | null {
  if (queued.uploading > 0) {
    return `${photos(queued.uploading)} still uploading. The report waits for them so they are in it.`;
  }
  if (queued.failed > 0) {
    return `${photos(queued.failed)} could not upload. Retry them from the upload queue, or generate without them.`;
  }
  return null;
}

/**
 * Photos on the walk that the summary does not include.
 *
 * Snaps that land after the summary was written are the usual cause. Counted
 * so the screen can say so and offer Regenerate, rather than presenting a
 * report that is quietly missing pictures.
 */
export function newPhotosSinceSummary(
  walkPhotoIds: readonly string[],
  summaryPhotoIds: readonly string[],
): number {
  const covered = new Set(summaryPhotoIds);
  return new Set(walkPhotoIds.filter((id) => !covered.has(id))).size;
}

/** The line that goes with `newPhotosSinceSummary`, or null when there are none. */
export function newPhotosMessage(count: number): string | null {
  if (count <= 0) return null;
  return `${count === 1 ? "1 new photo" : `${count} new photos`} since this report. Regenerate to include ${count === 1 ? "it" : "them"}.`;
}
