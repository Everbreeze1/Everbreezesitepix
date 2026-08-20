import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  FolderKanban,
  Layers,
} from "lucide-react";
import { formatCalendarDate, todayCalendarDate } from "@sitepix/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SURFACE_CARD } from "@/components/ui/surface";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { coversRange } from "@/lib/workspace-calendar";
import type { AwaitingDateJob, ScheduleEntry, WorkspaceSchedule } from "@/lib/workspace-calendar";

/**
 * The workspace calendar: every project's forward-looking dates on one grid.
 *
 * The fourth destination on the projects page, beside Projects, Groups and
 * Pipelines, and a peer of them rather than a refinement: it is a different
 * kind of content, not a filtered project list. The client's words for why it
 * exists are quoted in full in apps/web/src/lib/workspace-calendar.ts, which
 * is also where the two data sources and the ordering rules live. This file is
 * only the rendering.
 *
 * ## Why this is not the Calendar that already existed
 *
 * `PhotoCalendar` is a per-project view of capture activity: which days the
 * crew shot photos on that one job. It looks backwards and it is scoped to a
 * single project, and it stays exactly as it is, because reviewing a job's
 * capture history is a real thing people do. This is the other axis: every
 * project, and only dates that have not happened yet or have been missed.
 *
 * ## The layout, and why the rail is not optional
 *
 * A month grid alone answers "which days are busy" and refuses to answer "what
 * exactly". Thirty-one cells cannot hold a punch list, so each cell shows at
 * most three entries and a "+N more", and the rail beside it is where a day is
 * actually read. The rail opens on today, because "what's due today" is the
 * first question in the brief and it should cost zero clicks.
 *
 * Overdue work sits in the rail permanently rather than only when you happen
 * to page back to the month it slipped in. Something three weeks late is not
 * something you should have to go looking for.
 */
const WEEKDAYS = [
  { key: "sun", label: "S" },
  { key: "mon", label: "M" },
  { key: "tue", label: "T" },
  { key: "wed", label: "W" },
  { key: "thu", label: "T" },
  { key: "fri", label: "F" },
  { key: "sat", label: "S" },
];

/** Past this a cell is a wall of text, and the rail is the place to read it. */
const CELL_ENTRY_LIMIT = 3;

const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

