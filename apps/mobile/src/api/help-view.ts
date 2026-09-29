import { HELP_CATEGORIES, searchHelp, type HelpCategory } from "@everlumen/shared/help-guides";

/**
 * Help, as rules rather than a screen.
 *
 * The articles are the web Knowledge Base's own, from `@everlumen/shared`, so
 * the phone and the web never tell somebody two different things. The support
 * address is the web's `SUPPORT_EMAIL` (apps/web/src/lib/contact.ts): the
 * reply-to on every email the product sends, so a message from here lands in
 * the same inbox as a reply to one of those.
 */

export const SUPPORT_EMAIL = "support@everlumen.co";

/** A `mailto:` link with the subject filled in, as the web's support tiles build it. */
export function supportMailto(subject?: string): string {
  return `mailto:${SUPPORT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
}

/**
 * Where "What's new" goes. The web's Help Center tile for it links to the
 * public help page, and so does this, in the in-app browser.
 */
export const WHATS_NEW_PATH = "/help";

export type HelpResults = {
  categories: HelpCategory[];
  /** Guides shown. */
  count: number;
  /** "12 topics across 14 categories", or "3 topics matching roles". */
  summary: string;
};

export function helpResults(query: string): HelpResults {
  const categories = searchHelp(query, HELP_CATEGORIES);
  const count = categories.reduce((n, c) => n + c.guides.length, 0);
  const q = query.trim();
  const topics = (n: number) => `${n} ${n === 1 ? "topic" : "topics"}`;
  const summary = q
    ? `${topics(count)} matching "${q}"`
    : `${topics(count)} across ${categories.length} categories`;
  return { categories, count, summary };
}
