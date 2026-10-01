import { randomUUID } from "expo-crypto";
import { api } from "@/lib/api";
import {
  TRANSCRIBE_POLL_LIMIT_MS,
  TRANSCRIBE_POLL_MS,
  type TranscriptionOutcome,
} from "./walkthrough-report-view";

/**
 * Transcribe a walkthrough again from the recording already in storage.
 *
 * The detail screen's "Transcribe recording". It used to say recordings are
 * transcribed from the web app, and the web had no button for it, so a walk
 * whose transcription failed at Stop had no way back.
 *
 * The server is asked to work in the background and answer at once; this then
 * polls the outcome it records on the walkthrough. A long walk is a minute of
 * AI work per minute of narration, and no phone holds one request open that
 * long on a site connection.
 */

/** Five minutes for the call itself, in case the server answers the old way and works inline. */
export const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000;

const WALKTHROUGH_VIDEO_BUCKET = "site-videos";

/** The status op's answer. */
type TranscriptionStatus = TranscriptionOutcome & {
  startedAt?: string | null;
  finishedAt?: string | null;
};

export async function getWalkthroughTranscription(
  walkthroughId: string,
): Promise<TranscriptionStatus> {
  return api.rpc<TranscriptionStatus>("getWalkthroughTranscription", { walkthroughId });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the transcription and resolve with how it ended.
 *
 * Throws only when the server refuses the request outright (no access, no
 * recording); a run that heard nothing or lost minutes resolves, with a state
 * that says so. `onProgress` gets the seconds waited so far, and `cancelled`
 * stops the polling when the screen goes away.
 */
export async function retryWalkthroughTranscription(input: {
  walkthroughId: string;
  storagePath: string;
  mimeType: string;
  onProgress?: (elapsedSeconds: number) => void;
  cancelled?: () => boolean;
}): Promise<TranscriptionOutcome> {
  const started = Date.now();
  const first = await api.rpc<TranscriptionOutcome>(
    "transcribeWalkthrough",
    {
      walkthroughId: input.walkthroughId,
      storagePath: input.storagePath,
      bucket: WALKTHROUGH_VIDEO_BUCKET,
      mimeType: input.mimeType,
      background: true,
    },
    // AI work and charged for: the key stops a dropped response paying twice.
    { idempotencyKey: randomUUID(), timeoutMs: TRANSCRIBE_TIMEOUT_MS },
  );
  if (!first?.inProgress) return first ?? {};

  while (!input.cancelled?.()) {
    const elapsed = Date.now() - started;
    if (elapsed > TRANSCRIBE_POLL_LIMIT_MS) {
      return {
        state: "running",
        inProgress: true,
        message: "Still transcribing on the server. Pull down to refresh in a few minutes.",
      };
    }
    input.onProgress?.(Math.round(elapsed / 1000));
    await wait(TRANSCRIBE_POLL_MS);
    let status: TranscriptionStatus;
    try {
      status = await getWalkthroughTranscription(input.walkthroughId);
    } catch {
      // A dropped poll on a site connection is not the outcome. Ask again.
      continue;
    }
    if (status.state && status.state !== "running") {
      return { ...status, empty: status.state === "empty" || undefined };
    }
    // A database that cannot keep the record still gets the transcript.
    if (!status.state && status.transcript?.trim()) return { ...status, state: "done" };
  }
  return { state: "running", inProgress: true };
}
