/**
 * The camera's microphone button: its one hook point.
 *
 * Jon wants to speak a note for a photo and have it kept with that photo as
 * the words summaries and reports are written from. The mic records it: one
 * tap in the photo's note editor starts recording (expo-audio, an .m4a), Stop
 * sends the clip to the API's `transcribeVoiceNote`, and the words are added
 * to the end of the note, where they can still be corrected by typing. The
 * note is the photo's caption, which is what the whole-job report, photo
 * summaries and site-log descriptions already read. Only the user's own
 * words are transcribed: the photo is never sent, so this is not photo
 * analysis.
 *
 * Keyboard dictation is the fallback, and it is the same editor it always
 * was: the note takes focus, the editor folds into one bar on top of the
 * keyboard (so the keyboard never hides it), and the keyboard's own
 * microphone (iOS and Android both have one) types the words. It takes over
 * when the microphone permission is refused, when the recorder cannot start,
 * and when transcription fails, including against a server that does not have
 * `transcribeVoiceNote` yet (it answers "unknown operation"), so the mic
 * always ends in a way to speak the note.
 *
 * Walkthroughs are the other place speech is kept, and they are separate: a
 * walkthrough records its own audio and the AI writes its summary report from
 * that and the photos taken during it. A photo taken outside a walkthrough
 * gets its words from here, as its caption, shown under the photo.
 */

export type VoiceNoteMode = "dictation" | "record";

/** How the mic button takes a note on this build. */
export function voiceNoteMode(): VoiceNoteMode {
  return "record";
}

/** Longest note recorded. The recorder stops itself here; the API refuses longer. */
export const VOICE_NOTE_MAX_SECONDS = 120;

/**
 * What the note editor says, over the keyboard, when dictation is the way in.
 * Short enough to read at a glance on a phone held sideways, where the
 * keyboard leaves one line of room.
 */
export const DICTATION_HINT = "Speak now using the keyboard mic";

/** The line under it: where the words go. */
export const DICTATION_DETAIL = "Your words become this photo's caption. Tap Done when finished.";

/** The editor's voice action, on its own row so it is the obvious one. */
export const VOICE_NOTE_LABEL = "Add voice note";

/** Said while the clip is with the server. */
export const TRANSCRIBING_LABEL = "Transcribing...";

/** Elapsed recording time as m:ss, such as "0:07" or "1:42". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * The note with the spoken words added at the end, on a line of their own
 * when the note already has text, so a second recording adds to the first
 * rather than replacing it.
 */
export function appendTranscript(note: string, words: string): string {
  const spoken = words.trim();
  if (!spoken) return note;
  const current = note.replace(/\s+$/, "");
  return current ? `${current}\n${spoken}` : spoken;
}

/** Why the recorder handed over to the keyboard. */
export type VoiceNoteFallback = "permission" | "unavailable" | "failed" | "silent";

/** The short line shown when it did. Each one ends at the keyboard mic. */
export function fallbackMessage(reason: VoiceNoteFallback): string {
  switch (reason) {
    case "permission":
      return "Microphone is off for this app. Use the keyboard mic instead.";
    case "unavailable":
      return "Voice notes are not available yet. Use the keyboard mic instead.";
    case "silent":
      return "No words were heard. Try again, or use the keyboard mic.";
    default:
      return "Could not transcribe that. Use the keyboard mic instead.";
  }
}

/**
 * A failed transcription, sorted: a server without the operation (or the
 * feature switched off for this account) is "unavailable", anything else
 * "failed". Reads the `ApiClientError` fields without importing the client,
 * so this stays a plain module.
 */
export function transcriptionFailure(error: unknown): VoiceNoteFallback {
  const e = error as { status?: unknown; code?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : null;
  const code = typeof e?.code === "string" ? e.code : null;
  if (code === "unknown_op" || status === 404 || status === 403 || status === 503) {
    return "unavailable";
  }
  return "failed";
}
