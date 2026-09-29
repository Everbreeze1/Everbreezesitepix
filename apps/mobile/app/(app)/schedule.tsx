import { useMemo, useState, type ReactNode } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router, Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCalendarDate, todayCalendarDate } from "@everlumen/shared";
import { listProjectBoards } from "@/api/pipelines";
import { listDatedTasks, listSchedulableProjects, setProjectScheduledDate } from "@/api/schedule";
import { isIsoDate, isoDaysFromToday } from "@/api/task-dates";
import {
  addMonthsDate,
  attentionCount,
  buildWorkspaceSchedule,
  coversRange,
  dayCellLabel,
  dayTitle,
  entryTypeLabel,
  inMonth,
  monthGridDays,
  monthTitle,
  startOfMonthDate,
  supportsScheduledDate,
  type AwaitingDateJob,
  type ScheduleEntry,
  type StageLite,
} from "@/api/workspace-schedule-view";
import { radius, spacing, useLayout, useTheme } from "@/theme";
import {
  Calendar,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleSlash,
  Layers,
  SquareCheckBig,
  Trash2,
  TriangleAlert,
} from "@/ui/icons";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  IconButton,
  Sheet,
  SkeletonList,
  Text,
  type LucideIcon,
} from "@/ui";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * The workspace Schedule: the web's Schedule tab on the projects page.
 *
 * Every project's forward dates on one grid: the day a job is booked for
 * (`projects.scheduled_date`) and every task's due date, across all jobs.
 * "What's due today" and "what's booked this week" without opening each
 * project. Reached from the app menu and from the calendar button on Projects.
 *
 * On a phone a day cell is too narrow for titles, so cells carry markers
 * (square for a job, round for a task, as on the web's phone layout) and the
 * tapped day's entries list underneath. On a tablet or a phone on its side the
 * list sits to the right of the grid, as the web's rail does.
 *
 * A booked job can be moved or cleared here, and a job waiting in a Scheduled
 * stage can be given a day, through the same `projects.scheduled_date` update
 * the web makes. Tasks open their own screen: a due date is one field of a task
 * that also has an assignee, a checklist and a thread.
 */
export default function ScheduleScreen() {
  const theme = useTheme();
  const layout = useLayout();
  const queryClient = useQueryClient();
  const today = todayCalendarDate();

  const [month, setMonth] = useState<Date>(() => startOfMonthDate(new Date()));
  const [selectedDay, setSelectedDay] = useState<string>(today);
  const [booking, setBooking] = useState<{ projectId: string; name: string; date: string | null } | null>(
    null,
  );
  const [failure, setFailure] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["schedule-projects"],
    queryFn: listSchedulableProjects,
    staleTime: 60_000,
  });
  const tasksQuery = useQuery({
    queryKey: ["schedule-tasks"],
    queryFn: listDatedTasks,
    staleTime: 60_000,
  });
  // Same key as Projects and Pipelines: one shared fetch of the boards.
  const boardsQuery = useQuery({
    queryKey: ["project-boards"],
    queryFn: listProjectBoards,
    staleTime: 60_000,
  });

  const stagesById = useMemo(() => {
    const out = new Map<string, StageLite>();
    for (const board of boardsQuery.data ?? []) {
      for (const stage of board.stages ?? []) {
        out.set(stage.id, { id: stage.id, name: stage.name, color: stage.color });
      }
    }
    return out;
  }, [boardsQuery.data]);

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const schedule = useMemo(
    () =>
      buildWorkspaceSchedule({
        projects,
        tasks: tasksQuery.data?.tasks ?? [],
        stagesById,
        taskCoverage: tasksQuery.data?.coverage ?? null,
      }),
    [projects, tasksQuery.data, stagesById],
  );
  const canSchedule = supportsScheduledDate(projects);

  const book = useMutation({
    mutationFn: (args: { projectId: string; date: string | null }) =>
      setProjectScheduledDate(args.projectId, args.date),
    onMutate: async ({ projectId, date }) => {
      await queryClient.cancelQueries({ queryKey: ["schedule-projects"] });
      const before = queryClient.getQueryData<typeof projects>(["schedule-projects"]);
      if (before) {
        queryClient.setQueryData(
          ["schedule-projects"],
          before.map((p) => (p.id === projectId ? { ...p, scheduled_date: date } : p)),
        );
      }
      return { before };
    },
    onSuccess: (_result, { date }) => {
      setFailure(null);
      if (date) goToDay(date);
    },
    onError: (error: unknown, _args, context) => {
      if (context?.before) queryClient.setQueryData(["schedule-projects"], context.before);
      setFailure(error instanceof Error ? error.message : "Could not change that date.");
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["schedule-projects"] }),
  });

  const goToDay = (day: string) => {
    setSelectedDay(day);
    const date = new Date(`${day}T00:00:00`);
    if (!inMonth(day, month)) setMonth(startOfMonthDate(date));
  };

  const refreshing = projectsQuery.isRefetching || tasksQuery.isRefetching;
  const refresh = () => {
    void projectsQuery.refetch();
    void tasksQuery.refetch();
    void boardsQuery.refetch();
  };

  const header = <Stack.Screen options={{ title: "Schedule" }} />;

  if (projectsQuery.isLoading) {
    return (
      <>
        {header}
        <SkeletonList rows={6} />
      </>
    );
  }
  if (projectsQuery.error) {
    return (
      <>
        {header}
        <ErrorState
          title="Could not load the schedule"
          message={projectsQuery.error instanceof Error ? projectsQuery.error.message : undefined}
          onRetry={refresh}
        />
      </>
    );
  }

  const nothingAtAll =
    !tasksQuery.isLoading &&
    !tasksQuery.error &&
    schedule.entries.length === 0 &&
    schedule.awaitingDate.length === 0;

  if (nothingAtAll) {
    return (
      <>
        {header}
        <EmptyState
          icon={CalendarClock}
          title="Nothing is dated yet"
          body="The schedule reads two things across every project: the due dates on tasks, and the day a job is booked for. Put a due date on a task, or give a job in a Scheduled pipeline stage a date, and it lands here."
        />
      </>
    );
  }

  const days = monthGridDays(month);
  const monthDays = days.filter((day) => inMonth(day, month));
  const monthCovered = coversRange(
    schedule.taskCoverage,
    monthDays[0] ?? today,
    monthDays[monthDays.length - 1] ?? today,
  );
  const dayEntries = schedule.byDate.get(selectedDay) ?? [];
  const openToday = schedule.today.filter((entry) => !entry.done).length;
  const waiting = attentionCount(schedule);
  const side = layout.spread || layout.tablet;
  const pad = spacing.lg + layout.safeSide;

  const openEntry = (entry: ScheduleEntry) => {
    if (entry.taskId) {
      router.push({
        pathname: "/task/[id]",
        params: { id: entry.taskId, projectId: entry.projectId },
      });
    } else {
      router.push({ pathname: "/project/[id]", params: { id: entry.projectId } });
    }
  };

  const grid = (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <View style={{ flex: 1 }}>
          <Text variant="overline" tone="muted">
            WORKSPACE SCHEDULE
          </Text>
          <Text variant="heading">{monthTitle(month)}</Text>
        </View>
        <Button
          label="Today"
          variant="outline"
          size="sm"
          onPress={() => {
            setMonth(startOfMonthDate(new Date()));
            setSelectedDay(today);
          }}
        />
        <IconButton
          icon={ChevronLeft}
          accessibilityLabel="Previous month"
          surface={false}
          onPress={() => setMonth((current) => addMonthsDate(current, -1))}
        />
        <IconButton
          icon={ChevronRight}
          accessibilityLabel="Next month"
          surface={false}
          onPress={() => setMonth((current) => addMonthsDate(current, 1))}
        />
      </View>

      {/* The numbers the tab exists to produce, each one a way to the entries. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Chip
            icon={Calendar}
            label={`${openToday} due today`}
            onPress={() => goToDay(today)}
          />
          <Chip icon={CalendarClock} label={`${schedule.next7.length} in the next 7 days`} />
          {schedule.overdue.length > 0 ? (
            <Chip
              icon={TriangleAlert}
              label={`${schedule.overdue.length} overdue`}
              selected
              onPress={() => goToDay(schedule.overdue[0].date)}
            />
          ) : null}
        </View>
      </ScrollView>

      {tasksQuery.error ? (
        <Pressable accessibilityRole="button" onPress={() => void tasksQuery.refetch()}>
          <Text variant="caption" tone="destructive">
            {"Couldn't load task due dates. Tap to retry."}
          </Text>
        </Pressable>
      ) : null}
      {!tasksQuery.error && !monthCovered ? (
        <Text variant="caption" tone="safety">
          {"Task due dates aren't loaded this far out. Booked jobs still show."}
        </Text>
      ) : null}
      {schedule.taskCoverage?.capped ? (
        <Text variant="caption" tone="safety">
          Too many dated tasks to load at once, so the far future is cut off.
        </Text>
      ) : null}
      {failure ? (
        <Text variant="caption" tone="destructive">
          {failure}
        </Text>
      ) : null}

      <View>
        <View style={{ flexDirection: "row" }}>
          {WEEKDAYS.map((label, i) => (
            <View key={i} style={{ flex: 1, alignItems: "center", paddingBottom: spacing.xs }}>
              <Text variant="overline" tone="muted">
                {label}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {days.map((day) => {
            const entries = schedule.byDate.get(day) ?? [];
            const outside = !inMonth(day, month);
            const selected = day === selectedDay;
            const late = entries.some((entry) => entry.overdue);
            const isToday = day === today;
            return (
              <View key={day} style={{ width: `${100 / 7}%`, padding: 2 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={dayCellLabel(day, entries.length)}
                  onPress={() => setSelectedDay(day)}
                  style={{
                    minHeight: side ? 64 : 52,
                    padding: 4,
                    gap: 3,
                    borderRadius: radius.md,
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected
                      ? theme.colors.primary
                      : outside
                        ? "transparent"
                        : theme.colors.border,
                    backgroundColor: outside ? "transparent" : theme.colors.card,
                    opacity: outside ? 0.4 : 1,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View
                      style={{
                        minWidth: 20,
                        height: 20,
                        borderRadius: radius.pill,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: isToday ? theme.colors.primary : "transparent",
                      }}
                    >
                      <Text variant="caption" tone={isToday ? "inverse" : "muted"}>
                        {String(Number(day.slice(8, 10)))}
                      </Text>
                    </View>
                    {late ? (
                      <View
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: theme.colors.destructive,
                        }}
                      />
                    ) : null}
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 2 }}>
                    {entries.slice(0, 4).map((entry) => (
                      <View
                        key={entry.key}
                        style={{
                          width: 7,
                          height: 7,
                          // The shape is the type: square for a job, round for a task.
                          borderRadius: entry.kind === "job" ? 1 : 4,
                          backgroundColor: entry.color,
                          opacity: entry.done ? 0.4 : 1,
                        }}
                      />
                    ))}
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
        <LegendItem icon={Layers} label={entryTypeLabel({ kind: "job", done: false, overdue: false })} />
        <LegendItem
          icon={SquareCheckBig}
          label={entryTypeLabel({ kind: "task", done: false, overdue: false })}
        />
        <LegendItem icon={CircleCheck} label="Done" />
        <LegendItem icon={TriangleAlert} label="Overdue" destructive />
      </View>
    </View>
  );

  const rail = (
    <View style={{ gap: spacing.lg }}>
      <View style={{ gap: 2 }}>
        <Text variant="overline" tone="muted">
          {selectedDay === today ? "TODAY" : "SELECTED DAY"}
        </Text>
        <Text variant="heading">{dayTitle(selectedDay)}</Text>
        <Text variant="caption" tone="muted">
          {dayEntries.length === 0
            ? "Nothing dated on this day."
            : `${dayEntries.length} ${dayEntries.length === 1 ? "entry" : "entries"}`}
        </Text>
      </View>

      {dayEntries.map((entry) => (
        <EntryRow
          key={entry.key}
          entry={entry}
          canSchedule={canSchedule}
          onOpen={() => openEntry(entry)}
          onReschedule={() =>
            setBooking({ projectId: entry.projectId, name: entry.projectName, date: entry.date })
          }
        />
      ))}

      {schedule.overdue.length > 0 ? (
        <RailSection
          icon={TriangleAlert}
          title={`${schedule.overdue.length} overdue`}
          destructive
          body="Open, and the day has passed. Listed here whichever month you are looking at."
        >
          {schedule.overdue.slice(0, 12).map((entry) => (
            <EntryRow
              key={entry.key}
              entry={entry}
              showDate
              canSchedule={canSchedule}
              onOpen={() => openEntry(entry)}
              onReschedule={() =>
                setBooking({ projectId: entry.projectId, name: entry.projectName, date: entry.date })
              }
            />
          ))}
          {schedule.overdue.length > 12 ? (
            <Text variant="caption" tone="muted">
              {`Showing the 12 oldest of ${schedule.overdue.length}.`}
            </Text>
          ) : null}
        </RailSection>
      ) : null}

      {schedule.awaitingDate.length > 0 ? (
        <RailSection
          icon={CircleSlash}
          title={`${schedule.awaitingDate.length} awaiting a date`}
          body={
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
              onBook={() => setBooking({ projectId: job.projectId, name: job.projectName, date: null })}
            />
          ))}
        </RailSection>
      ) : null}

      {waiting === 0 && dayEntries.length === 0 ? (
        <Text variant="caption" tone="muted">
          Nothing is due today or overdue.
        </Text>
      ) : null}
    </View>
  );

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={refresh}
      tintColor={theme.colors.mutedForeground}
      colors={[theme.colors.primary]}
    />
  );

  return (
    <>
      {header}
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {side ? (
          <View style={{ flex: 1, flexDirection: "row" }}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: spacing.lg, paddingLeft: pad, paddingBottom: 48 }}
              refreshControl={refreshControl}
            >
              {grid}
            </ScrollView>
            <ScrollView
              style={{
                width: 360,
                flexGrow: 0,
                borderLeftWidth: 1,
                borderLeftColor: theme.colors.border,
                backgroundColor: theme.colors.card,
              }}
              contentContainerStyle={{ padding: spacing.lg, paddingRight: pad, paddingBottom: 48 }}
            >
              {rail}
            </ScrollView>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: pad, paddingBottom: 48, gap: spacing.xl }}
            refreshControl={refreshControl}
          >
            {grid}
            {rail}
          </ScrollView>
        )}
      </View>

      <BookDaySheet
        target={booking}
        selectedDay={selectedDay}
        saving={book.isPending}
        onClose={() => setBooking(null)}
        onSave={(date) => {
          if (!booking) return;
          book.mutate({ projectId: booking.projectId, date });
          setBooking(null);
        }}
      />
    </>
  );
}

function LegendItem({
  icon,
  label,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  destructive?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
      <Icon icon={icon} size="sm" tone={destructive ? "destructive" : "muted"} />
      <Text variant="caption" tone={destructive ? "destructive" : "muted"}>
        {label}
      </Text>
    </View>
  );
}

function RailSection({
  icon,
  title,
  body,
  destructive,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Icon icon={icon} size="sm" tone={destructive ? "destructive" : "muted"} />
        <Text variant="overline" tone={destructive ? "destructive" : "muted"}>
          {title.toUpperCase()}
        </Text>
      </View>
      <Text variant="caption" tone="muted">
        {body}
      </Text>
      {children}
    </View>
  );
}

function EntryRow({
  entry,
  showDate,
  canSchedule,
  onOpen,
  onReschedule,
}: {
  entry: ScheduleEntry;
  showDate?: boolean;
  canSchedule: boolean;
  onOpen: () => void;
  onReschedule: () => void;
}) {
  const theme = useTheme();
  const second = entry.kind === "job" ? (entry.detail ?? "No pipeline stage") : entry.projectName;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: entry.overdue ? theme.colors.destructive : theme.colors.border,
        backgroundColor: theme.colors.card,
        paddingLeft: spacing.md,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${entryTypeLabel(entry)}: ${entry.title}`}
        onPress={onOpen}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          paddingVertical: spacing.md,
          minHeight: 52,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: entry.kind === "job" ? 2 : 5,
            backgroundColor: entry.color,
            opacity: entry.done ? 0.4 : 1,
          }}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            variant="bodyStrong"
            numberOfLines={1}
            tone={entry.done ? "muted" : "default"}
            style={entry.done ? { textDecorationLine: "line-through" } : undefined}
          >
            {entry.title}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Icon icon={entry.kind === "job" ? Layers : SquareCheckBig} size="sm" tone="muted" />
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {[
                second,
                entry.kind === "task" ? entry.detail : null,
                showDate ? formatCalendarDate(entry.date) : null,
              ]
                .filter(Boolean)
                .join(", ")}
            </Text>
          </View>
        </View>
        {entry.done ? <Icon icon={CircleCheck} size="sm" tone="muted" /> : null}
      </Pressable>
      {entry.kind === "job" && canSchedule ? (
        <IconButton
          icon={CalendarClock}
          accessibilityLabel={`Reschedule ${entry.projectName}`}
          surface={false}
          onPress={onReschedule}
        />
      ) : (
        <View style={{ width: spacing.sm }} />
      )}
    </View>
  );
}

function AwaitingRow({
  job,
  canSchedule,
  onBook,
}: {
  job: AwaitingDateJob;
  canSchedule: boolean;
  onBook: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        paddingLeft: spacing.md,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${job.projectName}`}
        onPress={() => router.push({ pathname: "/project/[id]", params: { id: job.projectId } })}
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          minHeight: 52,
        }}
      >
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: job.stageColor }} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {job.projectName}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {job.stageName}
          </Text>
        </View>
      </Pressable>
      {canSchedule ? (
        <IconButton
          icon={CalendarClock}
          accessibilityLabel={`Book a day for ${job.projectName}`}
          surface={false}
          tone="primary"
          onPress={onBook}
        />
      ) : (
        <View style={{ width: spacing.sm }} />
      )}
    </View>
  );
}

/**
 * Book, move or clear a job's day.
 *
 * No native date picker ships with the app, so the common answers are one tap
 * (the day selected on the grid, today, tomorrow, a week out) and anything else
 * is typed as YYYY-MM-DD. Clearing a booked day asks first.
 */
function BookDaySheet({
  target,
  selectedDay,
  saving,
  onClose,
  onSave,
}: {
  target: { projectId: string; name: string; date: string | null } | null;
  selectedDay: string;
  saving: boolean;
  onClose: () => void;
  onSave: (date: string | null) => void;
}) {
  const [typed, setTyped] = useState("");
  const [lastTarget, setLastTarget] = useState<typeof target>(null);
  if (target !== lastTarget) {
    setLastTarget(target);
    setTyped(target?.date ?? "");
  }

  const typedOk = isIsoDate(typed.trim());
  const quick: { label: string; date: string }[] = [
    { label: `Selected day (${formatCalendarDate(selectedDay)})`, date: selectedDay },
    { label: "Today", date: isoDaysFromToday(0) },
    { label: "Tomorrow", date: isoDaysFromToday(1) },
    { label: "In a week", date: isoDaysFromToday(7) },
  ];

  const clear = () => {
    if (!target) return;
    Alert.alert("Clear the booked day?", `${target.name} goes back to having no day booked.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Clear date", style: "destructive", onPress: () => onSave(null) },
    ]);
  };

  return (
    <Sheet
      visible={target !== null}
      onClose={onClose}
      title={target?.date ? "Reschedule" : "Book a day"}
      subtitle={
        target
          ? target.date
            ? `${target.name}, booked for ${formatCalendarDate(target.date)}`
            : target.name
          : undefined
      }
      footer={
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {target?.date ? (
            <Button
              label="Clear"
              icon={Trash2}
              variant="destructive"
              accessibilityLabel="Clear date"
              onPress={clear}
              style={{ flex: 1 }}
            />
          ) : (
            <Button label="Cancel" variant="outline" onPress={onClose} style={{ flex: 1 }} />
          )}
          <Button
            label="Save date"
            loading={saving}
            disabled={!typedOk}
            onPress={() => onSave(typed.trim())}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {quick.map((option) => (
          <Chip
            key={option.label}
            label={option.label}
            selected={typed.trim() === option.date}
            onPress={() => setTyped(option.date)}
          />
        ))}
      </View>
      <Field
        label="Date"
        value={typed}
        onChangeText={setTyped}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        error={typed.trim() && !typedOk ? "Use YYYY-MM-DD" : undefined}
        hint={typedOk ? formatCalendarDate(typed.trim()) : undefined}
      />
    </Sheet>
  );
}
