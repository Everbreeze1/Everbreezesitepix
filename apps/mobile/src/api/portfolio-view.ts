/**
 * Reading the Portfolio, as rules.
 *
 * Import-free so it can be tested. Two things here are worth guarding.
 *
 * **The vocabulary.** The mini-site is the "Portfolio" and each page is a
 * "project". The tables and ops say `showcase` and always will, because
 * renaming them is a migration for no benefit. Nothing this module returns may
 * contain the word, because everything it returns is read by a person.
 *
 * **What "published" means.** `share_token` is `NOT NULL DEFAULT
 * gen_random_uuid()`, so every row has one from creation and the token says
 * nothing about whether the page is public. `revoked_at` is the switch. Reading
 * the token as the signal reports the entire portfolio as live the day it is
 * created, which is a page about a customer's job going public without anybody
 * choosing to.
 */

export type PortfolioLayout = "grid" | "masonry" | "featured";

/**
 * A portfolio page as `listShowcases` returns it.
 *
 * **Every field name here is the service's.** An earlier version guessed
 * `itemCount` and `coverUrl`; the service sends `item_count` and
 * `cover_image_url`, so every card read "0 photos" and showed the empty-cover
 * placeholder however many photos the page actually held. Nothing threw. The
 * same mistake was in the groups screen, found the same way: on the device.
 *
 * `position` is deliberately absent. The service orders by it in SQL and does
 * not send it, so the array arrives already in the portfolio's running order.
 */
export type PortfolioProject = {
  id: string;
  title: string;
  tagline: string | null;
  layout: PortfolioLayout | string;
  share_token: string | null;
  revoked_at: string | null;
  /** Signed cover URL, or null when the page has no photos. */
  cover_image_url?: string | null;
  /** How many photos the page holds. */
  item_count?: number;
  slug?: string | null;
  service_type?: string | null;
  city?: string | null;
  state?: string | null;
  on_site?: boolean | null;
  featured?: boolean | null;
  created_at: string;
  updated_at: string;
};

/**
 * Whether the public page is live.
 *
 * The same rule reports use, and for the same reason. Kept as its own function
 * rather than shared with them because the two could diverge: a report is sent
 * to one client, a portfolio project is on a public mini-site, and if the rules
 * ever differ it should be visible in the diff rather than silent.
 */
export function isPublished(
  project: Pick<PortfolioProject, "share_token" | "revoked_at">,
): boolean {
  return Boolean(project.share_token) && !project.revoked_at;
}

/** How many pages are live, for the header. */
export function publishedCount(projects: PortfolioProject[]): number {
  return projects.filter(isPublished).length;
}

/*
 * There is no `orderedPortfolio` here, on purpose.
 *
 * The service orders by `position` then `created_at` in SQL and returns the
 * rows in that order, which is the running order of the public grid. It does
 * not send `position`, so a client-side re-sort had nothing to sort on: it read
 * `undefined` for every row and silently fell back to date order. Preserving
 * the response order is both correct and the only thing that can be correct.
 */

/**
 * The line under a portfolio project's title.
 *
 * Deliberately does NOT say live or draft, though it used to. The card renders
 * a `Badge` reading "Live" or "Draft" immediately to the right of this line, so
 * the row said it twice, in two type sizes, a few points apart. Worse for
 * anybody using a screen reader, which read the sentence and then the badge:
 * "1 photo, Crewe England, live. Live."
 *
 * The badge is the better of the two. It carries the state in colour as well as
 * in words, and it stays put while this line grows with the place name.
 */
export function portfolioSummary(project: PortfolioProject): string {
  const photos = project.item_count ?? 0;
  const parts = [`${photos} photo${photos === 1 ? "" : "s"}`];

  const place = [project.city, project.state].filter(Boolean).join(", ");
  if (place) parts.push(place);

  return parts.join(" · ");
}

export function portfolioTitleError(title: string): string | null {
  const value = title.trim();
  if (!value) return "Give this page a title.";
  // The op caps at 160. Saying so here saves a round trip to be told.
  if (value.length > 160) return "Keep the title under 160 characters.";
  return null;
}

