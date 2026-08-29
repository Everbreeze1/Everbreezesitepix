import { describe, expect, it } from "vitest";
import {
  bucketOf,
  capturedTodayLabel,
  countToday,
  daysUntil,
  dueLabel,
  greeting,
  headline,
  needsYou,
  todayIso,
  type DashTask,
} from "../apps/mobile/src/api/dashboard-view";

/*
 * The home screen's arithmetic.
 *
 * Almost all of it is date comparison, and date comparison is where this kind
 * of screen goes wrong. A task due "2026-08-29" is due today for somebody in
 * Manchester at 11pm; comparing it against `Date.now()` makes it overdue six
 * hours early, and the person sees red on a task they have all day to do.
 *
 * `new Date(2026, 7, 29, ...)` throughout: local parts, which is what the
 * device has, rather than a UTC string.
 */

const task = (over: Partial<DashTask> = {}): DashTask => ({
  id: "t1",
  project_id: "p1",
  title: "Reseal the flashing",
  status: "open",
  priority: "normal",
  due_date: null,
  ...over,
});

describe("todayIso", () => {
  it("reads local parts, not UTC", () => {
    /*
     * The case that matters. `toISOString` on 11pm local, west of Greenwich,
     * names tomorrow; east of it, 1am names yesterday. Either way the day the
     * crew was on site is not the day the screen says.
     */
    expect(todayIso(new Date(2026, 7, 29, 23, 30))).toBe("2026-08-29");
    expect(todayIso(new Date(2026, 7, 29, 0, 30))).toBe("2026-08-29");
  });

  it("pads", () => {
    expect(todayIso(new Date(2026, 0, 4))).toBe("2026-01-04");
  });
});

describe("daysUntil", () => {
  const now = new Date(2026, 7, 29, 14, 0);

  it("counts whole calendar days either way", () => {
    expect(daysUntil("2026-08-29", now)).toBe(0);
    expect(daysUntil("2026-08-30", now)).toBe(1);
    expect(daysUntil("2026-08-27", now)).toBe(-2);
  });

  it("is not moved by the time of day", () => {
    // Same answer at one minute past midnight and at one minute to.
    expect(daysUntil("2026-08-30", new Date(2026, 7, 29, 0, 1))).toBe(1);
    expect(daysUntil("2026-08-30", new Date(2026, 7, 29, 23, 59))).toBe(1);
  });

  it("crosses a month and a year end", () => {
    expect(daysUntil("2026-09-01", new Date(2026, 7, 31))).toBe(1);
    expect(daysUntil("2027-01-01", new Date(2026, 11, 31))).toBe(1);
  });

  it("returns null rather than NaN for anything that is not a date", () => {
    // A NaN in here renders as an empty badge on a task that looks fine, which
    // is worse than no badge at all.
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil("", now)).toBeNull();
    expect(daysUntil("soon", now)).toBeNull();
    expect(daysUntil("2026-08-29T10:00:00Z", now)).toBeNull();
  });
});

describe("bucketOf", () => {
  const now = new Date(2026, 7, 29, 9, 0);

  it("sorts a date into the four buckets", () => {
    expect(bucketOf({ due_date: "2026-08-28" }, now)).toBe("overdue");
    expect(bucketOf({ due_date: "2026-08-29" }, now)).toBe("today");
    expect(bucketOf({ due_date: "2026-09-02" }, now)).toBe("soon");
    expect(bucketOf({ due_date: "2026-10-02" }, now)).toBe("later");
    expect(bucketOf({ due_date: null }, now)).toBe("none");
  });

  it("puts the seventh day inside the horizon and the eighth outside", () => {
    // A week, because that is what a crew plans over. Anything past it is
    // information rather than a call to action.
    expect(bucketOf({ due_date: "2026-09-05" }, now)).toBe("soon");
    expect(bucketOf({ due_date: "2026-09-06" }, now)).toBe("later");
  });
});

