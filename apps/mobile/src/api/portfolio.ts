import { api } from "@/lib/api";
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

/** A page's listing on the site: shown or hidden, featured, and its facets. */
export async function updateShowcaseSite(
  id: string,
  patch: {
    onSite?: boolean;
    featured?: boolean;
    serviceType?: string | null;
    summary?: string | null;
    city?: string | null;
    state?: string | null;
    completedOn?: string | null;
  },
): Promise<void> {
  await api.rpc("updateShowcaseSite", { id, ...patch });
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
