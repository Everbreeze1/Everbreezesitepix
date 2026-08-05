import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import { getSupabaseAdmin } from "../../lib/supabase";
import { myTeamId, resolvePhotoUrls, SHOWCASE_PHOTO_WIDTH } from "../showcases/service";
import {
  SHOWCASE_CARD_COLUMNS,
  compareCardRows,
  loadShowcaseCards,
  type PortfolioShowcaseCard,
  type ShowcaseCardRow,
} from "./cards";
import { isReservedSlug, isValidPortfolioSlug, slugify, uniqueSlug } from "./slug";

/** The editable site. Mirrors the portfolios table one-for-one. */
export interface PortfolioDetail {
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
  published: boolean;
  embed_key: string;
  seo_title: string | null;
  seo_description: string | null;
}

export interface MyPortfolio {
  /**
   * Null only when the team has no portfolio yet AND this user may not create
   * one. Writes are owner/admin-only, so a plain member who opens the page
   * before anyone has set it up gets an explanatory empty state rather than an
   * error page.
   */
  portfolio: PortfolioDetail | null;
  /** Whether this user may edit the site. Mirrors the RLS write policy. */
  canEdit: boolean;
  /** Every showcase on the team, on-site or not, in site order. */
  showcases: Array<PortfolioShowcaseCard & { on_site: boolean; is_draft: boolean }>;
  /** Distinct service types already in use, to power the builder's combobox. */
  serviceTypes: string[];
}

const DEFAULT_ACCENT = "#2563eb";

function notFound(message: string): never {
  throw Object.assign(new Error(message), { status: 404 });
}

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

/**
 * Picks a free slug for a brand new portfolio.
 *
 * Reads the whole slug column rather than probing one candidate at a time —
 * the table has one row per paying team, so this stays a few thousand short
 * strings for the foreseeable life of the feature and saves N round trips.
 */
async function pickPortfolioSlug(seed: string, teamId: string): Promise<string> {
  const admin = getSupabaseAdmin();
  const { data } = await (admin as any).from("portfolios").select("slug");
  const taken = ((data as Array<{ slug: string }>) ?? []).map((r) => r.slug);

  // Both ends have to clear the portfolios_slug_format CHECK (3–50 chars), or
  // the very first load of the Portfolio page 400s on a company name we chose
  // for them. Trimmed to 44 so uniqueSlug's "-123" suffix still fits in 50.
  let base = slugify(seed).slice(0, 44).replace(/-+$/g, "");
  if (base.length < 3 || isReservedSlug(base)) base = base ? `${base}-portfolio` : "";

  return uniqueSlug(base, taken, `site-${teamId.slice(0, 8)}`);
}

/**
 * Loads the team's portfolio, creating it on first access.
 *
 * Create-on-read rather than create-on-signup: teams that predate this feature
 * would otherwise need a backfill, and a team that never opens the page should
 * not own a row (or, more importantly, a claimed slug).
 *
 * Defaults are seeded from the owner's profile so the first render of the
 * builder is a plausible site rather than a wall of empty inputs — the same
 * reasoning as createShowcaseFromProject generating finished copy.
 */
export async function getMyPortfolioService(ctx: AuthedContext): Promise<MyPortfolio> {
  const db = ctx.supabase as any;
  const { data: membership } = await db
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  const teamId = (membership as any)?.team_id as string | undefined;
  if (!teamId) badRequest("You need a team before you can publish a portfolio.");
  const canEdit = ["owner", "admin"].includes((membership as any)?.role ?? "");

  let { data: row } = await db.from("portfolios").select("*").eq("team_id", teamId).maybeSingle();

  // Create-on-read is an owner/admin privilege. Returning null here — rather
  // than letting the insert fail on RLS — is what keeps a plain member's first
  // visit an empty state instead of a red error box.
  if (!row && !canEdit) {
    const cards = await loadTeamShowcaseCards(db, teamId);
    return {
      portfolio: null,
      canEdit,
      showcases: cards,
      serviceTypes: distinctServiceTypes(cards),
    };
  }

  if (!row) {
    const { data: profile } = await db
      .from("profiles")
      .select("company, company_logo_url, company_phone, company_address, email")
      .eq("id", ctx.userId)
      .maybeSingle();
    const p = (profile as any) ?? {};
    const name: string = p.company?.trim() || "My company";

    const insert = {
      team_id: teamId,
      created_by: ctx.userId,
      slug: await pickPortfolioSlug(name, teamId),
      business_name: p.company ?? null,
      logo_url: p.company_logo_url ?? null,
      accent_color: DEFAULT_ACCENT,
      hero_headline: p.company?.trim() ? `Work you can point at.` : null,
      hero_subhead: null,
      phone: p.company_phone ?? null,
      email: p.email ?? null,
      address: p.company_address ?? null,
      published: false,
    };
    const { data: created, error } = await db
      .from("portfolios")
      .insert(insert)
      .select("*")
      .single();
    if (error) {
      // 23505 means another tab created it between our read and our insert —
      // re-read instead of surfacing a unique-violation to the user.
      if ((error as any).code === "23505") {
        const { data: existing } = await db
          .from("portfolios")
          .select("*")
          .eq("team_id", teamId)
          .maybeSingle();
        if (!existing) badRequest(error.message);
        row = existing;
      } else if ((error as any).code === "42501") {
        badRequest("Only the team owner or an admin can set up the portfolio site.");
      } else {
        badRequest(error.message);
      }
    } else {
      row = created;
    }
  }

  const [cards, heroMap] = await Promise.all([
    loadTeamShowcaseCards(db, teamId),
    resolveHeroImage(row.hero_photo_id),
  ]);

  return {
    portfolio: toDetail(row, heroMap),
    canEdit,
    showcases: cards,
    serviceTypes: distinctServiceTypes(cards),
  };
}

