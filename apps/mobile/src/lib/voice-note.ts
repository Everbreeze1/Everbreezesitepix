/**
 * The camera's microphone button: its one hook point.
 *
 * Jon wants to speak a note for a photo and have it kept with that photo as
 * the words summaries and reports are written from. Today that works through
 * dictation: the mic opens the photo's note editor with the keyboard up (the
 * editor folds into one bar on top of the keyboard, so the keyboard never
 * hides it), and the keyboard's own microphone (iOS and Android both have one) turns speech into
 * the note's text. The text is the photo's caption, which is what the
 * whole-job report, photo summaries and site-log descriptions already read.
 *
 * Recording the audio itself is not built. No installed module records audio
 * on its own (`expo-camera` records video with sound, `expo-video` only
 * plays), and the API's transcription is reachable only through
 * `transcribeWalkthrough`, which needs a walkthrough. When a recorder lands,
 * this is the one place that changes: `voiceNoteMode` returns "record", and
 * the note editor calls the recorder instead of focusing the note.
 *
 * Walkthroughs are the other place speech is kept, and they are separate: a
 * walkthrough records its own audio and the AI writes its summary report from
 * that and the photos taken during it. A photo taken outside a walkthrough
 * gets its words from here, as its caption, shown under the photo.
 */

export type VoiceNoteMode = "dictation" | "record";

/** How the mic button takes a note on this build. */
export function voiceNoteMode(): VoiceNoteMode {
  return "dictation";
}

/**
 * What the note editor says, over the keyboard, when the mic opened it. Short
 * enough to read at a glance on a phone held sideways, where the keyboard
 * leaves one line of room.
 */
export const DICTATION_HINT = "Speak now using the keyboard mic";

/** The line under it: where the words go. */
export const DICTATION_DETAIL = "Your words become this photo's caption. Tap Done when finished.";

/** The editor's voice action, on its own row so it is the obvious one. */
export const VOICE_NOTE_LABEL = "Add voice note";
