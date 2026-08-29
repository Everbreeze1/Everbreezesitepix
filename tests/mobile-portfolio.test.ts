import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isPortfolioProjectEmpty,
  isPublished,
  LAYOUTS,
  normaliseLayout,
  orderedPortfolio,
  portfolioSummary,
  portfolioTitleError,
  publishedCount,
  taglineError,
  type PortfolioProject,
} from "../apps/mobile/src/api/portfolio-view";
import { shareUrl } from "../apps/mobile/src/api/share-links";

/*
 * The Portfolio.
 *
 * Two things are guarded here. The publishing rule, because getting it wrong
 * means a page about a customer's job goes public without anybody choosing to.
 * And the vocabulary, because the client is specific about it and the tables
 * are named the other way: the site is the "Portfolio", each page is a
 * "project", and `showcase` is an identifier that must never reach a screen.
 */

const page = (over: Partial<PortfolioProject> = {}): PortfolioProject => ({
  id: "s1",
  title: "Riverside roof replacement",
  tagline: null,
  layout: "grid",
  share_token: "tok-1",
  revoked_at: null,
  cover_photo_id: null,
  coverUrl: null,
  itemCount: 12,
  city: "Manchester",
  state: null,
  position: 0,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  ...over,
});

describe("isPublished", () => {
  it("reads revoked_at, not the token", () => {
    /*
     * `share_token` is NOT NULL DEFAULT gen_random_uuid(), so every row has one
     * from the moment it is created. Reading the token as the signal reports
     * the entire portfolio as live the day it exists, which means a page about
     * a customer's job is public without anybody choosing to make it so.
     */
    expect(isPublished(page())).toBe(true);
    expect(isPublished(page({ revoked_at: "2026-08-02T00:00:00.000Z" }))).toBe(false);
    expect(isPublished(page({ share_token: null }))).toBe(false);
  });
});

describe("publishedCount", () => {
  it("counts only the live ones", () => {
    expect(publishedCount([page(), page({ revoked_at: "2026-08-02T00:00:00.000Z" }), page()])).toBe(
      2,
    );
    expect(publishedCount([])).toBe(0);
  });
});

