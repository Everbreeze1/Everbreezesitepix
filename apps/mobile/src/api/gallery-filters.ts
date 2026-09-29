/**
 * The Photo Library's refinements, the web gallery's filter bar for a phone.
 *
 * Import-free so it can be tested. The pills on the library stay a single-choice
 * view switch; these sit behind the filter button and narrow the set at the
 * database, the way the web gallery's project, date, tag and "Taken by"
 * controls do. Pushed into the query rather than applied to loaded pages, so a
 * filter for last March finds last March instead of "nothing in what you have
 * scrolled through so far".
 */

export type GalleryFilters = {
  /** Any of these jobs. Empty means every job. */
  projectIds: string[];
  /** First day, inclusive, as a local calendar date (YYYY-MM-DD). */
  from: string | null;
  /** Last day, inclusive, as a local calendar date (YYYY-MM-DD). */
  to: string | null;
  /** Photos carrying any of these tags. Empty means no tag filter. */
  tags: string[];
  /** Taken by any of these people (user ids). */
  uploaders: string[];
  /**
   * Only photos with no tags at all: the web dashboard's "Needs review".
   * Separate from `tags` because "has none" is not a tag anybody can pick.
   */
  needsReview: boolean;
};

export const EMPTY_GALLERY_FILTERS: GalleryFilters = {
  projectIds: [],
  from: null,
  to: null,
  tags: [],
  uploaders: [],
  needsReview: false,
};

/** How many separate refinements are on, for the badge on the filter button. */
export function activeFilterCount(filters: GalleryFilters): number {
  let count = 0;
  if (filters.projectIds.length > 0) count += 1;
  if (filters.from || filters.to) count += 1;
  if (filters.tags.length > 0) count += 1;
  if (filters.uploaders.length > 0) count += 1;
  if (filters.needsReview) count += 1;
  return count;
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A YYYY-MM-DD string that names a real day, or null.
 *
 * Checked by building the date and reading it back, so "2026-02-30" is refused
 * rather than rolled over into March.
 */
export function parseCalendarDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = CALENDAR_DATE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** Local calendar date string for a Date. */
export function calendarDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The instant range a day range covers, in local time.
 *
 * `from` is local midnight at the start of the first day; `toExclusive` is
 * local midnight after the last day. Built from local parts on purpose: a bare
 * `new Date("2026-08-31")` is UTC midnight, which west of Greenwich is still the
 * 30th, and the web gallery lost the last picked day to exactly that.
 */
export function dayRangeBounds(
  from: string | null,
  to: string | null,
): { fromIso: string | null; toExclusiveIso: string | null } {
  const start = parseCalendarDay(from);
  const end = parseCalendarDay(to);
  let toExclusiveIso: string | null = null;
  if (end) {
    const next = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
    toExclusiveIso = next.toISOString();
  }
  return { fromIso: start ? start.toISOString() : null, toExclusiveIso };
}

/**
 * The PostgREST `or` expression for a date range.
 *
 * A photo belongs to the day its shutter fired (`taken_at`), falling back to
 * when it uploaded (`created_at`) for rows with no capture time. That is how
 * the library groups photos into days and how the timeline counts them, so a
 * day tapped on the timeline opens on exactly the photos it counted.
 */
export function dateRangeOrFilter(from: string | null, to: string | null): string | null {
  const { fromIso, toExclusiveIso } = dayRangeBounds(from, to);
  if (!fromIso && !toExclusiveIso) return null;
  const bounds = (column: string) =>
    [
      fromIso ? `${column}.gte.${fromIso}` : null,
      toExclusiveIso ? `${column}.lt.${toExclusiveIso}` : null,
    ].filter(Boolean);
  const taken = ["taken_at.not.is.null", ...bounds("taken_at")].join(",");
  const created = ["taken_at.is.null", ...bounds("created_at")].join(",");
  return `and(${taken}),and(${created})`;
}

/** Human label for a date range, for the summary line and the sheet. */
export function dateRangeLabel(from: string | null, to: string | null): string {
  if (!from && !to) return "Any time";
  if (from && to && from === to) return from;
  return `${from ?? "Start"} to ${to ?? "today"}`;
}

/** Toggle one id in a list, keeping the order it was picked in. */
export function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

/**
 * The quick ranges offered above the date fields. Typing a date on a phone
 * keyboard is the slow path; most searches are "today", "this week" or "about
 * a month ago".
 */
export function presetRange(
  preset: "today" | "7d" | "30d",
  now: Date = new Date(),
): { from: string; to: string } {
  const today = calendarDay(now);
  if (preset === "today") return { from: today, to: today };
  const days = preset === "7d" ? 6 : 29;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return { from: calendarDay(start), to: today };
}
