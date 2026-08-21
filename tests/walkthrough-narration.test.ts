import { describe, it, expect } from "vitest";
import {
  buildFallbackNarration,
  parseStoredNarration,
  transcriptWindow,
  coerceNarration,
  sealChapters,
  parseNarrationJson,
  narrationPrompt,
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

/*
 * What happens to the model's actual reply.
 *
 * Everything above tests the deterministic floor. This tests the path that runs
 * in production, where the reply is untrusted text that has been through
 * JSON.parse and nothing else. The model invents photo ids, returns chapters
 * out of order, answers "null" as a string, and occasionally wraps the whole
 * thing in a code fence.
 */
describe("coerceNarration", () => {
  const source: NarrationSource = {
    title: "Willow Street - Aug 21",
    projectName: "Willow Street",
    transcript: "checking the roof flashing now, then the two condensers on the north side",
    durationSeconds: 300,
    photos: [
      { photoId: "p1", offsetSeconds: 20, spokenNote: null, caption: null },
      { photoId: "p2", offsetSeconds: 140, spokenNote: null, caption: null },
    ],
  };

  const goodReply = {
    headline: "Roof flashing and the north condensers.",
    chapters: [
      { start: 0, end: 120, title: "Roof flashing", narration: "Walking the roof flashing." },
      { start: 120, end: 300, title: "Condensers", narration: "Moving to the north condensers." },
    ],
    photos: [
      {
        photo_id: "p1",
        narration: "Flashing along the parapet.",
        spoken: "checking the roof flashing now",
      },
      { photo_id: "p2", narration: "The two north condensers.", spoken: "the two condensers" },
    ],
  };

  it("takes a well-formed reply as written", () => {
    const n = coerceNarration(goodReply, source);
    expect(n.aiGenerated).toBe(true);
    expect(n.headline).toBe("Roof flashing and the north condensers.");
    expect(n.chapters).toHaveLength(2);
    expect(n.photos[0].narration).toBe("Flashing along the parapet.");
  });

  it("reports aiGenerated false when nothing in the reply survived", () => {
    // The flag's entire job. It used to read true for any reply at all, because
    // it tested a field the fallback had already filled in.
    expect(coerceNarration({}, source).aiGenerated).toBe(false);
    expect(coerceNarration(null, source).aiGenerated).toBe(false);
    expect(coerceNarration({ chapters: "nope", photos: 7 }, source).aiGenerated).toBe(false);
  });

  it("ignores photo ids the model invented, and never drops a real one", () => {
    const n = coerceNarration(
      {
        ...goodReply,
        photos: [
          { photo_id: "p1", narration: "Real one.", spoken: null },
          { photo_id: "does-not-exist", narration: "Invented.", spoken: "made up" },
        ],
      },
      source,
    );
    expect(n.photos.map((p) => p.photoId)).toEqual(["p1", "p2"]);
    expect(JSON.stringify(n)).not.toContain("Invented.");
    // p2 was omitted by the model, so it keeps its deterministic narration
    // rather than vanishing from the list.
    expect(n.photos[1].narration.length).toBeGreaterThan(0);
  });

  it("refuses to let the model put words in a silent moment", () => {
    const silent: NarrationSource = { ...source, transcript: null };
    const n = coerceNarration(
      {
        headline: "A walk.",
        chapters: [{ start: 0, end: 300, title: "Walk", narration: "Walking." }],
        photos: [{ photo_id: "p1", narration: "Fine.", spoken: "I definitely said this" }],
      },
      silent,
    );
    // Nobody spoke, so there is nothing to have been heard on camera.
    expect(n.hasSpeech).toBe(false);
    expect(n.photos.every((p) => p.spoken === null)).toBe(true);
  });

  it('treats the string "null" as null, which is what models actually emit', () => {
    const n = coerceNarration(
      { ...goodReply, photos: [{ photo_id: "p1", narration: "x", spoken: "null" }] },
      source,
    );
    expect(n.photos[0].spoken).not.toBe("null");
  });

  it("sorts chapters, starts at zero and leaves no gap", () => {
    const n = coerceNarration(
      {
        ...goodReply,
        chapters: [
          { start: 200, end: 260, title: "Third", narration: "Third." },
          { start: 40, end: 90, title: "First", narration: "First." },
          { start: 120, end: 130, title: "Second", narration: "Second." },
        ],
      },
      source,
    );
    expect(n.chapters.map((c) => c.title)).toEqual(["First", "Second", "Third"]);
    expect(n.chapters[0].start).toBe(0);
    for (let i = 1; i < n.chapters.length; i++) {
      expect(n.chapters[i].start).toBe(n.chapters[i - 1].end);
    }
    expect(n.chapters[n.chapters.length - 1].end).toBe(300);
  });

  it("never lets a chapter run past the end of the recording", () => {
    const n = coerceNarration(
      {
        ...goodReply,
        chapters: [
          { start: 0, end: 99999, title: "All of it", narration: "Everything." },
          { start: 100000, end: 100001, title: "Past the end", narration: "Nowhere." },
        ],
      },
      source,
    );
    for (const c of n.chapters) {
      expect(c.start).toBeLessThan(300);
      expect(c.end).toBeLessThanOrEqual(300);
      expect(c.end).toBeGreaterThan(c.start);
    }
  });

  it("drops junk values rather than rendering them", () => {
    const n = coerceNarration(
      {
        headline: 42,
        chapters: [
          { start: "abc", end: null, title: null, narration: "" },
          { start: -5, end: 10, title: "Negative", narration: "Kept." },
        ],
        photos: [{ photo_id: "p1", narration: null, spoken: undefined }],
      },
      source,
    );
    expect(n.headline).not.toBe("42");
    // The nastiest shape: an object rendered as "[object Object]" and printed
    // under a photo as though a model had written it.
    expect(JSON.stringify(n)).not.toContain("[object Object]");
    // The empty-narration chapter is dropped; the negative start is clamped.
    expect(n.chapters.every((c) => c.narration.length > 0)).toBe(true);
    expect(n.chapters.every((c) => c.start >= 0)).toBe(true);
    expect(n.photos[0].narration.length).toBeGreaterThan(0);
  });

  it("caps how many chapters a runaway reply can produce", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      start: i * 5,
      end: i * 5 + 5,
      title: `C${i}`,
      narration: `Chapter ${i}.`,
    }));
    const n = coerceNarration({ ...goodReply, chapters: many }, source);
    expect(n.chapters.length).toBeLessThanOrEqual(8);
  });
});

