import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultGoogleApply,
  DEFAULT_EMBED_OPTIONS,
  gallerySnippet,
  htmlToPlain,
  mapSnippet,
  movedIds,
  parseList,
  portfolioPageUrl,
  portfolioSiteUrl,
  reviewLinksToSave,
  sectionWithError,
  SITE_SECTIONS,
  siteDraftErrors,
  siteSectionDone,
  siteSectionProgress,
  siteSectionSummary,
  siteListingLabel,
  sitePatch,
  toSiteDraft,
  type PortfolioSite,
  isPortfolioProjectEmpty,
  isPublished,
  LAYOUTS,
  normaliseLayout,
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
  cover_image_url: null,
  item_count: 12,
  city: "Manchester",
  state: null,
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

describe("the response order is preserved", () => {
  it("has no client-side sort to get wrong", () => {
    /*
     * `listShowcases` orders by `position` then `created_at` in SQL and does
     * not send `position`. A client-side re-sort therefore read `undefined` for
     * every row and silently fell back to date order, which is not the order of
     * the public grid. The fix was to delete the sort, so the guard is that
     * nothing exports one.
     */
    const src = readFileSync(join(process.cwd(), "apps/mobile/src/api/portfolio-view.ts"), "utf8");
    expect(src).not.toMatch(/export function orderedPortfolio/);

    // And the screen must not be sorting either.
    const files = [
      "apps/mobile/app/(app)/portfolio.tsx",
      "apps/mobile/app/(app)/showcase/[id].tsx",
      "apps/mobile/src/components/portfolio/ShowcaseBuilder.tsx",
      "apps/mobile/src/components/portfolio/ShowcasePhotoPicker.tsx",
      "apps/mobile/src/components/portfolio/SiteEditor.tsx",
      "apps/mobile/src/api/portfolio-showcase.ts",
    ];
    const screen = files.map((f) => readFileSync(join(process.cwd(), f), "utf8")).join("\n");
    expect(screen).not.toContain("orderedPortfolio");
  });
});

describe("portfolioSummary", () => {
  it("says photos and place", () => {
    expect(portfolioSummary(page())).toBe("12 photos · Manchester");
  });

  it("leaves live and draft to the badge beside it", () => {
    /*
     * The state used to be appended here as well. The card renders a `Badge`
     * reading "Live" or "Draft" immediately to the right of this line, so the
     * row said it twice, in two type sizes, a few points apart - and read
     * aloud as "1 photo, Crewe England, live. Live."
     */
    expect(portfolioSummary(page({ revoked_at: "2026-08-02T00:00:00.000Z" }))).not.toContain(
      "draft",
    );
    expect(portfolioSummary(page())).not.toContain("live");
  });

  it("but the card still shows the state, so it was moved and not dropped", () => {
    /*
     * The other half of the change, read from the screen. Removing the word
     * from the summary is only right while the badge is there; without this
     * assertion the two edits could drift and the state would vanish.
     */
    const card = readFileSync(join(process.cwd(), "apps/mobile/app/(app)/portfolio.tsx"), "utf8");
    expect(card).toContain('label={isPublished(project) ? "Live" : "Draft"}');
  });

  it("omits the place when there is none", () => {
    expect(portfolioSummary(page({ city: null, state: null }))).toBe("12 photos");
  });

  it("reads item_count, the field the service actually sends", () => {
    /*
     * The bug. The service sends `item_count`; an earlier version read
     * `itemCount`, so every card said "0 photos" whatever the page held, and
     * `isPortfolioProjectEmpty` called every page empty. Both only visible on
     * the device.
     */
    expect(portfolioSummary(page({ item_count: 5, city: null }))).toBe("5 photos");
  });

  it("copes with a response that carried no count", () => {
    expect(portfolioSummary(page({ item_count: undefined, city: null }))).toBe("0 photos");
  });

  it("gets the singular right", () => {
    expect(portfolioSummary(page({ item_count: 1, city: null }))).toBe("1 photo");
  });
});

