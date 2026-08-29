/**
 * The month calendar, as arithmetic.
 *
 * Import-free so it can be tested, and worth testing because a calendar grid is
 * the classic place off-by-one errors survive review: the leading blanks, the
 * week the month starts on, and the boundary a "month" actually covers are all
 * things that look right for the month you happened to check.
 *
 * Everything is **local calendar dates**, never timestamps. A photo taken at
 * 7pm belongs to the day the crew was on site; converting through UTC lands it
 * on the next day for anyone west of Greenwich and silently shifts a third of
 * the calendar.
 */

export type TimelineDay = {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  photoCount: number;
  projectCount: number;
  coverUrl: string | null;
  projectNames: string[];
};

/** Year and zero-based month, the way `Date` counts them. */
export type Month = { year: number; month: number };

export function thisMonth(now: Date = new Date()): Month {
  return { year: now.getFullYear(), month: now.getMonth() };
}

/** Step a month, rolling the year over. Written out rather than `new Date(y, m +/- 1)`
 * so a caller can see that December to January is handled. */
export function shiftMonth({ year, month }: Month, by: number): Month {
  const total = year * 12 + month + by;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A local calendar date string for a year, month and day. */
export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function daysInMonth({ year, month }: Month): number {
  // Day 0 of the next month is the last day of this one, and it is the only
  // form of this that gets February right in a leap year without a table.
  return new Date(year, month + 1, 0).getDate();
}

/**
 * The instants to ask the server for.
 *
 * Built from local midnight on both ends and converted once, because the API
 * takes ISO instants while the calendar is in local dates. `to` is exclusive
 * and is local midnight on the first of the following month, so the last day of
 * the month is fully covered without a leap-second-flavoured off-by-one.
 */
export function monthRange(month: Month): { from: string; to: string } {
  const start = new Date(month.year, month.month, 1, 0, 0, 0, 0);
  const next = shiftMonth(month, 1);
  const end = new Date(next.year, next.month, 1, 0, 0, 0, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * One cell of the grid. `null` is a leading or trailing blank.
 *
 * Blanks are cells rather than an offset the renderer applies, so the grid is a
 * flat list of exactly the right length and the view never has to do the
 * arithmetic a second time.
 */
export type Cell = { date: string; day: number } | null;

/**
 * The grid for a month, in whole weeks.
 *
 * `weekStartsOn` is 1 for Monday, which is what a working week starts on
 * everywhere this product is sold. Sunday-first would put Saturday and Sunday
 * on opposite ends of the row, which is exactly wrong for reading a fortnight
 * of site work at a glance.
 */
export function monthGrid(month: Month, weekStartsOn = 1): Cell[] {
  const total = daysInMonth(month);
  const firstWeekday = new Date(month.year, month.month, 1).getDay(); // 0 = Sunday
  // How many blanks before the 1st. The `+ 7) % 7` is what makes a Sunday-start
  // month produce 6 leading blanks rather than -1.
  const lead = (firstWeekday - weekStartsOn + 7) % 7;

  const cells: Cell[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let day = 1; day <= total; day++) {
    cells.push({ date: isoDate(month.year, month.month, day), day });
  }
  // Padded to whole weeks so every row has seven cells and the grid does not
  // reflow its last row to a different width.
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Day headers, starting on the same day the grid does. */
export function weekdayLabels(weekStartsOn = 1): string[] {
  const base = ["S", "M", "T", "W", "T", "F", "S"];
  return Array.from({ length: 7 }, (_, i) => base[(weekStartsOn + i) % 7]);
}

/** Index the server's days by date, so a cell is a map lookup rather than a scan. */
export function byDate(days: TimelineDay[]): Map<string, TimelineDay> {
  const map = new Map<string, TimelineDay>();
  for (const day of days) map.set(day.date, day);
  return map;
}

/**
 * How busy a day was, on a four-step scale.
 *
 * Fixed thresholds rather than relative to the busiest day in view. Relative
 * shading makes a quiet month look exactly like a busy one, which is the one
 * thing a heat calendar exists to distinguish, and it makes two months
 * incomparable when you page between them.
 */
export type Density = 0 | 1 | 2 | 3;

export function densityOf(count: number): Density {
  if (count <= 0) return 0;
  if (count < 5) return 1;
  if (count < 20) return 2;
  return 3;
}

/** What a tapped day says above its photos. */
export function dayHeading(day: TimelineDay | undefined): string {
  if (!day || day.photoCount === 0) return "No photos on this day";
  const photos = `${day.photoCount} photo${day.photoCount === 1 ? "" : "s"}`;
  if (day.projectCount <= 1) {
    // One project: name it, because that is more useful than saying "1 project".
    return day.projectNames[0] ? `${photos} at ${day.projectNames[0]}` : photos;
  }
  return `${photos} across ${day.projectCount} projects`;
}

/** The month name shown in the header. */
export function monthLabel(month: Month): string {
  return new Date(month.year, month.month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/**
 * Whether paging forward would leave the present behind.
 *
 * A calendar of photographs has nothing in the future, so the forward control
 * is disabled at the current month rather than letting somebody page into a
 * run of empty grids and wonder whether the app is broken.
 */
export function isFutureMonth(month: Month, now: Date = new Date()): boolean {
  const current = thisMonth(now);
  return month.year * 12 + month.month >= current.year * 12 + current.month;
}

/** Totals for the strip under the calendar. */
export function monthSummary(
  days: TimelineDay[],
  capped: boolean,
): { photos: number; activeDays: number; text: string } {
  const activeDays = days.filter((day) => day.photoCount > 0).length;
  const photos = days.reduce((sum, day) => sum + day.photoCount, 0);

  if (photos === 0) return { photos, activeDays, text: "Nothing captured this month" };

  const text = `${photos}${capped ? "+" : ""} photo${photos === 1 ? "" : "s"} across ${activeDays} day${activeDays === 1 ? "" : "s"}`;
  return { photos, activeDays, text };
}
