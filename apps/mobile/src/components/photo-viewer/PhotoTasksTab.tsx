import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { calendarDueLabel } from "@everlumen/shared";
import { listPhotoTasks, type PhotoTasks } from "@/api/photo-viewer";
import { listMentionable } from "@/api/photo-comments";
import { normaliseStatus, statusPatch, TASK_STATUS_LABELS } from "@/api/task-status";
import type { TaskDraft, TaskRow } from "@/api/tasks";
import { TaskEditorSheet } from "@/components/TaskEditorSheet";
import { useAuth } from "@/lib/auth";
import {
  taskCreateRowId,
  taskRowId,
  taskPhotoRowId,
  type TaskCreatePayload,
  type TaskPatchPayload,
  type TaskPhotoPatchPayload,
} from "@/offline/handlers";
import { enqueue } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import { HIT_TARGET, radius, spacing, typography } from "@/theme";
import { ChevronRight, Circle, CircleCheck, CircleDashed, Plus, SquareCheckBig } from "@/ui/icons";
import { viewerColors as c } from "./viewer-theme";

export const photoTasksKey = (photoId: string) => ["photo-tasks", photoId] as const;

/**
 * The Tasks tab: web's `PhotoTasksPanel`.
 *
 * Every task on the project that covers this photo, with this photo's own
 * state. The circle ticks this photo off the task, not the whole task, because
 * a task can span twelve photos and ticking here used to close the other
 * eleven; the task's own status is rolled up by the server. Workspaces that
 * predate per-photo state fall back to the task's status, as web does.
 *
 * "New task" opens the app's task editor and links the new task to this
 * photo. Both writes go through the offline queue like every other task write.
 */
