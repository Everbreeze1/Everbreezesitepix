import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteWarning,
  isNarrated,
  markdownPreview,
  MAX_SUMMARY_PHOTOS,
  MAX_SUMMARY_TITLE,
  offsetLabel,
  orderedNotes,
  photoSelectionError,
  plainBody,
  summaryOrigin,
  summaryState,
  summarySubtitle,
  stateMessage,
  titleError,
  type SummaryPhotoNote,
} from "../apps/mobile/src/api/summary-view";

/*
 * Walkthrough write-ups.
 *
 * The phone could record a walkthrough - video, photos, narration, transcription
 * - and had nothing to show for it. Eight of the twenty walkthrough ops were
 * wired and the whole summary cluster was not, so the artefact the recording
 * exists to produce was reachable only from a desk.
 *
 * Two rules earn most of the tests. Whether a summary is FINISHED, because the
 * row exists before its body does and a spinner over readable text is the one
 * outcome nobody wants. And whether a shot was NARRATED, which the service
 * states plainly is load-bearing: it is what lets a spoken shot render
 * differently from a silent one.
 */

const note = (over: Partial<SummaryPhotoNote>): SummaryPhotoNote => ({
  photoId: "p1",
  offsetSeconds: 0,
  note: "Riser clamp fitted",
  spoken: null,
  ...over,
});

describe("summaryState", () => {
  it("is ready for a finished write-up", () => {
    expect(summaryState({ status: "ready", markdown: "# Done" })).toBe("ready");
  });

  it("is pending while there is nothing to read", () => {
    expect(summaryState({ status: "pending", markdown: null })).toBe("pending");
    expect(summaryState({ status: "generating", markdown: "" })).toBe("pending");
    expect(summaryState({ status: "processing", markdown: "   " })).toBe("pending");
  });

  it("prefers a body over a stale status", () => {
    /*
     * The generate ops write the row first and fill it in after, so a summary
     * can carry text while its column still says pending. Showing a spinner
     * over readable text is the one outcome nobody wants.
     */
    expect(summaryState({ status: "pending", markdown: "The riser was replaced." })).toBe("ready");
  });

  it("is failed when the write-up could not be produced", () => {
    expect(summaryState({ status: "failed", markdown: null })).toBe("failed");
    expect(summaryState({ status: "error", markdown: null })).toBe("failed");
  });

  it("treats an unfamiliar status as ready rather than as broken", () => {
    /*
     * The column is plain text upstream, so a value nobody recognises is
     * possible. Refusing to render a summary because of an unknown word is
     * worse than rendering one whose state label is imprecise.
     */
    expect(summaryState({ status: "archived", markdown: "text" })).toBe("ready");
    expect(summaryState({ status: "", markdown: "text" })).toBe("ready");
  });
});

describe("stateMessage", () => {
  it("says nothing when there is something to read", () => {
    expect(stateMessage("ready")).toBeNull();
  });

  it("names the likely cause of a failure rather than shrugging", () => {
    // This fails on every local network because Gemini is geo-blocked, and
    // somebody who does not know that reads it as their recording being broken.
    expect(stateMessage("failed")).toContain("AI service");
  });

  it("sets an expectation while waiting", () => {
    expect(stateMessage("pending")).toContain("under a minute");
  });
});

describe("isNarrated", () => {
  it("separates what was said from what was done", () => {
    /*
     * The distinction the service asks the UI to preserve. A silent shot has a
     * note the model wrote; a narrated one also has the words the person on
     * site actually said, which are the more valuable half.
     */
    expect(isNarrated(note({ spoken: "That crack is new since February." }))).toBe(true);
    expect(isNarrated(note({ spoken: null }))).toBe(false);
  });

  it("treats whitespace as silence", () => {
    // Otherwise an empty quote block renders under a shot nobody spoke over.
    expect(isNarrated(note({ spoken: "   " }))).toBe(false);
    expect(isNarrated(note({ spoken: "" }))).toBe(false);
  });
});

