import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

type Filter = "open" | "mine" | "all";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Outstanding" },
  { id: "mine", label: "Mine" },
  { id: "all", label: "All" },
];

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

        {isLoading ? (
          <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={theme.colors.primary} />
        ) : error ? (
          <View style={styles.centered}>
            <Text style={[typography.body, { color: theme.colors.destructive }]}>
              {error instanceof Error ? error.message : "Failed to load tasks"}
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={theme.colors.primary}
              />
            }
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm, marginBottom: spacing.lg }}
            >
              {FILTERS.map((option) => {
                const active = filter === option.id;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => setFilter(option.id)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? theme.colors.primary : theme.colors.card,
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        typography.caption,
                        {
                          fontWeight: "600",
                          color: active
                            ? theme.colors.primaryForeground
                            : theme.colors.mutedForeground,
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {visible.length === 0 ? (
              <Text
                style={[
                  typography.body,
                  {
                    color: theme.colors.mutedForeground,
                    textAlign: "center",
                    marginTop: spacing.xxl,
                  },
                ]}
              >
                {tasks.length === 0 ? "No tasks on this project." : "Nothing matches that filter."}
              </Text>
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

  const statusColor =
    status === "done"
      ? theme.colors.primary
      : status === "in_progress"
        ? theme.colors.safety
        : theme.colors.mutedForeground;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
      ]}
    >
      <Pressable onPress={onOpen} style={{ flex: 1, gap: 4 }}>
        <Text
          style={[
            typography.bodyStrong,
            {
              color: theme.colors.foreground,
              textDecorationLine: done ? "line-through" : "none",
            },
          ]}
        >
          {task.title}
        </Text>

        {task.description ? (
          <Text
            numberOfLines={2}
            style={[typography.caption, { color: theme.colors.mutedForeground }]}
          >
            {task.description}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          {due ? (
            <Text
              style={[
                typography.caption,
                {
                  color: done
                    ? theme.colors.mutedForeground
                    : due.overdue
                      ? theme.colors.destructive
                      : theme.colors.safety,
                  fontWeight: due.overdue && !done ? "700" : "400",
                },
              ]}
            >
              {due.overdue && !done ? `Overdue · ${due.label}` : due.label}
            </Text>
          ) : null}
          {urgent && !done ? (
            <Text style={[typography.overline, { color: theme.colors.destructive }]}>
              {TASK_PRIORITY_LABELS[priority].toUpperCase()}
            </Text>
          ) : null}
          {task.assignee_email ? (
            <Text
              numberOfLines={1}
              style={[typography.caption, { color: theme.colors.mutedForeground, flexShrink: 1 }]}
            >
              {task.assignee_email}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <Pressable
        onPress={onCycle}
        accessibilityLabel={`Status ${TASK_STATUS_LABELS[status]}, tap to advance`}
        style={[styles.statusButton, { borderColor: statusColor }]}
      >
        <Text style={[typography.caption, { color: statusColor, fontWeight: "700" }]}>
          {TASK_STATUS_LABELS[status as TaskStatus]}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexWrap: "wrap" },
  statusButton: {
    borderWidth: 2,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: HIT_TARGET,
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
  },
});
