/**
 * Calendar dates, kept off the timezone axis.
 *
 * `tasks.due_date` is a Postgres `date`. It arrives as "2026-08-20" and means
 * the twentieth of August, everywhere, for everyone. It is not an instant and
 * it has no timezone.
 *
 * `new Date("2026-08-20")` disagrees. ECMAScript parses a date-only ISO string
 * as UTC midnight, so west of Greenwich every render of that value moves back a
 * day: a due date typed as 08/20/2026 rendered as "Aug 19" in the task list,
 * and an item due today read as overdue from the moment it was saved. The same
 * string with a time in it (`"2026-08-20T00:00"`) is parsed as LOCAL, which is
 * why the bug looks arbitrary rather than systematic.
 *
 * So a calendar date is never handed to the Date constructor whole. It is split
 * into its three numbers and rebuilt at local midnight, which is the only
 * reading under which "is it due today" and "what day does this say" both come
 * out right.
 *
 * Everything here works on the "YYYY-MM-DD" strings the database stores and the
 * `<input type="date">` element produces, so nothing in between has to convert.
 */

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Two digits, for rebuilding a "YYYY-MM-DD" out of a local Date. */
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A calendar date as a Date pinned to LOCAL midnight, or null if the string is
 * not one.
 *
 * A value that already carries a time is passed to the Date constructor whole:
 * it is an instant, not a calendar date, and this function is not the place to
 * reinterpret it.
 */
export function parseCalendarDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = CALENDAR_DATE.exec(value.trim());
  if (!m) {
    const loose = new Date(value);
    return Number.isNaN(loose.getTime()) ? null : loose;
  }
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  // Rejects "2026-02-31", which the constructor would roll forward into March.
  return date.getMonth() === Number(mo) - 1 && date.getDate() === Number(d) ? date : null;
}

/** Today, in the reader's own calendar, as the string a `date` column stores. */
export function todayCalendarDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Local midnight today, the fixed point every "days from now" is measured off. */
export function startOfLocalDay(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Whole days from today to this calendar date. Negative when it has passed,
 * null when the value is not a date.
 *
 * Divided after both ends are pinned to local midnight, so a DST boundary
 * between them cannot round a 23-hour or 25-hour day into the wrong bucket.
 */
export function calendarDaysFromToday(
  value: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const due = parseCalendarDate(value);
  if (!due) return null;
  return Math.round((due.getTime() - startOfLocalDay(now).getTime()) / 86_400_000);
}

/** Is this calendar date strictly before today? False for today itself. */
export function isCalendarDateOverdue(
  value: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const days = calendarDaysFromToday(value, now);
  return days !== null && days < 0;
}

/**
 * "Aug 20" - the date the string says, in the reader's locale, never shifted.
 * Returns "" rather than "Invalid Date" for a value that is not a date.
 */
export function formatCalendarDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
  locale?: string,
): string {
  const date = parseCalendarDate(value);
  return date ? date.toLocaleDateString(locale, options) : "";
}

export interface DueLabel {
  /** "Today", "Tomorrow", "Yesterday", or the short date. */
  label: string;
  overdue: boolean;
  /** Whole days from today; negative in the past. */
  days: number;
}

/**
 * How a due date reads on a task row.
 *
 * The near days get words because that is how a crew talks about them, and
 * because "Today" is the one a person has to act on. Everything else is the
 * short date, which is unambiguous without a year on a punch list.
 */
export function calendarDueLabel(
  value: string | null | undefined,
  now: Date = new Date(),
  locale?: string,
): DueLabel | null {
  const days = calendarDaysFromToday(value, now);
  if (days === null) return null;
  const dated = formatCalendarDate(value, { month: "short", day: "numeric" }, locale);
  if (days === 0) return { label: "Today", overdue: false, days };
  if (days === 1) return { label: "Tomorrow", overdue: false, days };
  if (days === -1) return { label: "Yesterday", overdue: true, days };
  return { label: dated, overdue: days < 0, days };
}

/**
 * The years a person could plausibly mean when they book a job or set a due
 * date. Everything outside this is a half-typed year, not a decision.
 */
export const MIN_PLAUSIBLE_YEAR = 1900;
export const MAX_PLAUSIBLE_YEAR = 2999;

/**
 * Is this a calendar date somebody actually meant?
 *
 * `<input type="date">` is a three-segment control, and it emits a COMPLETE,
 * VALID value every time any one segment changes. Typing the year 2026 into it
 * therefore produces four of them in a row:
 *
 *     0002-08-24   0020-08-24   0202-08-24   2026-08-24
 *
 * Every one of those passes `parseCalendarDate`, because every one of them is a
 * real day. The client found what that costs on the schedule rail, where the
 * handler wrote straight through to the database: typing a year saved four
 * times, three of them to the year 2, 20 and 202, each with its own green
 * toast, and the entry jumped two millennia up the calendar between keystrokes.
 * A controlled input then re-rendered from the value it had just saved, so the
 * segments changed under the person still typing into them.
 *
 * The fix has to be a range check rather than a length check: the browser
 * zero-pads, so "0202" is four characters and looks finished. A year under
 * 1900 is a year still being typed, and nothing in this product is scheduled
 * before it either way.
 *
 * This does NOT replace `parseCalendarDate`. That answers "is this a date";
 * this answers "is this a date worth writing down", and a caller committing to
 * storage wants both.
 */
export function isPlausibleCalendarDate(value: string | null | undefined): boolean {
  const m = CALENDAR_DATE.exec(String(value ?? "").trim());
  if (!m) return false;
  if (!parseCalendarDate(value)) return false;
  const year = Number(m[1]);
  return year >= MIN_PLAUSIBLE_YEAR && year <= MAX_PLAUSIBLE_YEAR;
}
