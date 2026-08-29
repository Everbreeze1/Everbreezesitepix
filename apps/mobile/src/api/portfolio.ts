import { api } from "@/lib/api";
import type { PortfolioProject } from "./portfolio-view";

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