describe("offsetLabel", () => {
  it("times a shot against the recording", () => {
    expect(offsetLabel(note({ offsetSeconds: 75 }), true)).toBe("1:15");
    expect(offsetLabel(note({ offsetSeconds: 605 }), true)).toBe("10:05");
  });

  it("says nothing for a summary with no walk behind it", () => {
    // "0:00 into the walk" on a write-up built from photographs is a lie about
    // where the photographs came from.
    expect(offsetLabel(note({ offsetSeconds: 0 }), false)).toBe("");
    expect(offsetLabel(note({ offsetSeconds: 75 }), false)).toBe("");
  });

  it("says nothing at the very start", () => {
    expect(offsetLabel(note({ offsetSeconds: 0 }), true)).toBe("");
  });
});

describe("orderedNotes", () => {
  it("is the order the shots were taken, which is the order they were spoken about", () => {
    const notes = [
      note({ photoId: "c", offsetSeconds: 120 }),
      note({ photoId: "a", offsetSeconds: 5 }),
      note({ photoId: "b", offsetSeconds: 60 }),
    ];
    expect(orderedNotes(notes).map((n) => n.photoId)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate what it was given", () => {
    const notes = [note({ photoId: "b", offsetSeconds: 9 }), note({ photoId: "a" })];
    orderedNotes(notes);
    expect(notes.map((n) => n.photoId)).toEqual(["b", "a"]);
  });
});

describe("summaryOrigin and summarySubtitle", () => {
  it("says which of the two ways in this one came from", () => {
    expect(summaryOrigin({ walkthroughId: "w1" })).toContain("recorded walkthrough");
    expect(summaryOrigin({ walkthroughId: null })).toContain("photos");
  });

  it("counts photos and names the source on a list row", () => {
    expect(summarySubtitle({ photoCount: 1, walkthroughId: "w1" })).toBe(
      "1 photo · from a recording",
    );
    expect(summarySubtitle({ photoCount: 4, walkthroughId: null })).toBe("4 photos · from photos");
  });
});

describe("validation mirrors the server", () => {
  it("needs a title, within the server's ceiling", () => {
    expect(titleError("")).toContain("title");
    expect(titleError("x".repeat(MAX_SUMMARY_TITLE))).toBeNull();
    expect(titleError("x".repeat(MAX_SUMMARY_TITLE + 4))).toContain("4 characters");
  });

  it("refuses too many photos before the wait, not after it", () => {
    /*
     * The server rejects rather than trimming, so somebody who selected sixty
     * photographs would otherwise sit through the request and then be refused
     * by a server they cannot see.
     */
    expect(photoSelectionError(0)).toContain("at least one");
    expect(photoSelectionError(MAX_SUMMARY_PHOTOS)).toBeNull();
    expect(photoSelectionError(MAX_SUMMARY_PHOTOS + 10)).toContain("10 too many");
  });
});

describe("deleteWarning", () => {
  it("says what survives, which differs by where the summary came from", () => {
    expect(deleteWarning({ walkthroughId: "w1" })).toContain("recording");
    expect(deleteWarning({ walkthroughId: null })).toContain("photos");
  });

  it("never implies the source goes with it", () => {
    for (const walkthroughId of ["w1", null]) {
      expect(deleteWarning({ walkthroughId })).toContain("stay");
    }
  });
});

describe("markdown, reduced to text the phone can render", () => {
  const body = `# Site walk\n\n## Summary\n\nThe **riser** was replaced.\n\n![shot](https://x/y.jpg)\n\nSee [the report](https://x/r).`;

  it("drops the syntax rather than showing it", () => {
    const text = plainBody(body);
    expect(text).not.toContain("#");
    expect(text).not.toContain("**");
    expect(text).toContain("The riser was replaced.");
  });

  it("drops the title heading, which is already on the screen above", () => {
    expect(plainBody(body)).not.toContain("Site walk");
  });

  it("drops images, because the photos are rendered as their own cards", () => {
    // Otherwise every photograph appears twice: once as markdown source that
    // cannot load, once as the card below with its note.
    expect(plainBody(body)).not.toContain("![");
    expect(plainBody(body)).not.toContain("https://x/y.jpg");
  });

  it("keeps a link's words and drops its URL", () => {
    expect(plainBody(body)).toContain("the report");
    expect(plainBody(body)).not.toContain("https://x/r");
  });

  it("keeps paragraphs, which is what separates it from the preview", () => {
    expect(plainBody(body)).toContain("\n");
    expect(markdownPreview(body)).not.toContain("\n");
  });

  it("truncates the preview and marks it", () => {
    const long = `Body ${"word ".repeat(80)}`;
    const preview = markdownPreview(long, 40);
    expect(preview.length).toBeLessThanOrEqual(40);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("is empty for nothing, rather than throwing", () => {
    expect(plainBody(null)).toBe("");
    expect(markdownPreview(null)).toBe("");
  });
});

describe("the phone and the server agree", () => {
  const summaries = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/walkthroughs/summaries.ts"), "utf8");
  const client = () =>
    readFileSync(join(process.cwd(), "apps/mobile/src/api/summaries.ts"), "utf8");

  it("declares the summary in the camelCase the service maps to", () => {
    /*
     * `toSummary` maps the row explicitly. Three defects of this exact class
     * have already shipped in this port, so the shape is read from the service
     * rather than trusted.
     */
    const s = summaries();
    for (const field of ["walkthroughId:", "photoNotes:", "shareToken:", "createdAt:"]) {
      expect(s, field).toContain(field);
    }
    const view = readFileSync(join(process.cwd(), "apps/mobile/src/api/summary-view.ts"), "utf8");
    expect(view).toContain("walkthroughId:");
    expect(view).toContain("photoNotes:");
    expect(view).not.toMatch(/^\s*photo_notes:/m);
    expect(view).not.toMatch(/^\s*share_token:/m);
  });

  it("keeps the note and the spoken line as separate fields", () => {
    // The service says the distinction is load-bearing. Collapsing them client
    // side would throw away what the recording was made to capture.
    const s = summaries();
    expect(s).toContain("spoken");
    expect(s).toContain("note");
    const view = readFileSync(join(process.cwd(), "apps/mobile/src/api/summary-view.ts"), "utf8");
    expect(view).toContain("spoken: string | null");
  });

  it("mirrors the bounds the schemas enforce", () => {
    const s = summaries();
    expect(s).toContain(`max(${MAX_SUMMARY_TITLE})`);
    expect(s).toContain("MAX_SUMMARY_PHOTOS");
  });

  it("spends an LLM call behind an idempotency key", () => {
    /*
     * `generateSummaryFromPhotos` is registered idempotent precisely so a retry
     * cannot bill twice. The key is per attempt rather than per photo set:
     * asking for a second summary of the same photos is legitimate, a retry
     * after a dropped response is not.
     */
    const registry = readFileSync(
      join(process.cwd(), "apps/api/src/domains/rpc/registry.ts"),
      "utf8",
    );
    const at = registry.indexOf("generateSummaryFromPhotos: authed(");
    expect(at).toBeGreaterThan(-1);
    expect(registry.slice(at, at + 400)).toContain("idempotent: true");
    expect(client()).toContain("idempotencyKey");
  });

  it("builds its share link through the shared route map", () => {
    /*
     * Not by assembling the path itself, which is what the first version did -
     * a seventh copy of a route prefix that `share-links.ts` exists to hold
     * once. That the map's entry points at a route the web actually serves is
     * checked in `mobile-page-share.test.ts`, against the routes directory.
     */
    const c = client();
    expect(c).toContain('publicUrl("summaries"');
    expect(c).not.toContain("`${webAppUrl}/share/");
  });
});