export function taglineError(tagline: string): string | null {
  return tagline.trim().length > 300 ? "Keep the tagline under 300 characters." : null;
}

/**
 * Whether a page is worth publishing.
 *
 * A portfolio project with no photos is a title on an empty page under the
 * company's name, in public. The screen still lets somebody publish it, because
 * it is their call, but it says this first.
 */
export function isPortfolioProjectEmpty(project: PortfolioProject): boolean {
  return (project.item_count ?? 0) === 0;
}

/**
 * The layouts offered, with what each one actually does.
 *
 * Named for the result rather than the CSS. "Masonry" means nothing to a
 * roofer, and the picker is the only place anybody meets these words.
 */
export const LAYOUTS: { id: PortfolioLayout; label: string; hint: string }[] = [
  { id: "grid", label: "Even grid", hint: "Every photo the same size, in rows" },
  { id: "masonry", label: "Mixed heights", hint: "Photos keep their shape, packed together" },
  { id: "featured", label: "Lead photo", hint: "One large photo, the rest smaller beneath" },
];

export function normaliseLayout(value: string | null | undefined): PortfolioLayout {
  return LAYOUTS.some((layout) => layout.id === value) ? (value as PortfolioLayout) : "grid";
}

/*
 * ---------------------------------------------------------------------------
 * The site itself: the layer above the pages.
 *
 * The web's Portfolio page is three tabs (Site, Projects, Embeds) under one
 * publish bar, and the phone now draws the same three. Everything below is the
 * site half, read from `getMyPortfolio` and written through `updatePortfolio`,
 * the same two ops the web calls. Field names are the service's.
 * ---------------------------------------------------------------------------
 */

/** The portfolio row as `getMyPortfolio` returns it. Mirrors `PortfolioDetail` on the web. */
export type PortfolioSite = {
  id: string;
  slug: string;
  business_name: string | null;
  logo_url: string | null;
  accent_color: string | null;
  hero_headline: string | null;
  hero_subhead: string | null;
  hero_photo_id: string | null;
  hero_image_url: string | null;
  about_html: string | null;
  services: string[] | null;
  service_areas: string[] | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  website_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  show_map: boolean;
  show_reviews: boolean;
  published: boolean;
  embed_key: string;
  seo_title: string | null;
  seo_description: string | null;
  google_place_id: string | null;
  google_name: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  google_synced_at: string | null;
};

/** One card on the site, as `getMyPortfolio` lists it. */
export type PortfolioSiteCard = {
  id: string;
  slug: string | null;
  title: string;
  summary: string | null;
  service_type: string | null;
  city: string | null;
  state: string | null;
  completed_on: string | null;
  on_site: boolean;
  featured: boolean;
  is_draft: boolean;
};

export type MyPortfolio = {
  /** Null when the team has no portfolio yet and this user may not create one. */
  portfolio: PortfolioSite | null;
  /** Absent on an older API; treated as allowed, exactly as the web does. */
  canEdit?: boolean;
  showcases: PortfolioSiteCard[];
  serviceTypes: string[];
};

/**
 * The public site's address: `/p/<slug>` on the website, the same path the
 * web's "View site" button opens. Null when the app has no website to point at.
 */
export function portfolioSiteUrl(webBase: string | null, slug: string | null | undefined) {
  if (!webBase || !slug) return null;
  return `${webBase.replace(/\/+$/, "")}/p/${slug}`;
}

/** One project's page on the public site, as the web's "View on site" opens it. */
export function portfolioPageUrl(
  webBase: string | null,
  siteSlug: string | null | undefined,
  pageSlug: string | null | undefined,
) {
  const site = portfolioSiteUrl(webBase, siteSlug);
  return site && pageSlug ? `${site}/${pageSlug}` : null;
}

/** The site form, flat and string-valued so every field can be a text box. */
export type SiteDraft = {
  slug: string;
  businessName: string;
  accentColor: string;
  heroHeadline: string;
  heroSubhead: string;
  about: string;
  services: string;
  serviceAreas: string;
  phone: string;
  email: string;
  address: string;
  websiteUrl: string;
  ctaLabel: string;
  ctaUrl: string;
  showMap: boolean;
  showReviews: boolean;
  seoTitle: string;
  seoDescription: string;
};

