import { z } from "zod";
import { normalizeExternalUrl } from "@sitepix/shared";
import { getSupabaseAdmin } from "../../lib/supabase";
import {
  loadSections,
  resolvePhotoUrls,
  SHOWCASE_PHOTO_WIDTH,
  type ShowcaseSectionDetail,
} from "../showcases/service";
import {
  SHOWCASE_CARD_COLUMNS,
  compareCardRows,
  loadShowcaseCards,
  type PortfolioShowcaseCard,
  type ShowcaseCardRow,
} from "./cards";

/**
 * Anonymous reads for the portfolio mini-site and its website embeds.
 *
 * Everything here runs on the service-role client, exactly like the existing
 * public report / page / showcase reads. The visibility rules therefore live in
 * ONE place - `visibleShowcaseRows` below - instead of being spread across RLS
 * predicates that are hard to audit and easy to widen by accident.
 *
 * Nothing in this file returns a row id, storage path, team id or user id. The
 * public surface is slugs and signed URLs only.
 */

export interface PublicPortfolioSite {
  slug: string;
  business_name: string | null;
  logo_url: string | null;
  accent_color: string | null;
  hero_headline: string | null;
  hero_subhead: string | null;
  hero_image_url: string | null;
  about_html: string | null;
  services: string[];
  service_areas: string[];
  phone: string | null;
  email: string | null;
  address: string | null;
  website_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  show_map: boolean;
  show_reviews: boolean;
  seo_title: string | null;
  seo_description: string | null;
  /**
   * The public half of a connected Google Business Profile. Only the rating,
   * the count and the two links are exposed - place_id is an internal handle
   * and belongs in the admin surface, not on an anonymous page.
   */
  google_rating: number | null;
  google_review_count: number | null;
  google_reviews_url: string | null;
  google_review_ask_url: string | null;
}

export interface PortfolioReviewLink {
  url: string;
  label: string | null;
  platform: string;
}

export interface PublicPortfolio {
  status: "ok" | "not_found" | "unpublished";
  site: PublicPortfolioSite | null;
  showcases: PortfolioShowcaseCard[];
  /** Service types actually present on published work - these are the filters. */
  serviceTypes: string[];
  /** Distinct "City, ST" strings, for the areas-served list. */
  locations: string[];
  stats: { projects: number; photos: number; areas: number };
  reviewLinks: PortfolioReviewLink[];
}

export interface PublicPortfolioShowcase {
  status: "ok" | "not_found" | "unpublished";
  site: PublicPortfolioSite | null;
  showcase: {
    slug: string;
    title: string;
    tagline: string | null;
    summary: string | null;
    service_type: string | null;
    products_used: string[];
    city: string | null;
    state: string | null;
    completed_on: string | null;
    layout: string;
    intro_html: string | null;
    outro_html: string | null;
    accent_color: string | null;
    show_contact: boolean;
    show_reviews: boolean;
    cover_image_url: string | null;
    sections: ShowcaseSectionDetail[];
  } | null;
  /** Walk to the neighbouring project without going back to the grid. */
  prev: { slug: string; title: string; cover_image_url: string | null } | null;
  next: { slug: string; title: string; cover_image_url: string | null } | null;
  /** Same service type, for the "more like this" strip. */
  related: PortfolioShowcaseCard[];
  reviewLinks: PortfolioReviewLink[];
}

export interface PortfolioEmbedData {
  status: "ok" | "not_found" | "unpublished";
  site_url: string | null;
  slug: string | null;
  business_name: string | null;
  accent_color: string | null;
  showcases: PortfolioShowcaseCard[];
  serviceTypes: string[];
}

const PORTFOLIO_COLUMNS =
  "id, team_id, slug, business_name, logo_url, accent_color, hero_headline, hero_subhead, hero_photo_id, about_html, services, service_areas, phone, email, address, website_url, cta_label, cta_url, show_map, show_reviews, published, seo_title, seo_description, google_rating, google_review_count, google_reviews_url, google_review_ask_url";

