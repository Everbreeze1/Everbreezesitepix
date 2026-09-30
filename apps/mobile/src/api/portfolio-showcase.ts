import {
  humanizeServiceType,
  looksLikeStreetAddress,
  withoutStreetAddress,
} from "@everlumen/shared";
import { visibleText } from "./rich-doc";

/**
 * One portfolio page's builder, as rules.
 *
 * The web's `ShowcaseBuilderPage` is a cover, an opening, the work (sections of
 * photos from jobs), a closing and a design panel, saved together by one Save;
 * beside it `ShowcaseSiteCard` holds the page's own site listing (its address,
 * service, summary, products, place and completion date), saved separately.
 * The phone keeps both halves and both saves, so a change to the listing can
 * never publish half-written copy and the other way round.
 *
 * Field names are the service's (`getShowcase`, `updateShowcase`,
 * `setShowcaseSections`, `updateShowcaseSite`). No import here reaches React
 * Native, so the rules can be tested.
 *
 * The word on screen is "project" or "page", never the table's name.
 */

export const DEFAULT_ACCENT = "#2563eb";

export type ShowcaseItem = {
  id?: string;
  photo_id: string;
  caption: string | null;
  position?: number;
  image_url: string;
};

export type ShowcaseSection = {
  id: string;
  project_id: string | null;
  project_name: string | null;
  title: string | null;
  body_html: string | null;
  position?: number;
  items: ShowcaseItem[];
};

/** A page as `getShowcase` returns it. */
export type ShowcaseDetail = {
  id: string;
  title: string;
  tagline: string | null;
  layout: string;
  share_token: string | null;
  revoked_at: string | null;
  intro_html: string | null;
  outro_html: string | null;
  accent_color: string | null;
  show_contact: boolean;
  show_reviews: boolean;
  cover_photo_id: string | null;
  cover_image_url: string | null;
  sections: ShowcaseSection[];
  slug: string | null;
  service_type: string | null;
  products_used: string[] | null;
  summary: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  on_site: boolean;
  featured: boolean;
  completed_on: string | null;
};

export type BuilderLayout = "grid" | "masonry" | "featured";

export type BuilderItem = { photoId: string; caption: string; imageUrl: string };

export type BuilderSection = {
  /** Client-side only: the service regenerates section ids on every save. */
  key: string;
  projectId: string | null;
  projectName: string | null;
  title: string;
  bodyHtml: string;
  items: BuilderItem[];
};

/** Everything the builder's one Save writes. */
export type BuilderDraft = {
  title: string;
  tagline: string;
  layout: BuilderLayout;
  accentColor: string;
  showContact: boolean;
  showReviews: boolean;
  introHtml: string;
  outroHtml: string;
  coverPhotoId: string | null;
  /** For drawing the cover only; never sent. */
  coverImageUrl: string | null;
  sections: BuilderSection[];
};

let keySeq = 0;
export function sectionKey(): string {
  keySeq += 1;
  return `sec-${keySeq}`;
}

function layoutOf(value: string | null | undefined): BuilderLayout {
  return value === "masonry" || value === "featured" ? value : "grid";
}

export function toBuilderDraft(detail: ShowcaseDetail): BuilderDraft {
  return {
    title: detail.title,
    tagline: detail.tagline ?? "",
    layout: layoutOf(detail.layout),
    accentColor: detail.accent_color || DEFAULT_ACCENT,
    showContact: detail.show_contact,
    showReviews: detail.show_reviews,
    introHtml: detail.intro_html ?? "",
    outroHtml: detail.outro_html ?? "",
    coverPhotoId: detail.cover_photo_id,
    coverImageUrl: detail.cover_image_url,
    sections: detail.sections.map((section) => ({
      key: sectionKey(),
      projectId: section.project_id,
      projectName: section.project_name,
      title: section.title ?? "",
      bodyHtml: section.body_html ?? "",
      items: section.items.map((item) => ({
        photoId: item.photo_id,
        caption: item.caption ?? "",
        imageUrl: item.image_url,
      })),
    })),
  };
}

/**
 * The saved shape of a draft, for the dirty flag: the web's `makeSnapshot`,
 * field for field. Section keys and the cover's display URL are left out
 * because neither is saved.
 */
