import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { calendarDueLabel } from "@everlumen/shared";
import {
  advanceStatus,
  normaliseStatus,
  statusPatch,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from "@/api/task-status";
import { listProjectTasks, type TaskRow } from "@/api/tasks";
import { QueueBanner } from "@/components/QueueBanner";
import { useAuth } from "@/lib/auth";
import { taskRowId, type TaskPatchPayload } from "@/offline/handlers";
import { enqueue } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { ListTodo } from "@/ui/icons";
import {
  Avatar,
  Badge,
  Card,
  ChipGroup,
  EmptyState,
  ErrorState,
  SkeletonList,
  Text,
  type BadgeTone,
  type ChipOption,
} from "@/ui";

type Filter = "open" | "mine" | "all";

/** Status to badge colour, from the same three values `normaliseStatus` returns. */
const STATUS_TONE: Record<TaskStatus, BadgeTone> = {
  open: "neutral",
  in_progress: "warning",
  done: "success",
};

export default function ProjectTasksScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("open");

  const queryKey = useMemo(() => ["project-tasks", id], [id]);

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey,
    queryFn: () => listProjectTasks(id!),
    enabled: Boolean(id),
  });

  // `data ?? []` mints a fresh array each render, which would make the memo
  // below recompute every time and defeat its own purpose.
  const tasks = useMemo(() => data ?? [], [data]);

  const visible = useMemo(() => {
    if (filter === "all") return tasks;
    if (filter === "mine") return tasks.filter((task) => task.assignee_user_id === user?.id);
    return tasks.filter((task) => normaliseStatus(task.status) !== "done");
  }, [tasks, filter, user?.id]);

  // Counts off the full list, so an unselected chip reads its real total rather
  // than zero.
  const filters: ChipOption<Filter>[] = [
    {
      id: "open",
      label: "Outstanding",
      count: tasks.filter((task) => normaliseStatus(task.status) !== "done").length,
    },
    {
      id: "mine",
      label: "Mine",
      count: tasks.filter((task) => task.assignee_user_id === user?.id).length,
    },
    { id: "all", label: "All", count: tasks.length },
  ];

  /**
   * Move a task along.
   *
   * Optimistic, then queued, like every other write in the app. The patch
   * carries the query key it just changed, so if the completion trigger refuses
   * the write the drain can put the real status back rather than leaving a task
   * showing as done that the server never accepted.
   */
  const cycleStatus = useCallback(
    async (task: TaskRow) => {
      const next = advanceStatus(task.status);
      const patch = statusPatch(next);

      queryClient.setQueryData<TaskRow[]>(queryKey, (current) =>
        (current ?? []).map((row) => (row.id === task.id ? { ...row, ...patch } : row)),
      );

      const payload: TaskPatchPayload & { invalidate: unknown[][] } = {
        taskId: task.id,
        patch,
        invalidate: [queryKey],
      };

      await enqueue({
        id: taskRowId(task.id),
        kind: "task_patch",
        projectId: task.project_id,
        payload,
      });

      await refreshQueue();
      requestSync();
    },
    [queryClient, queryKey],
  );

  return (
    <>
      <Stack.Screen options={{ title: "Tasks" }} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <QueueBanner />

        <View style={{ paddingVertical: spacing.sm }}>
          <ChipGroup options={filters} value={filter} onChange={setFilter} label="Filter tasks" />
        </View>

        {isLoading ? (
          <SkeletonList rows={5} />
        ) : error ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Failed to load tasks"}
            onRetry={() => void refetch()}
          />
        ) : (
          <ScrollView
            contentContainerStyle={{
              padding: spacing.lg,
              gap: spacing.md,
              paddingBottom: spacing.xxxl,
              flexGrow: 1,
            }}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={theme.colors.mutedForeground}
                colors={[theme.colors.primary]}
              />
            }
          >
            {visible.length === 0 ? (
              tasks.length === 0 ? (
                <EmptyState
                  icon={ListTodo}
                  title="No tasks here"
                  body="Tasks are the punch list for this job. Add them from the web app, or from a photo."
                />
              ) : (
                <EmptyState
                  title="Nothing matches that filter"
                  body="Every task on this project is either done or assigned to someone else."
                  action={{ label: "Show all", onPress: () => setFilter("all") }}
                />
              )
            ) : (
              visible.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onCycle={() => void cycleStatus(task)}
                  onOpen={() => router.push(`/task/${task.id}?projectId=${task.project_id}`)}
                />
              ))
            )}
          </ScrollView>
        )}
      </View>
    </>
  );
}

function TaskCard({
  task,
  onCycle,
  onOpen,
}: {
  task: TaskRow;
  onCycle: () => void;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const status = normaliseStatus(task.status);
  const done = status === "done";
  const priority = (task.priority as TaskPriority) ?? "normal";
  const urgent = priority === "high" || priority === "urgent";

  /*
   * `calendarDueLabel` returns null for a date it cannot read, and reports
   * `overdue` itself. Colouring every due date amber would make a task due next
   * month look as urgent as one that slipped last week, which is the opposite
   * of what someone scanning this screen needs.
   */
  const due = calendarDueLabel(task.due_date);

  return (
    <Card padded={false}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          padding: spacing.lg,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={task.title}
          accessibilityHint="Opens the task"
          onPress={onOpen}
          style={{ flex: 1, gap: spacing.xs }}
        >
          <Text
            variant="bodyStrong"
            tone={done ? "muted" : "default"}
            style={{ textDecorationLine: done ? "line-through" : "none" }}
          >
            {task.title}
          </Text>

          {task.description ? (
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {task.description}
            </Text>
          ) : null}

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              flexWrap: "wrap",
              marginTop: spacing.xs,
            }}
          >
            {due ? (
              <Badge
                label={due.overdue && !done ? `Overdue · ${due.label}` : due.label}
                tone={done ? "neutral" : due.overdue ? "danger" : "warning"}
                variant={due.overdue && !done ? "solid" : "soft"}
              />
            ) : null}
            {urgent && !done ? (
              <Badge label={TASK_PRIORITY_LABELS[priority]} tone="danger" variant="outline" />
            ) : null}
            {task.assignee_email ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                <Avatar name={task.assignee_email} size="sm" />
                <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {task.assignee_email}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>

        {/*
         * The status control stays a separate tap target from the row itself.
         * Advancing a task and opening it are different intents, and merging
         * them would mean every glance at a task's detail nudged its status.
         */}
        <Pressable
          accessibilityRole="button"
          onPress={onCycle}
          accessibilityLabel={`Status ${TASK_STATUS_LABELS[status]}, tap to advance`}
          style={({ pressed }) => ({
            minHeight: HIT_TARGET,
            minWidth: 96,
            paddingHorizontal: spacing.md,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.card,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Badge label={TASK_STATUS_LABELS[status]} tone={STATUS_TONE[status]} />
        </Pressable>
      </View>
    </Card>
  );
}