function distinctServiceTypes(cards: Array<{ service_type: string | null }>): string[] {
  return Array.from(
    new Set(cards.map((c) => c.service_type).filter((s): s is string => !!s?.trim())),
  ).sort((a, b) => a.localeCompare(b));
}

async function resolveHeroImage(photoId: string | null): Promise<string | null> {
  if (!photoId) return null;
  const map = await resolvePhotoUrls([photoId], SHOWCASE_PHOTO_WIDTH);
  return map.get(photoId)?.image_url || null;
}

function toDetail(row: any, heroImageUrl: string | null): PortfolioDetail {
  return {
    id: row.id,
    slug: row.slug,
    business_name: row.business_name ?? null,
    logo_url: row.logo_url ?? null,
    accent_color: row.accent_color ?? null,
    hero_headline: row.hero_headline ?? null,
    hero_subhead: row.hero_subhead ?? null,
    hero_photo_id: row.hero_photo_id ?? null,
    hero_image_url: heroImageUrl,
    about_html: row.about_html ?? null,
    services: row.services ?? [],
    service_areas: row.service_areas ?? [],
    phone: row.phone ?? null,
    email: row.email ?? null,
    address: row.address ?? null,
    website_url: row.website_url ?? null,
    cta_label: row.cta_label ?? null,
    cta_url: row.cta_url ?? null,
    show_map: row.show_map ?? true,
    show_reviews: row.show_reviews ?? true,
    published: row.published ?? false,
    embed_key: row.embed_key,
    seo_title: row.seo_title ?? null,
    seo_description: row.seo_description ?? null,
  };
}