export function builderSnapshot(draft: BuilderDraft): string {
  return JSON.stringify({
    title: draft.title,
    tagline: draft.tagline,
    layout: draft.layout,
    accentColor: draft.accentColor,
    showContact: draft.showContact,
    showReviews: draft.showReviews,
    introHtml: draft.introHtml,
    outroHtml: draft.outroHtml,
    coverPhotoId: draft.coverPhotoId,
    sections: draft.sections.map((s) => ({
      p: s.projectId,
      t: s.title,
      b: s.bodyHtml,
      i: s.items.map((it) => [it.photoId, it.caption]),
    })),
  });
}

const HEX = /^#[0-9a-f]{6}$/i;

/** What stops a Save, before the service says it. Limits are the ops'. */
export function builderErrors(draft: BuilderDraft): string[] {
  const errors: string[] = [];
  if (draft.title.trim().length > 160) errors.push("Keep the title under 160 characters.");
  if (draft.tagline.trim().length > 300) errors.push("Keep the tagline under 300 characters.");
  if (!HEX.test(draft.accentColor.trim())) errors.push("Use a brand colour like #2563eb.");
  if (draft.introHtml.length > 20_000) errors.push("The opening is too long.");
  if (draft.outroHtml.length > 20_000) errors.push("The closing is too long.");
  if (draft.sections.length > 50) errors.push("Up to 50 sections.");
  draft.sections.forEach((s, i) => {
    const name = s.title.trim() || `Section ${i + 1}`;
    if (s.title.trim().length > 200) errors.push(`${name}: keep the heading under 200 characters.`);
    if (s.bodyHtml.length > 20_000) errors.push(`${name}: the text is too long.`);
    if (s.items.length > 200) errors.push(`${name}: up to 200 photos.`);
    if (s.items.some((it) => it.caption.trim().length > 500)) {
      errors.push(`${name}: keep each caption under 500 characters.`);
    }
  });
  return errors;
}

/** The two writes behind one Save, in the web's words and order. */
export function builderPayload(id: string, draft: BuilderDraft) {
  return {
    showcase: {
      id,
      title: draft.title.trim() || "Untitled project",
      tagline: draft.tagline.trim() || null,
      layout: draft.layout,
      accentColor: draft.accentColor.trim(),
      showContact: draft.showContact,
      showReviews: draft.showReviews,
      introHtml: draft.introHtml || null,
      outroHtml: draft.outroHtml || null,
      coverPhotoId: draft.coverPhotoId,
    },
    sections: {
      showcaseId: id,
      sections: draft.sections.map((s) => ({
        projectId: s.projectId,
        title: s.title.trim() || null,
        bodyHtml: s.bodyHtml || null,
        items: s.items.map((it) => ({ photoId: it.photoId, caption: it.caption.trim() || null })),
      })),
    },
  };
}

/** The cover as the public page draws it: the chosen one, else the first photo. */
export function coverPreview(draft: BuilderDraft): string | null {
  if (draft.coverImageUrl) return draft.coverImageUrl;
  for (const section of draft.sections) {
    const first = section.items.find((it) => it.imageUrl);
    if (first) return first.imageUrl;
  }
  return null;
}

export function photoCount(draft: Pick<BuilderDraft, "sections">): number {
  return draft.sections.reduce((n, s) => n + s.items.length, 0);
}

/** One place up or down in a list; the web's arrow buttons, since a phone has no drag. */
export function moved<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) {
    return list.slice();
  }
  const next = list.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** A photo as the picker hands it back. */
export type PickedPhoto = {
  id: string;
  imageUrl: string;
  projectId: string;
  projectName: string;
};

/** "Add from a job": one new section per job, titled with its name, as the web builds them. */
export function sectionsFromPicked(picked: PickedPhoto[]): BuilderSection[] {
  const byProject = new Map<string, PickedPhoto[]>();
  for (const photo of picked) {
    const list = byProject.get(photo.projectId);
    if (list) list.push(photo);
    else byProject.set(photo.projectId, [photo]);
  }
  return Array.from(byProject.entries()).map(([projectId, photos]) => ({
    key: sectionKey(),
    projectId,
    projectName: photos[0]?.projectName ?? null,
    title: photos[0]?.projectName ?? "",
    bodyHtml: "",
    items: photos.map((p) => ({ photoId: p.id, caption: "", imageUrl: p.imageUrl })),
  }));
}

