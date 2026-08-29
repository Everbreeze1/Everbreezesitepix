/**
 * The home screen's arithmetic: what needs somebody today.
 *
 * Import-free so it can be tested, and separate from the screen because the
 * bucketing is the only interesting part. The web dashboard is a widget grid of
 * counts and a sparkline, which answers "how is the business doing". That is a
 * question somebody asks at a desk. The person holding the phone is standing on
 * a site and asks a different one, so this file computes that instead.
 *
 * All dates are compared as **calendar dates in local time**, never as
 * timestamps. A task due today is due today for somebody in Manchester at 11pm,
 * and comparing `Date.now()` against a `due_date` of "2026-08-29" makes it
 * overdue six hours early.
 */

export type DashTask = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
};

/**
 * When a task needs attention.
 *
 * Four buckets and not a sorted list, because the answer to "what needs me" is
 * a shape rather than an order: three overdue is a different morning from
 * three due next week, and a flat list sorted by date makes the two look the
 * same until you read the dates.
 */
export type DueBucket = "overdue" | "today" | "soon" | "later" | "none";

/** Today as a calendar date string, from local parts. */
export function todayIso(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Whole days from today to a calendar date, or null if it has none.
 *
 * Built from local parts on both sides so it never crosses a day boundary
 * because of a timezone. `Date.UTC` on the parts rather than `new Date(iso)`,
 * which parses a bare date as midnight UTC and lands on the previous day for
 * anyone west of Greenwich.
 */
export function daysUntil(dueDate: string | null, now: Date = new Date()): number | null {
  if (!dueDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate.trim());
  if (!match) return null;

  const due = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / 86_400_000);
}

export function bucketOf(task: Pick<DashTask, "due_date">, now: Date = new Date()): DueBucket {
  const days = daysUntil(task.due_date, now);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  // A week, because that is the horizon a crew plans over. Anything past it is
  // information rather than a call to action.
  if (days <= 7) return "soon";
  return "later";
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/**
 * The tasks worth putting on a home screen, worst first.
 *
 * Only overdue and due-today, and only the ones assigned to the reader. A
 * home screen that lists every open task in the workspace is a task list with
 * extra steps, and the whole point of this screen is that it is shorter than
 * the task list.
 */
export function needsYou(tasks: DashTask[], now: Date = new Date()): DashTask[] {
  return tasks
    .filter((task) => task.status !== "done")
    .filter((task) => {
      const bucket = bucketOf(task, now);
      return bucket === "overdue" || bucket === "today";
    })
    .sort((a, b) => {
      // Overdue above due-today, then by how overdue, then by priority. A task
      // three days late outranks one due this afternoon.
      const byDays = (daysUntil(a.due_date, now) ?? 0) - (daysUntil(b.due_date, now) ?? 0);
      if (byDays !== 0) return byDays;
      return (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
    });
}

/**
 * How a due date reads on a card.
 *
 * Words rather than dates for the near ones, because "2 days late" is a fact
 * somebody can act on and "2026-08-27" is arithmetic they have to do first.
 */
export function dueLabel(dueDate: string | null, now: Date = new Date()): string | null {
  const days = daysUntil(dueDate, now);
  if (days === null) return null;
  if (days < -1) return `${Math.abs(days)} days late`;
  if (days === -1) return "1 day late";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 7) return `Due in ${days} days`;
  return `Due ${dueDate}`;
}

/**
 * The greeting.
 *
 * Split at the hours a working day actually turns over rather than at noon and
 * six: a crew that starts at seven is well into the morning by eight, and
 * "Good evening" at 5pm to somebody still on a roof reads as wrong.
 */
export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The one-line answer under the greeting.
 *
 * Ordered by what is most urgent, and it says the single most pressing thing
 * rather than reciting every count. A summary that lists four numbers is a
 * fifth thing to read.
 */
export function headline(counts: {
  overdue: number;
  dueToday: number;
  unread: number;
  queued: number;
}): string {
  if (counts.queued > 0) {
    return `${counts.queued} change${counts.queued === 1 ? "" : "s"} still to send`;
  }
  if (counts.overdue > 0) {
    return `${counts.overdue} task${counts.overdue === 1 ? " is" : "s are"} overdue`;
  }
  if (counts.dueToday > 0) {
    return `${counts.dueToday} task${counts.dueToday === 1 ? "" : "s"} due today`;
  }
  if (counts.unread > 0) {
    return `${counts.unread} unread notification${counts.unread === 1 ? "" : "s"}`;
  }
  return "Nothing needs you right now";
}

/**
 * Photos taken today, from a list of capture timestamps.
 *
 * Compared as local calendar dates, so a photo taken at 11pm counts for the day
 * the crew was actually on site rather than the next one.
 */
export function countToday(isoTimes: (string | null)[], now: Date = new Date()): number {
  const today = todayIso(now);
  return isoTimes.filter((iso) => {
    if (!iso) return false;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return false;
    return todayIso(at) === today;
  }).length;
}

/** The line under the day's capture count. */
export function capturedTodayLabel(count: number): string {
  if (count === 0) return "No photos yet today";
  return `${count} photo${count === 1 ? "" : "s"} today`;
}
