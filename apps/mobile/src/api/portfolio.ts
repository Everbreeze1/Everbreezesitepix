import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  builderPayload,
  listingPayload,
  type BuilderDraft,
  type ListingDraft,
  type ShowcaseDetail,
} from "./portfolio-showcase";
import type {
  GoogleApplyField,
  MyPortfolio,
  PortfolioPatch,
  PortfolioProject,
  ReviewLink,
} from "./portfolio-view";

/**
 * The Portfolio: a shareable mini-site of the company's best work.
 *
 * **Vocabulary matters here and the client is specific about it.** The mini-site
 * is the "Portfolio" and each page in it is a "project". The `showcases` tables
 * and the `/showcases` ops keep the old name because renaming them would be a
 * migration for no benefit, so identifiers say showcase and every word a person
 * reads says project. Do not let the identifier leak into the UI.
 *
 * There is no collision with the app's own projects, which is worth being clear
 * about: a portfolio project **is** the public page for one of them. Building
 * one from a job is the normal path, not a special case.
 *
 * All through `/v1/rpc`. `listShowcases` resolves the team, counts the items
 * and signs cover URLs; `createShowcaseFromProject` reads a job's photos,
 * groups them by phase and writes the sections. Neither is a client query.
 */

export async function listPortfolio(): Promise<PortfolioProject[]> {
  const result = await api.rpc<{ showcases?: PortfolioProject[] }>("listShowcases");
  return result?.showcases ?? [];
}

/**
 * Build a portfolio project from a job.
 *
 * The headline action on a phone, and the reason this screen is worth having
 * natively at all: photos are already tagged before, progress and after, and
 * that tagging **is** the story. The op groups them into three sections and
 * writes the page. A crew finishing a job can publish it before leaving.
 */
export async function createFromProject(
  projectId: string,
  maxPhotos = 24,
): Promise<{ id: string }> {
  const result = await api.rpc<{ id?: string; showcaseId?: string }>("createShowcaseFromProject", {
    projectId,
    maxPhotos,
  });
  const id = result?.id ?? result?.showcaseId;
  if (!id) throw new Error("The portfolio project was not created.");
  return { id };
}

/** An empty page, for somebody who wants to assemble it by hand. */
export async function createBlank(title: string, tagline: string | null): Promise<{ id: string }> {
  const result = await api.rpc<{ id?: string }>("createShowcase", { title, tagline });
  if (!result?.id) throw new Error("The portfolio project was not created.");
  return { id: result.id };
}

export async function updatePortfolioProject(
  id: string,
  patch: { title?: string; tagline?: string | null; layout?: "grid" | "masonry" | "featured" },
): Promise<void> {
  await api.rpc("updateShowcase", { id, ...patch });
}

export async function deletePortfolioProject(id: string): Promise<void> {
  await api.rpc("deleteShowcase", { id });
}

/**
 * Turn the public link on or off.
 *
 * Its own op rather than a field on `updateShowcase`, and the server keeps it
 * that way: publishing is the one change with an effect outside the workspace,
 * so it is not something a title edit can do by accident.
 */
export async function setPortfolioShare(id: string, enable: boolean): Promise<void> {
  await api.rpc("setShowcaseShare", { id, enable });
}

/*
 * ---------------------------------------------------------------------------
 * The site: the same ops the web's Portfolio page calls, nothing new.
 * ---------------------------------------------------------------------------
 */

/**
 * The team's portfolio, its cards and the service types in use.
 *
 * Creates the portfolio on first read for an owner or admin, exactly as it
 * does for the web, so opening the screen is safe to do before anything exists.
 */
export async function getMyPortfolio(): Promise<MyPortfolio> {
  const result = await api.rpc<Partial<MyPortfolio>>("getMyPortfolio");
  return {
    portfolio: result?.portfolio ?? null,
    canEdit: result?.canEdit,
    showcases: result?.showcases ?? [],
    serviceTypes: result?.serviceTypes ?? [],
  };
}

/** Saves site fields, or publishes and unpublishes the whole site with `{ published }`. */
export async function updatePortfolio(patch: PortfolioPatch): Promise<{ slug: string }> {
  // Spread, because every field is optional: the op's `optionalText` helper
  // allows each one to be left out, and only what changed is sent.
  const result = await api.rpc<{ slug?: string }>("updatePortfolio", { ...patch });
  return { slug: result?.slug ?? "" };
}

export async function checkPortfolioSlug(
  slug: string,
): Promise<{ available: boolean; reason: string | null }> {
  const result = await api.rpc<{ available?: boolean; reason?: string | null }>(
    "checkPortfolioSlug",
    { slug },
  );
  return { available: result?.available !== false, reason: result?.reason ?? null };
}

/** A new embed key. Every snippet already pasted on another website stops working. */
export async function rotatePortfolioEmbedKey(): Promise<string> {
  const result = await api.rpc<{ embedKey?: string }>("rotatePortfolioEmbedKey");
  if (!result?.embedKey) throw new Error("The embed key was not changed.");
  return result.embedKey;
}