/** Photos added to a section, skipping any it already holds. */
export function addPhotosToSection(
  section: BuilderSection,
  picked: PickedPhoto[],
): { section: BuilderSection; added: number } {
  const existing = new Set(section.items.map((it) => it.photoId));
  const fresh = picked.filter((p) => !existing.has(p.id));
  return {
    section: {
      ...section,
      items: [
        ...section.items,
        ...fresh.map((p) => ({ photoId: p.id, caption: "", imageUrl: p.imageUrl })),
      ],
    },
    added: fresh.length,
  };
}

/** The job the builder's pickers open on: the one the page was built from. */
export function defaultPickerProject(draft: Pick<BuilderDraft, "sections">): string | null {
  return draft.sections.find((s) => s.projectId)?.projectId ?? null;
}

/** A short line of the text in some stored HTML, for a collapsed row. */
export function htmlSummary(html: string, empty: string, max = 80): string {
  const text = visibleText(html);
  if (!text) return empty;
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/* ------------------------------------------------------------------------ */
/* The builder's parts: what the phone lists, and the tablet puts beside.    */
/* ------------------------------------------------------------------------ */

export type BuilderPartId = "cover" | "opening" | "work" | "closing" | "design" | "listing";

export const BUILDER_PARTS: { id: BuilderPartId; label: string; hint: string }[] = [
  {
    id: "cover",
    label: "Cover",
    hint: "The masthead of this project's page, and the thumbnail on your portfolio grid.",
  },
  {
    id: "opening",
    label: "Opening",
    hint: "Introduce the company: who you are, what you do, why prospects should call you.",
  },
  {
    id: "work",
    label: "Your work",
    hint: "Sections of photos from your jobs, each with a heading and a few lines.",
  },
  {
    id: "closing",
    label: "Closing",
    hint: "A call to action: free estimates, service area, what to do next.",
  },
  {
    id: "design",
    label: "Design",
    hint: "The photo layout, the brand colour, and what shows at the bottom.",
  },
  {
    id: "listing",
    label: "On your site",
    hint: "How this project appears in your portfolio's grid, filters and map. Saved on its own.",
  },
];

export function builderPartSummary(id: BuilderPartId, draft: BuilderDraft, listing?: ListingDraft) {
  switch (id) {
    case "cover":
      return draft.coverPhotoId ? "Cover photo chosen" : "Using the first photo";
    case "opening":
      return htmlSummary(draft.introHtml, "Not written yet");
    case "work": {
      const n = draft.sections.length;
      const photos = photoCount(draft);
      return `${n} section${n === 1 ? "" : "s"}, ${photos} photo${photos === 1 ? "" : "s"}`;
    }
    case "closing":
      return htmlSummary(draft.outroHtml, "Not written yet");
    case "design": {
      const layout = BUILDER_LAYOUTS.find((l) => l.id === draft.layout)?.label ?? "Grid";
      return `${layout}, ${draft.accentColor.trim()}`;
    }
    case "listing":
      if (!listing) return "";
      return [
        listing.onSite ? "Listed" : "Hidden",
        listing.serviceType.trim(),
        listing.featured ? "Featured" : "",
      ]
        .filter(Boolean)
        .join(", ");
  }
}

/** The web's three layouts, named as its Design panel names them. */
export const BUILDER_LAYOUTS: { id: BuilderLayout; label: string; hint: string }[] = [
  { id: "grid", label: "Grid", hint: "Every photo the same size, in rows" },
  { id: "masonry", label: "Masonry", hint: "Photos keep their shape, packed together" },
  { id: "featured", label: "Featured + grid", hint: "One large photo, the rest smaller beneath" },
];

/** A few colours one tap away. Anything else is typed as #rrggbb. */
export const ACCENT_SWATCHES = [
  "#2563eb",
  "#0f766e",
  "#16a34a",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#7c3aed",
  "#111827",
];

export function isHexColour(value: string): boolean {
  return HEX.test(value.trim());
}

/* ------------------------------------------------------------------------ */
/* The page's site listing: the web's ShowcaseSiteCard.                     */
/* ------------------------------------------------------------------------ */

export type ListingDraft = {
  slug: string;
  serviceType: string;
  productsUsed: string[];
  summary: string;
  city: string;
  state: string;
  completedOn: string;
  onSite: boolean;
  featured: boolean;
  latitude: number | null;
  longitude: number | null;
};

export function toListingDraft(detail: ShowcaseDetail): ListingDraft {
  return {
    slug: detail.slug ?? "",
    serviceType: detail.service_type ?? "",
    productsUsed: detail.products_used ?? [],
    summary: detail.summary ?? "",
    city: detail.city ?? "",
    state: detail.state ?? "",
    completedOn: detail.completed_on ?? "",
    onSite: detail.on_site,
    featured: detail.featured,
    latitude: detail.latitude,
    longitude: detail.longitude,
  };
}

export function listingSnapshot(draft: ListingDraft): string {
  return JSON.stringify(draft);
}

/** Per field, so each message sits under its box. Limits are `updateShowcaseSite`'s. */
export function listingErrors(draft: ListingDraft): Partial<Record<keyof ListingDraft, string>> {
  const errors: Partial<Record<keyof ListingDraft, string>> = {};
  if (draft.slug.trim().length > 60) errors.slug = "Keep the address under 60 characters.";
  if (draft.serviceType.trim().length > 80) errors.serviceType = "Keep it under 80 characters.";
  if (draft.summary.trim().length > 300) errors.summary = "Keep it under 300 characters.";
  if (draft.city.trim().length > 120) errors.city = "Keep it under 120 characters.";
  if (draft.state.trim().length > 60) errors.state = "Keep it under 60 characters.";
  if (draft.productsUsed.length > 24) errors.productsUsed = "Up to 24 products.";
  const done = draft.completedOn.trim();
  if (done && !/^\d{4}-\d{2}-\d{2}$/.test(done)) errors.completedOn = "Use YYYY-MM-DD";
  return errors;
}

/** The `updateShowcaseSite` input, all of it, as the web's card sends it. */
export function listingPayload(id: string, draft: ListingDraft) {
  return {
    id,
    slug: draft.slug.trim().toLowerCase() || null,
    serviceType: humanizeServiceType(draft.serviceType) || null,
    productsUsed: draft.productsUsed,
    summary: draft.summary.trim() || null,
    city: draft.city.trim() || null,
    state: draft.state.trim() || null,
    completedOn: draft.completedOn.trim() || null,
    onSite: draft.onSite,
    featured: draft.featured,
    latitude: draft.latitude,
    longitude: draft.longitude,
  };
}

/**
 * The service types already used on the site, tidied, sorted and capped, so
 * the filter row on the public grid stays short. The web's `ServiceTypePicker`.
 */
export function serviceTypeOptions(suggestions: string[]): string[] {
  return Array.from(new Set(suggestions.map((s) => humanizeServiceType(s)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 12);
}

/** Products as tags: a comma or line list, trimmed, de-duplicated, capped at 24. */
export function parseProducts(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const value = raw.trim().slice(0, 80);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out.slice(0, 24);
}

/**
 * The privacy check on a line that publishes where a customer lives.
 *
 * The web's `AddressPrivacyNotice`: a summary or tagline that looks like a
 * street address gets a one-tap "Use the town only". Null when the line is fine.
 */
export function townOnly(value: string, city: string, state: string): string | null {
  if (!looksLikeStreetAddress(value)) return null;
  const stripped = withoutStreetAddress(value);
  const place = [city.trim(), state.trim()].filter(Boolean).join(", ");
  return stripped || place;
}

/** Where a pin is, in words a person can check. */
export function pinLabel(latitude: number | null, longitude: number | null): string {
  if (latitude == null || longitude == null) return "No pin. The town places it on the map.";
  return `Pinned at ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

/** The page's own public address, as the web's card prints it. */
export function pagePath(siteSlug: string | null | undefined, pageSlug: string): string {
  return `/p/${siteSlug || "your-site"}/${pageSlug.trim().toLowerCase() || "..."}`;
}