export function WorkspaceCalendar({
  schedule,
  loading,
  error,
  onRetry,
  canSchedule,
  onSetScheduledDate,
}: {
  schedule: WorkspaceSchedule;
  loading: boolean;
  /** Non-null when the task read failed, so an empty month cannot pose as a quiet one. */
  error: string | null;
  onRetry: () => void;
  /**
   * False until 20260923000000_project_scheduled_date.sql is applied. The jobs
   * still list; the date controls that could only fail are not offered.
   */
  canSchedule: boolean;
  onSetScheduledDate: (projectId: string, date: string | null) => void;
}) {
  const today = todayCalendarDate();
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<string>(today);

  const gridDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month)),
        end: endOfWeek(endOfMonth(month)),
      }),
    [month],
  );

  /*
   * The grid pages without limit; the task read does not. Booked jobs are not
   * windowed either, so a month outside the read would draw jobs and silently
   * no tasks - a half-true month that reads as a quiet one. Say it instead.
   */
  const monthCovered = coversRange(
    schedule.taskCoverage,
    dayKey(startOfMonth(month)),
    dayKey(endOfMonth(month)),
  );

  const dayEntries = schedule.byDate.get(selectedDay) ?? [];
  const selectedDate = useMemo(() => new Date(`${selectedDay}T00:00:00`), [selectedDay]);
  const openToday = schedule.today.filter((e) => !e.done).length;

  const goToDay = (day: string) => {
    setSelectedDay(day);
    const asDate = new Date(`${day}T00:00:00`);
    if (!isSameMonth(asDate, month)) setMonth(startOfMonth(asDate));
  };

  const nothingAtAll =
    !loading && !error && schedule.entries.length === 0 && schedule.awaitingDate.length === 0;

  if (nothingAtAll) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Nothing is dated yet"
        description="This calendar reads two things across every project: the due dates on tasks, and the day a job is booked for. Put a due date on a task, or give a job in a Scheduled pipeline stage a date, and it lands here."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:items-start">
      <Card className={cn(SURFACE_CARD, "p-4 sm:p-5")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
              Workspace schedule
            </p>
            <h2 className="font-display mt-1.5 text-2xl font-bold leading-none tracking-[-0.6px]">
              {format(month, "MMMM yyyy")}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                setMonth(startOfMonth(new Date()));
                setSelectedDay(today);
              }}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setMonth(addMonths(month, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setMonth(addMonths(month, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* The three numbers the tab exists to produce. Each is a button,
            because reading "4 overdue" and wanting to see the four is one
            gesture, not two. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {error ? (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              Couldn&apos;t load task due dates
              <button
                type="button"
                onClick={onRetry}
                className="underline underline-offset-2 hover:no-underline"
              >
                Retry
              </button>
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => goToDay(today)}
                className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground transition hover:text-foreground"
              >
                <CalendarDays className="h-3.5 w-3.5" />
                {openToday} due today
              </button>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" />
                {schedule.next7.length} in the next 7 days
              </span>
              {schedule.overdue.length > 0 && (
                <button
                  type="button"
                  onClick={() => goToDay(schedule.overdue[0].date)}
                  className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-destructive transition hover:underline"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {schedule.overdue.length} overdue
                </button>
              )}
              {loading && (
                <span className="text-[11.5px] font-semibold text-muted-foreground">Loading…</span>
              )}
              {/* Both of these are "what you are looking at is short, and here
                  is why", which is the one thing a calendar must never leave
                  the reader to work out. */}
              {!monthCovered && (
                <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Task due dates aren&apos;t loaded this far out. Booked jobs still show.
                </span>
              )}
              {schedule.taskCoverage?.capped && (
                <span className="text-[11.5px] font-bold text-amber-600 dark:text-amber-400">
                  Too many dated tasks to load at once - the far future is cut off
                </span>
              )}
            </>
          )}
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1 sm:gap-1.5">
          {WEEKDAYS.map((d) => (
            <div
              key={d.key}
              className="pb-1 text-center text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground"
            >
              {d.label}
            </div>
          ))}

          {gridDays.map((day) => {
            const k = dayKey(day);
            const entries = schedule.byDate.get(k) ?? [];
            const outside = !isSameMonth(day, month);
            const isSelected = selectedDay === k;
            const hasLate = entries.some((e) => e.overdue);

            return (
              <button
                key={k}
                type="button"
                onClick={() => setSelectedDay(k)}
                aria-pressed={isSelected}
                aria-label={`${format(day, "EEEE d MMMM")}, ${entries.length} ${
                  entries.length === 1 ? "entry" : "entries"
                }`}
                className={cn(
                  "flex min-h-[74px] flex-col gap-1 rounded-xl border p-1.5 text-left transition sm:min-h-[104px]",
                  outside
                    ? "border-transparent bg-transparent opacity-40"
                    : "border-border hover:border-primary/50",
                  isSelected && "border-primary ring-2 ring-primary/25",
                  !outside && entries.length === 0 && "bg-muted/20",
                )}
              >
                <span className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "text-[11px] font-extrabold tabular-nums",
                      isToday(day)
                        ? "flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  {hasLate && (
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
                      title="Something here is overdue"
                    />
                  )}
                </span>

                {/* Phones get dots, because a 48px-wide cell cannot hold a
                    readable title and a truncated one is worse than a mark
                    saying "there is something here". */}
                {entries.length > 0 && (
                  <span className="flex flex-wrap gap-0.5 sm:hidden">
                    {entries.slice(0, 4).map((e) => (
                      <span
                        key={e.key}
                        aria-hidden
                        className={cn("h-1.5 w-1.5 rounded-full", e.done && "opacity-40")}
                        style={{ backgroundColor: e.color }}
                      />
                    ))}
                  </span>
                )}

                <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                  {entries.slice(0, CELL_ENTRY_LIMIT).map((e) => (
                    <span
                      key={e.key}
                      className={cn(
                        "flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-bold leading-tight",
                        e.done ? "text-muted-foreground line-through" : "text-foreground",
                        e.kind === "job" ? "bg-muted/70" : "bg-transparent",
                      )}
                    >
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: e.color }}
                      />
                      <span className="truncate">{e.title}</span>
                    </span>
                  ))}
                  {entries.length > CELL_ENTRY_LIMIT && (
                    <span className="px-1 text-[10px] font-extrabold text-muted-foreground">
                      +{entries.length - CELL_ENTRY_LIMIT} more
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* The rail: where a day is actually read. */}
      <Card className={cn(SURFACE_CARD, "overflow-hidden p-0 lg:sticky lg:top-4")}>
        <div className="border-b border-border/60 px-4 py-3.5">
          <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
            {selectedDay === today ? "Today" : "Selected day"}
          </p>
          <h3 className="font-display mt-1.5 text-xl font-bold leading-none tracking-[-0.4px]">
            {format(selectedDate, "EEEE, d MMM")}
          </h3>
          <p className="mt-1.5 text-xs font-semibold text-muted-foreground">
            {dayEntries.length === 0
              ? "Nothing dated on this day."
              : `${dayEntries.length} ${dayEntries.length === 1 ? "entry" : "entries"}`}
          </p>
        </div>

        <div className="max-h-[560px] space-y-4 overflow-y-auto p-3">
          {dayEntries.length > 0 && (
            <div className="space-y-1.5">
              {dayEntries.map((e) => (
                <EntryRow
                  key={e.key}
                  entry={e}
                  canSchedule={canSchedule}
                  onSetScheduledDate={onSetScheduledDate}
                />
              ))}
            </div>
          )}

          {schedule.overdue.length > 0 && (
            <RailSection
              icon={AlertTriangle}
              title={`${schedule.overdue.length} overdue`}
              tone="destructive"
              description="Open, and the day has passed. Listed here whichever month you are looking at."
            >
              {schedule.overdue.slice(0, 12).map((e) => (
                <EntryRow
                  key={e.key}
                  entry={e}
                  showDate
                  canSchedule={canSchedule}
                  onSetScheduledDate={onSetScheduledDate}
                />
              ))}
              {schedule.overdue.length > 12 && (
                <p className="px-1 pt-1 text-[11px] font-semibold text-muted-foreground">
                  Showing the 12 oldest of {schedule.overdue.length}.
                </p>
              )}
            </RailSection>
          )}

          {schedule.awaitingDate.length > 0 && (
            <RailSection
              icon={CircleSlash}
              title={`${schedule.awaitingDate.length} awaiting a date`}
              description={
                canSchedule
                  ? "Sitting in a Scheduled pipeline stage with no day booked. Pick one and it lands on the grid."
                  : "Sitting in a Scheduled pipeline stage with no day booked."
              }
            >
              {schedule.awaitingDate.map((job) => (
                <AwaitingRow
                  key={job.projectId}
                  job={job}
                  canSchedule={canSchedule}
                  onSetScheduledDate={onSetScheduledDate}
                />
              ))}
            </RailSection>
          )}
        </div>
      </Card>
    </div>
  );
}

function RailSection({
  icon: Icon,
  title,
  description,
  tone,
  children,
}: {
  icon: typeof AlertTriangle;
  title: string;
  description?: string;
  tone?: "destructive";
  children: ReactNode;
}) {
  return (
    <div className="border-t border-border/60 pt-3 first:border-t-0 first:pt-0">
      <p
        className={cn(
          "flex items-center gap-1.5 px-1 font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px]",
          tone === "destructive" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {title}
      </p>
      {description && (
        <p className="mt-1 px-1 text-[11px] font-medium text-muted-foreground">{description}</p>
      )}
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  );
}

/**
 * One dated thing, and the way through to the job it belongs to.
 *
 * A task carries `?task=<id>`, which the project route already understands:
 * it opens the Tasks tab with that task expanded. A job has nowhere more
 * specific to land than its own page. Either way the click is one hop, which
 * is the whole point of aggregating in the first place.
 */
function EntryRow({
  entry,
  showDate,
  canSchedule,
  onSetScheduledDate,
}: {
  entry: ScheduleEntry;
  showDate?: boolean;
  canSchedule: boolean;
  onSetScheduledDate: (projectId: string, date: string | null) => void;
}) {
  return (
    <div
      className={cn(
        "group rounded-xl border border-border/70 bg-card/60 p-2 transition hover:border-primary/40",
        entry.overdue && "border-destructive/40 bg-destructive/5",
      )}
    >
      <Link
        to="/projects/$projectId"
        params={{ projectId: entry.projectId }}
        search={entry.taskId ? { task: entry.taskId } : {}}
        className="flex min-w-0 items-start gap-2"
      >
        <span
          aria-hidden
          className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", entry.done && "opacity-40")}
          style={{ backgroundColor: entry.color }}
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-xs font-bold",
              entry.done ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {entry.title}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            {entry.kind === "job" ? (
              <Layers className="h-3 w-3 shrink-0" />
            ) : (
              <FolderKanban className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">
              {entry.kind === "job" ? (entry.detail ?? "No pipeline stage") : entry.projectName}
            </span>
            {/* Who it is on. "What's due today" is half an answer without it,
                and it is the one field a person would otherwise open the task
                to read. */}
            {entry.kind === "task" && entry.detail && (
              <span className="hidden shrink-0 truncate opacity-80 sm:inline">{entry.detail}</span>
            )}
            {showDate && (
              <span className="shrink-0 tabular-nums">{formatCalendarDate(entry.date)}</span>
            )}
          </span>
        </span>
        {entry.done ? (
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
        )}
      </Link>

      {/* Moving a booked job is a calendar's job, so it does not send anyone to
          the project page and back. Tasks are not editable here on purpose:
          a due date is one field of a task that also has an assignee, a
          checklist and a thread, and the Tasks tab is where that whole record
          lives. */}
      {entry.kind === "job" && canSchedule && (
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-border/50 pt-1.5">
          <CalendarDays className="h-3 w-3 shrink-0 text-muted-foreground" />
          <input
            type="date"
            value={entry.date}
            onChange={(ev) => onSetScheduledDate(entry.projectId, ev.target.value || null)}
            className="w-[118px] bg-transparent text-[11px] font-semibold outline-none"
            aria-label={`Reschedule ${entry.projectName}`}
          />
          <button
            type="button"
            onClick={() => onSetScheduledDate(entry.projectId, null)}
            className="ml-auto text-[11px] font-bold text-muted-foreground underline underline-offset-2 hover:text-foreground hover:no-underline"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function AwaitingRow({
  job,
  canSchedule,
  onSetScheduledDate,
}: {
  job: AwaitingDateJob;
  canSchedule: boolean;
  onSetScheduledDate: (projectId: string, date: string | null) => void;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-2">
      <Link
        to="/projects/$projectId"
        params={{ projectId: job.projectId }}
        className="flex min-w-0 items-center gap-2"
      >
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: job.stageColor }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold">{job.projectName}</span>
          <span className="block truncate text-[11px] font-semibold text-muted-foreground">
            {job.stageName}
          </span>
        </span>
      </Link>
      {canSchedule && (
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-border/50 pt-1.5">
          <CalendarDays className="h-3 w-3 shrink-0 text-muted-foreground" />
          <input
            type="date"
            value=""
            onChange={(ev) => ev.target.value && onSetScheduledDate(job.projectId, ev.target.value)}
            className="w-[118px] bg-transparent text-[11px] font-semibold outline-none"
            aria-label={`Book a day for ${job.projectName}`}
          />
        </div>
      )}
    </div>
  );
}
