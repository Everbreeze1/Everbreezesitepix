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
