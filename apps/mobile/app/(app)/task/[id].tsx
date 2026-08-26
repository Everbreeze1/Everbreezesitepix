import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
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
      <Stack.Screen options={{ title: "Task" }} />

      {collaborationQuery.isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={theme.colors.primary} />
      ) : collaborationQuery.error ? (
        <View style={styles.centered}>
          <Text style={[typography.body, { color: theme.colors.destructive }]}>
            {collaborationQuery.error instanceof Error
              ? collaborationQuery.error.message
              : "Could not load the conversation"}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={collaborationQuery.isRefetching}
              onRefresh={() => void collaborationQuery.refetch()}
              tintColor={theme.colors.primary}
            />
          }
        >
          {photoState && photoState.photos.length > 0 && !photoState.unavailable ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={[typography.overline, { color: theme.colors.mutedForeground }]}>
                PHOTOS ON THIS TASK{progress ? ` · ${progress.done} of ${progress.total}` : ""}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  {photoState.photos.map((photo) => {
                    const done = photoIsDone(photoState.items, photo.id);
                    return (
                      <Pressable
                        key={photo.id}
                        disabled={togglePhoto.isPending}
                        onPress={() => togglePhoto.mutate(photo.id)}
                        style={[
                          styles.taskPhoto,
                          { borderColor: done ? theme.colors.primary : theme.colors.border },
                        ]}
                      >
                        <Image
                          source={photo.url ? { uri: photo.url } : undefined}
                          style={[styles.taskPhotoImage, { backgroundColor: theme.colors.muted }]}
                          contentFit="cover"
                        />
                        <Text
                          style={[
                            typography.caption,
                            {
                              color: done ? theme.colors.primary : theme.colors.mutedForeground,
                              fontWeight: done ? "700" : "400",
                            },
                          ]}
                        >
                          {done ? "Done" : "Open"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
              {togglePhoto.error ? (
                <Text style={[typography.caption, { color: theme.colors.destructive }]}>
                  {togglePhoto.error instanceof Error
                    ? togglePhoto.error.message
                    : "Could not update that photo"}
                </Text>
              ) : null}
            </View>
          ) : null}

          {comments.length === 0 ? (
            <Text
              style={[
                typography.body,
                { color: theme.colors.mutedForeground, textAlign: "center" },
              ]}
            >
              No comments yet. Leave a note like "waiting on part" without editing the task.
            </Text>
          ) : (
            comments.map((comment) => (
              <View
                key={comment.id}
                style={[
                  styles.comment,
                  { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                ]}
              >
                <View style={styles.commentHead}>
                  <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                    {memberLabel(byId.get(comment.author_id))}
                  </Text>
                  <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
                    {relativeTime(comment.created_at)}
                  </Text>
                </View>
                <Text style={[typography.body, { color: theme.colors.foreground }]}>
                  {comment.body}
                </Text>
                {comment.mentions.length > 0 ? (
                  <Text style={[typography.caption, { color: theme.colors.primary }]}>
                    Notified {comment.mentions.map((m) => memberLabel(byId.get(m))).join(", ")}
                  </Text>
                ) : null}
              </View>
            ))
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
            <Pressable
              key={member.user_id}
              onPress={() => insert(member)}
              style={[
                styles.mentionChip,
                { backgroundColor: theme.colors.accent, borderColor: theme.colors.border },
              ]}
            >
              <Text style={[typography.caption, { color: theme.colors.accentForeground }]}>
                {memberLabel(member)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={[styles.composerBar, { borderColor: theme.colors.border }]}>
        <TextInput
          ref={composer}
          value={draft}
          onChangeText={setDraft}
          onSelectionChange={onSelectionChange}
          multiline
          placeholder="Add a comment, @ to mention"
          placeholderTextColor={theme.colors.mutedForeground}
          style={[
            styles.composer,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
              color: theme.colors.foreground,
            },
          ]}
        />
        <Pressable
          disabled={!draft.trim() || post.isPending}
          onPress={() => post.mutate()}
          style={[
            styles.send,
            {
              backgroundColor: theme.colors.primary,
              opacity: !draft.trim() || post.isPending ? 0.5 : 1,
            },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
            {post.isPending ? "…" : "Send"}
          </Text>
        </Pressable>
      </View>

      {post.error ? (
        <Text
          style={[
            typography.caption,
            { color: theme.colors.destructive, paddingHorizontal: spacing.lg, paddingBottom: 8 },
          ]}
        >
          {post.error instanceof Error ? post.error.message : "Could not post the comment"}
        </Text>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centered: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
  comment: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  taskPhoto: { width: 96, gap: 4, borderWidth: 2, borderRadius: radius.md, padding: 4 },
  taskPhotoImage: { width: 84, height: 84, borderRadius: radius.sm },
  commentHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  mentionBar: { maxHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  mentionChip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: "center",
  },
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
    fontSize: 16,
    minHeight: HIT_TARGET,
    maxHeight: 120,
  },
  send: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: HIT_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
});
