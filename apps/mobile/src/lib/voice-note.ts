/**
 * The camera's microphone button: its one hook point.
 *
 * Jon wants to speak a note for a photo and have it kept with that photo as
 * the words summaries and reports are written from. Today that works through
 * dictation: the mic opens the photo's note with the keyboard up, and the
 * keyboard's own microphone (iOS and Android both have one) turns speech into
 * the note's text. The text is the photo's caption, which is what the
 * whole-job report, photo summaries and site-log descriptions already read.
 *
 * Recording the audio itself is not built. No installed module records audio
 * on its own (`expo-camera` records video with sound, `expo-video` only
 * plays), and the API's transcription is reachable only through
 * `transcribeWalkthrough`, which needs a walkthrough. When a recorder lands,
 * this is the one place that changes: `voiceNoteMode` returns "record", and
 * the camera calls the recorder instead of focusing the note.
 */

export type VoiceNoteMode = "dictation" | "record";

/** How the mic button takes a note on this build. */
export function voiceNoteMode(): VoiceNoteMode {
  return "dictation";
}

/** What the note shows when the mic opens it for dictation. */
export const DICTATION_HINT =
  "Tap the microphone on your keyboard and speak. Your words are saved as this photo's note.";
