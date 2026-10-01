/**
 * Transcribing a walkthrough again from the recording in storage.
 *
 * The phone's detail screen used to send people here ("recordings are
 * transcribed from the web app") and this page had no button for it. Now both
 * have one, and both say how it ended: transcribed, nothing heard, or how many
 * minutes could not be read.
 *
 * The calls are passed in rather than imported, so the polling and the wording
 * can be tested without a server.
 */

export type TranscriptionState = "running" | "done" | "partial" | "empty" | "failed";

/** What the transcribe op and the status op answer. Older servers send only `transcript`. */
export type TranscriptionOutcome = {
  transcript?: string;
  state?: TranscriptionState | null;
  empty?: boolean;
  failedPieces?: number;
  totalPieces?: number;
  message?: string | null;
  inProgress?: boolean;
};

export const TRANSCRIBE_POLL_MS = 4_000;
export const TRANSCRIBE_POLL_LIMIT_MS = 15 * 60 * 1000;

function minutes(n: number): string {
  return `${n} ${n === 1 ? "minute" : "minutes"}`;
}

export function transcriptionState(outcome: TranscriptionOutcome): TranscriptionState {
  if (outcome.inProgress) return "running";
  if (outcome.state) return outcome.state;
  if (outcome.empty || !outcome.transcript?.trim()) return "empty";
  return (outcome.failedPieces ?? 0) > 0 ? "partial" : "done";
}

/** The sentence to show. The server's own wins when it sent one. */
export function transcriptionNotice(outcome: TranscriptionOutcome): string {
  const state = transcriptionState(outcome);
  if (state === "running") {
    return outcome.message ?? "Transcribing. A long walk can take a few minutes.";
  }
  if (state === "done") return "Transcript ready.";
  if (outcome.message) return outcome.message;
  const lost = outcome.failedPieces ?? 0;
  if (state === "partial") return `${minutes(lost)} could not be transcribed. The rest was saved.`;
  if (state === "empty") {
    return "No speech was found in the recording. Reports are built from the photos instead.";
  }
  return lost > 0
    ? `${minutes(lost)} could not be transcribed.`
    : "The recording could not be transcribed.";
}

export function transcriptionIsProblem(outcome: TranscriptionOutcome): boolean {
  const state = transcriptionState(outcome);
  return state === "partial" || state === "empty" || state === "failed";
}

/**
 * Start a background transcription and wait for its outcome.
 *
 * Throws only when the server refuses the request itself. A poll that fails is
 * asked again rather than reported, since a dropped status check says nothing
 * about the transcription.
 */
export async function runTranscription(deps: {
  start: () => Promise<TranscriptionOutcome>;
  status: () => Promise<TranscriptionOutcome>;
  onProgress?: (elapsedSeconds: number) => void;
  cancelled?: () => boolean;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<TranscriptionOutcome> {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = now();
  const first = await deps.start();
  if (!first?.inProgress) return first ?? {};
  while (!deps.cancelled?.()) {
    const elapsed = now() - started;
    if (elapsed > TRANSCRIBE_POLL_LIMIT_MS) {
      return {
        state: "running",
        inProgress: true,
        message: "Still transcribing on the server. Refresh this page in a few minutes.",
      };
    }
    deps.onProgress?.(Math.round(elapsed / 1000));
    await wait(TRANSCRIBE_POLL_MS);
    let status: TranscriptionOutcome;
    try {
      status = await deps.status();
    } catch {
      continue;
    }
    if (status.state && status.state !== "running") return status;
    if (!status.state && status.transcript?.trim()) return { ...status, state: "done" };
  }
  return { state: "running", inProgress: true };
}
