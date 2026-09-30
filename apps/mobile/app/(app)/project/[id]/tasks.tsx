import { useCallback, useMemo, useState } from "react";
import { randomUUID } from "expo-crypto";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
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
import { deleteTask, listProjectTasks, type TaskDraft, type TaskRow } from "@/api/tasks";
import { canDeleteTask } from "@/api/record-edit-rules";
import { ActionRail } from "@/components/ActionRail";
import { ProjectSubPageHeader } from "@/components/ProjectSubPageHeader";
import { QueueBanner } from "@/components/QueueBanner";
import { TaskEditorSheet } from "@/components/TaskEditorSheet";
import { useAuth } from "@/lib/auth";
import {
  taskCreateRowId,
  taskRowId,
  type TaskCreatePayload,
  type TaskPatchPayload,
} from "@/offline/handlers";
import { enqueue } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import { spacing, useTheme } from "@/theme";
import { CircleCheck, Clock, Flag, ListTodo, Plus, Trash2 } from "@/ui/icons";
import {
  ActionSheet,
  Avatar,
  CardGrid,
  ChipGroup,
  EmptyState,
  ErrorState,
  ItemCard,
  SkeletonList,
  StatusChip,
  Text,
  useCardPage,
  type ChipOption,
  type StatusTone,
} from "@/ui";

type Filter = "open" | "mine" | "all";

/** Status to chip colour, from the same three values `normaliseStatus` returns. */
const STATUS_TONE: Record<TaskStatus, StatusTone> = {
  open: "neutral",
  in_progress: "warning",
  done: "success",
};

export default function ProjectTasksScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { inset } = useCardPage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("open");
  const [composing, setComposing] = useState(false);
  const [menuFor, setMenuFor] = useState<TaskRow | null>(null);

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

  /**
   * Add a task from the phone.
   *
   * The id is minted here rather than left to the database, which is what lets
   * the task appear in the list instantly and still be the same row when the
   * insert eventually lands. Without it the optimistic entry and the server row
   * are two different tasks, and a drain that ran twice would leave two.
   *
   * Queued like every other write, so a task thought of while standing in a
   * basement is recorded rather than lost.
   */
  const createTask = useCallback(
    async (draft: TaskDraft) => {
      if (!id || !user?.id) return;
      const taskId = randomUUID();

      const optimistic: TaskRow = {
        id: taskId,
        project_id: id,
        title: draft.title,
        description: draft.description,
        status: "open",
        priority: draft.priority,
        due_date: draft.due_date,
        completed_at: null,
        assignee_user_id: draft.assignee_user_id,
        assignee_email: draft.assignee_email,
        photo_ids: [],
        // The database owns the real ordering; this only places the row in the
        // list until the next read replaces it.
        position: tasks.length,
        updated_at: new Date().toISOString(),
        created_by: user.id,
      };

      queryClient.setQueryData<TaskRow[]>(queryKey, (current) => [...(current ?? []), optimistic]);
      setComposing(false);

      const payload: TaskCreatePayload & { invalidate: unknown[][] } = {
        input: {
          id: taskId,
          projectId: id,
          createdBy: user.id,
          ...draft,
        },
        invalidate: [queryKey],
      };

      await enqueue({
        id: taskCreateRowId(taskId),
        kind: "task_create",
        projectId: id,
        payload,
      });

      await refreshQueue();
      requestSync();
    },
    [id, user?.id, tasks.length, queryClient, queryKey],
  );

  /**
   * Delete a task from the list, after a confirm.
   *
   * Optimistic, then put back if the server refuses. Not queued: see
   * `deleteTask`. Offered only on tasks this person created, which is the rule
   * RLS applies.
   */
  const removeTask = useCallback(
    async (task: TaskRow) => {
      const previous = queryClient.getQueryData<TaskRow[]>(queryKey);
      queryClient.setQueryData<TaskRow[]>(queryKey, (current) =>
        (current ?? []).filter((row) => row.id !== task.id),
      );
      try {
        await deleteTask(task.id);
        void queryClient.invalidateQueries({ queryKey });
      } catch (e) {
        if (previous) queryClient.setQueryData(queryKey, previous);
        Alert.alert(
          "Could not delete the task",
          e instanceof Error ? e.message : "Try again when you have signal.",
        );
      }
    },
    [queryClient, queryKey],
  );

  const confirmDelete = useCallback(
    (task: TaskRow) => {
      Alert.alert(
        "Delete this task?",
        `"${task.title}" will be removed for everybody. This cannot be undone.`,
        [
          { text: "Keep", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => void removeTask(task) },
        ],
      );
    },
    [removeTask],
  );

  const outstanding = tasks.filter((task) => normaliseStatus(task.status) !== "done").length;
  const doneCount = tasks.length - outstanding;
  const overdue = tasks.filter(
    (task) =>
      normaliseStatus(task.status) !== "done" && Boolean(calendarDueLabel(task.due_date)?.overdue),
  ).length;
  const summary =
    tasks.length === 0
      ? null
      : [`${outstanding} open`, overdue > 0 ? `${overdue} overdue` : null, `${doneCount} done`]
          .filter(Boolean)
          .join(" · ");

  return (
    <>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ProjectSubPageHeader
          projectId={id}
          title="Tasks"
          summary={summary}
          progress={
            tasks.length > 0
              ? {
                  value: doneCount,
                  total: tasks.length,
                  tone: outstanding === 0 ? "success" : "primary",
                }
              : null
          }
        >
          {tasks.length > 0 ? (
            <ChipGroup options={filters} value={filter} onChange={setFilter} label="Filter tasks" />
          ) : null}
        </ProjectSubPageHeader>
        <QueueBanner />

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
              paddingHorizontal: inset,
              paddingTop: spacing.lg,
              // Room for the floating New task button.
              paddingBottom: 120,
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
                  body="Tasks are the punch list for this job. Add the first one now, or attach one to a photo."
                  action={{ label: "New task", icon: Plus, onPress: () => setComposing(true) }}
                />
              ) : (
                <EmptyState
                  title="Nothing matches that filter"
                  body="Every task on this project is either done or assigned to someone else."
                  action={{ label: "Show all", onPress: () => setFilter("all") }}
                />
              )
            ) : (
              <CardGrid>
                {visible.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onCycle={() => void cycleStatus(task)}
                    onOpen={() => router.push(`/task/${task.id}?projectId=${task.project_id}`)}
                    onMenu={canDeleteTask(task, user?.id) ? () => setMenuFor(task) : undefined}
                  />
                ))}
              </CardGrid>
            )}
          </ScrollView>
        )}

        {/* Hidden while the empty state offers the same thing. */}
        {isLoading || tasks.length === 0 ? null : (
          <ActionRail
            actions={[
              { key: "new-task", icon: Plus, label: "New task", onPress: () => setComposing(true) },
            ]}
          />
        )}
      </View>

      <ActionSheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor?.title}
        actions={
          menuFor
            ? [
                {
                  label: "Open",
                  icon: ListTodo,
                  onPress: () => router.push(`/task/${menuFor.id}?projectId=${menuFor.project_id}`),
                },
                {
                  label: "Delete this task",
                  icon: Trash2,
                  destructive: true,
                  onPress: () => confirmDelete(menuFor),
                },
              ]
            : []
        }
      />

      <TaskEditorSheet
        visible={composing}
        onClose={() => setComposing(false)}
        projectId={id ?? ""}
        onSave={(draft) => void createTask(draft)}
      />
    </>
  );
}