function toSite(row: any, heroImageUrl: string | null): PublicPortfolioSite {
  return {
    slug: row.slug,
    business_name: row.business_name ?? null,
    logo_url: row.logo_url ?? null,
    accent_color: row.accent_color ?? null,
    hero_headline: row.hero_headline ?? null,
    hero_subhead: row.hero_subhead ?? null,
    hero_image_url: heroImageUrl,
    about_html: row.about_html ?? null,
    services: row.services ?? [],
    service_areas: row.service_areas ?? [],
    phone: row.phone ?? null,
    email: row.email ?? null,
    address: row.address ?? null,
    // Repaired on the way out, not just on the way in: a site saved before the
    // write path checked these is live right now with "acmeroofing.com" in its
    // header button, and that link resolves against /p/<slug> and 404s.
    website_url: normalizeExternalUrl(row.website_url),
    cta_label: row.cta_label ?? null,
    cta_url: normalizeExternalUrl(row.cta_url),
    show_map: row.show_map ?? true,
    show_reviews: row.show_reviews ?? true,
    seo_title: row.seo_title ?? null,
    seo_description: row.seo_description ?? null,
    // Gated by the same switch as the review links: a site with reviews turned
    // off must not still be advertising a star rating.
    google_rating:
      row.show_reviews === false || row.google_rating == null ? null : Number(row.google_rating),
    google_review_count: row.show_reviews === false ? null : (row.google_review_count ?? null),
    google_reviews_url: row.show_reviews === false ? null : (row.google_reviews_url ?? null),
    google_review_ask_url: row.show_reviews === false ? null : (row.google_review_ask_url ?? null),
  };
}

/**
 * THE visibility rule for everything anonymous. A showcase is on the site only
 * when all four hold:
 *
 *   on_site           the owner listed it,
 *   revoked_at IS NULL the showcase itself isn't a draft,
 *   slug IS NOT NULL   it has an address to route to,
 *   items > 0          it isn't an empty shell (checked by the caller via
 *                      photo_count, since it needs the item rows anyway).
 *
 * Ordering matches compareCardRows so the grid, map and embeds agree.
 */
async function visibleShowcaseRows(teamId: string): Promise<ShowcaseCardRow[]> {
  const admin = getSupabaseAdmin();
  const { data } = await (admin as any)
    .from("showcases")
    .select(SHOWCASE_CARD_COLUMNS)
    .eq("team_id", teamId)
    .eq("on_site", true)
    .is("revoked_at", null)
    .not("slug", "is", null);
  return ((data as ShowcaseCardRow[]) ?? []).slice().sort(compareCardRows);
}

async function loadReviewLinks(teamId: string, enabled: boolean): Promise<PortfolioReviewLink[]> {
  if (!enabled) return [];
  const { data } = await (getSupabaseAdmin() as any)
    .from("team_review_links")
    .select("platform, url, label, position")
    .eq("team_id", teamId)
    .order("position", { ascending: true });
  return ((data as any[]) ?? []).map((r) => ({
    url: r.url as string,
    label: (r.label as string | null) ?? null,
    platform: r.platform as string,
  }));
}

function locationLabel(card: { city: string | null; state: string | null }): string | null {
  const label = [card.city?.trim(), card.state?.trim()].filter(Boolean).join(", ");
  return label || null;
}

/** Cards with no photo are hidden: an empty tile makes a portfolio look broken. */
function listable(cards: PortfolioShowcaseCard[]): PortfolioShowcaseCard[] {
  return cards.filter((c) => c.photo_count > 0);
}

export const publicPortfolioInputSchema = z.object({
  slug: z.string().trim().toLowerCase().min(1).max(60),
});