export function PhotoTasksTab({
  photoId,
  projectId,
  onOpenTask,
  bottomInset,
}: {
  photoId: string;
  projectId: string | null;
  /** Called before leaving for a task's own screen. */
  onOpenTask?: () => void;
  bottomInset: number;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  const key = useMemo(() => photoTasksKey(photoId), [photoId]);

  const query = useQuery({
    queryKey: key,
    queryFn: () => listPhotoTasks(projectId!, photoId),
    enabled: Boolean(projectId && photoId),
  });

  const peopleQuery = useQuery({
    queryKey: ["mentionable"],
    queryFn: listMentionable,
    staleTime: 5 * 60 * 1000,
  });
  const nameOf = (userId: string | null, email: string | null) => {
    if (!userId) return email ? email.split("@")[0] : null;
    if (userId === user?.id) return "You";
    const person = peopleQuery.data?.find((p) => p.userId === userId);
    return person?.fullName || (person?.email ?? email)?.split("@")[0] || "Teammate";
  };

  const data = query.data;
  const tasks = data?.tasks ?? [];

  const isDone = (task: TaskRow) =>
    data && !data.unavailable
      ? data.items[task.id]?.status === "done"
      : normaliseStatus(task.status) === "done";

  const toggle = useMutation({
    mutationFn: async (task: TaskRow) => {
      const done = isDone(task);
      if (data && !data.unavailable) {
        const status = done ? "open" : "done";
        queryClient.setQueryData<PhotoTasks>(key, (prev) =>
          prev
            ? {
                ...prev,
                items: {
                  ...prev.items,
                  [task.id]: {
                    ...(prev.items[task.id] ?? {
                      task_id: task.id,
                      photo_id: photoId,
                      note: null,
                      completed_by: null,
                      completed_at: null,
                      updated_at: new Date().toISOString(),
                    }),
                    status,
                  },
                },
              }
            : prev,
        );
        await enqueue({
          id: taskPhotoRowId(task.id, photoId),
          kind: "task_photo_patch",
          projectId,
          payload: {
            taskId: task.id,
            photoId,
            status,
            invalidate: [key, ["project-tasks", projectId], ["task-photos", task.id]],
          } as TaskPhotoPatchPayload,
        });
      } else {
        const patch = statusPatch(done ? "open" : "done");
        queryClient.setQueryData<PhotoTasks>(key, (prev) =>
          prev
            ? {
                ...prev,
                tasks: prev.tasks.map((row) => (row.id === task.id ? { ...row, ...patch } : row)),
              }
            : prev,
        );
        await enqueue({
          id: taskRowId(task.id),
          kind: "task_patch",
          projectId,
          payload: {
            taskId: task.id,
            patch,
            invalidate: [key, ["project-tasks", projectId]],
          } as TaskPatchPayload,
        });
      }
      await refreshQueue();
      requestSync();
    },
  });

  const create = async (draft: TaskDraft) => {
    if (!projectId || !user?.id) return;
    const taskId = randomUUID();
    const optimistic: TaskRow = {
      id: taskId,
      project_id: projectId,
      title: draft.title,
      description: draft.description,
      status: "open",
      priority: draft.priority,
      due_date: draft.due_date,
      completed_at: null,
      assignee_user_id: draft.assignee_user_id,
      assignee_email: draft.assignee_email,
      photo_ids: [photoId],
      position: 0,
      updated_at: new Date().toISOString(),
    };
    queryClient.setQueryData<PhotoTasks>(key, (prev) => ({
      tasks: [optimistic, ...(prev?.tasks ?? [])],
      items: prev?.items ?? {},
      unavailable: prev?.unavailable ?? false,
    }));
    setComposing(false);
    const payload: TaskCreatePayload & { invalidate: unknown[][] } = {
      input: { id: taskId, projectId, createdBy: user.id, photoIds: [photoId], ...draft },
      invalidate: [[...key], ["project-tasks", projectId]],
    };
    await enqueue({ id: taskCreateRowId(taskId), kind: "task_create", projectId, payload });
    await refreshQueue();
    requestSync();
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: bottomInset }}
      >
        {!projectId ? (
          <Text style={[typography.caption, { color: c.muted }]}>
            This photo is not attached to a project, so it cannot carry tasks.
          </Text>
        ) : query.isLoading ? (
          <ActivityIndicator color={c.muted} style={{ marginTop: spacing.lg }} />
        ) : query.error ? (
          <Text style={[typography.caption, { color: c.destructive }]}>
            Could not load tasks.{" "}
            <Text style={{ textDecorationLine: "underline" }} onPress={() => void query.refetch()}>
              Try again
            </Text>
          </Text>
        ) : tasks.length === 0 ? (
          <View style={{ alignItems: "center", gap: spacing.sm, padding: spacing.xl }}>
            <SquareCheckBig size={28} color={c.muted} />
            <Text style={[typography.bodyStrong, { color: c.foreground }]}>No tasks yet</Text>
            <Text style={[typography.caption, { color: c.muted, textAlign: "center" }]}>
              Turn what needs doing here into a task and assign it.
            </Text>
          </View>
        ) : (
          tasks.map((task) => {
            const done = isDone(task);
            const status = normaliseStatus(task.status);
            const Glyph = done ? CircleCheck : status === "in_progress" ? CircleDashed : Circle;
            const tint = done ? c.success : status === "in_progress" ? c.safety : c.muted;
            const who = nameOf(task.assignee_user_id, task.assignee_email);
            const due = task.due_date ? calendarDueLabel(task.due_date) : null;
            const count = task.photo_ids?.length ?? 0;
            return (
              <View
                key={task.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.xs,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: c.card,
                }}
              >
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done }}
                  accessibilityLabel={
                    done
                      ? `Mark this photo not done on ${task.title}`
                      : `Mark this photo done on ${task.title}`
                  }
                  onPress={() => toggle.mutate(task)}
                  style={{
                    width: HIT_TARGET,
                    height: HIT_TARGET + 8,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Glyph size={22} color={tint} strokeWidth={2.25} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint="Opens the task"
                  onPress={() => {
                    onOpenTask?.();
                    router.push({
                      pathname: "/task/[id]",
                      params: { id: task.id, projectId: task.project_id },
                    });
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: spacing.sm,
                    paddingRight: spacing.sm,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      style={[
                        typography.bodyStrong,
                        {
                          color: done ? c.muted : c.foreground,
                          textDecorationLine: done ? "line-through" : "none",
                        },
                      ]}
                      numberOfLines={2}
                    >
                      {task.title}
                    </Text>
                    <Text style={[typography.caption, { color: c.muted }]} numberOfLines={1}>
                      {[TASK_STATUS_LABELS[status], who, due, count > 1 ? `${count} photos` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    {data?.items[task.id]?.note ? (
                      <Text style={[typography.caption, { color: c.foreground }]} numberOfLines={3}>
                        Done here: {data.items[task.id]?.note}
                      </Text>
                    ) : null}
                  </View>
                  <ChevronRight size={18} color={c.muted} />
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>

      {projectId ? (
        <View
          style={{
            padding: spacing.md,
            borderTopWidth: 1,
            borderTopColor: c.border,
            backgroundColor: c.chrome,
          }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => setComposing(true)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.xs,
              minHeight: HIT_TARGET,
              borderRadius: radius.md,
              backgroundColor: c.primary,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Plus size={18} color={c.primaryForeground} strokeWidth={2.5} />
            <Text style={[typography.bodyStrong, { color: c.primaryForeground }]}>
              New task for this photo
            </Text>
          </Pressable>
        </View>
      ) : null}

      {projectId ? (
        <TaskEditorSheet
          visible={composing}
          onClose={() => setComposing(false)}
          projectId={projectId}
          onSave={(draft) => void create(draft)}
        />
      ) : null}
    </View>
  );
}