/*
 * The rail invariants, on their own.
 *
 * Extracted from both builders because both used to seal their own way and only
 * one had the fix. The case that matters is the last one: it was found by
 * running the builder over real walkthroughs, not by writing a test, and it hit
 * three of the first five.
 */
describe("sealChapters", () => {
  const c = (start: number, title = `C${start}`) => ({
    start,
    end: start,
    title,
    narration: `${title}.`,
  });

  it("drops a chapter starting at the very end of the recording", () => {
    /*
     * A technician's last photo is usually their sign-off shot, taken as they
     * stop recording - so its offset equals the duration exactly. That produced
     * a zero-length final chapter, which the old code nudged to `start + 1`:
     * a chapter one second past the end of the video, and the real final second
     * left with nothing highlighted.
     */
    const sealed = sealChapters([c(0), c(60), c(120)], 120);
    expect(sealed.map((x) => x.start)).toEqual([0, 60]);
    expect(sealed.at(-1)!.end).toBe(120);
    expect(sealed.every((x) => x.end <= 120)).toBe(true);
  });

  it("covers the recording exactly, with no gap and no overhang", () => {
    const sealed = sealChapters([c(0), c(30), c(75)], 200);
    expect(sealed[0].start).toBe(0);
    expect(sealed.at(-1)!.end).toBe(200);
    for (let i = 1; i < sealed.length; i++) {
      expect(sealed[i].start).toBe(sealed[i - 1].end);
    }
  });

  it("orders a shuffled list and pulls the first back to zero", () => {
    const sealed = sealChapters([c(90), c(20), c(50)], 150);
    expect(sealed.map((x) => x.title)).toEqual(["C20", "C50", "C90"]);
    expect(sealed[0].start).toBe(0);
  });

  it("never emits a zero-length chapter", () => {
    const sealed = sealChapters([c(0), c(10), c(10), c(10), c(40)], 100);
    expect(sealed.every((x) => x.end > x.start)).toBe(true);
    // The duplicate starts collapse to one.
    expect(sealed.map((x) => x.start)).toEqual([0, 10, 40]);
  });

  it("handles a recording with no known duration", () => {
    // duration_seconds is 0 on some real rows. Nothing may be dropped for
    // being "past the end" when there is no known end.
    const sealed = sealChapters([c(0), c(5)], 0);
    expect(sealed).toHaveLength(2);
    expect(sealed.every((x) => x.end > x.start)).toBe(true);
  });

  it("returns nothing rather than inventing a chapter from nothing", () => {
    expect(sealChapters([], 100)).toEqual([]);
    expect(sealChapters([c(500)], 100)).toEqual([]);
  });
});

/*
 * Getting the model's reply out of whatever it wrapped it in.
 *
 * The system prompt asks for bare JSON and mostly gets it. "Mostly" is not a
 * contract, and the consequence of failing here is not a crash - it is the
 * silent loss of the whole premium artefact, because a null routes straight to
 * the deterministic builder and the user never learns why their Summary reads
 * like a stub.
 */
