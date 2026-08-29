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

export type PortfolioProject = {
  id: string;
  title: string;
  tagline: string | null;
  layout: PortfolioLayout | string;
  share_token: string | null;
  revoked_at: string | null;
  cover_photo_id: string | null;
  /** Signed cover URL, attached by the list op. */
  coverUrl?: string | null;
  /** How many photos the page holds, attached by the list op. */
  itemCount?: number;
  slug?: string | null;
  service_type?: string | null;
  city?: string | null;
  state?: string | null;
  featured?: boolean | null;
  position?: number | null;
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

/**
 * Portfolio order.
 *
 * `position` first, then newest, matching the server's own ordering. The list
 * on a phone is also the running order of the public grid, so the two have to
 * agree or reordering on the web looks broken here.
 */
export function orderedPortfolio(projects: PortfolioProject[]): PortfolioProject[] {
  return [...projects].sort((a, b) => {
    const ap = a.position ?? Number.MAX_SAFE_INTEGER;
    const bp = b.position ?? Number.MAX_SAFE_INTEGER;
    if (ap !== bp) return ap - bp;
    return b.created_at.localeCompare(a.created_at);
  });
}

/** The line under a portfolio project's title. */
export function portfolioSummary(project: PortfolioProject): string {
  const photos = project.itemCount ?? 0;
  const parts = [`${photos} photo${photos === 1 ? "" : "s"}`];

  const place = [project.city, project.state].filter(Boolean).join(", ");
  if (place) parts.push(place);
  parts.push(isPublished(project) ? "live" : "draft");

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
  return (project.itemCount ?? 0) === 0;
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
