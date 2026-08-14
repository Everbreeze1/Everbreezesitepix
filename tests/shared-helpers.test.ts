import { describe, it, expect, vi, afterEach } from "vitest";
import {
  relativeTime,
  sanitizeCaption,
  isFilenameLikeCaption,
  cleanCaption,
  displayCaption,
  formatChecklistAnswer,
  formatProjectAddress,
} from "../packages/shared/src/index";

afterEach(() => {
  vi.useRealTimers();
});

/** Freeze the clock so relative-time boundaries are deterministic. */
function at(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe("relativeTime", () => {
  it("returns empty string for nullish and unparseable input", () => {
    expect(relativeTime(null)).toBe("");
    expect(relativeTime(undefined)).toBe("");
    expect(relativeTime("")).toBe("");
    expect(relativeTime("not a date")).toBe("");
  });

  it("walks the unit boundaries", () => {
    at("2026-08-10T12:00:00.000Z");
    const ago = (ms: number) => relativeTime(new Date(Date.now() - ms).toISOString());
    expect(ago(0)).toBe("just now");
    expect(ago(29_000)).toBe("just now");
    expect(ago(30_000)).toBe("30s ago");
    expect(ago(60_000)).toBe("1m ago");
    expect(ago(59 * 60_000)).toBe("59m ago");
    expect(ago(60 * 60_000)).toBe("1h ago");
    expect(ago(23 * 3600_000)).toBe("23h ago");
    expect(ago(24 * 3600_000)).toBe("1d ago");
    expect(ago(6 * 24 * 3600_000)).toBe("6d ago");
    expect(ago(7 * 24 * 3600_000)).toBe("1w ago");
    expect(ago(29 * 24 * 3600_000)).toBe("4w ago");
  });

  it("falls back to an absolute date past 30 days", () => {
    at("2026-08-10T12:00:00.000Z");
    const out = relativeTime(new Date(Date.now() - 40 * 24 * 3600_000).toISOString());
    expect(out).not.toMatch(/ago$/);
    expect(out.length).toBeGreaterThan(0);
  });

  // A clock-skewed client, or a row stamped by a server slightly ahead of the
  // browser, produces a negative difference. It must not render as "-1m ago".
  it("does not emit a negative duration for future timestamps", () => {
    at("2026-08-10T12:00:00.000Z");
    const future = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(relativeTime(future)).not.toMatch(/-/);
  });
});

describe("isFilenameLikeCaption", () => {
  it("treats empty and whitespace as filename-like (i.e. no real caption)", () => {
    expect(isFilenameLikeCaption(null)).toBe(true);
    expect(isFilenameLikeCaption("")).toBe(true);
    expect(isFilenameLikeCaption("   ")).toBe(true);
  });

  it("detects generated names and bare timestamps", () => {
    expect(isFilenameLikeCaption("sitepix-1781560897511.jpg")).toBe(true);
    expect(isFilenameLikeCaption("IMG_1234.HEIC")).toBe(true);
    expect(isFilenameLikeCaption("photo-2025-01-02.jpeg")).toBe(true);
    expect(isFilenameLikeCaption("1781560897511")).toBe(true);
  });

  it("keeps real captions written by a person", () => {
    expect(isFilenameLikeCaption("Cracked flashing on north elevation")).toBe(false);
    expect(isFilenameLikeCaption("Unit 3B")).toBe(false);
  });

  /*
   * The prefix rule used to fire on anything merely STARTING with one of the
   * generated-name words plus a digit, so these real captions were discarded -
   * and `sanitizeCaption` blanks them, with report sections persisting the
   * blank. The digit run now has to reach the end of the string.
   */
  it("keeps captions that begin with a generated-looking word but continue in prose", () => {
    expect(isFilenameLikeCaption("Photo 3 of the north wall crack")).toBe(false);
    expect(isFilenameLikeCaption("Image 2 shows the damaged flashing")).toBe(false);
    expect(isFilenameLikeCaption("Capture 1 - before repair")).toBe(false);
    expect(isFilenameLikeCaption("IMG 4 taken from the roof")).toBe(false);
  });

  it("still discards bare generated names with no extension", () => {
    expect(isFilenameLikeCaption("Photo 1781560897511")).toBe(true);
    expect(isFilenameLikeCaption("IMG_1234")).toBe(true);
    expect(isFilenameLikeCaption("photo-2025-01-02")).toBe(true);
    expect(isFilenameLikeCaption("sitepix-1781560897511")).toBe(true);
  });

  it("a real caption survives sanitizeCaption end to end", () => {
    expect(sanitizeCaption("Photo 3 of the north wall crack")).toBe(
      "Photo 3 of the north wall crack",
    );
    expect(sanitizeCaption("<p>Photo 3 of the north wall crack</p>")).toBe(
      "<p>Photo 3 of the north wall crack</p>",
    );
  });
});

describe("cleanCaption / displayCaption", () => {
  it("nulls out filename-like captions and trims real ones", () => {
    expect(cleanCaption("IMG_0001.jpg")).toBeNull();
    expect(cleanCaption("  Roof detail  ")).toBe("Roof detail");
  });

  it("falls back when there is no real caption", () => {
    expect(displayCaption("IMG_0001.jpg", "Untitled")).toBe("Untitled");
    expect(displayCaption("Roof detail", "Untitled")).toBe("Roof detail");
  });
});

describe("sanitizeCaption", () => {
  it("blanks captions whose visible text is filename-like, even when wrapped in markup", () => {
    expect(sanitizeCaption("<p>IMG_0001.jpg</p>")).toBe("");
    expect(sanitizeCaption("<p>&nbsp;</p>")).toBe("");
    expect(sanitizeCaption(null)).toBe("");
  });

  it("preserves rich formatting on a real caption", () => {
    expect(sanitizeCaption("<p><strong>Roof</strong> detail</p>")).toBe(
      "<p><strong>Roof</strong> detail</p>",
    );
  });

  /*
   * DOCUMENTS ACTUAL BEHAVIOUR, and it is not what the name implies.
   *
   * `sanitizeCaption` strips tags only to *decide* whether the caption is
   * filename-like; when it decides the caption is real it returns the ORIGINAL
   * input verbatim. It is a filter, not a sanitiser. These assertions exist so
   * that if someone later makes it actually sanitise, the test fails loudly and
   * they check every consumer that relies on formatting being preserved.
   */
  it("does NOT strip active markup - it is a filter, not a sanitiser", () => {
    const payload = '<img src=x onerror="alert(1)">Roof detail';
    expect(sanitizeCaption(payload)).toBe(payload);
    expect(sanitizeCaption(payload)).toContain("onerror");

    const script = "<script>alert(1)</script>Roof detail";
    expect(sanitizeCaption(script)).toContain("<script>");
  });
});

/*
 * The printed / shared field record.
 *
 * These two helpers live in `shared` because the SAME record is rendered from two
 * sources - the web app maps live rows, the public share service maps rows read
 * with the service role - and both must produce identical paper. A drift here is
 * a customer receiving a checklist that disagrees with the one the crew printed,
 * so the edge cases are pinned rather than left to each caller.
 */
describe("formatChecklistAnswer", () => {
  it("returns null for every shape of no-answer", () => {
    for (const t of ["checkbox", "text", "numeric", "rating", "pass_fail"]) {
      expect(formatChecklistAnswer(t, null)).toBeNull();
      expect(formatChecklistAnswer(t, undefined)).toBeNull();
      expect(formatChecklistAnswer(t, "")).toBeNull();
    }
  });

  it("keeps a recorded zero, which is an answer", () => {
    // `0` and `false` are falsy but were genuinely entered. Printing a blank rule
    // beside "Refrigerant added (lbs)" when the tech measured 0 misreports the job.
    expect(formatChecklistAnswer("numeric", 0)).toBe("0");
    expect(formatChecklistAnswer("yes_no", false)).toBe("No");
  });

  it("renders a rating out of five, not a bare number", () => {
    expect(formatChecklistAnswer("rating", 4)).toBe("4 / 5");
    // Ratings arrive as jsonb, so a stringified number has to land the same way.
    expect(formatChecklistAnswer("rating", "3")).toBe("3 / 5");
  });

  it("never prints NaN or Infinity onto a record", () => {
    expect(formatChecklistAnswer("numeric", Number.NaN)).toBeNull();
    expect(formatChecklistAnswer("numeric", Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatChecklistAnswer("rating", "not a number")).toBeNull();
  });

  it("passes pass/fail and free text through verbatim", () => {
    expect(formatChecklistAnswer("pass_fail", "Fail")).toBe("Fail");
    expect(formatChecklistAnswer("text", "Compressor humming at start-up")).toBe(
      "Compressor humming at start-up",
    );
  });

  it("tolerates an unknown item_type rather than dropping the answer", () => {
    // `item_type` is a text column with a CHECK constraint; a future type added
    // to the database before this map must still print what was recorded.
    expect(formatChecklistAnswer("some_future_type", "42")).toBe("42");
    expect(formatChecklistAnswer(null, "recorded")).toBe("recorded");
  });
});

describe("formatProjectAddress", () => {
  it("returns null rather than an empty or comma-only string", () => {
    expect(formatProjectAddress(null)).toBeNull();
    expect(formatProjectAddress({})).toBeNull();
    expect(formatProjectAddress({ street: null, city: null, state: null, zip: null })).toBeNull();
  });

  it("collapses a full address onto one letterhead line", () => {
    expect(
      formatProjectAddress({ street: "12 Oak St", city: "Austin", state: "TX", zip: "78701" }),
    ).toBe("12 Oak St, Austin, TX 78701");
  });

  it("drops missing parts without leaving stray punctuation", () => {
    // A project with only a city must not print "Austin, " or ", TX".
    expect(formatProjectAddress({ city: "Austin" })).toBe("Austin");
    expect(formatProjectAddress({ street: "12 Oak St" })).toBe("12 Oak St");
    expect(formatProjectAddress({ city: "Austin", zip: "78701" })).toBe("Austin 78701");
    expect(formatProjectAddress({ state: "TX", zip: "78701" })).toBe("TX 78701");
    expect(formatProjectAddress({ street: "12 Oak St", zip: "78701" })).toBe("12 Oak St, 78701");
  });
});
