import { describe, expect, it } from "vitest";
import { isIsoDate, isoDaysFromToday, toIsoDate } from "../apps/mobile/src/api/task-dates";

/*
 * Due dates set from the phone.
 *
 * Everything here decides what lands in `tasks.due_date`, which the web board,
 * the dashboard and every overdue calculation in the product read back. Both
 * failures covered below are silent: neither throws, and both store a real date
 * that is simply the wrong one.
 */

describe("isoDaysFromToday", () => {
  it("reads the local date, not the UTC one", () => {
    /*
     * The bug this exists to prevent: `toISOString` converts to UTC first, so
     * for anyone west of Greenwich in the evening it returns tomorrow. A person
     * in New York tapping "Today" at 8pm would set a due date of tomorrow, and
     * the task would print as due tomorrow everywhere.
     *
     * 2026-03-14T23:30 local is 2026-03-15T03:30 UTC when the device is four
     * hours behind, so the two answers genuinely differ here.
     */
    const lateEvening = () => new Date(2026, 2, 14, 23, 30, 0);
    expect(isoDaysFromToday(0, lateEvening)).toBe("2026-03-14");
  });

  it("offsets forward by whole days", () => {
    const at = () => new Date(2026, 2, 14, 9, 0, 0);
    expect(isoDaysFromToday(1, at)).toBe("2026-03-15");
    expect(isoDaysFromToday(7, at)).toBe("2026-03-21");
  });

  it("rolls over month and year ends", () => {
    // `setDate` past the end of the month is the normal way to do this and is
    // worth pinning, because the alternative (building the date by hand) gets
    // 31 December wrong.
    expect(isoDaysFromToday(1, () => new Date(2026, 11, 31, 12, 0, 0))).toBe("2027-01-01");
    expect(isoDaysFromToday(1, () => new Date(2028, 1, 28, 12, 0, 0))).toBe("2028-02-29");
  });

  it("pads single digit months and days", () => {
    // "2026-3-4" is not a date PostgreSQL accepts in this column.
    expect(isoDaysFromToday(0, () => new Date(2026, 2, 4, 12, 0, 0))).toBe("2026-03-04");
  });
});

describe("toIsoDate", () => {
  it("formats local date parts", () => {
    expect(toIsoDate(new Date(2026, 8, 1, 23, 59, 59))).toBe("2026-09-01");
  });
});

describe("isIsoDate", () => {
  it("accepts a real date", () => {
    expect(isIsoDate("2026-09-14")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
  });

  it("rejects a date that does not exist", () => {
    /*
     * The reason the check is a round trip rather than a regex.
     * `new Date("2026-02-31")` does not throw: it rolls forward to 2 March. A
     * typo would be stored as a real date three days off, which nothing
     * downstream can detect.
     */
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-04-31")).toBe(false);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
  });

  it("rejects anything not shaped like a calendar date", () => {
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate("14/09/2026")).toBe(false);
    expect(isIsoDate("2026-9-14")).toBe(false);
    expect(isIsoDate("2026-09-14T10:00:00Z")).toBe(false);
    expect(isIsoDate("tomorrow")).toBe(false);
  });
});