describe("orderedPortfolio", () => {
  it("uses position, then newest", () => {
    /*
     * The list on the phone is also the running order of the public grid, so
     * the two have to agree or reordering on the web looks broken here.
     */
    const out = orderedPortfolio([
      page({ id: "c", position: 2 }),
      page({ id: "a", position: 0 }),
      page({ id: "b", position: 1 }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("puts a page with no position last, not first", () => {
    // A null sorting as zero would jump an unpositioned page to the front of
    // somebody's portfolio.
    const out = orderedPortfolio([
      page({ id: "none", position: null }),
      page({ id: "first", position: 0 }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["first", "none"]);
  });

  it("breaks a tie on newest", () => {
    const out = orderedPortfolio([
      page({ id: "older", position: 0, created_at: "2026-01-01T00:00:00.000Z" }),
      page({ id: "newer", position: 0, created_at: "2026-08-01T00:00:00.000Z" }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["newer", "older"]);
  });

  it("does not mutate its input", () => {
    const rows = [page({ id: "b", position: 1 }), page({ id: "a", position: 0 })];
    orderedPortfolio(rows);
    expect(rows[0].id).toBe("b");
  });
});

describe("portfolioSummary", () => {
  it("says photos, place and whether it is live", () => {
    expect(portfolioSummary(page())).toBe("12 photos · Manchester · live");
  });

  it("marks an unpublished page a draft", () => {
    expect(portfolioSummary(page({ revoked_at: "2026-08-02T00:00:00.000Z" }))).toContain("draft");
  });

  it("omits the place when there is none", () => {
    expect(portfolioSummary(page({ city: null, state: null }))).toBe("12 photos · live");
  });

  it("copes with a response that carried no count", () => {
    expect(portfolioSummary(page({ itemCount: undefined, city: null }))).toBe("0 photos · live");
  });

  it("gets the singular right", () => {
    expect(portfolioSummary(page({ itemCount: 1, city: null }))).toBe("1 photo · live");
  });
});

describe("isPortfolioProjectEmpty", () => {
  it("is true for a page with no photos", () => {
    // Publishing one puts a title on an empty page under the company's name, in
    // public. The screen asks first rather than blocking: it is their call.
    expect(isPortfolioProjectEmpty(page({ itemCount: 0 }))).toBe(true);
    expect(isPortfolioProjectEmpty(page({ itemCount: undefined }))).toBe(true);
    expect(isPortfolioProjectEmpty(page({ itemCount: 1 }))).toBe(false);
  });
});

describe("titles and taglines", () => {
  it("caps at the same lengths the ops do", () => {
    expect(portfolioTitleError("")).toContain("title");
    expect(portfolioTitleError("Riverside")).toBeNull();
    expect(portfolioTitleError("x".repeat(160))).toBeNull();
    expect(portfolioTitleError("x".repeat(161))).toContain("160");

    expect(taglineError("")).toBeNull();
    expect(taglineError("x".repeat(300))).toBeNull();
    expect(taglineError("x".repeat(301))).toContain("300");
  });
});

describe("normaliseLayout", () => {
  it("passes the three the server accepts", () => {
    for (const layout of LAYOUTS) expect(normaliseLayout(layout.id)).toBe(layout.id);
  });

  it("falls back rather than sending something the CHECK rejects", () => {
    // `layout` has a CHECK constraint. A value from an older client would fail
    // the write with a database error rather than anything readable.
    expect(normaliseLayout("carousel")).toBe("grid");
    expect(normaliseLayout(null)).toBe("grid");
  });
});

describe("LAYOUTS", () => {
  it("names each layout for its result, not its CSS", () => {
    // "Masonry" means nothing to a roofer, and this picker is the only place
    // anybody meets these words.
    const labels = LAYOUTS.map((layout) => layout.label.toLowerCase());
    expect(labels.some((label) => label.includes("masonry"))).toBe(false);
    for (const layout of LAYOUTS) expect(layout.hint.length).toBeGreaterThan(0);
  });
});

describe("the public link", () => {
  it("points at a route that exists", () => {
    /*
     * The kind is "showcases" because the route is, and a link the phone builds
     * wrongly is a link a customer opens and finds broken. Checked against the
     * filesystem rather than a copy of the path.
     */
    const url = shareUrl("https://everlumen.co", "showcases", "tok-1");
    expect(url).toBe("https://everlumen.co/share/showcases/tok-1");

    const route = join(process.cwd(), "apps/web/src/routes/share.showcases.$token.tsx");
    expect(() => readFileSync(route, "utf8")).not.toThrow();
  });
});

describe("vocabulary", () => {
  it("never puts the word 'showcase' in front of a person", () => {
    /*
     * The client's wording, and it is load-bearing: the site is the Portfolio
     * and each page is a project. `showcase` is what the tables and routes are
     * called, and it may stay there forever, but it must not reach a screen.
     *
     * Checked against the screen source rather than by inspection, because this
     * is exactly the kind of thing that comes back one careless string at a
     * time.
     */
    const screen = readFileSync(join(process.cwd(), "apps/mobile/app/(app)/portfolio.tsx"), "utf8");

    /*
     * Strip comments and imports: identifiers and explanations may say it.
     *
     * The lookbehind is not optional and `tests/invariants.test.ts` enforces
     * it. An unguarded `/\*` opens a comment at any slash-star, including the
     * one inside a string like `accept="image/*"`, and then runs to the next
     * real star-slash deleting everything between. The dangerous half is that
     * this test is a `toEqual([])`: the offending text would sit inside the
     * hole and the test would report green.
     */
    const withoutComments = screen
      .replace(/(?<![\w"'])\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/^import[\s\S]*?from\s+".*";$/gm, "");

    // What is left is JSX and logic. Any `showcase` here is either an op name
    // or a share kind, both of which are identifiers in quotes.
    const humanText = withoutComments.match(/"[^"]*"|`[^`]*`|>[^<>{}]+</g) ?? [];
    const offenders = humanText.filter(
      (text) => /showcase/i.test(text) && !/^"(showcases)"$/.test(text.trim()),
    );

    expect(offenders).toEqual([]);
  });
});
