/**
 * What happened the last time a walkthrough was transcribed, kept on the row.
 *
 * Transcription used to leave no trace when it came back with nothing: the
 * model heard no speech, the server wrote nothing, and the op answered
 * `{ transcript: "" }`. The phone and the web both read that as "still to do",
 * so a walk that had genuinely failed looked exactly like one nobody had tried.
 * A minute that failed inside a long walk was dropped without a word as well.
 *
 * The outcome now lives inside `walkthroughs.narration_json`, under
 * `transcription`, beside the `transcriptSegments` the transcription pass
 * already keeps there. No migration: the column exists, and a database without
 * it loses only this record, as it already loses the segment timing.
 *
 * Import-free apart from types, so the rules can be tested without a database.
 */

/** The bucket walkthrough recordings live in. Nothing else is ever transcribed. */
export const TRANSCRIPTION_BUCKET = "site-videos";

/**
 * How long a "running" record holds off a second run.
 *
 * Longer than any real walk takes (an hour of narration is sixty one-minute
 * pieces, three at a time), short enough that a run lost to a restart does not
 * block the retry button for the rest of the day.
 */
export const TRANSCRIPTION_STALE_MS = 15 * 60 * 1000;

export type TranscriptionState = "running" | "done" | "partial" | "empty" | "failed";

export type TranscriptionRecord = {
  state: TranscriptionState;
  startedAt: string;
  finishedAt: string | null;
  /** One-minute pieces that could not be transcribed. */
  failedPieces: number;
  /** One-minute pieces in the recording, or 1 for a file sent whole. */
  totalPieces: number;
  /** A sentence for the person, or null when there is nothing to say. */
  message: string | null;
  /** True when the audio-only upload heard nothing and the stored video was tried. */
  videoFallback: boolean;
};

/** What the op answers with. `transcript` is the field every older client reads. */
export type TranscriptionResult = {
  transcript: string;
  state: TranscriptionState;
  /** Present and true when this run heard nothing. */
  empty?: true;
  failedPieces: number;
  totalPieces: number;
  message: string | null;
  videoFallback?: true;
  /** The work is still going; poll `getWalkthroughTranscription`. */
  inProgress?: true;
};

/**
 * Why this caller may not have this object transcribed, or null when it may.
 *
 * SECURITY. The op signs the object with the service role, so an unchecked
 * bucket and path is a read of any file in storage, by anybody signed in, with
 * the transcript as the leak. Recordings always land under
 * `{userId}/{projectId}/` in `site-videos` (the same rule `saveWalkthroughPhoto`
 * and `updateWalkthroughVideoPath` apply), and the walkthrough's own stored
 * `video_path` was checked against that rule when it was written.
 */
export function transcriptionPathError(input: {
  bucket: string | null | undefined;
  storagePath: string;
  userId: string;
  projectId: string;
  videoPath: string | null | undefined;
}): string | null {
  const bucket = input.bucket ?? TRANSCRIPTION_BUCKET;
  if (bucket !== TRANSCRIPTION_BUCKET) return "Recordings can only be read from site-videos.";
  const path = input.storagePath;
  if (!path || path.includes("..")) return "That recording path is not valid.";
  if (input.videoPath && path === input.videoPath) return null;
  if (path.startsWith(`${input.userId}/${input.projectId}/`)) return null;
  return "That recording does not belong to this walkthrough.";
}

/** The record inside `narration_json`, or null when there is none or it is malformed. */
export function readTranscriptionRecord(narrationJson: unknown): TranscriptionRecord | null {
  if (!narrationJson || typeof narrationJson !== "object" || Array.isArray(narrationJson)) {
    return null;
  }
  const raw = (narrationJson as Record<string, unknown>).transcription;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const states: TranscriptionState[] = ["running", "done", "partial", "empty", "failed"];
  if (!states.includes(r.state as TranscriptionState)) return null;
  return {
    state: r.state as TranscriptionState,
    startedAt: typeof r.startedAt === "string" ? r.startedAt : "",
    finishedAt: typeof r.finishedAt === "string" ? r.finishedAt : null,
    failedPieces: Math.max(0, Number(r.failedPieces) || 0),
    totalPieces: Math.max(0, Number(r.totalPieces) || 0),
    message: typeof r.message === "string" ? r.message : null,
    videoFallback: r.videoFallback === true,
  };
}

/**
 * Whether a run is genuinely under way, so a second tap must not start another.
 *
 * A "running" record older than `TRANSCRIPTION_STALE_MS` is a run that died
 * with its process, and does not count.
 */
export function transcriptionIsRunning(
  record: TranscriptionRecord | null,
  now: number = Date.now(),
): boolean {
  if (!record || record.state !== "running") return false;
  const started = Date.parse(record.startedAt);
  if (!Number.isFinite(started)) return false;
  return now - started < TRANSCRIPTION_STALE_MS;
}

function minutes(n: number): string {
  return `${n} ${n === 1 ? "minute" : "minutes"}`;
}

/** How a finished run turned out, from what it produced. */
export function transcriptionOutcome(input: {
  transcriptChars: number;
  failedPieces: number;
  totalPieces: number;
}): { state: TranscriptionState; message: string | null } {
  if (input.transcriptChars <= 0) {
    if (input.failedPieces > 0) {
      return {
        state: "failed",
        message: `${minutes(input.failedPieces)} could not be transcribed, and no speech was found in the rest.`,
      };
    }
    return {
      state: "empty",
      message: "No speech was found in the recording. Reports are built from the photos instead.",
    };
  }
  if (input.failedPieces > 0) {
    return {
      state: "partial",
      message: `${minutes(input.failedPieces)} could not be transcribed. The rest was saved.`,
    };
  }
  return { state: "done", message: null };
}

/** The op's answer for a finished run. Keeps `transcript` for older clients. */
export function transcriptionResult(input: {
  transcript: string;
  heardSpeech: boolean;
  state: TranscriptionState;
  failedPieces: number;
  totalPieces: number;
  message: string | null;
  videoFallback: boolean;
}): TranscriptionResult {
  return {
    transcript: input.transcript,
    state: input.state,
    ...(input.heardSpeech ? {} : { empty: true as const }),
    failedPieces: input.failedPieces,
    totalPieces: input.totalPieces,
    message: input.message,
    ...(input.videoFallback ? { videoFallback: true as const } : {}),
  };
}