/**
 * `about_html` as plain paragraphs, for a phone text box.
 *
 * The web edits it with a rich editor. The phone shows the words and only
 * writes the field back when they were changed, so formatting made on the web
 * survives any save that did not touch the About text.
 */
export function htmlToPlain(html: string | null | undefined): string {
  if (!html) return "";
  return (
    html
      // A paragraph ends in a blank line so `plainToHtml` reads it back as one.
      .replace(/<\/(p|div|h\d)\s*>/gi, "\n\n")
      .replace(/<(br|\/li)\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain paragraphs back to the simple HTML the public site renders. */
export function plainToHtml(text: string): string | null {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  return paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** A comma or line separated list, trimmed and de-duplicated. */
export function parseList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function toSiteDraft(site: PortfolioSite): SiteDraft {
  return {
    slug: site.slug,
    businessName: site.business_name ?? "",
    accentColor: site.accent_color ?? "",
    heroHeadline: site.hero_headline ?? "",
    heroSubhead: site.hero_subhead ?? "",
    about: htmlToPlain(site.about_html),
    services: (site.services ?? []).join(", "),
    serviceAreas: (site.service_areas ?? []).join(", "),
    phone: site.phone ?? "",
    email: site.email ?? "",
    address: site.address ?? "",
    websiteUrl: site.website_url ?? "",
    ctaLabel: site.cta_label ?? "",
    ctaUrl: site.cta_url ?? "",
    showMap: site.show_map,
    showReviews: site.show_reviews,
    seoTitle: site.seo_title ?? "",
    seoDescription: site.seo_description ?? "",
  };
}

/** The `updatePortfolio` input, camelCased the way the op takes it. */
export type PortfolioPatch = {
  slug?: string;
  businessName?: string | null;
  accentColor?: string;
  heroHeadline?: string | null;
  heroSubhead?: string | null;
  aboutHtml?: string | null;
  services?: string[];
  serviceAreas?: string[];
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  websiteUrl?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  showMap?: boolean;
  showReviews?: boolean;
  published?: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Only what changed.
 *
 * Sending the whole form would write back fields the phone cannot show
 * faithfully (the About text's formatting, above all), and a slug that did not
 * move would be re-validated for nothing. So the patch is the difference
 * between the form and the row it was read from, and an untouched form is an
 * empty patch.
 */
export function sitePatch(before: SiteDraft, after: SiteDraft): PortfolioPatch {
  const patch: PortfolioPatch = {};
  const text = (value: string) => value.trim() || null;
  const listChanged = (a: string, b: string) =>
    parseList(a).join("\u0000") !== parseList(b).join("\u0000");

  if (after.slug.trim().toLowerCase() !== before.slug) patch.slug = after.slug.trim().toLowerCase();
  if (after.businessName.trim() !== before.businessName.trim()) {
    patch.businessName = text(after.businessName);
  }
  if (
    after.accentColor.trim() !== before.accentColor.trim() &&
    HEX.test(after.accentColor.trim())
  ) {
    patch.accentColor = after.accentColor.trim();
  }
  if (after.heroHeadline.trim() !== before.heroHeadline.trim()) {
    patch.heroHeadline = text(after.heroHeadline);
  }
  if (after.heroSubhead.trim() !== before.heroSubhead.trim()) {
    patch.heroSubhead = text(after.heroSubhead);
  }
  if (after.about.trim() !== before.about.trim()) patch.aboutHtml = plainToHtml(after.about);
  if (listChanged(after.services, before.services)) patch.services = parseList(after.services);
  if (listChanged(after.serviceAreas, before.serviceAreas)) {
    patch.serviceAreas = parseList(after.serviceAreas);
  }
  if (after.phone.trim() !== before.phone.trim()) patch.phone = text(after.phone);
  if (after.email.trim() !== before.email.trim()) patch.email = text(after.email);
  if (after.address.trim() !== before.address.trim()) patch.address = text(after.address);
  if (after.websiteUrl.trim() !== before.websiteUrl.trim())
    patch.websiteUrl = text(after.websiteUrl);
  if (after.ctaLabel.trim() !== before.ctaLabel.trim()) patch.ctaLabel = text(after.ctaLabel);
  if (after.ctaUrl.trim() !== before.ctaUrl.trim()) patch.ctaUrl = text(after.ctaUrl);
  if (after.showMap !== before.showMap) patch.showMap = after.showMap;
  if (after.showReviews !== before.showReviews) patch.showReviews = after.showReviews;
  if (after.seoTitle.trim() !== before.seoTitle.trim()) patch.seoTitle = text(after.seoTitle);
  if (after.seoDescription.trim() !== before.seoDescription.trim()) {
    patch.seoDescription = text(after.seoDescription);
  }
  return patch;
}

/**
 * What is wrong with the form, before the op says it.
 *
 * The limits are the op's (`updatePortfolioInputSchema`); the slug rule is the
 * shape `checkPortfolioSlug` accepts. Returned per field so each message sits
 * under the box it is about.
 */
export function siteDraftErrors(draft: SiteDraft): Partial<Record<keyof SiteDraft, string>> {
  const errors: Partial<Record<keyof SiteDraft, string>> = {};
  const slug = draft.slug.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(slug)) {
    errors.slug = "Use 3 to 50 lowercase letters, numbers or hyphens.";
  }
  if (draft.accentColor.trim() && !HEX.test(draft.accentColor.trim())) {
    errors.accentColor = "Use a colour like #2563eb.";
  }
  if (draft.businessName.trim().length > 160) errors.businessName = "Keep it under 160 characters.";
  if (draft.heroHeadline.trim().length > 200) errors.heroHeadline = "Keep it under 200 characters.";
  if (draft.heroSubhead.trim().length > 400) errors.heroSubhead = "Keep it under 400 characters.";
  if (parseList(draft.services).length > 24) errors.services = "Up to 24 services.";
  if (parseList(draft.serviceAreas).length > 40) errors.serviceAreas = "Up to 40 areas.";
  if (draft.ctaLabel.trim().length > 60) errors.ctaLabel = "Keep it under 60 characters.";
  if (draft.seoTitle.trim().length > 70) errors.seoTitle = "Search engines cut titles at about 70.";
  if (draft.seoDescription.trim().length > 200) {
    errors.seoDescription = "Keep it under 200 characters.";
  }
  for (const key of ["websiteUrl", "ctaUrl"] as const) {
    const value = draft[key].trim();
    if (value && !/^https?:\/\/\S+\.\S+/i.test(value)) errors[key] = "Start the link with https://";
  }
  return errors;
}

/**
 * How a card reads on the site, in the web's words.
 *
 * A page that is not published cannot be listed however its switch is set, so
 * "Draft" wins; then "On site" or "Hidden" by the switch.
 */
export function siteListingLabel(card: {
  on_site?: boolean | null;
  revoked_at?: string | null;
}): "Draft" | "On site" | "Hidden" {
  if (card.revoked_at) return "Draft";
  return card.on_site ? "On site" : "Hidden";
}

/** One slot up or down, for the reorder buttons that stand in for the web's drag. */
export function movedIds(ids: string[], id: string, direction: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** The options the web's embed panel offers, and its defaults. */
export type EmbedOptions = {
  columns: "2" | "3" | "4";
  limit: "12" | "24" | "60";
  filters: boolean;
  mapHeight: "360" | "460" | "600";
  pinColor: boolean;
};

export const DEFAULT_EMBED_OPTIONS: EmbedOptions = {
  columns: "3",
  limit: "24",
  filters: true,
  mapHeight: "460",
  pinColor: true,
};

/** The gallery snippet, line for line what the web's Embeds tab copies. */
export function gallerySnippet(webBase: string, embedKey: string, options: EmbedOptions): string {
  return [
    `<script async src="${webBase}/embed.js"`,
    `  data-everlumen="gallery"`,
    `  data-key="${embedKey}"`,
    `  data-columns="${options.columns}"`,
    `  data-limit="${options.limit}"`,
    ...(options.filters ? [] : [`  data-filters="0"`]),
    `></script>`,
  ].join("\n");
}

/** The map snippet, line for line what the web's Embeds tab copies. */
export function mapSnippet(
  webBase: string,
  embedKey: string,
  accentColor: string | null,
  options: EmbedOptions,
): string {
  return [
    `<script async src="${webBase}/embed.js"`,
    `  data-everlumen="map"`,
    `  data-key="${embedKey}"`,
    `  data-height="${options.mapHeight}"`,
    ...(options.pinColor && accentColor ? [`  data-pin="${accentColor}"`] : []),
    `></script>`,
  ].join("\n");
}

/** The fields a connected Google listing can fill in, as `connectGoogleBusiness` names them. */
export type GoogleApplyField =
  | "businessName"
  | "phone"
  | "address"
  | "websiteUrl"
  | "services"
  | "serviceAreas"
  | "heroSubhead";

export const GOOGLE_APPLY_FIELDS: { id: GoogleApplyField; label: string }[] = [
  { id: "businessName", label: "Business name" },
  { id: "phone", label: "Phone" },
  { id: "address", label: "Address" },
  { id: "websiteUrl", label: "Website" },
  { id: "services", label: "Services" },
  { id: "serviceAreas", label: "Service area" },
  { id: "heroSubhead", label: "Intro line" },
];

/**
 * Which listing fields to copy by default: only the ones the site has left
 * empty, so connecting never overwrites something somebody typed on purpose.
 */
export function defaultGoogleApply(site: PortfolioSite): GoogleApplyField[] {
  const empty: Record<GoogleApplyField, boolean> = {
    businessName: !site.business_name,
    phone: !site.phone,
    address: !site.address,
    websiteUrl: !site.website_url,
    services: (site.services ?? []).length === 0,
    serviceAreas: (site.service_areas ?? []).length === 0,
    heroSubhead: !site.hero_subhead,
  };
  return GOOGLE_APPLY_FIELDS.map((f) => f.id).filter((id) => empty[id]);
}

/** A review link as `listReviewLinks` returns it. */
export type ReviewLink = {
  id?: string;
  platform: "google" | "nicejob" | "custom";
  url: string;
  label: string | null;
};

/** The extra links worth sending: an http(s) address, trimmed. Google's own rows pass through. */
export function reviewLinksToSave(rows: ReviewLink[]): ReviewLink[] {
  return rows
    .map((row) => ({ ...row, url: row.url.trim(), label: row.label?.trim() || null }))
    .filter((row) => /^https?:\/\//i.test(row.url));
}

/**
 * The site's sections, in the order and words of the web's site editor
 * (`SITE_STEPS` in `PortfolioSiteSteps.tsx`).
 *
 * The web shows one section at a time behind a trail of ticks; the phone
 * shows the same list as rows and opens one section in a sheet. Each field of
 * `SiteDraft` belongs to exactly one section, so an error can say where it is.
 */
export type SiteSectionId =
  | "business"
  | "services"
  | "cover"
  | "areas"
  | "about"
  | "reviews"
  | "contact"
  | "address";

export const SITE_SECTIONS: {
  id: SiteSectionId;
  label: string;
  question: string;
  hint: string;
  optional?: boolean;
  fields: (keyof SiteDraft)[];
}[] = [
  {
    id: "business",
    label: "Business",
    question: "What's your business called?",
    hint: "Your name and colour set the tone for every page on the site.",
    fields: ["businessName", "accentColor"],
  },
  {
    id: "services",
    label: "What you do",
    question: "What work do you want to be known for?",
    hint: "These become the headline trades and the filters over your projects.",
    fields: ["services"],
  },
  {
    id: "cover",
    label: "Cover",
    question: "What should greet a visitor?",
    hint: "The headline over the photo at the top of the site.",
    fields: ["heroHeadline", "heroSubhead"],
  },
  {
    id: "areas",
    label: "Where you work",
    question: "Where do you work?",
    hint: "Shown beside the map, and it is what wins local searches.",
    optional: true,
    fields: ["serviceAreas", "showMap"],
  },
  {
    id: "about",
    label: "About",
    question: "Who's behind the work?",
    hint: "A short paragraph does more than a long one.",
    optional: true,
    fields: ["about"],
  },
  {
    id: "reviews",
    label: "Reviews",
    question: "Where do people review you?",
    hint: "Connect Google once and it feeds your site and the review ask on every job report.",
    optional: true,
    fields: ["showReviews"],
  },
  {
    id: "contact",
    label: "Contact",
    question: "How should they reach you?",
    hint: "This fills the header button, the contact band and the footer.",
    fields: ["phone", "email", "address", "ctaLabel", "ctaUrl", "websiteUrl"],
  },
  {
    id: "address",
    label: "Web address",
    question: "Where should your site live?",
    hint: "The link you text to customers, and how search engines show it.",
    fields: ["slug", "seoTitle", "seoDescription"],
  },
];

/** Whether a section has something in it, by the web's `isDone` rules. */
export function siteSectionDone(
  id: SiteSectionId,
  draft: SiteDraft,
  site: Pick<PortfolioSite, "hero_photo_id" | "google_place_id">,
): boolean {
  switch (id) {
    case "business":
      return draft.businessName.trim().length > 0;
    case "services":
      return parseList(draft.services).length > 0;
    case "cover":
      return !!site.hero_photo_id || draft.heroHeadline.trim().length > 0;
    case "areas":
      return parseList(draft.serviceAreas).length > 0;
    case "about":
      return draft.about.trim().length > 0;
    case "reviews":
      return !!site.google_place_id;
    case "contact":
      return !!(draft.phone.trim() || draft.email.trim());
    case "address":
      return true;
  }
}

/** "5 of 7": the web counts every section but the address, which always has a value. */
export function siteSectionProgress(
  draft: SiteDraft,
  site: Pick<PortfolioSite, "hero_photo_id" | "google_place_id">,
): { done: number; total: number } {
  const counted = SITE_SECTIONS.filter((s) => s.id !== "address");
  return {
    done: counted.filter((s) => siteSectionDone(s.id, draft, site)).length,
    total: counted.length,
  };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One short line under a section's row: what is there now, so nobody opens it to find out. */
export function siteSectionSummary(
  id: SiteSectionId,
  draft: SiteDraft,
  site: Pick<PortfolioSite, "hero_photo_id" | "google_place_id" | "google_rating">,
): string {
  switch (id) {
    case "business":
      return draft.businessName.trim() || "Not named yet";
    case "services": {
      const list = parseList(draft.services);
      return list.length === 0
        ? "None yet"
        : list.slice(0, 3).join(", ") + (list.length > 3 ? ` and ${list.length - 3} more` : "");
    }
    case "cover":
      return draft.heroHeadline.trim() || (site.hero_photo_id ? "Photo chosen" : "Not set");
    case "areas": {
      const n = parseList(draft.serviceAreas).length;
      return `${n === 0 ? "No areas yet" : count(n, "area", "areas")}, map ${draft.showMap ? "on" : "off"}`;
    }
    case "about": {
      const text = draft.about.trim().replace(/\s+/g, " ");
      return text ? (text.length > 60 ? `${text.slice(0, 57)}...` : text) : "Not written yet";
    }
    case "reviews":
      if (!site.google_place_id) return draft.showReviews ? "Google not connected" : "Off";
      return site.google_rating != null
        ? `Google, ${site.google_rating.toFixed(1)} stars`
        : "Google connected";
    case "contact":
      return draft.phone.trim() || draft.email.trim() || "Not set";
    case "address":
      return `/p/${draft.slug.trim().toLowerCase()}`;
  }
}

/** The first section holding an error, so Save can open it. */
export function sectionWithError(
  errors: Partial<Record<keyof SiteDraft, string>>,
): SiteSectionId | null {
  const keys = Object.keys(errors) as (keyof SiteDraft)[];
  return SITE_SECTIONS.find((s) => s.fields.some((f) => keys.includes(f)))?.id ?? null;
}