describe("parseNarrationJson", () => {
  const payload = { headline: "A walk.", chapters: [], photos: [] };

  it("reads a bare object", () => {
    expect(parseNarrationJson(JSON.stringify(payload))).toEqual(payload);
  });

  it("reads it out of a code fence", () => {
    expect(parseNarrationJson("```json\n" + JSON.stringify(payload) + "\n```")).toEqual(payload);
    expect(parseNarrationJson("```\n" + JSON.stringify(payload) + "\n```")).toEqual(payload);
  });

  it("reads it past a preamble the model was told not to write", () => {
    const raw = `Here is the narration you asked for:\n\n${JSON.stringify(payload)}\n\nLet me know!`;
    expect(parseNarrationJson(raw)).toEqual(payload);
  });

  it("keeps braces that live inside strings", () => {
    // `lastIndexOf("}")` rather than the first: a closing brace inside a
    // narration string must not truncate the object.
    const withBrace = { headline: "Checked the {main} panel.", chapters: [], photos: [] };
    expect(parseNarrationJson(JSON.stringify(withBrace))).toEqual(withBrace);
  });

  it("returns null for a reply with no JSON in it", () => {
    expect(parseNarrationJson("I'm sorry, I can't help with that.")).toBeNull();
    expect(parseNarrationJson("")).toBeNull();
    expect(parseNarrationJson("   ")).toBeNull();
  });

  it("returns null for JSON that got cut off mid-flight", () => {
    // A truncated reply is the shape a token limit produces.
    expect(parseNarrationJson('{"headline": "A walk", "chapters": [')).toBeNull();
  });

  it("does not throw on any of it", () => {
    for (const raw of ["{", "}", "{}}", "```json", "null", "[]", "{'single': 1}"]) {
      expect(() => parseNarrationJson(raw)).not.toThrow();
    }
  });
});

/*
 * What the model is actually asked.
 *
 * The prompt is the only place the real photo ids reach the model, and
 * `coerceNarration` throws away any id it did not recognise - so an id missing
 * from the prompt is a photo that can never be narrated, silently.
 */
describe("narrationPrompt", () => {
  const source: NarrationSource = {
    title: "Willow Street - Aug 21",
    projectName: "Willow Street",
    transcript: "checking the roof flashing",
    durationSeconds: 300,
    photos: [
      { photoId: "aaaa-1", offsetSeconds: 20, spokenNote: null, caption: "Parapet flashing" },
      { photoId: "bbbb-2", offsetSeconds: 140, spokenNote: "the north condensers", caption: null },
    ],
  };

  it("names every photo id exactly once", () => {
    const prompt = narrationPrompt(source);
    for (const p of source.photos) {
      expect(prompt.split(p.photoId).length - 1).toBe(1);
    }
  });

  it("passes the technician's own words through", () => {
    const prompt = narrationPrompt(source);
    expect(prompt).toContain("Parapet flashing");
    expect(prompt).toContain("the north condensers");
    expect(prompt).toContain("checking the roof flashing");
  });

  it("states the duration in both forms the model has to reason about", () => {
    const prompt = narrationPrompt(source);
    expect(prompt).toContain("5:00");
    expect(prompt).toContain("300 seconds");
  });

  it("tells the model plainly when nobody spoke", () => {
    const prompt = narrationPrompt({ ...source, transcript: null });
    expect(prompt).toContain("(no speech was captured)");
    // And that it must not fill the silence with invented quotes.
    expect(prompt).toContain('Set every "spoken" to null');
  });

  it("handles a walkthrough with no photos", () => {
    const prompt = narrationPrompt({ ...source, photos: [] });
    expect(prompt).toContain("(none)");
    expect(prompt).not.toContain("undefined");
  });

  it("lists photos in timeline order, not arrival order", () => {
    const shuffled: NarrationSource = {
      ...source,
      photos: [
        { photoId: "late", offsetSeconds: 200, spokenNote: null, caption: null },
        { photoId: "early", offsetSeconds: 5, spokenNote: null, caption: null },
      ],
    };
    const prompt = narrationPrompt(shuffled);
    expect(prompt.indexOf("early")).toBeLessThan(prompt.indexOf("late"));
  });

  it("never asks for more chapters than the rail will render", () => {
    const many: NarrationSource = {
      ...source,
      photos: Array.from({ length: 40 }, (_, i) => ({
        photoId: `p${i}`,
        offsetSeconds: i * 5,
        spokenNote: null,
        caption: null,
      })),
    };
    const target = /Aim for (\d+) chapter/.exec(narrationPrompt(many))?.[1];
    expect(Number(target)).toBeLessThanOrEqual(8);
  });

  it("does not put an em dash in front of the model", () => {
    // The repo bans the character outright, and a prompt is the one place a
    // model would happily copy the style back out into a document.
    expect(narrationPrompt(source)).not.toContain("\u2014");
  });
});