export async function getPublicPortfolioService(
  data: z.infer<typeof publicPortfolioInputSchema>,
): Promise<PublicPortfolio> {
  const empty = {
    site: null,
    showcases: [],
    serviceTypes: [],
    locations: [],
    stats: { projects: 0, photos: 0, areas: 0 },
    reviewLinks: [],
  };
  const admin = getSupabaseAdmin();
  const { data: row } = await (admin as any)
    .from("portfolios")
    .select(PORTFOLIO_COLUMNS)
    .eq("slug", data.slug)
    .maybeSingle();
  if (!row) return { status: "not_found", ...empty };
  if (!row.published) return { status: "unpublished", ...empty };

  const [rows, heroUrl, reviewLinks] = await Promise.all([
    visibleShowcaseRows(row.team_id),
    row.hero_photo_id
      ? resolvePhotoUrls([row.hero_photo_id], SHOWCASE_PHOTO_WIDTH).then(
          (m) => m.get(row.hero_photo_id)?.image_url || null,
        )
      : Promise.resolve(null),
    loadReviewLinks(row.team_id, row.show_reviews ?? true),
  ]);

  const showcases = listable(await loadShowcaseCards(admin, rows));
  const locations = Array.from(
    new Set(showcases.map(locationLabel).filter((s): s is string => !!s)),
  ).sort((a, b) => a.localeCompare(b));

  return {
    status: "ok",
    // Falls back to the newest project's cover so a portfolio always has a hero,
    // even before the owner picks one - same reasoning as the showcase masthead.
    site: toSite(row, heroUrl ?? showcases[0]?.cover_image_url ?? null),
    showcases,
    serviceTypes: Array.from(
      new Set(showcases.map((c) => c.service_type).filter((s): s is string => !!s?.trim())),
    ).sort((a, b) => a.localeCompare(b)),
    locations,
    stats: {
      projects: showcases.length,
      photos: showcases.reduce((n, c) => n + c.photo_count, 0),
      areas: locations.length,
    },
    reviewLinks,
  };
}

export const publicPortfolioShowcaseInputSchema = z.object({
  slug: z.string().trim().toLowerCase().min(1).max(60),
  showcaseSlug: z.string().trim().toLowerCase().min(1).max(60),
});

export async function getPublicPortfolioShowcaseService(
  data: z.infer<typeof publicPortfolioShowcaseInputSchema>,
): Promise<PublicPortfolioShowcase> {
  const empty = {
    site: null,
    showcase: null,
    prev: null,
    next: null,
    related: [],
    reviewLinks: [],
  };
  const admin = getSupabaseAdmin();
  const { data: row } = await (admin as any)
    .from("portfolios")
    .select(PORTFOLIO_COLUMNS)
    .eq("slug", data.slug)
    .maybeSingle();
  if (!row) return { status: "not_found", ...empty };
  if (!row.published) return { status: "unpublished", ...empty };

  // The full visible list is loaded regardless of which project was asked for,
  // because prev/next and "more like this" both need it. It is one indexed
  // query over a team's own showcases, so this stays cheap.
  const rows = await visibleShowcaseRows(row.team_id);
  const index = rows.findIndex((r) => r.slug === data.showcaseSlug);
  if (index < 0) return { status: "not_found", ...empty };
  const target = rows[index];

  const [detail, sections, heroUrl, cards, reviewLinks] = await Promise.all([
    (admin as any)
      .from("showcases")
      .select(
        "layout, tagline, intro_html, outro_html, accent_color, show_contact, show_reviews, cover_photo_id",
      )
      .eq("id", target.id)
      .maybeSingle()
      .then((r: any) => r.data),
    loadSections(admin, target.id),
    row.hero_photo_id
      ? resolvePhotoUrls([row.hero_photo_id], SHOWCASE_PHOTO_WIDTH).then(
          (m) => m.get(row.hero_photo_id)?.image_url || null,
        )
      : Promise.resolve(null),
    loadShowcaseCards(admin, rows),
    loadReviewLinks(row.team_id, row.show_reviews ?? true),
  ]);
  if (!detail) return { status: "not_found", ...empty };

  const coverMap = await resolvePhotoUrls(
    detail.cover_photo_id ? [detail.cover_photo_id] : [],
    SHOWCASE_PHOTO_WIDTH,
  );
  const firstPhoto = sections.flatMap((s) => s.items).find((i) => i.image_url)?.image_url ?? null;

  const cardBySlug = new Map(cards.map((c) => [c.slug, c]));
  const neighbour = (i: number) => {
    const r = rows[i];
    if (!r?.slug) return null;
    return {
      slug: r.slug,
      title: r.title,
      cover_image_url: cardBySlug.get(r.slug)?.cover_image_url ?? null,
    };
  };

  return {
    status: "ok",
    site: toSite(row, heroUrl ?? cards[0]?.cover_image_url ?? null),
    showcase: {
      slug: target.slug!,
      title: target.title,
      tagline: detail.tagline ?? null,
      summary: target.summary,
      service_type: target.service_type,
      products_used: target.products_used ?? [],
      city: target.city,
      state: target.state,
      completed_on: target.completed_on,
      layout: detail.layout,
      intro_html: detail.intro_html ?? null,
      outro_html: detail.outro_html ?? null,
      // The showcase's own accent wins when set, so a one-off job page can be
      // styled differently; otherwise it inherits the site's brand colour.
      accent_color: detail.accent_color ?? row.accent_color ?? null,
      show_contact: detail.show_contact ?? true,
      show_reviews: detail.show_reviews ?? true,
      cover_image_url: detail.cover_photo_id
        ? coverMap.get(detail.cover_photo_id)?.image_url || firstPhoto
        : firstPhoto,
      sections,
    },
    prev: neighbour(index - 1),
    next: neighbour(index + 1),
    related: listable(cards)
      .filter(
        (c) =>
          c.slug !== target.slug && !!target.service_type && c.service_type === target.service_type,
      )
      .slice(0, 3),
    reviewLinks,
  };
}