describe("needsYou", () => {
  const now = new Date(2026, 7, 29, 9, 0);

  it("keeps only overdue and due today", () => {
    /*
     * The whole point of the screen is that it is shorter than the task list.
     * Including "soon" turns it back into the task list with a greeting on top.
     */
    const out = needsYou(
      [
        task({ id: "late", due_date: "2026-08-27" }),
        task({ id: "today", due_date: "2026-08-29" }),
        task({ id: "soon", due_date: "2026-09-01" }),
        task({ id: "undated", due_date: null }),
      ],
      now,
    );
    expect(out.map((t) => t.id)).toEqual(["late", "today"]);
  });

  it("drops anything already done", () => {
    expect(needsYou([task({ id: "d", due_date: "2026-08-27", status: "done" })], now)).toHaveLength(
      0,
    );
  });

  it("puts the most overdue first", () => {
    // A task three days late outranks one due this afternoon.
    const out = needsYou(
      [
        task({ id: "a", due_date: "2026-08-29" }),
        task({ id: "b", due_date: "2026-08-26" }),
        task({ id: "c", due_date: "2026-08-28" }),
      ],
      now,
    );
    expect(out.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks a tie on priority", () => {
    const out = needsYou(
      [
        task({ id: "normal", due_date: "2026-08-29", priority: "normal" }),
        task({ id: "urgent", due_date: "2026-08-29", priority: "urgent" }),
        task({ id: "low", due_date: "2026-08-29", priority: "low" }),
      ],
      now,
    );
    expect(out.map((t) => t.id)).toEqual(["urgent", "normal", "low"]);
  });

  it("treats an unknown priority as normal rather than sorting it to an end", () => {
    const out = needsYou(
      [
        task({ id: "weird", due_date: "2026-08-29", priority: "blocker" }),
        task({ id: "urgent", due_date: "2026-08-29", priority: "urgent" }),
        task({ id: "low", due_date: "2026-08-29", priority: "low" }),
      ],
      now,
    );
    expect(out.map((t) => t.id)).toEqual(["urgent", "weird", "low"]);
  });
});

describe("dueLabel", () => {
  const now = new Date(2026, 7, 29, 9, 0);

  it("says what somebody can act on, not a date", () => {
    // "2 days late" is a fact. "2026-08-27" is arithmetic they have to do
    // before they know whether to care.
    expect(dueLabel("2026-08-27", now)).toBe("2 days late");
    expect(dueLabel("2026-08-28", now)).toBe("1 day late");
    expect(dueLabel("2026-08-29", now)).toBe("Due today");
    expect(dueLabel("2026-08-30", now)).toBe("Due tomorrow");
    expect(dueLabel("2026-09-02", now)).toBe("Due in 4 days");
  });

  it("falls back to the date past the horizon", () => {
    expect(dueLabel("2026-12-01", now)).toBe("Due 2026-12-01");
  });

  it("is null when there is no date", () => {
    expect(dueLabel(null, now)).toBeNull();
  });
});

describe("greeting", () => {
  it("turns over at the hours a working day actually does", () => {
    // "Good evening" at 5pm to somebody still on a roof reads as wrong.
    expect(greeting(new Date(2026, 7, 29, 7))).toBe("Good morning");
    expect(greeting(new Date(2026, 7, 29, 11, 59))).toBe("Good morning");
    expect(greeting(new Date(2026, 7, 29, 12))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 7, 29, 17, 59))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 7, 29, 18))).toBe("Good evening");
  });
});

describe("headline", () => {
  it("leads with the queue, which is the only thing that can be lost", () => {
    expect(headline({ queued: 3, overdue: 9, dueToday: 4, unread: 7 })).toBe(
      "3 changes still to send",
    );
    expect(headline({ queued: 1, overdue: 0, dueToday: 0, unread: 0 })).toBe(
      "1 change still to send",
    );
  });

  it("then overdue, then due today, then unread", () => {
    expect(headline({ queued: 0, overdue: 2, dueToday: 5, unread: 9 })).toBe("2 tasks are overdue");
    expect(headline({ queued: 0, overdue: 1, dueToday: 5, unread: 9 })).toBe("1 task is overdue");
    expect(headline({ queued: 0, overdue: 0, dueToday: 1, unread: 9 })).toBe("1 task due today");
    expect(headline({ queued: 0, overdue: 0, dueToday: 0, unread: 2 })).toBe(
      "2 unread notifications",
    );
  });

  it("says so when nothing needs anybody", () => {
    // A real answer, and the one a well-run crew should see most mornings.
    expect(headline({ queued: 0, overdue: 0, dueToday: 0, unread: 0 })).toBe(
      "Nothing needs you right now",
    );
  });
});

describe("countToday", () => {
  const now = new Date(2026, 7, 29, 14, 0);

  it("counts by local calendar day", () => {
    /*
     * A photo taken at 11pm counts for the day the crew was on site. Comparing
     * against a 24-hour window instead would drop this morning's captures at
     * 9am tomorrow and keep last night's until midday.
     */
    const late = new Date(2026, 7, 29, 23, 30).toISOString();
    const early = new Date(2026, 7, 29, 0, 15).toISOString();
    const yesterday = new Date(2026, 7, 28, 14, 0).toISOString();
    expect(countToday([late, early, yesterday], now)).toBe(2);
  });

  it("ignores nulls and unparseable values", () => {
    expect(countToday([null, "not a time"], now)).toBe(0);
  });

  it("is zero on an empty list", () => {
    expect(countToday([], now)).toBe(0);
  });
});

describe("capturedTodayLabel", () => {
  it("reads naturally at every count", () => {
    expect(capturedTodayLabel(0)).toBe("No photos yet today");
    expect(capturedTodayLabel(1)).toBe("1 photo today");
    expect(capturedTodayLabel(9)).toBe("9 photos today");
  });
});
