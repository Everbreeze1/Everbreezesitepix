/**
 * URL slugs for the portfolio site and its project pages.
 *
 * These end up in addresses customers see and search engines index, so they are
 * generated once and then treated as stable — renaming a showcase deliberately
 * does NOT re-slug it, because that would silently 404 every link the contractor
 * already sent out.
 */

/** Reserved at the top level so a portfolio can never shadow an app route. */
const RESERVED = new Set([
  "admin",
  "api",
  "app",
  "embed",
  "help",
  "login",
  "logout",
  "p",
  "pricing",
  "privacy-policy",
  "share",
  "signup",
  "sitemap",
  "static",
  "support",
  "www",
]);

/** Combining diacritical marks, left behind by NFKD decomposition. */
const COMBINING_MARKS = /[̀-ͯ]/g;
/** Apostrophes are removed rather than hyphenated: "Dave's" -> daves, not dave-s. */
const APOSTROPHES = /['‘’]/g;

/**
 * Lowercase, ASCII, hyphen-separated. Accented characters are decomposed rather
 * than dropped so "Cafe Remodel" with an accent becomes `cafe-remodel`, not
 * `caf-remodel`.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

/** Matches the CHECK constraint on portfolios.slug. */
export function isValidPortfolioSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug) && !RESERVED.has(slug);
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug);
}

/**
 * Appends -2, -3, ... until the candidate clears `taken`.
 *
 * Callers pass the set of slugs already used in the relevant scope (globally for
 * portfolios, per-team for showcases). This is a best-effort de-duplication in
 * application code; the UNIQUE indexes remain the real guarantee, and callers
 * handle the 23505 that a concurrent insert can still produce.
 */
export function uniqueSlug(base: string, taken: Iterable<string>, fallback: string): string {
  const seed = base || fallback;
  const used = new Set(taken);
  if (!used.has(seed)) return seed;
  for (let n = 2; n < 500; n++) {
    const candidate = `${seed}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  // Practically unreachable; better than looping forever or returning a dupe.
  return `${seed}-${Math.floor(Math.random() * 1e6)}`;
}
