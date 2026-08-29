import { describe, expect, it } from "vitest";
import {
  byDate,
  dayHeading,
  daysInMonth,
  densityOf,
  isFutureMonth,
  isoDate,
  monthGrid,
  monthRange,
  monthSummary,
  shiftMonth,
  thisMonth,
  weekdayLabels,
  type TimelineDay,
} from "../apps/mobile/src/api/timeline-view";

/*
 * The month calendar.
 *
 * A calendar grid is the classic place an off-by-one survives review: the
 * leading blanks, the weekday the month starts on and the boundary a "month"
 * covers all look correct for whichever month somebody happened to check. So
 * the awkward months are checked explicitly - one starting on a Sunday, one
 * starting on a Monday, and February in a leap year.
 */

const day = (over: Partial<TimelineDay> = {}): TimelineDay => ({
  date: "2026-08-29",
  photoCount: 3,
  projectCount: 1,
  coverUrl: null,
  projectNames: ["Riverside"],
  ...over,
});

describe("shiftMonth", () => {
  it("rolls the year over in both directions", () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
  });

  it("steps several months at once", () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -3)).toEqual({ year: 2025, month: 10 });
    expect(shiftMonth({ year: 2026, month: 10 }, 14)).toEqual({ year: 2028, month: 0 });
  });

  it("is its own inverse", () => {
    const start = { year: 2026, month: 0 };
    expect(shiftMonth(shiftMonth(start, -1), 1)).toEqual(start);
  });
});

describe("daysInMonth", () => {
  it("knows the short months and the leap year", () => {
    expect(daysInMonth({ year: 2026, month: 1 })).toBe(28);
    // 2028 is a leap year; 2100 is not, despite being divisible by four.
    expect(daysInMonth({ year: 2028, month: 1 })).toBe(29);
    expect(daysInMonth({ year: 2100, month: 1 })).toBe(28);
    expect(daysInMonth({ year: 2026, month: 3 })).toBe(30);
    expect(daysInMonth({ year: 2026, month: 0 })).toBe(31);
  });
});

describe("isoDate", () => {
  it("pads both parts", () => {
    expect(isoDate(2026, 0, 4)).toBe("2026-01-04");
    expect(isoDate(2026, 11, 31)).toBe("2026-12-31");
  });
});

