import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attentionCount,
  buildWorkspaceSchedule,
  dayCellLabel,
  dayTitle,
  inMonth,
  monthGridDays,
  monthTitle,
  supportsScheduledDate,
} from "../apps/mobile/src/api/workspace-schedule-view";

/*
 * The workspace Schedule on the phone: the web's Schedule tab, with the same
 * bucketing (ported from apps/web/src/lib/workspace-schedule.ts) and a month
 * grid built without date-fns.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const NOW = new Date(2026, 8, 15, 10, 0, 0); // 15 September 2026, local

describe("buildWorkspaceSchedule", () => {
  const stages = new Map([
    ["st-sched", { id: "st-sched", name: "Scheduled", color: "#3b82f6" }],
    ["st-lead", { id: "st-lead", name: "Lead/Quoted", color: "#64748b" }],
  ]);
  const schedule = buildWorkspaceSchedule({
    now: NOW,
    stagesById: stages,
    projects: [
      { id: "p1", name: "Booked", status: "active", scheduled_date: "2026-09-15" },
      {
        id: "p2",
        name: "Waiting",
        status: "active",
        pipeline_stage_id: "st-sched",
        scheduled_date: null,
      },
      {
        id: "p3",
        name: "Lead",
        status: "active",
        pipeline_stage_id: "st-lead",
        scheduled_date: null,
      },
      { id: "p4", name: "Archived", archived: true, scheduled_date: "2026-09-15" },
    ],
    tasks: [
      { id: "t1", project_id: "p1", title: "Late", status: "open", due_date: "2026-09-10" },
      { id: "t2", project_id: "p1", title: "Done late", status: "done", due_date: "2026-09-10" },
      { id: "t3", project_id: "p4", title: "On archived", status: "open", due_date: "2026-09-16" },
      { id: "t4", project_id: "p1", title: "Soon", status: "open", due_date: "2026-09-18" },
    ],
  });

  it("puts booked jobs and dated tasks on their days, archived work left out", () => {
    expect(schedule.byDate.get("2026-09-15")?.map((e) => e.key)).toEqual(["job:p1"]);
    expect(schedule.entries.some((e) => e.projectId === "p4")).toBe(false);
  });

  it("calls open past work overdue, never finished work", () => {
    expect(schedule.overdue.map((e) => e.key)).toEqual(["task:t1"]);
  });

  it("lists a job in a Scheduled stage with no day as awaiting a date", () => {
    expect(schedule.awaitingDate.map((j) => j.projectId)).toEqual(["p2"]);
  });

  it("counts what needs attention: overdue plus open today", () => {
    expect(attentionCount(schedule)).toBe(2);
    expect(schedule.next7.map((e) => e.key)).toEqual(["job:p1", "task:t4"]);
  });

  it("only offers booking when the database has the column", () => {
    expect(supportsScheduledDate([{ id: "a", name: "a" }])).toBe(false);
    expect(supportsScheduledDate([{ id: "a", name: "a", scheduled_date: null }])).toBe(true);
  });
});

describe("the month grid", () => {
  it("draws whole weeks from Sunday", () => {
    const days = monthGridDays(new Date(2026, 8, 1));
    expect(days.length % 7).toBe(0);
    expect(days[0]).toBe("2026-08-30");
    expect(days[days.length - 1]).toBe("2026-10-03");
    expect(days).toContain("2026-09-30");
  });

  it("knows which days are in the month and names them", () => {
    expect(inMonth("2026-09-01", new Date(2026, 8, 20))).toBe(true);
    expect(inMonth("2026-08-31", new Date(2026, 8, 20))).toBe(false);
    expect(monthTitle(new Date(2026, 8, 1))).toBe("September 2026");
    expect(dayTitle("2026-09-29")).toBe("Tuesday, 29 September");
    expect(dayCellLabel("2026-09-29", 1)).toBe("Tuesday, 29 September, 1 entry");
  });
});

describe("the Schedule screen", () => {
  const screen = read("apps/mobile/app/(app)/schedule.tsx");
  const api = read("apps/mobile/src/api/schedule.ts");

  it("is registered with the menu button and listed in the app menu", () => {
    expect(read("apps/mobile/app/(app)/_layout.tsx")).toContain(
      '<Stack.Screen name="schedule" options={{ title: "Schedule", ...MENU_DESTINATION }} />',
    );
    expect(read("apps/mobile/src/lib/app-menu.ts")).toContain(
      '{ label: "Schedule", href: "/schedule", icon: "schedule" }',
    );
  });

  it("books and clears a job's day with the web's update, and asks before clearing", () => {
    expect(api).toContain(".update({ scheduled_date: date } as never)");
    expect(screen).toContain('"Clear the booked day?"');
    expect(screen).toContain('style: "destructive"');
  });

  it("reads task due dates in the web's bounded window", () => {
    expect(api).toContain("LOOK_BACK_DAYS = 180");
    expect(api).toContain("LOOK_AHEAD_DAYS = 550");
    expect(api).toContain("TASK_LIMIT = 2000");
  });

  it("puts the day list beside the grid on a tablet or a phone on its side", () => {
    expect(screen).toContain("const side = layout.spread || layout.tablet;");
  });
});