/**
 * A page's listing on the site: its own address, shown or hidden, featured,
 * its facets and its map pin. Returns the slug as the service stored it,
 * because the service slugifies what was typed.
 */
export async function updateShowcaseSite(
  id: string,
  patch: {
    slug?: string | null;
    onSite?: boolean;
    featured?: boolean;
    serviceType?: string | null;
    productsUsed?: string[];
    summary?: string | null;
    city?: string | null;
    state?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    completedOn?: string | null;
  },
): Promise<{ slug: string | null }> {
  const result = await api.rpc<{ slug?: string | null }>("updateShowcaseSite", { id, ...patch });
  return { slug: result?.slug ?? null };
}

/** Every field of the listing at once, as the web's "On your site" card saves it. */
export async function saveShowcaseListing(
  id: string,
  draft: ListingDraft,
): Promise<{ slug: string | null }> {
  const { id: pageId, ...patch } = listingPayload(id, draft);
  return updateShowcaseSite(pageId, patch);
}

/*
 * ---------------------------------------------------------------------------
 * One page's builder: the web's `ShowcaseBuilderPage`, through the same ops.
 * ---------------------------------------------------------------------------
 */

/** The whole page: copy, design, cover and every section with its photos (signed). */
export async function getShowcase(id: string): Promise<ShowcaseDetail | null> {
  const result = await api.rpc<ShowcaseDetail | null>("getShowcase", { id });
  if (!result?.id) return null;
  return { ...result, sections: result.sections ?? [], products_used: result.products_used ?? [] };
}

/**
 * The builder's one Save: the page's fields, then its body.
 *
 * Two ops in the web's order. `setShowcaseSections` replaces every section and
 * photo, which is how a reorder, a removal and a caption all land at once.
 */
export async function saveShowcase(id: string, draft: BuilderDraft): Promise<void> {
  const { showcase: page, sections: body } = builderPayload(id, draft);
  await api.rpc("updateShowcase", {
    id: page.id,
    title: page.title,
    tagline: page.tagline,
    layout: page.layout,
    accentColor: page.accentColor,
    showContact: page.showContact,
    showReviews: page.showReviews,
    introHtml: page.introHtml,
    outroHtml: page.outroHtml,
    coverPhotoId: page.coverPhotoId,
  });
  await api.rpc("setShowcaseSections", { showcaseId: body.showcaseId, sections: body.sections });
}

/** Longest edge of an uploaded site logo; the site header draws it far smaller. */
const LOGO_DIM = 1024;

/**
 * Upload the portfolio site's own logo.
 *
 * The web's `uploadLogo` in `site-draft.ts`: the same public `company-logos`
 * bucket Settings uses, under `<uid>/portfolio-logo-<ts>`, but stored on the
 * portfolio (through `updatePortfolio`'s `logoUrl`) rather than the profile, so
 * the site's logo and the one on reports may differ. Re-encoded as PNG so a
 * transparent background stays transparent.
 */
export async function uploadPortfolioLogo(
  userId: string,
  uri: string,
  width?: number,
): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  if (!width || width > LOGO_DIM) context.resize({ width: LOGO_DIM });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.PNG });
  const bytes = await new File(saved.uri).arrayBuffer();

  const path = `${userId}/portfolio-logo-${Date.now()}.png`;
  const { error } = await supabase.storage
    .from("company-logos")
    .upload(path, bytes, { contentType: "image/png", upsert: true });
  if (error) throw new Error(error.message);
  return supabase.storage.from("company-logos").getPublicUrl(path).data.publicUrl;
}

/** The site's running order, as the full list of page ids. */
export async function reorderPortfolioShowcases(ids: string[]): Promise<void> {
  await api.rpc("reorderPortfolioShowcases", { ids });
}

export async function listReviewLinks(): Promise<ReviewLink[]> {
  const result = await api.rpc<{ links?: ReviewLink[] }>("listReviewLinks");
  return result?.links ?? [];
}

export async function setReviewLinks(links: ReviewLink[]): Promise<void> {
  await api.rpc("setReviewLinks", {
    links: links.map((link) => ({ platform: link.platform, url: link.url, label: link.label })),
  });
}

/** A Google Business listing, as the lookup returns it before anything is saved. */
export type GoogleBusinessProfile = {
  placeId: string;
  name: string | null;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
};

/** Read-only: finds the listing behind a pasted link or a name, so it can be confirmed. */
export async function lookupGoogleBusiness(query: string): Promise<GoogleBusinessProfile | null> {
  const result = await api.rpc<{ found?: boolean; profile?: GoogleBusinessProfile | null }>(
    "lookupGoogleBusiness",
    { query },
  );
  return result?.found ? (result.profile ?? null) : null;
}

export async function connectGoogleBusiness(
  placeId: string,
  apply: GoogleApplyField[],
): Promise<void> {
  await api.rpc("connectGoogleBusiness", { placeId, apply });
}

export async function refreshGoogleBusiness(): Promise<void> {
  await api.rpc("refreshGoogleBusiness");
}

export async function disconnectGoogleBusiness(): Promise<void> {
  await api.rpc("disconnectGoogleBusiness");
}