export const portfolioEmbedInputSchema = z.object({
  key: z.string().uuid(),
});

/**
 * Feeds both website widgets from one call.
 *
 * Keyed by embed_key rather than slug so the contractor can rotate the key to
 * kill third-party embeds without changing (and 404ing) their site address.
 */
export async function getPortfolioEmbedService(
  data: z.infer<typeof portfolioEmbedInputSchema>,
): Promise<PortfolioEmbedData> {
  const empty = {
    site_url: null,
    slug: null,
    business_name: null,
    accent_color: null,
    showcases: [],
    serviceTypes: [],
  };
  const admin = getSupabaseAdmin();
  const { data: row } = await (admin as any)
    .from("portfolios")
    .select("id, team_id, slug, business_name, accent_color, published")
    .eq("embed_key", data.key)
    .maybeSingle();
  if (!row) return { status: "not_found", ...empty };
  if (!row.published) return { status: "unpublished", ...empty };

  const rows = await visibleShowcaseRows(row.team_id);
  const showcases = listable(await loadShowcaseCards(admin, rows));

  return {
    status: "ok",
    // Relative: the embed is iframed from this same origin, so the parent's
    // domain is irrelevant and hardcoding one would break preview environments.
    site_url: `/p/${row.slug}`,
    slug: row.slug,
    business_name: row.business_name ?? null,
    accent_color: row.accent_color ?? null,
    showcases,
    serviceTypes: Array.from(
      new Set(showcases.map((c) => c.service_type).filter((s): s is string => !!s?.trim())),
    ).sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Every published portfolio + its projects, for sitemap.xml.
 *
 * Returns only slugs and timestamps; this is the one place that enumerates
 * portfolios across teams, which is exactly what a sitemap is for.
 */
export async function listPublicPortfolioUrlsService(): Promise<{
  entries: Array<{
    slug: string;
    updated_at: string;
    showcases: Array<{ slug: string; updated_at: string }>;
  }>;
}> {
  const admin = getSupabaseAdmin();
  const { data: portfolios } = await (admin as any)
    .from("portfolios")
    .select("team_id, slug, updated_at")
    .eq("published", true);
  const rows = (portfolios as any[]) ?? [];
  if (!rows.length) return { entries: [] };

  const { data: showcases } = await (admin as any)
    .from("showcases")
    .select("team_id, slug, updated_at")
    .in(
      "team_id",
      rows.map((r) => r.team_id),
    )
    .eq("on_site", true)
    .is("revoked_at", null)
    .not("slug", "is", null);

  const byTeam = new Map<string, Array<{ slug: string; updated_at: string }>>();
  ((showcases as any[]) ?? []).forEach((s) => {
    const list = byTeam.get(s.team_id);
    const entry = { slug: s.slug as string, updated_at: s.updated_at as string };
    if (list) list.push(entry);
    else byTeam.set(s.team_id, [entry]);
  });

  return {
    entries: rows.map((r) => ({
      slug: r.slug as string,
      updated_at: r.updated_at as string,
      showcases: byTeam.get(r.team_id) ?? [],
    })),
  };
}
