import { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { calendarDueLabel, photoIsDone, relativeTime, taskPhotoProgress } from "@everlumen/shared";
import { Image } from "expo-image";
import { listProjectTasks, type TaskDraft, type TaskRow } from "@/api/tasks";
import { getTaskPhotoState, setTaskPhotoStatus } from "@/api/task-photos";
import {
  createTaskComment,
  getProjectContributors,
  listTaskCollaboration,
  type TaskComment,
  addTaskWatchers,
  deleteTaskComment,
  removeTaskWatcher,
  type TaskWatcher,
} from "@/api/task-comments";
import {
  addableWatchers,
  canDeleteTaskComment,
  commentAuthor,
  sortedWatchers,
  watcherName,
  watcherSummary,
} from "@/api/task-watchers-view";
import {
  applyMention,
  memberLabel,
  mentionMatches,
  mentionQueryAt,
  resolveMentions,
  type MentionMember,
} from "@/api/task-mentions";
import {
  normaliseStatus,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from "@/api/task-status";
import { TaskEditorSheet } from "@/components/TaskEditorSheet";
import { useAuth } from "@/lib/auth";
import { taskEditRowId, type TaskEditPayload } from "@/offline/handlers";
import { enqueue } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";
import {
  Calendar,
  CircleCheck,
  MessageSquare,
  PenLine,
  Plus,
  Send,
  Trash2,
  User,
} from "@/ui/icons";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  ProgressBar,
  SectionHeader,
  SkeletonList,
  Text,
  type BadgeTone,
} from "@/ui";

const STATUS_TONE: Record<TaskStatus, BadgeTone> = {
  open: "neutral",
  in_progress: "warning",
  done: "success",
};

export default function TaskDetailScreen() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId?: string }>();
  const theme = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const composer = useRef<TextInput>(null);

  const queryKey = useMemo(() => ["task-collaboration", id], [id]);
  const tasksKey = useMemo(() => ["project-tasks", projectId], [projectId]);

  const collaborationQuery = useQuery({
    queryKey,
    queryFn: () => listTaskCollaboration(id!),
    enabled: Boolean(id),
  });

  const membersQuery = useQuery({
    queryKey: ["project-contributors", projectId],
    queryFn: () => getProjectContributors(projectId!),
    enabled: Boolean(projectId),
    // Teammates change rarely, and this only feeds a picker.
    staleTime: 10 * 60 * 1000,
  });

  /*
   * The task row is read from the project list rather than fetched alone: the
   * list is already cached from the screen the user tapped through, so this
   * costs nothing and keeps `photo_ids` in one place.
   */
  const tasksQuery = useQuery({
    queryKey: tasksKey,
    queryFn: () => listProjectTasks(projectId!),
    enabled: Boolean(projectId),
  });

  const task = tasksQuery.data?.find((row) => row.id === id) ?? null;

  const photosQuery = useQuery({
    queryKey: ["task-photos", id, task?.photo_ids?.length ?? 0],
    queryFn: () => getTaskPhotoState(id!, task?.photo_ids ?? []),
    enabled: Boolean(id) && Boolean(task?.photo_ids?.length),
  });

  const photoState = photosQuery.data;
  const progress = useMemo(
    () => (photoState ? taskPhotoProgress(task?.photo_ids ?? [], photoState.items) : null),
    [photoState, task?.photo_ids],
  );

  const togglePhoto = useMutation({
    mutationFn: async (photoId: string) => {
      const done = photoIsDone(photoState?.items, photoId);
      await setTaskPhotoStatus(id!, photoId, done ? "open" : "done");
    },
    onSuccess: () => {
      void photosQuery.refetch();
      // The parent task's status is rolled up by a trigger, so the list has to
      // be re-read rather than patched from here.
      void queryClient.invalidateQueries({ queryKey: tasksKey });
    },
  });

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const byId = useMemo(() => new Map(members.map((member) => [member.user_id, member])), [members]);

  const query = mentionQueryAt(draft, cursor);
  const matches = mentionMatches(members, query, user?.id ?? null);

  const post = useMutation({
    mutationFn: async () => {
      const body = draft.trim();
      if (!body || !id) return null;
      const mentions = resolveMentions(body, picked, members);
      return createTaskComment({ taskId: id, body, mentions });
    },
    onSuccess: (comment) => {
      if (!comment) return;
      queryClient.setQueryData<{ comments: TaskComment[]; watchers: unknown[] }>(
        queryKey,
        (current) =>
          current
            ? { ...current, comments: [...current.comments, comment] }
            : { comments: [comment], watchers: [] },
      );
      setDraft("");
      setPicked(new Set());
    },
  });

  /**
   * Save an edit.
   *
   * Optimistic against the project task list, because that is the cache this
   * screen reads the task out of. Queued on its own row id, separate from the
   * status row: a queued edit and a queued status change carry different fields
   * and must not replace one another.
   */
  const saveEdit = useCallback(
    async (next: TaskDraft) => {
      if (!id) return;

      queryClient.setQueryData<TaskRow[]>(tasksKey, (current) =>
        (current ?? []).map((row) => (row.id === id ? { ...row, ...next } : row)),
      );
      setEditing(false);

      const payload: TaskEditPayload & { invalidate: unknown[][] } = {
        taskId: id,
        draft: next,
        invalidate: [tasksKey],
      };

      await enqueue({
        id: taskEditRowId(id),
        kind: "task_edit",
        projectId: projectId ?? null,
        payload,
      });

      await refreshQueue();
      requestSync();
    },
    [id, projectId, queryClient, tasksKey],
  );

  const onSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      setCursor(event.nativeEvent.selection.start);
    },
    [],
  );

  const insert = useCallback(
    (member: MentionMember) => {
      const next = applyMention(draft, cursor, member);
      setDraft(next.text);
      setCursor(next.cursor);
      // Remembered here, then filtered again at send time against what the
      // message actually still says.
      setPicked((prev) => new Set(prev).add(member.user_id));
      composer.current?.focus();
    },
    [cursor, draft],
  );

  const comments = collaborationQuery.data?.comments ?? [];
  const watchers = collaborationQuery.data?.watchers ?? [];

  // Everyone on the project who is not already watching, and not the caller.
  // The server would accept both, but an action that visibly does nothing is
  // worse than one that is not offered.
  const addable = addableWatchers(members, watchers, user?.id ?? null);

  /**
   * Loop somebody in, or drop them.
   *
   * One mutation for both directions so the list cannot be mid-add and
   * mid-remove at once, which on a phone is a double tap away.
   */
  /**
   * Remove one of your own comments.
   *
   * Optimistic, and rolled back on failure. A comment that disappears and stays
   * gone after a failed delete reads as deleted, and the author never tries
   * again.
   */
  const removeComment = useMutation({
    mutationFn: (commentId: string) => deleteTaskComment(commentId),
    onMutate: async (commentId: string) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<{
        comments: TaskComment[];
        watchers: TaskWatcher[];
      }>(queryKey);
      queryClient.setQueryData<{ comments: TaskComment[]; watchers: TaskWatcher[] }>(
        queryKey,
        (current) =>
          current
            ? { ...current, comments: current.comments.filter((c) => c.id !== commentId) }
            : current,
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
  });

  const confirmDeleteComment = useCallback(
    (comment: TaskComment) => {
      Alert.alert("Delete this comment?", "It will be removed for everybody on the task.", [
        { text: "Keep", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => removeComment.mutate(comment.id) },
      ]);
    },
    [removeComment],
  );

  const changeWatcher = useMutation({
    mutationFn: async (change: { kind: "add" | "remove"; userId: string }) => {
      if (change.kind === "add") await addTaskWatchers(String(id), [change.userId]);
      else await removeTaskWatcher(String(id), change.userId);
      return change;
    },
    onSuccess: (change) => {
      // Patched rather than refetched: the thread above is a long list and
      // rebuilding it to add one name loses the scroll position.
      queryClient.setQueryData<{ comments: TaskComment[]; watchers: TaskWatcher[] }>(
        queryKey,
        (current) => {
          if (!current) return current;
          if (change.kind === "remove") {
            return {
              ...current,
              watchers: current.watchers.filter((w) => w.userId !== change.userId),
            };
          }
          const member = members.find((m) => m.user_id === change.userId);
          if (current.watchers.some((w) => w.userId === change.userId)) return current;
          return {
            ...current,
            watchers: [
              ...current.watchers,
              {
                userId: change.userId,
                addedBy: user?.id ?? null,
                createdAt: new Date().toISOString(),
                fullName: member?.full_name ?? null,
                email: member?.email ?? null,
                avatarUrl: null,
              },
            ],
          };
        },
      );
    },
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <Stack.Screen
        options={{
          title: "Task",
          headerRight: () =>
            task ? (
              <IconButton
                icon={PenLine}
                accessibilityLabel="Edit task"
                surface={false}
                tone="primary"
                onPress={() => setEditing(true)}
              />
            ) : null,
        }}
      />

      {collaborationQuery.isLoading ? (
        <SkeletonList rows={4} />
      ) : collaborationQuery.error ? (
        <ErrorState
          message={
            collaborationQuery.error instanceof Error
              ? collaborationQuery.error.message
              : "Could not load the conversation"
          }
          onRetry={() => void collaborationQuery.refetch()}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={collaborationQuery.isRefetching}
              onRefresh={() => void collaborationQuery.refetch()}
              tintColor={theme.colors.mutedForeground}
              colors={[theme.colors.primary]}
            />
          }
        >
          {/*
            The task itself, which this screen never showed.
            It opened straight into the comment thread, so the title, who it is
            on and when it is due were only visible on the screen behind.
          */}
          {task ? <TaskSummary task={task} /> : null}

          {photoState && photoState.photos.length > 0 && !photoState.unavailable ? (
            <View style={{ gap: spacing.sm }}>
              <Text variant="overline" tone="muted">
                PHOTOS ON THIS TASK
              </Text>
              {progress ? (
                <ProgressBar
                  value={progress.done}
                  total={progress.total}
                  tone={progress.done === progress.total ? "success" : "primary"}
                  showLabel
                />
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  {photoState.photos.map((photo) => {
                    const done = photoIsDone(photoState.items, photo.id);
                    return (
                      <Pressable
                        key={photo.id}
                        accessibilityRole="button"
                        accessibilityLabel={done ? "Done, tap to reopen" : "Open, tap to mark done"}
                        accessibilityState={{ selected: done }}
                        disabled={togglePhoto.isPending}
                        onPress={() => togglePhoto.mutate(photo.id)}
                        style={({ pressed }) => ({
                          width: 96,
                          gap: spacing.xs,
                          padding: 4,
                          borderWidth: 2,
                          borderRadius: radius.md,
                          borderColor: done ? theme.colors.success : theme.colors.border,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Image
                          source={photo.url ? { uri: photo.url } : undefined}
                          style={{
                            width: 84,
                            height: 84,
                            borderRadius: radius.sm,
                            backgroundColor: theme.colors.muted,
                          }}
                          contentFit="cover"
                        />
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 3,
                            justifyContent: "center",
                          }}
                        >
                          {done ? <Icon icon={CircleCheck} size="xs" tone="success" /> : null}
                          <Text variant="caption" tone={done ? "success" : "muted"}>
                            {done ? "Done" : "Open"}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
              {togglePhoto.error ? (
                <Text variant="caption" tone="destructive">
                  {togglePhoto.error instanceof Error
                    ? togglePhoto.error.message
                    : "Could not update that photo"}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/*
            Watchers sit above the thread because they decide who READS it.
            Adding somebody emails them, so the section says that out loud
            rather than leaving it to be discovered by the person interrupted.
          */}
          <SectionHeader title="Watching" count={watchers.length || undefined} />

          <View style={{ gap: spacing.sm }}>
            <Text variant="caption" tone="muted">
              {watcherSummary(watchers)}
            </Text>

            {sortedWatchers(watchers).map((watcher) => (
              <Card
                key={watcher.userId}
                style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
              >
                <Avatar name={watcherName(watcher)} uri={watcher.avatarUrl} size="sm" />
                <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
                  {watcherName(watcher)}
                </Text>
                <Button
                  label="Remove"
                  variant="secondary"
                  size="sm"
                  disabled={changeWatcher.isPending}
                  onPress={() => changeWatcher.mutate({ kind: "remove", userId: watcher.userId })}
                />
              </Card>
            ))}

            {addable.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  {addable.map((member) => (
                    <Pressable
                      key={member.user_id}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${memberLabel(member)} as a watcher`}
                      disabled={changeWatcher.isPending}
                      onPress={() => changeWatcher.mutate({ kind: "add", userId: member.user_id })}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: spacing.xs,
                        paddingVertical: spacing.xs,
                        paddingHorizontal: spacing.sm,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Icon icon={Plus} size="sm" tone="primary" />
                      <Text variant="caption">{memberLabel(member)}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            ) : null}

            {changeWatcher.error ? (
              <Text variant="caption" tone="destructive">
                {changeWatcher.error instanceof Error
                  ? changeWatcher.error.message
                  : "Could not change who is watching"}
              </Text>
            ) : null}
          </View>

          <SectionHeader title="Comments" count={comments.length || undefined} />

          {comments.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No comments yet"
              body="Leave a note like waiting on part, without editing the task itself."
            />
          ) : (
            comments.map((comment) => (
              <Card key={comment.id} style={{ gap: spacing.xs }}>
                {/*
                  The author comes from the comment itself, not from a roster
                  lookup. The service already joins `profiles` and sends the
                  name and avatar, and a lookup fails outright for anybody who
                  has since left the team - which is exactly whose old comments
                  you are most likely to be reading.
                */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Avatar name={commentAuthor(comment)} uri={comment.authorAvatarUrl} size="sm" />
                  <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {commentAuthor(comment)}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {relativeTime(comment.createdAt)}
                  </Text>
                  {/*
                    Author only, matching the RLS policy. Offered to nobody else
                    because a delete matching no row is a no-op, so the button
                    would appear to work and change nothing.
                  */}
                  {canDeleteTaskComment(comment, user?.id ?? null) ? (
                    <IconButton
                      icon={Trash2}
                      accessibilityLabel="Delete your comment"
                      tone="destructive"
                      surface={false}
                      size="sm"
                      onPress={() => confirmDeleteComment(comment)}
                    />
                  ) : null}
                </View>
                <Text variant="body">{comment.body}</Text>
                {comment.mentions.length > 0 ? (
                  <Text variant="caption" tone="primary">
                    {`Notified ${comment.mentions.map((m) => memberLabel(byId.get(m))).join(", ")}`}
                  </Text>
                ) : null}
              </Card>
            ))
          )}
        </ScrollView>
      )}

      {matches.length > 0 ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          style={{
            maxHeight: 56,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            paddingVertical: spacing.sm,
          }}
          contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}
        >
          {matches.map((member) => (
            <Pressable
              key={member.user_id}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${memberLabel(member)}`}
              onPress={() => insert(member)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.pill,
                backgroundColor: theme.colors.accent,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Avatar name={memberLabel(member)} size="sm" />
              <Text variant="caption" style={{ color: theme.colors.accentForeground }}>
                {memberLabel(member)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: spacing.sm,
          padding: spacing.lg,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.card,
        }}
      >
        <TextInput
          ref={composer}
          value={draft}
          onChangeText={setDraft}
          onSelectionChange={onSelectionChange}
          multiline
          placeholder="Add a comment, @ to mention"
          placeholderTextColor={theme.colors.mutedForeground}
          accessibilityLabel="Comment"
          style={[
            typography.body,
            {
              flex: 1,
              borderWidth: 1,
              borderRadius: radius.md,
              borderColor: theme.colors.input,
              backgroundColor: theme.colors.background,
              color: theme.colors.foreground,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              minHeight: HIT_TARGET,
              maxHeight: 120,
            },
          ]}
        />
        <IconButton
          icon={Send}
          accessibilityLabel="Send comment"
          tone="primary"
          disabled={!draft.trim() || post.isPending}
          onPress={() => post.mutate()}
        />
      </View>

      {post.error ? (
        <Text
          variant="caption"
          tone="destructive"
          style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
        >
          {post.error instanceof Error ? post.error.message : "Could not post the comment"}
        </Text>
      ) : null}

      <TaskEditorSheet
        visible={editing}
        onClose={() => setEditing(false)}
        projectId={projectId ?? ""}
        task={task}
        onSave={(next) => void saveEdit(next)}
      />
    </KeyboardAvoidingView>
  );
}

/** Title, status, priority, due date and assignee: the task itself. */
function TaskSummary({ task }: { task: TaskRow }) {
  const status = normaliseStatus(task.status);
  const priority = (task.priority as TaskPriority) ?? "normal";
  const due = calendarDueLabel(task.due_date);
  const done = status === "done";

  return (
    <Card style={{ gap: spacing.sm }}>
      <Text variant="title">{task.title}</Text>

      {task.description ? (
        <Text variant="body" tone="muted">
          {task.description}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        <Badge label={TASK_STATUS_LABELS[status]} tone={STATUS_TONE[status]} variant="solid" />
        {priority === "high" || priority === "urgent" ? (
          <Badge label={TASK_PRIORITY_LABELS[priority]} tone="danger" variant="outline" />
        ) : (
          <Badge label={TASK_PRIORITY_LABELS[priority]} tone="neutral" />
        )}
        {due ? (
          <Badge
            label={due.overdue && !done ? `Overdue · ${due.label}` : due.label}
            tone={done ? "neutral" : due.overdue ? "danger" : "warning"}
            icon={Calendar}
          />
        ) : null}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        {task.assignee_email ? (
          <>
            <Avatar name={task.assignee_email} size="sm" />
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
              {task.assignee_email}
            </Text>
          </>
        ) : (
          <>
            <Icon icon={User} size="sm" tone="muted" />
            <Text variant="caption" tone="muted">
              Not assigned
            </Text>
          </>
        )}
      </View>
    </Card>
  );
}
