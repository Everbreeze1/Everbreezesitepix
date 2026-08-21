import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  calendarDaysFromToday,
  calendarDueLabel,
  formatCalendarDate,
  isCalendarDateOverdue,
  parseCalendarDate,
  startOfLocalDay,
  todayCalendarDate,
} from "../packages/shared/src/calendar-date";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Code only, comments dropped.
 *
 * The assertions below say "this construct is not used here", and the fix for
 * the bug quotes the broken construct in the comment explaining it. Matching
 * the raw file would fail on its own explanation.
 */
const codeOf = (src: string) =>
  src.replace(/(?<![\w"'])\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * The reported bug, in the client's words:
 *
 *   "Due date saved a day off. I entered 08/20/2026 and the task list shows the
 *    due-date pill as 'Aug 19.' Looks like a timezone rounding bug converting
 *    the date to UTC. Worth a QA pass - a wrong due date is worse than no due
 *    date for accountability."
 *
 * `tasks.due_date` is a Postgres `date`. It arrives as "2026-08-20" and means
 * the twentieth, everywhere. `new Date("2026-08-20")` parses that as UTC
 * midnight, so anywhere west of Greenwich `toLocaleDateString` renders the
 * nineteenth, and a task due today reads as overdue from the moment it is
 * saved.
 *
 * These lock both halves: that the helper reads a calendar date as a calendar
 * date, and that the screens which show due dates actually call it instead of
 * quietly growing another `new Date(due_date)`.
 */
describe("a calendar date means the same day everywhere", () => {
  describe("parsing", () => {
    it("rebuilds a date-only string at LOCAL midnight, not UTC midnight", () => {
      const d = parseCalendarDate("2026-08-20")!;
      expect(d.getFullYear()).toBe(2026);
      // getMonth is zero-based; August is 7.
      expect(d.getMonth()).toBe(7);
      expect(d.getDate()).toBe(20);
      expect(d.getHours()).toBe(0);
    });

    it("is the fix: the naive constructor is what shifted the day", () => {
      /*
       * This is the whole bug in two lines. In any timezone behind UTC these
       * disagree, and the old code used the second one. The assertion is
       * written so it passes in every timezone: the helper always says the
       * twentieth, whatever `new Date` thinks the local date is.
       */
      expect(parseCalendarDate("2026-08-20")!.getDate()).toBe(20);
      const naive = new Date("2026-08-20");
      expect(naive.getUTCDate()).toBe(20); // UTC midnight, as the spec says
      // ...which is why reading it locally is not safe. No claim about what
      // `naive.getDate()` is - that depends on where the test runs, which is
      // exactly the problem.
    });

    it("rejects a value that is not a real day rather than rolling it forward", () => {
      // `new Date(2026, 1, 31)` silently becomes 3 March.
      expect(parseCalendarDate("2026-02-31")).toBeNull();
      expect(parseCalendarDate("")).toBeNull();
      expect(parseCalendarDate(null)).toBeNull();
      expect(parseCalendarDate("not a date")).toBeNull();
    });

    it("leaves a value that carries a time alone - that is an instant, not a date", () => {
      const d = parseCalendarDate("2026-08-20T13:45:00Z")!;
      expect(d.toISOString()).toBe("2026-08-20T13:45:00.000Z");
    });
  });

  describe("today, and distance from it", () => {
    it("reads today off the local calendar, so it round-trips through the column", () => {
      const now = new Date(2026, 7, 20, 23, 30);
      expect(todayCalendarDate(now)).toBe("2026-08-20");
      expect(startOfLocalDay(now).getHours()).toBe(0);
    });

    it("counts whole days, measured midnight to midnight", () => {
      const now = new Date(2026, 7, 20, 23, 30);
      expect(calendarDaysFromToday("2026-08-20", now)).toBe(0);
      expect(calendarDaysFromToday("2026-08-21", now)).toBe(1);
      expect(calendarDaysFromToday("2026-08-19", now)).toBe(-1);
      expect(calendarDaysFromToday(null, now)).toBeNull();
    });

    it("does not call today overdue, at any hour of the day", () => {
      // The half of the bug that mattered most: an item due today reading as
      // overdue is worse than a label being a day out, because it is a red pill
      // on work nobody is late on.
      expect(isCalendarDateOverdue("2026-08-20", new Date(2026, 7, 20, 0, 1))).toBe(false);
      expect(isCalendarDateOverdue("2026-08-20", new Date(2026, 7, 20, 23, 59))).toBe(false);
      expect(isCalendarDateOverdue("2026-08-19", new Date(2026, 7, 20, 0, 1))).toBe(true);
    });
  });

  describe("the label a row shows", () => {
    const now = new Date(2026, 7, 20, 9, 0);

    it("uses words for the days a crew talks about in words", () => {
      expect(calendarDueLabel("2026-08-20", now)!.label).toBe("Today");
      expect(calendarDueLabel("2026-08-21", now)!.label).toBe("Tomorrow");
      expect(calendarDueLabel("2026-08-19", now)!.label).toBe("Yesterday");
    });

    it("shows the date the value says for everything else", () => {
      // en-US so the assertion is stable wherever CI runs.
      expect(formatCalendarDate("2026-08-25", { month: "short", day: "numeric" }, "en-US")).toBe(
        "Aug 25",
      );
      // The exact case from the report: entered as 08/20, shown as Aug 20.
      expect(formatCalendarDate("2026-08-20", { month: "short", day: "numeric" }, "en-US")).toBe(
        "Aug 20",
      );
    });

    it("marks the past as overdue and the future as not", () => {
      expect(calendarDueLabel("2026-08-10", now)!.overdue).toBe(true);
      expect(calendarDueLabel("2026-09-10", now)!.overdue).toBe(false);
      expect(calendarDueLabel("2026-08-20", now)!.overdue).toBe(false);
    });

    it("returns null rather than an Invalid Date pill", () => {
      expect(calendarDueLabel(null, now)).toBeNull();
      expect(formatCalendarDate(null)).toBe("");
    });
  });

  /*
   * The helper being right is only half of it. The bug was one `new Date()` in
   * one render, and the same construct existed in three places - the task row,
   * the board card and the group page - so fixing the one the client happened
   * to photograph would have left the other two shifting the same date.
   */
  describe("the screens that show a due date use it", () => {
    const SURFACES = [
      "apps/web/src/features/projects/components/ProjectTasks.tsx",
      "apps/web/src/features/projects/pages/GroupPage.tsx",
    ];

    it.each(SURFACES)("%s parses due dates through the shared helper", (rel) => {
      const src = read(rel);
      expect(src).toContain("@sitepix/shared");
      expect(src).toMatch(/formatCalendarDate|calendarDueLabel|isCalendarDateOverdue/);
    });

    it.each(SURFACES)("%s no longer hands due_date to the Date constructor", (rel) => {
      const src = codeOf(read(rel));
      expect(src).not.toMatch(/new Date\(\s*t\.due_date\s*\)/);
      expect(src).not.toMatch(/new Date\(\s*dueDate\s*\)/);
    });
  });
});
