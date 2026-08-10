import { describe, it, expect, vi, afterEach } from "vitest";
import {
  relativeTime,
  sanitizeCaption,
  isFilenameLikeCaption,
  cleanCaption,
  displayCaption,
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
  it("does NOT strip active markup — it is a filter, not a sanitiser", () => {
    const payload = '<img src=x onerror="alert(1)">Roof detail';
    expect(sanitizeCaption(payload)).toBe(payload);
    expect(sanitizeCaption(payload)).toContain("onerror");

    const script = "<script>alert(1)</script>Roof detail";
    expect(sanitizeCaption(script)).toContain("<script>");
  });
});
