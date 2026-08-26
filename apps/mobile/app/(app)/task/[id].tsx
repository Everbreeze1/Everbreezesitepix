import { useCallback, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { photoIsDone, relativeTime, taskPhotoProgress } from "@everlumen/shared";
import { Image } from "expo-image";
import { listProjectTasks } from "@/api/tasks";
import { getTaskPhotoState, setTaskPhotoStatus } from "@/api/task-photos";
import {
  createTaskComment,
  getProjectContributors,
  listTaskCollaboration,
  type TaskComment,
} from "@/api/task-comments";
import {
  applyMention,
  memberLabel,
  mentionMatches,
  mentionQueryAt,
  resolveMentions,
  type MentionMember,
} from "@/api/task-mentions";
import { useAuth } from "@/lib/auth";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";
import { MessageSquare, Send } from "@/ui/icons";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  ProgressBar,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

export default function TaskDetailScreen() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId?: string }>();
  const theme = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const composer = useRef<TextInput>(null);

  const queryKey = useMemo(() => ["task-collaboration", id], [id]);

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
    queryKey: ["project-tasks", projectId],
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
      void queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <Stack.Screen options={{ title: task?.title ?? "Task" }} />

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
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
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
          {photoState && photoState.photos.length > 0 && !photoState.unavailable ? (
            <Card>
              <SectionHeader title="Photos on this task" />
              {progress ? (
                <ProgressBar
                  value={progress.done}
                  total={progress.total}
                  tone={progress.done === progress.total ? "success" : "primary"}
                  showLabel
                />
              ) : null}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: spacing.md }}
              >
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  {photoState.photos.map((photo) => {
                    const done = photoIsDone(photoState.items, photo.id);
                    return (
                      <Pressable
                        key={photo.id}
                        accessibilityRole="button"
                        accessibilityLabel={done ? "Photo done, tap to reopen" : "Photo open, tap to mark done"}
                        accessibilityState={{ selected: done, disabled: togglePhoto.isPending }}
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
                        <Badge
                          label={done ? "Done" : "Open"}
                          tone={done ? "success" : "neutral"}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
              {togglePhoto.error ? (
                <Text variant="caption" tone="destructive" style={{ marginTop: spacing.sm }}>
                  {togglePhoto.error instanceof Error
                    ? togglePhoto.error.message
                    : "Could not update that photo"}
                </Text>
              ) : null}
            </Card>
          ) : null}

          {comments.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No comments yet"
              body='Leave a note like "waiting on part" without editing the task itself.'
            />
          ) : (
            comments.map((comment) => {
              const author = memberLabel(byId.get(comment.author_id));
              return (
                <Card key={comment.id}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.sm,
                      marginBottom: spacing.sm,
                    }}
                  >
                    <Avatar name={author} size="sm" />
                    <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                      {author}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {relativeTime(comment.created_at)}
                    </Text>
                  </View>

                  <Text variant="body">{comment.body}</Text>

                  {comment.mentions.length > 0 ? (
                    <Text variant="caption" tone="primary" style={{ marginTop: spacing.sm }}>
                      {`Notified ${comment.mentions.map((m) => memberLabel(byId.get(m))).join(", ")}`}
                    </Text>
                  ) : null}
                </Card>
              );
            })
          )}
        </ScrollView>
      )}

      {matches.length > 0 ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          style={[styles.mentionBar, { borderColor: theme.colors.border }]}
          contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}
        >
          {matches.map((member) => (
            <Chip key={member.user_id} label={memberLabel(member)} onPress={() => insert(member)} />
          ))}
        </ScrollView>
      ) : null}

      {/*
       * The composer stays a bespoke control rather than becoming a `Field`.
       * It needs a ref to refocus after a mention is inserted and a selection
       * handler to know where the caret is, and neither belongs on a form input
       * used by six other screens. Its colours still come from the palette.
       */}
      <View style={[styles.composerBar, { borderColor: theme.colors.border }]}>
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
            styles.composer,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
              color: theme.colors.foreground,
            },
          ]}
        />
        <Button
          label="Send"
          icon={Send}
          loading={post.isPending}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  mentionBar: { maxHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  composerBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composer: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: HIT_TARGET,
    // Caps the growth of a long comment so the list behind it does not vanish.
    maxHeight: 120,
  },
});
