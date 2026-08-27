/**
 * Due-date arithmetic for the task editor, free of imports so it can be tested
 * directly.
 *
 * Same convention as `task-status.ts`, and for the same reason: everything in
 * this file decides what ends up in `tasks.due_date`, which is read by the web
 * board, the dashboard, report task sections and every overdue calculation in
 * the product. A date this app gets wrong is wrong everywhere.
 */

/** The shape `tasks.due_date` stores: a calendar date, no time, no zone. */
export type IsoDate = string;

/**
 * An ISO date `days` from today, in the device's own timezone.
 *
 * Built from the local date parts rather than `toISOString`, which converts to
 * UTC first. For anyone west of Greenwich in the evening that returns tomorrow,
 * so a "Today" chip would quietly set a due date of tomorrow, and a task due
 * today would print as due tomorrow on every screen that reads the column. The
 * bug only appears after about 4pm in New York, which is why it is worth
 * writing down rather than discovering.
 */
export function isoDaysFromToday(days: number, today: () => Date = () => new Date()): IsoDate {
  const date = today();
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Local date parts as `YYYY-MM-DD`. */
export function toIsoDate(date: Date): IsoDate {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Whether a typed date is one the database will accept.
 *
 * The shape check alone is not enough. `new Date("2026-02-31")` does not throw:
 * it rolls forward to 2 March, so a typo would be stored as a real date three
 * days off rather than rejected. Round-tripping the parsed date back through
 * `toIsoDate` and comparing is what catches that, and it catches 31 April and
 * 29 February in a non-leap year the same way.
 */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Parsed with an explicit time so it is read as local, not UTC midnight.
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  return toIsoDate(parsed) === value;
}