function TaskCard({
  task,
  onCycle,
  onOpen,
  onMenu,
}: {
  task: TaskRow;
  onCycle: () => void;
  onOpen: () => void;
  /** Absent when the only action it would hold is one this person cannot take. */
  onMenu?: () => void;
}) {
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
  const hasDetails = Boolean(due) || (urgent && !done) || Boolean(task.assignee_email);

  return (
    <ItemCard
      icon={done ? CircleCheck : ListTodo}
      iconTone={done ? "success" : "primary"}
      title={task.title}
      titleDone={done}
      meta={task.description}
      onPress={onOpen}
      onMenu={onMenu}
      menuLabel={`Actions for ${task.title}`}
      accessibilityLabel={task.title}
      status={
        /*
         * The status control stays a separate tap target from the card itself.
         * Advancing a task and opening it are different intents, and merging
         * them would mean every glance at a task's detail nudged its status.
         */
        <Pressable
          accessibilityRole="button"
          onPress={onCycle}
          accessibilityLabel={`Status ${TASK_STATUS_LABELS[status]}, tap to advance`}
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <StatusChip label={TASK_STATUS_LABELS[status]} tone={STATUS_TONE[status]} />
        </Pressable>
      }
    >
      {hasDetails ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            flexWrap: "wrap",
          }}
        >
          {due ? (
            <StatusChip
              icon={Clock}
              label={due.overdue && !done ? `Overdue · ${due.label}` : due.label}
              tone={done ? "neutral" : due.overdue ? "danger" : "warning"}
            />
          ) : null}
          {urgent && !done ? (
            <StatusChip label={TASK_PRIORITY_LABELS[priority]} tone="danger" icon={Flag} />
          ) : null}
          {task.assignee_email ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 }}
            >
              <Avatar name={task.assignee_email} size="sm" />
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {task.assignee_email}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </ItemCard>
  );
}