describe("isPortfolioProjectEmpty", () => {
  it("is true for a page with no photos", () => {
    // Publishing one puts a title on an empty page under the company's name, in
    // public. The screen asks first rather than blocking: it is their call.
    expect(isPortfolioProjectEmpty(page({ item_count: 0 }))).toBe(true);
    expect(isPortfolioProjectEmpty(page({ item_count: undefined }))).toBe(true);
    expect(isPortfolioProjectEmpty(page({ item_count: 1 }))).toBe(false);
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
      // The share kind and the builder's route are identifiers, not words anybody reads.
      (text) => /showcase/i.test(text) && !/^"(showcases|\/showcase\/\[id\])"$/.test(text.trim()),
    );

    expect(offenders).toEqual([]);
  });
});

describe("the site, as the web's Portfolio page has it", () => {
  const site: PortfolioSite = {
    id: "p1",
    slug: "acme-roofing",
    business_name: "Acme",
    logo_url: null,
    accent_color: "#2563eb",
    hero_headline: null,
    hero_subhead: null,
    hero_photo_id: null,
    hero_image_url: null,
    about_html: "<p>We <strong>fix</strong> roofs.</p><p>Since 1990.</p>",
    services: ["Roofing"],
    service_areas: [],
    phone: null,
    email: null,
    address: null,
    website_url: null,
    cta_label: null,
    cta_url: null,
    show_map: true,
    show_reviews: false,
    published: true,
    embed_key: "key-1",
    seo_title: null,
    seo_description: null,
    google_place_id: null,
    google_name: null,
    google_rating: null,
    google_review_count: null,
    google_synced_at: null,
  };

  it("opens the same public address the web's View site button does", () => {
    const web = readFileSync(
      join(process.cwd(), "apps/web/src/features/showcases/pages/PortfolioPage.tsx"),
      "utf8",
    );
    expect(web).toContain("/p/${p.slug}");
    expect(portfolioSiteUrl("https://everlumen.co/", "acme-roofing")).toBe(
      "https://everlumen.co/p/acme-roofing",
    );
    expect(portfolioPageUrl("https://everlumen.co", "acme-roofing", "barn")).toBe(
      "https://everlumen.co/p/acme-roofing/barn",
    );
    expect(portfolioSiteUrl(null, "acme-roofing")).toBeNull();
  });

  it("sends nothing for an untouched form", () => {
    const draft = toSiteDraft(site);
    expect(sitePatch(draft, draft)).toEqual({});
  });

  it("sends only what changed, and leaves the About formatting alone unless edited", () => {
    const before = toSiteDraft(site);
    const patch = sitePatch(before, { ...before, phone: " 0113 ", showReviews: true });
    expect(patch).toEqual({ phone: "0113", showReviews: true });
    expect(patch).not.toHaveProperty("aboutHtml");

    // About is the web's own HTML now, edited with the formatted editor, so the
    // bold made on the web is in the draft and goes back exactly as edited.
    expect(before.about).toBe(site.about_html);
    const html = "<p>New <strong>words</strong>.</p>";
    expect(sitePatch(before, { ...before, about: html }).aboutHtml).toBe(html);
    // An emptied editor saves "", which clears the field rather than storing it.
    expect(sitePatch(before, { ...before, about: "" }).aboutHtml).toBeNull();
  });

  it("sends the logo and the hero photo the phone now picks", () => {
    const before = toSiteDraft(site);
    expect(before.logoUrl).toBe("");
    expect(before.heroPhotoId).toBe("");
    expect(
      sitePatch(before, { ...before, logoUrl: "https://cdn/x.png", heroPhotoId: "ph-1" }),
    ).toEqual({ logoUrl: "https://cdn/x.png", heroPhotoId: "ph-1" });
    const chosen = toSiteDraft({ ...site, logo_url: "https://cdn/x.png", hero_photo_id: "ph-1" });
    // Removing either sends null: "use the newest project" and "no logo".
    expect(sitePatch(chosen, { ...chosen, logoUrl: "", heroPhotoId: "" })).toEqual({
      logoUrl: null,
      heroPhotoId: null,
    });
  });

  it("reads About back as paragraphs, for its one-line summary", () => {
    expect(htmlToPlain(site.about_html)).toBe("We fix roofs.\n\nSince 1990.");
  });

  it("parses comma lists without duplicates", () => {
    expect(parseList("Roofing, gutters,roofing\nSiding,")).toEqual([
      "Roofing",
      "gutters",
      "Siding",
    ]);
  });

  it("checks the address the way the server does", () => {
    const draft = toSiteDraft(site);
    expect(siteDraftErrors(draft)).toEqual({});
    expect(siteDraftErrors({ ...draft, slug: "A B" }).slug).toBeTruthy();
    expect(siteDraftErrors({ ...draft, slug: "ab" }).slug).toBeTruthy();
    expect(siteDraftErrors({ ...draft, accentColor: "blue" }).accentColor).toBeTruthy();
    expect(siteDraftErrors({ ...draft, ctaUrl: "example.com" }).ctaUrl).toBeTruthy();
  });

  it("builds the web's embed snippets", () => {
    const g = gallerySnippet("https://everlumen.co", "key-1", {
      ...DEFAULT_EMBED_OPTIONS,
      filters: false,
    });
    expect(g).toContain('src="https://everlumen.co/embed.js"');
    expect(g).toContain('data-key="key-1"');
    expect(g).toContain('data-filters="0"');
    const m = mapSnippet("https://everlumen.co", "key-1", "#2563eb", DEFAULT_EMBED_OPTIONS);
    expect(m).toContain('data-everlumen="map"');
    expect(m).toContain('data-pin="#2563eb"');
  });

  it("moves a page one place for the reorder buttons", () => {
    expect(movedIds(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(movedIds(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });

  it("labels a card the way the web grid does", () => {
    expect(siteListingLabel({ on_site: true, revoked_at: "x" })).toBe("Draft");
    expect(siteListingLabel({ on_site: true, revoked_at: null })).toBe("On site");
    expect(siteListingLabel({ on_site: false, revoked_at: null })).toBe("Hidden");
  });

  it("offers Google fields only where the site is empty", () => {
    const apply = defaultGoogleApply(site);
    expect(apply).not.toContain("businessName");
    expect(apply).not.toContain("services");
    expect(apply).toContain("phone");
  });

  it("drops review links that are not web addresses", () => {
    expect(
      reviewLinksToSave([
        { platform: "custom", url: " https://yelp.com/x ", label: " Yelp " },
        { platform: "custom", url: "yelp", label: null },
      ]),
    ).toEqual([{ platform: "custom", url: "https://yelp.com/x", label: "Yelp" }]);
  });

  it("draws the web's three tabs and its publish controls", () => {
    const screen = readFileSync(join(process.cwd(), "apps/mobile/app/(app)/portfolio.tsx"), "utf8");
    for (const label of ['label: "Site"', 'label: "Projects"', 'label: "Embeds"']) {
      expect(screen).toContain(label);
    }
    expect(screen).toContain('label="View website"');
    expect(screen).toContain('label="Publish site"');
    expect(screen).toContain("WebBrowser.openBrowserAsync(url)");
  });
});

describe("laid out the way the web's Portfolio page is", () => {
  /*
   * Jon, 2026-09-29: the phone's portfolio "feels cumbersome" and does not
   * look like the website. The web (`PortfolioPage.tsx`, the page the sidebar
   * links to at /showcases) is a publish band, three tabs, and a site editor
   * that shows one section at a time behind a trail of ticks. The phone had
   * the tabs but put every field of the site into one long form.
   */
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const site = {
    hero_photo_id: null,
    google_place_id: null,
    google_rating: null,
  } as const;
  const blank = toSiteDraft({
    id: "p1",
    slug: "acme-roofing",
    business_name: null,
    logo_url: null,
    accent_color: null,
    hero_headline: null,
    hero_subhead: null,
    hero_photo_id: null,
    hero_image_url: null,
    about_html: null,
    services: [],
    service_areas: [],
    phone: null,
    email: null,
    address: null,
    website_url: null,
    cta_label: null,
    cta_url: null,
    show_map: true,
    show_reviews: false,
    published: false,
    embed_key: "k",
    seo_title: null,
    seo_description: null,
    google_place_id: null,
    google_name: null,
    google_rating: null,
    google_review_count: null,
    google_synced_at: null,
  } as PortfolioSite);

  it("names the site's sections as the web's editor does, in its order", () => {
    const web = read("apps/web/src/features/showcases/components/PortfolioSiteSteps.tsx");
    const webLabels = [...web.matchAll(/^\s{4}label: "([^"]+)",$/gm)].map((m) => m[1]);
    expect(SITE_SECTIONS.map((s) => s.label)).toEqual(webLabels);
  });

  it("files every draft field under exactly one section", () => {
    const all = SITE_SECTIONS.flatMap((s) => s.fields).sort();
    expect(all).toEqual(Object.keys(blank).sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it("ticks sections by the web's rules and counts all but the address", () => {
    expect(siteSectionProgress(blank, site)).toEqual({ done: 0, total: 7 });
    const filled = { ...blank, businessName: "Acme", services: "Roofing", phone: "0113" };
    expect(siteSectionProgress(filled, site).done).toBe(3);
    // The cover follows the draft's photo, so clearing it unticks it before Save.
    expect(siteSectionDone("cover", { ...blank, heroPhotoId: "ph" }, site)).toBe(true);
    expect(siteSectionDone("cover", blank, { ...site, hero_photo_id: "ph" })).toBe(false);
    expect(siteSectionDone("reviews", blank, { ...site, google_place_id: "g" })).toBe(true);
  });

  it("says what is in each section, so nobody opens one to find out", () => {
    expect(siteSectionSummary("business", blank, site)).toBe("Not named yet");
    expect(siteSectionSummary("services", { ...blank, services: "A, B, C, D, E" }, site)).toBe(
      "A, B, C and 2 more",
    );
    expect(siteSectionSummary("address", blank, site)).toBe("/p/acme-roofing");
    expect(
      siteSectionSummary("reviews", blank, { ...site, google_place_id: "g", google_rating: 4.84 }),
    ).toBe("Google, 4.8 stars");
  });

  it("points Save at the section holding the error", () => {
    expect(sectionWithError({})).toBeNull();
    expect(sectionWithError({ slug: "bad" })).toBe("address");
    expect(sectionWithError({ ctaUrl: "bad" })).toBe("contact");
  });

  it("opens one section at a time instead of one long form", () => {
    const editor = read("apps/mobile/src/components/portfolio/SiteEditor.tsx");
    expect(editor).toContain("SITE_SECTIONS.map(");
    expect(editor).toContain("<Sheet");
    // The old form listed every section as a header down one scroll.
    expect(editor).not.toContain('<SectionHeader title="Business" />');
  });

  it("puts each embed behind its own row", () => {
    const embeds = read("apps/mobile/src/components/portfolio/EmbedsPanel.tsx");
    expect(embeds).toContain('title="Website gallery"');
    expect(embeds).toContain('title="Project map"');
    expect(embeds).toContain("<Sheet");
  });

  it("lists projects as compact rows and keeps their controls in a sheet", () => {
    const screen = read("apps/mobile/app/(app)/portfolio.tsx");
    expect(screen).toContain("setSelectedId(project.id)");
    expect(screen).toContain('label="Featured"');
    expect(screen).toContain('label="On site"');
    // Building from a job floats at the lower right, a labelled pill on a tablet.
    expect(screen).toContain("<ActionRail");
    expect(screen).toContain('label: "Build from a job"');
    expect(screen).toContain("useRightRail()");
  });
});
