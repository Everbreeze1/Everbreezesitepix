import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  keyboardOverlap,
  noteEditorLayout,
} from "../apps/mobile/src/components/capture/note-editor-layout";
import {
  ADD_CAPTION_LABEL,
  captionText,
  tileCaptionHeight,
  tileCaptionLines,
} from "../apps/mobile/src/components/photo-viewer/caption-line";
import {
  DICTATION_HINT,
  TRANSCRIBING_LABEL,
  VOICE_NOTE_LABEL,
  VOICE_NOTE_MAX_SECONDS,
  appendTranscript,
  fallbackMessage,
  formatElapsed,
  transcriptionFailure,
  voiceNoteMode,
} from "../apps/mobile/src/lib/voice-note";

/*
 * The photo note editor: one photo's caption, typed or spoken, and the line it
 * becomes under the photo.
 *
 * Jon (2026-09-29): the camera's small note window was right, but the mic
 * brought up the Android keyboard and the keyboard hid the whole window. What
 * a keyboard covers cannot be seen in a unit test, so the rule the editor
 * follows is tested here, and the wiring is checked by reading the source.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("keyboardOverlap", () => {
  it("covers the bottom of a window that does not shrink (Android edge to edge)", () => {
    // 800pt window, 300pt keyboard drawn over its bottom.
    expect(
      keyboardOverlap({
        viewBottom: 800,
        keyboardTop: 500,
        keyboardHeight: 300,
        windowHeight: 800,
      }),
    ).toBe(300);
  });

  it("is zero when the window already resized for the keyboard", () => {
    // adjustResize: the view ends where the keyboard starts. Nothing added twice.
    expect(
      keyboardOverlap({
        viewBottom: 500,
        keyboardTop: 500,
        keyboardHeight: 300,
        windowHeight: 500,
      }),
    ).toBe(0);
  });

  it("is zero when the window panned the view above the keyboard", () => {
    expect(
      keyboardOverlap({
        viewBottom: 480,
        keyboardTop: 500,
        keyboardHeight: 300,
        windowHeight: 800,
      }),
    ).toBe(0);
  });

  it("works out the keyboard's top when Android reports none", () => {
    expect(
      keyboardOverlap({ viewBottom: 800, keyboardTop: 0, keyboardHeight: 280, windowHeight: 800 }),
    ).toBe(280);
  });

  it("never pads by more than the keyboard, and not at all with no keyboard", () => {
    expect(
      keyboardOverlap({
        viewBottom: 900,
        keyboardTop: 500,
        keyboardHeight: 300,
        windowHeight: 800,
      }),
    ).toBe(300);
    expect(
      keyboardOverlap({ viewBottom: 800, keyboardTop: 800, keyboardHeight: 0, windowHeight: 800 }),
    ).toBe(0);
  });
});

describe("noteEditorLayout", () => {
  it("folds into the one bar on the keyboard while typing or dictating", () => {
    const at = { width: 390, height: 800, wide: false };
    expect(noteEditorLayout({ ...at, keyboard: 0, typing: false }).mode).toBe("full");
    expect(noteEditorLayout({ ...at, keyboard: 300, typing: true }).mode).toBe("typing");
    // A window that resized has no overlap, and the editor still folds.
    expect(noteEditorLayout({ ...at, keyboard: 0, typing: true }).mode).toBe("typing");
  });

  it("stacks on a portrait phone and goes side by side on a landscape one", () => {
    const portrait = noteEditorLayout({
      width: 390,
      height: 800,
      keyboard: 0,
      typing: false,
      wide: false,
    });
    expect(portrait.arrangement).toBe("stacked");
    expect(portrait.width).toBeNull();
    expect(portrait.photo.height).toBeLessThanOrEqual(800 * 0.32);

    const landscape = noteEditorLayout({
      width: 800,
      height: 360,
      keyboard: 0,
      typing: false,
      wide: false,
    });
    expect(landscape.arrangement).toBe("side");
    expect(landscape.photo.height).toBeLessThanOrEqual(180);
  });

  it("docks to the right at a fixed width on a tablet, in either orientation", () => {
    for (const [width, height] of [
      [820, 1180],
      [1180, 820],
    ]) {
      const layout = noteEditorLayout({ width, height, keyboard: 0, typing: false, wide: true });
      expect(layout.arrangement).toBe("side");
      expect(layout.width).toBeGreaterThanOrEqual(420);
      expect(layout.width).toBeLessThanOrEqual(560);
    }
  });

  it("keeps the note usable in the little room a sideways keyboard leaves", () => {
    const layout = noteEditorLayout({
      width: 800,
      height: 360,
      keyboard: 220,
      typing: true,
      wide: false,
    });
    expect(layout.typingThumb).toBe(40);
    expect(layout.noteMaxHeight).toBeGreaterThanOrEqual(44);
    expect(layout.noteMaxHeight).toBeLessThanOrEqual(140);
  });
});

describe("the voice note", () => {
  it("records, with keyboard dictation kept as the fallback", () => {
    expect(voiceNoteMode()).toBe("record");
    expect(DICTATION_HINT).toBe("Speak now using the keyboard mic");
    expect(VOICE_NOTE_LABEL).toBe("Add voice note");
    expect(TRANSCRIBING_LABEL).toBe("Transcribing...");
    expect(VOICE_NOTE_MAX_SECONDS).toBe(120);
  });

  it("shows the time recorded as m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_400)).toBe("0:07");
    expect(formatElapsed(102_000)).toBe("1:42");
  });

  it("adds the words to the end of the note, never replacing it", () => {
    expect(appendTranscript("", "Loose flashing")).toBe("Loose flashing");
    expect(appendTranscript("North wall  ", " Loose flashing ")).toBe("North wall\nLoose flashing");
    expect(appendTranscript("North wall", "   ")).toBe("North wall");
  });

  it("falls back to the keyboard when the server has no voice notes yet", () => {
    // What a server from before this change answers, as the API client throws it.
    expect(transcriptionFailure({ status: 404, code: "unknown_op" })).toBe("unavailable");
    expect(transcriptionFailure({ status: 500, code: "internal_error" })).toBe("failed");
    expect(transcriptionFailure(new Error("network"))).toBe("failed");
    for (const reason of ["permission", "unavailable", "failed"] as const) {
      expect(fallbackMessage(reason)).toMatch(/keyboard mic/);
    }
  });
});

describe("the caption under a photo", () => {
  it("shows a real caption and hides a file name", () => {
    expect(captionText("  Water stain above the window ")).toBe("Water stain above the window");
    expect(captionText("IMG_1234.HEIC")).toBeNull();
    expect(captionText("")).toBeNull();
    expect(captionText(null)).toBeNull();
  });

  it("is one or two lines under a tile, and takes no room when there is none", () => {
    expect(tileCaptionLines(80)).toBe(1);
    expect(tileCaptionLines(120)).toBe(2);
    expect(tileCaptionHeight(null, 120)).toBe(0);
    expect(tileCaptionHeight("Leak", 120)).toBeGreaterThan(tileCaptionHeight("Leak", 80));
    expect(ADD_CAPTION_LABEL).toMatch(/voice note/);
  });
});

describe("wiring", () => {
  const editor = read("apps/mobile/src/components/capture/PhotoNoteEditor.tsx");
  const viewer = read("apps/mobile/src/components/photo-viewer/PhotoViewer.tsx");

  it("keeps the editor clear of the keyboard with React Native's own events", () => {
    expect(editor).toContain("useKeyboardOverlap()");
    expect(editor).toContain("paddingBottom: keyboard.overlap > 0 ? keyboard.overlap");
    const hook = read("apps/mobile/src/components/capture/keyboard-overlap.ts");
    expect(hook).toContain('"keyboardDidShow"');
    expect(hook).toContain('"keyboardWillShow"');
    expect(hook).toContain("measureInWindow");
  });

  it("records with expo-audio and sends the clip to transcribeVoiceNote", () => {
    const hook = read("apps/mobile/src/components/capture/use-voice-note-recorder.ts");
    expect(hook).toContain("useAudioRecorder(");
    expect(hook).toContain("requestRecordingPermissionsAsync()");
    expect(hook).toContain("allowsRecording: false");
    expect(read("apps/mobile/src/api/voice-note.ts")).toContain('"transcribeVoiceNote"');
    expect(editor).toContain("useVoiceNoteRecorder(");
    expect(editor).toContain("appendTranscript(captionRef.current, text)");
    expect(editor).toContain('accessibilityLabel="Stop recording"');
  });

  it("shows one photo, never a strip of them", () => {
    expect(editor).not.toMatch(/horizontal/);
    expect(editor).toContain("photoUri");
  });

  it("puts the caption under the photo in the viewer, and edits it in the same editor", () => {
    expect(viewer).toContain("<ViewerCaption");
    expect(viewer).toContain("<PhotoNoteEditor");
    expect(viewer).toContain('edit(photo.id, projectId, "caption", { caption: next })');
    // Android's Back closes the editor first, keeping the caption.
    expect(viewer).toContain("if (backFirst.current?.()) return;");
  });

  it("puts the caption under the tiles of the project grid and the calendar", () => {
    expect(read("apps/mobile/app/(app)/project/[id]/index.tsx")).toContain("<TileCaption");
    expect(read("apps/mobile/src/components/ProjectPhotoCalendar.tsx")).toContain("<TileCaption");
  });
});