async function loadTeamShowcaseCards(
  db: any,
  teamId: string,
): Promise<Array<PortfolioShowcaseCard & { on_site: boolean; is_draft: boolean }>> {
  const { data } = await db
    .from("showcases")
    .select(SHOWCASE_CARD_COLUMNS)
    .eq("team_id", teamId);
  const rows = ((data as ShowcaseCardRow[]) ?? []).slice().sort(compareCardRows);
  const cards = await loadShowcaseCards(db, rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return cards.map((c) => {
    const r = byId.get(c.id)!;
    return { ...c, on_site: r.on_site ?? true, is_draft: !!r.revoked_at };
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a #rrggbb hex value")
  .nullable();

/** Trims, and turns "" into null so an emptied input clears the column. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v == null ? v : v.trim() === "" ? null : v.trim()));

/** Deduped, trimmed, empties dropped — these render as filter chips. */
const tagList = (max: number) =>
  z
    .array(z.string().max(80))
    .max(max)
    .optional()
    .transform((v) =>
      v == null
        ? v
        : Array.from(new Set(v.map((s) => s.trim()).filter(Boolean))).slice(0, max),
    );

export const updatePortfolioInputSchema = z.object({
  slug: z.string().trim().toLowerCase().min(3).max(50).optional(),
  businessName: optionalText(160),
  logoUrl: optionalText(2000),
  accentColor: hexColor.optional(),
  heroHeadline: optionalText(200),
  heroSubhead: optionalText(400),
  heroPhotoId: z.string().uuid().nullable().optional(),
  aboutHtml: z.string().max(20_000).nullable().optional(),
  services: tagList(24),
  serviceAreas: tagList(40),
  phone: optionalText(60),
  email: optionalText(200),
  address: optionalText(300),
  websiteUrl: optionalText(2000),
  ctaLabel: optionalText(60),
  ctaUrl: optionalText(2000),
  showMap: z.boolean().optional(),
  showReviews: z.boolean().optional(),
  published: z.boolean().optional(),
  seoTitle: optionalText(70),
  seoDescription: optionalText(200),
});

export async function updatePortfolioService(
  ctx: AuthedContext,
  data: z.infer<typeof updatePortfolioInputSchema>,
): Promise<{ ok: true; slug: string }> {
  const teamId = await myTeamId(ctx);
  if (!teamId) badRequest("You need a team before you can publish a portfolio.");
  const db = ctx.supabase as any;

  const patch: Record<string, unknown> = {};
  if (data.slug !== undefined) {
    if (!isValidPortfolioSlug(data.slug)) {
      badRequest(
        isReservedSlug(data.slug)
          ? `"${data.slug}" is reserved — pick another address.`
          : "Addresses can use lowercase letters, numbers and hyphens only.",
      );
    }
    patch.slug = data.slug;
  }
  if (data.businessName !== undefined) patch.business_name = data.businessName;
  if (data.logoUrl !== undefined) patch.logo_url = data.logoUrl;
  if (data.accentColor !== undefined) patch.accent_color = data.accentColor;
  if (data.heroHeadline !== undefined) patch.hero_headline = data.heroHeadline;
  if (data.heroSubhead !== undefined) patch.hero_subhead = data.heroSubhead;
  if (data.heroPhotoId !== undefined) patch.hero_photo_id = data.heroPhotoId;
  if (data.aboutHtml !== undefined) patch.about_html = data.aboutHtml;
  if (data.services !== undefined) patch.services = data.services;
  if (data.serviceAreas !== undefined) patch.service_areas = data.serviceAreas;
  if (data.phone !== undefined) patch.phone = data.phone;
  if (data.email !== undefined) patch.email = data.email;
  if (data.address !== undefined) patch.address = data.address;
  if (data.websiteUrl !== undefined) patch.website_url = data.websiteUrl;
  if (data.ctaLabel !== undefined) patch.cta_label = data.ctaLabel;
  if (data.ctaUrl !== undefined) patch.cta_url = data.ctaUrl;
  if (data.showMap !== undefined) patch.show_map = data.showMap;
  if (data.showReviews !== undefined) patch.show_reviews = data.showReviews;
  if (data.published !== undefined) patch.published = data.published;
  if (data.seoTitle !== undefined) patch.seo_title = data.seoTitle;
  if (data.seoDescription !== undefined) patch.seo_description = data.seoDescription;

  if (!Object.keys(patch).length) {
    const { data: row } = await db.from("portfolios").select("slug").eq("team_id", teamId).maybeSingle();
    return { ok: true, slug: (row as any)?.slug ?? "" };
  }

  const { data: updated, error } = await db
    .from("portfolios")
    .update(patch)
    .eq("team_id", teamId)
    .select("slug")
    .maybeSingle();

  if (error) {
    if ((error as any).code === "23505") {
      badRequest("That address is already taken — try another.");
    }
    if ((error as any).code === "23514") {
      badRequest("Addresses can use lowercase letters, numbers and hyphens only.");
    }
    badRequest(error.message);
  }
  // RLS silently filters rather than erroring, so "no row came back" is how a
  // non-admin's write actually fails. Say so, rather than reporting success.
  if (!updated) {
    badRequest("Only the team owner or an admin can edit the portfolio site.");
  }
  return { ok: true, slug: (updated as any).slug };
}

export const checkPortfolioSlugInputSchema = z.object({
  slug: z.string().trim().toLowerCase().min(1).max(60),
});

export async function checkPortfolioSlugService(
  ctx: AuthedContext,
  data: z.infer<typeof checkPortfolioSlugInputSchema>,
): Promise<{ available: boolean; reason: string | null }> {
  const teamId = await myTeamId(ctx);
  if (!isValidPortfolioSlug(data.slug)) {
    return {
      available: false,
      reason: isReservedSlug(data.slug)
        ? "That address is reserved."
        : "Use 3–50 lowercase letters, numbers or hyphens.",
    };
  }
  // Admin client: a team must be told a slug is taken even though RLS would
  // hide the row owning it. Only a boolean leaks, never whose it is.
  const { data: row } = await (getSupabaseAdmin() as any)
    .from("portfolios")
    .select("team_id")
    .eq("slug", data.slug)
    .maybeSingle();
  if (row && (row as any).team_id !== teamId) {
    return { available: false, reason: "That address is already taken." };
  }
  return { available: true, reason: null };
}

export async function rotatePortfolioEmbedKeyService(
  ctx: AuthedContext,
): Promise<{ embedKey: string }> {
  const teamId = await myTeamId(ctx);
  if (!teamId) badRequest("You need a team before you can publish a portfolio.");
  const { data, error } = await (ctx.supabase as any)
    .from("portfolios")
    .update({ embed_key: crypto.randomUUID() })
    .eq("team_id", teamId)
    .select("embed_key")
    .maybeSingle();
  if (error) badRequest(error.message);
  if (!data) badRequest("Only the team owner or an admin can rotate the embed key.");
  return { embedKey: (data as any).embed_key };
}

export const updateShowcaseSiteInputSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().trim().toLowerCase().max(60).nullable().optional(),
  serviceType: optionalText(80),
  productsUsed: tagList(24),
  summary: optionalText(300),
  city: optionalText(120),
  state: optionalText(60),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  onSite: z.boolean().optional(),
  featured: z.boolean().optional(),
  completedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .nullable()
    .optional(),
});

/**
 * The per-showcase fields that only matter once it lives on a site: its URL,
 * the facets it is filtered by, its map pin, and whether it is listed at all.
 *
 * Deliberately separate from updateShowcase, which owns the *document* (title,
 * copy, layout). Splitting them keeps the builder's autosave-free dirty check
 * on the document simple and lets the site panel save independently.
 */
export async function updateShowcaseSiteService(
  ctx: AuthedContext,
  data: z.infer<typeof updateShowcaseSiteInputSchema>,
): Promise<{ ok: true; slug: string | null }> {
  const teamId = await myTeamId(ctx);
  if (!teamId) badRequest("You need a team before you can publish a portfolio.");
  const db = ctx.supabase as any;

  const patch: Record<string, unknown> = {};
  if (data.slug !== undefined) {
    if (data.slug === null || data.slug === "") {
      patch.slug = null;
    } else {
      const clean = slugify(data.slug);
      if (clean.length < 2) badRequest("Use at least 2 letters or numbers in the address.");
      const { data: clash } = await db
        .from("showcases")
        .select("id")
        .eq("team_id", teamId)
        .eq("slug", clean)
        .neq("id", data.id)
        .maybeSingle();
      if (clash) badRequest(`"${clean}" is already used by another showcase.`);
      patch.slug = clean;
    }
  }
  if (data.serviceType !== undefined) patch.service_type = data.serviceType;
  if (data.productsUsed !== undefined) patch.products_used = data.productsUsed;
  if (data.summary !== undefined) patch.summary = data.summary;
  if (data.city !== undefined) patch.city = data.city;
  if (data.state !== undefined) patch.state = data.state;
  if (data.latitude !== undefined) patch.latitude = data.latitude;
  if (data.longitude !== undefined) patch.longitude = data.longitude;
  if (data.onSite !== undefined) patch.on_site = data.onSite;
  if (data.featured !== undefined) patch.featured = data.featured;
  if (data.completedOn !== undefined) patch.completed_on = data.completedOn;

  if (!Object.keys(patch).length) return { ok: true, slug: null };

  const { data: updated, error } = await db
    .from("showcases")
    .update(patch)
    .eq("id", data.id)
    .select("slug")
    .maybeSingle();
  if (error) {
    if ((error as any).code === "23505") badRequest("That address is already used by another showcase.");
    badRequest(error.message);
  }
  if (!updated) notFound("That showcase no longer exists, or you can't edit it.");
  return { ok: true, slug: (updated as any).slug ?? null };
}

export const reorderPortfolioShowcasesInputSchema = z.object({
  ids: z.array(z.string().uuid()).max(200),
});

/**
 * Writes the grid order the user dragged into.
 *
 * One UPDATE per row rather than an upsert: an upsert would need every NOT NULL
 * column of showcases in the payload, and getting that wrong silently blanks
 * live marketing copy. N is bounded by the 200-showcase cap.
 */
export async function reorderPortfolioShowcasesService(
  ctx: AuthedContext,
  data: z.infer<typeof reorderPortfolioShowcasesInputSchema>,
): Promise<{ ok: true }> {
  const db = ctx.supabase as any;
  for (const [index, id] of data.ids.entries()) {
    const { error } = await db.from("showcases").update({ position: index }).eq("id", id);
    if (error) badRequest(error.message);
  }
  return { ok: true };
}
