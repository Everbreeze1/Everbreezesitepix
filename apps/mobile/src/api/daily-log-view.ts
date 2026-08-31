/**
 * How a Daily Log reads on the phone.
 *
 * Import-free, and the reason is one rule: which calendar day a log belongs to.
 * The server refuses to answer that, deliberately, because it runs in UTC and
 * cannot know whose midnight matters. A 6:30pm job in California is already
 * tomorrow to the server. So the day is resolved here, against the device's own
 * clock, which is the technician's clock, which is the only one that counts.
 */

/** Bullets shown before the card starts hiding them. */
export const PREVIEW_ENTRIES = 4;

/** A local calendar day as `YYYY-MM-DD`, in the device's own zone. */
export function localDay(value: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/**
 * "Today", "Yesterday", or a date.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the boundary can
 * actually be tested. A day label that is wrong by one is the kind of bug that
 * only reproduces for six hours a night in one timezone.
 */
export function dayLabel(createdAt: string, now: Date = new Date()): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";

  const today = localDay(now);
  if (localDay(created) === today) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (localDay(created) === localDay(yesterday)) return "Yesterday";

  return created.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "3 photos", and the singular that stops it reading like a machine. */
export function photoCountLabel(count: number): string {
  return `${count} ${count === 1 ? "photo" : "photos"}`;
}

/**
 * The bullets to draw, and how many are being held back.
 *
 * Returned together so the card cannot say "+2 more" while showing a different
 * number of lines, which is what happens when the two are computed apart.
 */
export function previewEntries(
  entries: string[],
  limit = PREVIEW_ENTRIES,
): { shown: string[]; hidden: number } {
  const shown = entries.slice(0, limit);
  return { shown, hidden: Math.max(0, entries.length - shown.length) };
}

/**
 * Whether to draw the card at all.
 *
 * Nothing to show and nothing on the way means no card, rather than an empty
 * one. A permanent "no daily log yet" box under every photo grid explains a
 * feature instead of being one; the log introduces itself by appearing the
 * first time somebody adds photos, which is a better introduction than a
 * placeholder describing what would go in it.
 */
export function shouldShowLog(logs: unknown[], pending: boolean): boolean {
  return logs.length > 0 || pending;
}

/** Said on the card, so nobody sends one of these to a client. */
export const INTERNAL_NOTICE = "Internal only - not shared with clients";
