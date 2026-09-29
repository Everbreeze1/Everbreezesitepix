import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTimestampedTranscript } from "../apps/api/src/domains/ai/service";
import {
  captionAround,
  isPlaceholderCaption,
  segmentsFromLines,
  storedSegments,
  transcriptFromSegments,
  untimedSegments,
} from "../apps/api/src/domains/walkthroughs/captions";

/*
 * Jon, 2026-09-29: "those words transcribed just before that snap and just
 * after that snap should be recorded as a caption for that snap in
 * walkthroughs."
 */

describe("reading a timed transcript", () => {
  it("reads the [m:ss] lines the prompt asks for", () => {
    const lines = parseTimestampedTranscript(
      "[0:02] Starting at the north wall.\n[0:09] The flashing is loose here.\n[1:05] Moving to the roof.",
    );
    expect(lines).toEqual([
      { start: 2, text: "Starting at the north wall." },
      { start: 9, text: "The flashing is loose here." },
      { start: 65, text: "Moving to the roof." },
    ]);
  });

  it("tolerates the formats the model drifts into", () => {
    const lines = parseTimestampedTranscript(
      "00:03 - First line.\n(0:00:07) Second line.\n[0:12.4] Third line.\nand it keeps going",
    );
    expect(lines.map((l) => l.start)).toEqual([3, 7, 12]);
    expect(lines[2].text).toBe("Third line. and it keeps going");
  });

  it("never lets a timestamp run backwards or past the audio", () => {
    const lines = parseTimestampedTranscript("[0:30] a.\n[0:10] b.\n[9:59] c.", 60);
    expect(lines.map((l) => l.start)).toEqual([30, 30, 60]);
  });

  it("keeps text with no timestamps at all, from zero", () => {
    expect(parseTimestampedTranscript("Just words.")).toEqual([{ start: 0, text: "Just words." }]);
  });

  it("returns nothing for silence", () => {
    expect(parseTimestampedTranscript("   \n")).toEqual([]);
  });
});

describe("placing a piece's lines on the recording's clock", () => {
  it("offsets by the piece start and ends each line at the next", () => {
    const segments = segmentsFromLines(
      [
        { start: 1, text: "One." },
        { start: 20, text: "Two." },
      ],
      60,
      120,
    );
    expect(segments).toEqual([
      { start: 61, end: 80, text: "One." },
      { start: 80, end: 120, text: "Two." },
    ]);
    expect(transcriptFromSegments(segments)).toBe("One. Two.");
  });
});

describe("captioning a snap from what was said around it", () => {
  const segments = [
    { start: 0, end: 10, text: "We are starting at the front gate." },
    { start: 10, end: 20, text: "The gutter on the left is pulling away from the fascia." },
    { start: 20, end: 26, text: "Snapping that now." },
    { start: 26, end: 40, text: "Next is the back door where the threshold is rotten." },
    { start: 40, end: 60, text: "That is everything for today." },
  ];

  it("takes the sentences spoken just before and just after the snap", () => {
    const caption = captionAround(segments, 21);
    expect(caption).toContain("gutter on the left");
    expect(caption).toContain("Snapping that now.");
    expect(caption).not.toContain("front gate");
    expect(caption).not.toContain("everything for today");
  });

  it("keeps whole sentences rather than cutting mid-thought", () => {
    const caption = captionAround(segments, 21)!;
    expect(caption.startsWith("The gutter")).toBe(true);
    expect(/[.!?]$/.test(caption)).toBe(true);
  });

  it("gives each snap its own words, not the whole transcript", () => {
    const early = captionAround(segments, 3);
    const late = captionAround(segments, 45);
    expect(early).toContain("front gate");
    expect(late).toContain("everything for today");
    expect(early).not.toEqual(late);
  });

  it("answers null when nothing was said near the snap", () => {
    expect(captionAround([{ start: 0, end: 5, text: "Hello." }], 120)).toBeNull();
    expect(captionAround([], 10)).toBeNull();
  });

  it("fits the caption column", () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const caption = captionAround([{ start: 0, end: 30, text: long }], 15)!;
    expect(caption.length).toBeLessThanOrEqual(255);
  });

  it("marks a sentence it had to cut", () => {
    const long = Array.from({ length: 120 }, (_, i) => `w${i}`).join(" ");
    // One run-on "sentence" of 120 words at speaking pace (0.4 s a word).
    const caption = captionAround([{ start: 0, end: 48, text: long }], 24)!;
    expect(caption.startsWith("...")).toBe(true);
    expect(caption.endsWith("...")).toBe(true);
  });

  it("falls back to the transcript spread over the recording when there is no timing", () => {
    const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
    const caption = captionAround(untimedSegments(words, 60), 30)!;
    expect(caption).toContain("w30");
    expect(caption).not.toContain("w5 ");
  });
});

describe("whose caption it is", () => {
  it("replaces only the recorders' placeholders", () => {
    expect(isPlaceholderCaption(null)).toBe(true);
    expect(isPlaceholderCaption("")).toBe(true);
    expect(isPlaceholderCaption("Walkthrough +42s")).toBe(true);
    expect(isPlaceholderCaption("walkthrough-1755000000000.jpg")).toBe(true);
  });

  it("never replaces a caption somebody typed", () => {
    expect(isPlaceholderCaption("Loose flashing, north wall")).toBe(false);
    expect(isPlaceholderCaption("walkthrough-front-door.jpg")).toBe(false);
    expect(isPlaceholderCaption("Walkthrough +42s of the roof")).toBe(false);
  });
});

describe("timing kept for photos that land after the transcript", () => {
  it("reads segments back from narration_json and ignores anything else", () => {
    expect(storedSegments(null)).toBeNull();
    expect(storedSegments({ photos: [] })).toBeNull();
    expect(
      storedSegments({ transcriptSegments: [{ start: 1, end: 2, text: "Hi." }, { bad: true }] }),
    ).toEqual([{ start: 1, end: 2, text: "Hi." }]);
  });

  it("the narration writer keeps them when it replaces the narration", () => {
    const src = readFileSync(
      join(process.cwd(), "apps/api/src/domains/walkthroughs/narration.ts"),
      "utf8",
    );
    const fn = src.slice(src.indexOf("export async function saveWalkthroughNarration"));
    expect(fn.slice(0, 1500)).toContain("transcriptSegments");
  });
});

describe("the save op the phone's outbox calls", () => {
  const registry = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/rpc/registry.ts"), "utf8");

  it("keeps the thumbnail path instead of stripping it", () => {
    const src = registry();
    const at = src.indexOf("saveWalkthroughPhoto: authed(");
    const entry = src.slice(at, src.indexOf("finishWalkthroughSession: authed(", at));
    expect(entry).toMatch(/thumbPath:\s*z\.string\(\)/);
  });

  it("is idempotent, so an outbox retry does not write a second photo", () => {
    const src = registry();
    const at = src.indexOf("saveWalkthroughPhoto: authed(");
    const entry = src.slice(at, src.indexOf("finishWalkthroughSession: authed(", at));
    expect(entry).toContain("idempotent: true");
  });

  it("transcription sends audio, not the video container", () => {
    const src = readFileSync(
      join(process.cwd(), "apps/api/src/domains/walkthroughs/service.ts"),
      "utf8",
    );
    expect(src).toContain("findAacTrack");
    expect(src).toMatch(/transcribeAudioTimed\([\s\S]{0,120}"aac"/);
  });
});
