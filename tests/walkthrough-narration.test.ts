import { describe, it, expect } from "vitest";
import {
  buildFallbackNarration,
  parseStoredNarration,
  transcriptWindow,
  WALKTHROUGH_NARRATION_VERSION,
  type NarrationSource,
} from "../apps/api/src/domains/walkthroughs/narration";

/*
 * The narration behind the premium Summary.
 *
 * Tested through the deterministic path, which is the one that has to hold when
 * the model is unavailable - and which every AI reply is folded back onto field
 * by field. The property that matters most is the one the client named: a
 * walkthrough nobody spoke on must not come out looking like one they did.
 */

const base = (over: Partial<NarrationSource> = {}): NarrationSource => ({
  title: "Willow Street - Aug 21",
  projectName: "Willow Street",
  transcript: null,
  durationSeconds: 120,
  photos: [],
  ...over,
});

const photo = (id: string, offsetSeconds: number, over: Record<string, unknown> = {}) => ({
  photoId: id,
  offsetSeconds,
  spokenNote: null,
  caption: null,
  ...over,
});

describe("buildFallbackNarration", () => {
  it("marks a silent recording as having no speech, and narrates no quotes", () => {
    const n = buildFallbackNarration(base({ photos: [photo("a", 10), photo("b", 60)] }));
    expect(n.hasSpeech).toBe(false);
    // This is the whole difference the UI renders on. Every `spoken` null means
    // no "Heard on camera" block is drawn, so the silent card is visibly the
    // shorter one.
    expect(n.photos.every((p) => p.spoken === null)).toBe(true);
    expect(n.aiGenerated).toBe(false);
  });

  it("still narrates every photo when nobody spoke", () => {
    const n = buildFallbackNarration(base({ photos: [photo("a", 10), photo("b", 60)] }));
    expect(n.photos).toHaveLength(2);
    // A card with an empty narration line is a card that looks broken.
    expect(n.photos.every((p) => p.narration.trim().length > 0)).toBe(true);
  });

  it("prefers the technician's own caption over a timestamp", () => {
    const n = buildFallbackNarration(
      base({ photos: [photo("a", 10, { caption: "Condensate pump, unit 4B" })] }),
    );
    expect(n.photos[0].narration).toBe("Condensate pump, unit 4B");
  });

  it("ignores a filename masquerading as a caption", () => {
    // Uploads default the caption to the source filename. Printing IMG_1234.JPG
    // as narration made every photo look annotated when none were.
    const n = buildFallbackNarration(
      base({ photos: [photo("a", 10, { caption: "IMG_1234.JPG" })] }),
    );
    expect(n.photos[0].narration).not.toContain("IMG_1234");
  });

  it("attaches spoken words to photos once there is a transcript", () => {
    const transcript = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const n = buildFallbackNarration(
      base({ transcript, photos: [photo("a", 10), photo("b", 90)] }),
    );
    expect(n.hasSpeech).toBe(true);
    expect(n.photos.every((p) => (p.spoken ?? "").length > 0)).toBe(true);
    // Different moments in the walk, so different words.
    expect(n.photos[0].spoken).not.toBe(n.photos[1].spoken);
  });

  it("keeps a real spoken note ahead of an estimate from the transcript", () => {
    const n = buildFallbackNarration(
      base({
        transcript: "some other words entirely",
        photos: [photo("a", 10, { spokenNote: "Replaced the condensate pump" })],
      }),
    );
    expect(n.photos[0].spoken).toBe("Replaced the condensate pump");
  });

  it("covers the whole recording with chapters, in order and without gaps", () => {
    const n = buildFallbackNarration(
      base({
        durationSeconds: 300,
        transcript: "walking the roof now, checking the flashing, then the units",
        photos: [photo("a", 0), photo("b", 60), photo("c", 150), photo("d", 240)],
      }),
    );
    expect(n.chapters.length).toBeGreaterThan(0);
    expect(n.chapters[0].start).toBe(0);
    for (let i = 1; i < n.chapters.length; i++) {
      // A gap between chapters is a stretch of playback the rail cannot
      // highlight, which reads on screen as the narration having stopped.
      expect(n.chapters[i].start).toBe(n.chapters[i - 1].end);
      expect(n.chapters[i].end).toBeGreaterThan(n.chapters[i].start);
    }
    expect(n.chapters[n.chapters.length - 1].end).toBe(300);
  });

  it("gives a short walk one chapter rather than a table of contents", () => {
    const n = buildFallbackNarration(
      base({ durationSeconds: 20, photos: [photo("a", 2), photo("b", 9)] }),
    );
    expect(n.chapters).toHaveLength(1);
  });

  it("orders photos by when they were taken, not by the order they arrived", () => {
    const n = buildFallbackNarration(
      base({ photos: [photo("late", 200), photo("early", 5), photo("mid", 90)] }),
    );
    expect(n.photos.map((p) => p.photoId)).toEqual(["early", "mid", "late"]);
  });

  it("survives a walkthrough with no photos and no speech", () => {
    const n = buildFallbackNarration(base({ photos: [] }));
    expect(n.photos).toHaveLength(0);
    expect(n.headline.length).toBeGreaterThan(0);
  });
});

describe("transcriptWindow", () => {
  it("returns nothing for an empty transcript", () => {
    expect(transcriptWindow("", 0, null, 100, 0, 1)).toBeNull();
    expect(transcriptWindow("   ", 0, null, 100, 0, 1)).toBeNull();
  });

  it("moves later in the transcript for a later moment in the walk", () => {
    const transcript = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
    const first = transcriptWindow(transcript, 0, 30, 300, 0, 4) ?? "";
    const last = transcriptWindow(transcript, 240, null, 300, 3, 4) ?? "";
    expect(first).not.toBe(last);
    expect(transcript.indexOf(first)).toBeLessThan(transcript.indexOf(last));
  });
});

describe("parseStoredNarration", () => {
  it("rejects anything that is not a narration payload", () => {
    // The column is jsonb, so the database will happily hand back a number.
    expect(parseStoredNarration(null)).toBeNull();
    expect(parseStoredNarration(7)).toBeNull();
    expect(parseStoredNarration("{}")).toBeNull();
    expect(parseStoredNarration({})).toBeNull();
  });

  it("accepts a payload carrying either half", () => {
    expect(parseStoredNarration({ photos: [] })).not.toBeNull();
    expect(parseStoredNarration({ chapters: [] })).not.toBeNull();
  });

  it("defaults a missing version to the current one rather than NaN", () => {
    const parsed = parseStoredNarration({ photos: [] });
    expect(parsed?.version).toBe(WALKTHROUGH_NARRATION_VERSION);
  });

  it("round-trips what the fallback builder produces", () => {
    const built = buildFallbackNarration(
      base({ transcript: "checking the roof", photos: [photo("a", 4)] }),
    );
    const parsed = parseStoredNarration(JSON.parse(JSON.stringify(built)));
    expect(parsed?.photos).toHaveLength(1);
    expect(parsed?.hasSpeech).toBe(true);
  });
});