describe("monthGrid", () => {
  it("fills whole weeks, always", () => {
    // Otherwise the last row reflows to a different width than the rest.
    for (let month = 0; month < 12; month++) {
      expect(monthGrid({ year: 2026, month }).length % 7).toBe(0);
    }
  });

  it("puts every day of the month in, once, in order", () => {
    const cells = monthGrid({ year: 2026, month: 7 });
    const days = cells.filter((c) => c !== null).map((c) => c!.day);
    expect(days).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("leads with the right number of blanks on a Monday-start week", () => {
    /*
     * 1 August 2026 is a Saturday. Monday-first, that is five leading blanks.
     * The `(x - start + 7) % 7` is what keeps this from being -1 on a month
     * that starts on a Sunday.
     */
    const cells = monthGrid({ year: 2026, month: 7 });
    expect(cells.slice(0, 5).every((c) => c === null)).toBe(true);
    expect(cells[5]).toEqual({ date: "2026-08-01", day: 1 });
  });

  it("handles a month starting on the very day the week starts", () => {
    // 1 June 2026 is a Monday: no leading blanks at all.
    const cells = monthGrid({ year: 2026, month: 5 });
    expect(cells[0]).toEqual({ date: "2026-06-01", day: 1 });
  });

  it("handles a month starting on a Sunday, which is the wrap case", () => {
    // 1 February 2026 is a Sunday. Monday-first, that is six leading blanks,
    // and the naive subtraction gives -1.
    const cells = monthGrid({ year: 2026, month: 1 });
    expect(cells.slice(0, 6).every((c) => c === null)).toBe(true);
    expect(cells[6]).toEqual({ date: "2026-02-01", day: 1 });
  });

  it("can start the week on Sunday if asked", () => {
    const cells = monthGrid({ year: 2026, month: 1 }, 0);
    expect(cells[0]).toEqual({ date: "2026-02-01", day: 1 });
  });
});

describe("weekdayLabels", () => {
  it("starts on Monday by default", () => {
    // A working week starts on Monday everywhere this is sold. Sunday-first
    // puts Saturday and Sunday at opposite ends of the row, which is the wrong
    // shape for reading a fortnight of site work.
    expect(weekdayLabels()).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    expect(weekdayLabels(0)).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
  });
});

describe("monthRange", () => {
  it("covers the whole month and stops at the next one", () => {
    const { from, to } = monthRange({ year: 2026, month: 7 });
    // Built from local midnight, so these are exact instants for the device's
    // own zone rather than a UTC day that may be a day out.
    expect(new Date(from).getFullYear()).toBe(2026);
    expect(new Date(from).getMonth()).toBe(7);
    expect(new Date(from).getDate()).toBe(1);
    expect(new Date(to).getMonth()).toBe(8);
    expect(new Date(to).getDate()).toBe(1);
  });

  it("rolls into the next year in December", () => {
    const { to } = monthRange({ year: 2026, month: 11 });
    expect(new Date(to).getFullYear()).toBe(2027);
    expect(new Date(to).getMonth()).toBe(0);
  });
});

describe("densityOf", () => {
  it("is fixed, not relative to the busiest day in view", () => {
    /*
     * Relative shading makes a quiet month look exactly like a busy one, which
     * is the single thing a heat calendar exists to distinguish, and it makes
     * two months incomparable when you page between them.
     */
    expect(densityOf(0)).toBe(0);
    expect(densityOf(1)).toBe(1);
    expect(densityOf(4)).toBe(1);
    expect(densityOf(5)).toBe(2);
    expect(densityOf(19)).toBe(2);
    expect(densityOf(20)).toBe(3);
    expect(densityOf(500)).toBe(3);
  });

  it("treats a negative count as empty rather than as a level", () => {
    expect(densityOf(-1)).toBe(0);
  });
});

describe("byDate", () => {
  it("indexes so a cell is a lookup rather than a scan", () => {
    const map = byDate([day({ date: "2026-08-01" }), day({ date: "2026-08-02" })]);
    expect(map.get("2026-08-01")?.date).toBe("2026-08-01");
    expect(map.get("2026-08-03")).toBeUndefined();
  });
});

describe("dayHeading", () => {
  it("names the project when there is only one", () => {
    // More useful than saying "1 project", which is a count of something the
    // reader can already see.
    expect(dayHeading(day())).toBe("3 photos at Riverside");
  });

  it("counts them when there are several", () => {
    expect(dayHeading(day({ projectCount: 3, projectNames: ["A", "B", "C"] }))).toBe(
      "3 photos across 3 projects",
    );
  });

  it("says nothing happened rather than showing a zero", () => {
    expect(dayHeading(undefined)).toBe("No photos on this day");
    expect(dayHeading(day({ photoCount: 0 }))).toBe("No photos on this day");
  });

  it("copes with a day whose project name did not come back", () => {
    expect(dayHeading(day({ projectNames: [] }))).toBe("3 photos");
  });

  it("gets the singular right", () => {
    expect(dayHeading(day({ photoCount: 1 }))).toBe("1 photo at Riverside");
  });
});

describe("isFutureMonth", () => {
  const now = new Date(2026, 7, 29);

  it("stops paging at the current month", () => {
    /*
     * A calendar of photographs has nothing in the future. Letting somebody
     * page into a run of empty grids reads as the app failing to load rather
     * than as there being nothing there.
     */
    expect(isFutureMonth({ year: 2026, month: 7 }, now)).toBe(true);
    expect(isFutureMonth({ year: 2026, month: 8 }, now)).toBe(true);
    expect(isFutureMonth({ year: 2027, month: 0 }, now)).toBe(true);
  });

  it("allows every past month", () => {
    expect(isFutureMonth({ year: 2026, month: 6 }, now)).toBe(false);
    expect(isFutureMonth({ year: 2025, month: 11 }, now)).toBe(false);
  });
});

describe("thisMonth", () => {
  it("reads local parts", () => {
    expect(thisMonth(new Date(2026, 7, 29, 23, 30))).toEqual({ year: 2026, month: 7 });
  });
});

describe("monthSummary", () => {
  it("totals photos and active days", () => {
    const summary = monthSummary(
      [
        day({ photoCount: 3 }),
        day({ date: "2026-08-30", photoCount: 5 }),
        day({ date: "2026-08-31", photoCount: 0 }),
      ],
      false,
    );
    expect(summary.photos).toBe(8);
    expect(summary.activeDays).toBe(2);
    expect(summary.text).toBe("8 photos across 2 days");
  });

  it("marks a capped count as a floor rather than presenting it as fact", () => {
    // The service says so when the range hit its row ceiling, and a short count
    // presented as a total is worse than no count.
    expect(monthSummary([day({ photoCount: 500 })], true).text).toContain("500+");
  });

  it("says nothing happened rather than showing zeroes", () => {
    expect(monthSummary([], false).text).toBe("Nothing captured this month");
    expect(monthSummary([day({ photoCount: 0 })], false).text).toBe("Nothing captured this month");
  });

  it("gets the singulars right", () => {
    expect(monthSummary([day({ photoCount: 1 })], false).text).toBe("1 photo across 1 day");
  });
});
