/**
 * Rules shared by every template library on the phone: blueprints, documents,
 * report templates and walkthroughs.
 *
 * Import-free so it is tested directly. Each piece mirrors a web module and
 * `tests/mobile-template-libraries.test.ts` holds the two to each other, so a
 * trade added on the web cannot quietly sort differently here.
 */

/**
 * The trades, in the web's order (`apps/web/src/lib/template-categories.ts`).
 * The strings are stored on template rows, so they must match exactly.
 */
export const CATEGORY_ORDER = [
  "Electrical",
  "HVAC",
  "Plumbing",
  "Construction",
  "Roofing & Exterior",
  "Restoration",
  "Cleaning",
  "Landscaping",
  "Real Estate",
  "Field Reports",
  "Field Admin",
  "Insurance & Adjusting",
];

/** Where a template with no trade on it is listed. Never stored. */
export const GENERAL_CATEGORY = "General";

/** Every choice a trade picker offers, General first. */
export const TRADE_CHOICES = [GENERAL_CATEGORY, ...CATEGORY_ORDER];

/**
 * Sort key for a trade heading. The team's own General work leads; an unknown
 * trade sorts after every listed one rather than vanishing.
 */
export function categoryRank(category: string): number {
  if (category === GENERAL_CATEGORY) return -1;
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

/** The heading a stored category files under. */
export function tradeOf(category: string | null | undefined): string {
  return category?.trim() || GENERAL_CATEGORY;
}

/** What a trade picker's choice writes back: General is the absence of one. */
export function storedCategory(choice: string): string | null {
  return choice === GENERAL_CATEGORY ? null : choice;
}

/** Group rows under their trade, trades in the shared order. */
export function groupByTrade<T>(
  rows: readonly T[],
  categoryOf: (row: T) => string | null | undefined,
): { trade: string; rows: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = tradeOf(categoryOf(row));
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()]
    .sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([trade, list]) => ({ trade, rows: list }));
}

/** Case-insensitive match of a search box against any of the given strings. */
export function matchesSearch(search: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(needle));
}

/** A trailing " (copy)" or " (copy 4)". Same pattern as the web's duplicate-name.ts. */
const COPY_SUFFIX = /\s*\(copy(?:\s+\d+)?\)\s*$/i;

/**
 * The name a duplicate takes, numbered from a stripped base so a copy of a
 * copy reads "(copy 2)" rather than "(copy) (copy)". `taken` includes archived
 * rows: a name only free because its card is hidden is still a collision.
 */
export function nextCopyName(name: string, taken: Iterable<string>): string {
  let base = name.trim();
  while (COPY_SUFFIX.test(base)) base = base.replace(COPY_SUFFIX, "").trim();
  base = base || "Untitled";
  const used = new Set<string>();
  for (const t of taken) used.add(t.trim().toLowerCase());
  let candidate = `${base} (copy)`;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (copy ${n})`;
  return candidate;
}

/**
 * PostgREST's answer for a table that does not exist yet (a migration not run
 * on this database). Shown as its own state, because "you have none" and "this
 * database cannot store them" are different answers.
 */
export function isMissingTable(code: string | null | undefined): boolean {
  return code === "PGRST205" || code === "42P01";
}
