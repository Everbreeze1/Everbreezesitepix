import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addPhotosToSection,
  BUILDER_LAYOUTS,
  BUILDER_PARTS,
  builderErrors,
  builderPartSummary,
  builderPayload,
  builderSnapshot,
  coverPreview,
  defaultPickerProject,
  listingErrors,
  listingPayload,
  moved,
  pagePath,
  parseProducts,
  photoCount,
  pinLabel,
  sectionsFromPicked,
  serviceTypeOptions,
  toBuilderDraft,
  toListingDraft,
  townOnly,
  type ShowcaseDetail,
} from "../apps/mobile/src/api/portfolio-showcase";
import {
  firstUnansweredSection,
  needsGuidedSetup,
  setupDismissedKey,
  SITE_PREVIEW_BLOCKS,
  SITE_SECTIONS,
  sitePreviewLine,
  skippedSections,
  toSiteDraft,
  type PortfolioSite,
} from "../apps/mobile/src/api/portfolio-view";

/*
 * One portfolio page's builder on the phone, and the site editor's new parts.
 *
 * Jon, 2026-09-29: replicate every website capability in the app, easier to
 * use on a phone. The web builds a page in `ShowcaseBuilderPage.tsx` (cover,
 * opening, sections of photos from jobs, closing, design) with the page's site
 * listing in `ShowcaseSiteCard.tsx`, and builds the site in the guided
 * `PortfolioSetupWizard`. These tests hold the phone to the same writes.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const detail = (over: Partial<ShowcaseDetail> = {}): ShowcaseDetail => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Oak Street reroof",
  tagline: null,
  layout: "masonry",
  share_token: "tok",
  revoked_at: null,
  intro_html: "<p>We <strong>fix</strong> roofs.</p>",
  outro_html: null,
  accent_color: null,
  show_contact: true,
  show_reviews: false,
  cover_photo_id: null,
  cover_image_url: null,
  sections: [
    {
      id: "sec-a",
      project_id: "job-1",
      project_name: "Oak Street",
      title: "Before",
      body_html: null,
      items: [
        { photo_id: "ph-1", caption: "Old roof", image_url: "https://img/1" },
        { photo_id: "ph-2", caption: null, image_url: "https://img/2" },
      ],
    },
  ],
  slug: "oak-street-reroof",
  service_type: "Roof replacement",
  products_used: ["GAF Timberline HDZ"],
  summary: null,
  city: "Sacramento",
  state: "CA",
  latitude: null,
  longitude: null,
  on_site: true,
  featured: false,
  completed_on: null,
  ...over,
});

describe("the page builder's one Save", () => {
  it("loads the service's fields and defaults the colour as the web does", () => {
    const draft = toBuilderDraft(detail());
    expect(draft.layout).toBe("masonry");
    expect(draft.accentColor).toBe("#2563eb");
    expect(draft.introHtml).toBe("<p>We <strong>fix</strong> roofs.</p>");
    expect(draft.sections[0]?.items.map((i) => i.caption)).toEqual(["Old roof", ""]);
    expect(toBuilderDraft(detail({ layout: "weird" })).layout).toBe("grid");
  });

  it("is clean until something saved changes, and ignores client-only keys", () => {
    const a = toBuilderDraft(detail());
    const b = toBuilderDraft(detail());
    // Different section keys, same saved content.
    expect(a.sections[0]?.key).not.toBe(b.sections[0]?.key);
    expect(builderSnapshot(a)).toBe(builderSnapshot(b));
    expect(builderSnapshot({ ...a, coverImageUrl: "https://x" })).toBe(builderSnapshot(a));
    expect(builderSnapshot({ ...a, title: "New" })).not.toBe(builderSnapshot(a));
  });

  it("writes updateShowcase then setShowcaseSections, in the web's shapes", () => {
    const draft = toBuilderDraft(detail());
    const payload = builderPayload("id-1", { ...draft, title: "  ", tagline: " Fine " });
    expect(payload.showcase).toEqual({
      id: "id-1",
      title: "Untitled project",
      tagline: "Fine",
      layout: "masonry",
      accentColor: "#2563eb",
      showContact: true,
      showReviews: false,
      introHtml: "<p>We <strong>fix</strong> roofs.</p>",
      outroHtml: null,
      coverPhotoId: null,
    });
    expect(payload.sections).toEqual({
      showcaseId: "id-1",
      sections: [
        {
          projectId: "job-1",
          title: "Before",
          bodyHtml: null,
          items: [
            { photoId: "ph-1", caption: "Old roof" },
            { photoId: "ph-2", caption: null },
          ],
        },
      ],
    });

    // Both ops, in that order, from the client.
    const api = read("apps/mobile/src/api/portfolio.ts");
    const update = api.indexOf('api.rpc("updateShowcase", {');
    const sections = api.indexOf('api.rpc("setShowcaseSections", {');
    expect(update).toBeGreaterThan(-1);
    expect(sections).toBeGreaterThan(update);
  });

  it("stops a Save the service would refuse", () => {
    const draft = toBuilderDraft(detail());
    expect(builderErrors(draft)).toEqual([]);
    expect(builderErrors({ ...draft, accentColor: "blue" })).toEqual([
      "Use a brand colour like #2563eb.",
    ]);
    expect(builderErrors({ ...draft, title: "x".repeat(161) })[0]).toMatch(/160/);
  });

  it("draws the cover the public page falls back to", () => {
    const draft = toBuilderDraft(detail());
    expect(coverPreview(draft)).toBe("https://img/1");
    expect(coverPreview({ ...draft, coverImageUrl: "https://cover" })).toBe("https://cover");
    expect(coverPreview({ ...draft, sections: [] })).toBeNull();
  });

  it("reorders with the arrows the web draws, and never loses an item", () => {
    expect(moved(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moved(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
    expect(moved(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  });

  it("makes one section per job from picked photos, and skips duplicates", () => {
    const picked = [
      { id: "p1", imageUrl: "u1", projectId: "j1", projectName: "Oak" },
      { id: "p2", imageUrl: "u2", projectId: "j1", projectName: "Oak" },
      { id: "p3", imageUrl: "u3", projectId: "j2", projectName: "Elm" },
    ];
    const sections = sectionsFromPicked(picked);
    expect(sections.map((s) => [s.title, s.items.length])).toEqual([
      ["Oak", 2],
      ["Elm", 1],
    ]);
    const draft = toBuilderDraft(detail());
    const result = addPhotosToSection(draft.sections[0]!, [
      { id: "ph-1", imageUrl: "u", projectId: "job-1", projectName: "Oak Street" },
      { id: "ph-9", imageUrl: "u9", projectId: "job-1", projectName: "Oak Street" },
    ]);
    expect(result.added).toBe(1);
    expect(result.section.items.map((i) => i.photoId)).toEqual(["ph-1", "ph-2", "ph-9"]);
    expect(photoCount({ sections: [result.section] })).toBe(3);
    // The pickers open on the page's own job.
    expect(defaultPickerProject(draft)).toBe("job-1");
  });

  it("lists the web builder's parts and names its layouts as its Design panel does", () => {
    expect(BUILDER_PARTS.map((p) => p.label)).toEqual([
      "Cover",
      "Opening",
      "Your work",
      "Closing",
      "Design",
      "On your site",
    ]);
    const web = read("apps/web/src/features/showcases/pages/ShowcaseBuilderPage.tsx");
    for (const layout of BUILDER_LAYOUTS) {
      expect(web).toContain(`<SelectItem value="${layout.id}">`);
    }
    const draft = toBuilderDraft(detail());
    expect(builderPartSummary("work", draft)).toBe("1 section, 2 photos");
    expect(builderPartSummary("opening", draft)).toBe("We fix roofs.");
  });
});

describe("the page's site listing, saved on its own", () => {
  it("sends every field of the web's On your site card", () => {
    const listing = toListingDraft(detail({ latitude: 38.5, longitude: -121.4 }));
    expect(
      listingPayload("id-1", { ...listing, slug: " Oak-Street ", serviceType: "roof-repair" }),
    ).toEqual({
      id: "id-1",
      slug: "oak-street",
      serviceType: "Roof Repair",
      productsUsed: ["GAF Timberline HDZ"],
      summary: null,
      city: "Sacramento",
      state: "CA",
      completedOn: null,
      onSite: true,
      featured: false,
      latitude: 38.5,
      longitude: -121.4,
    });
  });

  it("checks the op's limits and the date's shape", () => {
    const listing = toListingDraft(detail());
    expect(listingErrors(listing)).toEqual({});
    expect(listingErrors({ ...listing, completedOn: "29/09/2026" }).completedOn).toBe(
      "Use YYYY-MM-DD",
    );
    expect(listingErrors({ ...listing, summary: "x".repeat(301) }).summary).toMatch(/300/);
  });

  it("tidies service types and products as the web does", () => {
    expect(serviceTypeOptions(["roof-repair", "Roof Repair", "gutters"])).toEqual([
      "Gutters",
      "Roof Repair",
    ]);
    expect(parseProducts("GAF, gaf,  Ice and water shield\n")).toEqual([
      "GAF",
      "Ice and water shield",
    ]);
  });

  it("offers the town instead of a customer's street address", () => {
    expect(townOnly("Reroof at 12 Oak Street, Sacramento", "Sacramento", "CA")).not.toBeNull();
    expect(townOnly("Reroof in Sacramento", "Sacramento", "CA")).toBeNull();
  });

  it("says where the page and its pin are", () => {
    expect(pagePath("acme", "Oak-Street")).toBe("/p/acme/oak-street");
    expect(pagePath(null, "")).toBe("/p/your-site/...");
    expect(pinLabel(null, null)).toMatch(/No pin/);
    expect(pinLabel(38.5, -121.4)).toBe("Pinned at 38.50000, -121.40000");
  });
});

describe("the builder screen", () => {
  const builder = read("apps/mobile/src/components/portfolio/ShowcaseBuilder.tsx");
  const route = read("apps/mobile/app/(app)/showcase/[id].tsx");
  const list = read("apps/mobile/app/(app)/portfolio.tsx");

  it("keeps the Portfolio's owner-only gate", () => {
    expect(route).toContain("useAccountOwner()");
    expect(route).toContain('<Redirect href="/" />');
  });

  it("is reached from each project on the list and after making one", () => {
    expect(list).toContain('pathname: "/showcase/[id]"');
    expect(list).toContain('label: "Edit page"');
    expect(list).toContain("openBuilder(made)");
  });

  it("asks before leaving unsaved work and before destructive steps", () => {
    expect(builder).toContain('"beforeRemove"');
    expect(builder).toContain('"Leave without saving?"');
    expect(builder).toContain('"Remove this section?"');
    expect(builder).toContain('"Unpublish this project?"');
    // Every page has a way back, even when opened first from a link.
    expect(builder).toContain('router.replace("/portfolio")');
  });

  it("lays out side by side on a tablet on its side, with actions on the right", () => {
    expect(builder).toContain("<SplitPane");
    expect(builder).toContain("useRightRail()");
    expect(builder).toContain("layout.split()");
  });

  it("edits long copy as formatted text over the web's HTML", () => {
    expect(builder).toContain("<RichHtmlField");
    expect(read("apps/mobile/src/components/portfolio/RichHtmlField.tsx")).toContain(
      "<FormattedTextEditor",
    );
  });

  it("picks photos from a job, one cover or many", () => {
    expect(builder).toContain("<ShowcasePhotoPicker");
    const picker = read("apps/mobile/src/components/portfolio/ShowcasePhotoPicker.tsx");
    expect(picker).toContain("listProjectPhotoPage(");
    expect(picker).toContain("single");
  });
});

describe("the site editor's guided build and preview", () => {
  const base: PortfolioSite = {
    id: "p1",
    slug: "acme",
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
    show_reviews: true,
    published: false,
    embed_key: "k",
    seo_title: null,
    seo_description: null,
    google_place_id: null,
    google_name: null,
    google_rating: null,
    google_review_count: null,
    google_synced_at: null,
  };

  it("opens for a site missing a load-bearing answer, as the web's does", () => {
    const blank = toSiteDraft(base);
    expect(needsGuidedSetup(blank, base)).toBe(true);
    const filled = { ...blank, businessName: "Acme", services: "Roofing", heroHeadline: "Hi" };
    expect(needsGuidedSetup(filled, base)).toBe(false);
    expect(firstUnansweredSection(blank, base)).toBe(0);
    expect(SITE_SECTIONS[firstUnansweredSection(filled, base)]?.id).toBe("areas");
    expect(skippedSections(filled, base).map((s) => s.id)).toEqual([
      "areas",
      "about",
      "reviews",
      "contact",
    ]);
    // The web's own key, so the choice means the same thing on both.
    const web = read("apps/web/src/features/showcases/pages/PortfolioPage.tsx");
    expect(web).toContain("everlumen.portfolio-setup-dismissed.${portfolioId}");
    expect(setupDismissedKey("p1")).toBe("everlumen.portfolio-setup-dismissed.p1");
  });

  it("draws the web overview's blocks, each filled from its section", () => {
    const web = read("apps/web/src/features/showcases/pages/PortfolioLibraryContent.tsx");
    for (const label of ["Our story", "Capabilities", "Testimonials"]) {
      expect(web).toContain(`<Eyebrow>${label}</Eyebrow>`);
      expect(SITE_PREVIEW_BLOCKS.some((b) => b.label === label)).toBe(true);
    }
    const draft = { ...toSiteDraft(base), about: "<p>Family <b>run</b>.</p>" };
    expect(sitePreviewLine("story", draft, base, 0)).toBe("Family run.");
    expect(sitePreviewLine("gallery", draft, base, 2)).toBe("2 projects on the site");
    expect(sitePreviewLine("testimonials", draft, { ...base, google_rating: 4.84 }, 0)).toBe(
      "4.8 rating on Google, 0 reviews",
    );
  });

  it("uploads the site's own logo and picks the hero from a job, as the web does", () => {
    const editor = read("apps/mobile/src/components/portfolio/SiteEditor.tsx");
    expect(editor).toContain("uploadPortfolioLogo(");
    expect(editor).toContain('title="Choose your hero photo"');
    expect(editor).toContain("WebBrowser.openBrowserAsync(siteUrl)");
    expect(editor).not.toContain("The logo is uploaded on the website.");
    expect(editor).not.toContain("The cover photo is picked on the website.");
    const api = read("apps/mobile/src/api/portfolio.ts");
    expect(api).toContain('.from("company-logos")');
    expect(api).toContain("portfolio-logo-");
  });
});
