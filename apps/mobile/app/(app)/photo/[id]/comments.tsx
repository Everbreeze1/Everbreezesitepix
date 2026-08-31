import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import {
  createPhotoComment,
  deletePhotoComment,
  listMentionable,
  listPhotoComments,
} from "@/api/photo-comments";
import {
  authorLabel,
  bodySegments,
  canDeleteComment,
  commentError,
  commentsSummary,
  MAX_COMMENT_LENGTH,
  mentionCandidates,
  mentionHandle,
  mentionQuery,
  mentionsInBody,
  withMention,
  type Mentionable,
  type PendingMention,
  type PhotoComment,
} from "@/api/photo-comments-view";
import { useAuth } from "@/lib/auth";
import { radius, spacing, useTheme } from "@/theme";
import { AtSign, MessageSquare, Send, Trash2 } from "@/ui/icons";
import {
  Avatar,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  IconButton,
  PageHeader,
  PhotoThumb,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Comments on one photograph.
 *
 * A gap rather than a new feature: `photo_comments` has existed since July, the
 * web has a panel for it, and four `/v1/rpc` ops were already registered and
 * reachable. The phone could not read or write any of them. On a product whose
 * unit of work is a photograph, that means the conversation about a job happens
 * somewhere the person standing in front of the job cannot see it.
 *
 * The loop already closes at the other end: a mention writes a notification
 * with `?photo=<id>`, and `notificationTarget` turns that into the project
 * screen with the lightbox open on the right photo. So the only missing piece
 * was somewhere to write and read them, which is this.
 *
 * Reached from the lightbox in both grids rather than being a tab, because a
 * comment is about the photograph you are looking at and nothing else.
 */
export default function PhotoCommentsScreen() {
  const { id, uri, projectId, caption } = useLocalSearchParams<{
    id: string;
    uri?: string;
    projectId?: string;
    caption?: string;
  }>();
  const theme = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [body, setBody] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pending, setPending] = useState<PendingMention[]>([]);
  const [caret, setCaret] = useState<{ start: number; end: number } | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const listRef = useRef<FlatList<PhotoComment>>(null);

  const queryKey = useMemo(() => ["photo-comments", id], [id]);

  const commentsQuery = useQuery({
    queryKey,
    queryFn: () => listPhotoComments(String(id)),
    enabled: Boolean(id),
  });

  /*
   * The roster is fetched even before anybody types an `@`, and deliberately.
   * Waiting until the first keystroke means the picker opens empty and fills in
   * a moment later, by which time the person has already given up on it. It is
   * one cached request and every other screen has it warm already.
   */
  const peopleQuery = useQuery({
    queryKey: ["mentionable"],
    queryFn: listMentionable,
    staleTime: 5 * 60 * 1000,
  });

  const comments = commentsQuery.data ?? [];
  const people = peopleQuery.data ?? [];

  const query = mentionQuery(body, cursor);
  const candidates = mentionCandidates(people, query, user?.id ?? null);

  const post = useMutation({
    mutationFn: async () => {
      const mentions = mentionsInBody(body, pending);
      return createPhotoComment({
        photoId: String(id),
        projectId: String(projectId ?? ""),
        body,
        mentions,
      });
    },
    onSuccess: (comment) => {
      /*
       * Appended rather than refetched. The list is chronological and this is
       * the newest row, so writing it in directly keeps the scroll position and
       * avoids the flash of a list rebuilding under the keyboard.
       */
      queryClient.setQueryData<PhotoComment[]>(queryKey, (prev) => {
        const list = prev ?? [];
        return list.some((c) => c.id === comment.id) ? list : [...list, comment];
      });
      setBody("");
      setPending([]);
      setFormError(null);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    },
    onError: (error: unknown) =>
      setFormError(error instanceof Error ? error.message : "Could not post that."),
  });

  const remove = useMutation({
    mutationFn: (commentId: string) => deletePhotoComment(commentId),
    onMutate: async (commentId: string) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<PhotoComment[]>(queryKey);
      queryClient.setQueryData<PhotoComment[]>(queryKey, (prev) =>
        (prev ?? []).filter((c) => c.id !== commentId),
      );
      return { previous };
    },
    onError: (error: unknown, _id, context) => {
      // Put it back. A comment that vanishes and stays vanished after a failed
      // delete reads as deleted, and the writer never tries again.
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      Alert.alert("Could not delete", error instanceof Error ? error.message : "Please try again.");
    },
  });

  const submit = useCallback(() => {
    const bad = commentError(body);
    if (bad) {
      setFormError(bad);
      return;
    }
    if (!projectId) {
      // The server requires it and would refuse with a schema error nobody can
      // act on. Every route into this screen passes it; this is the guard for
      // the one that eventually will not.
      setFormError("This photo is not attached to a project yet.");
      return;
    }
    setFormError(null);
    post.mutate();
  }, [body, projectId, post]);

  const pick = useCallback(
    (person: Mentionable) => {
      const handle = mentionHandle(person);
      const next = withMention(body, cursor, handle);
      setBody(next.text);
      setCursor(next.cursor);
      // Moved once, then released on the next selection change, so the caret
      // does not stay pinned where the insert put it.
      setCaret({ start: next.cursor, end: next.cursor });
      setPending((prev) =>
        prev.some((m) => m.userId === person.userId && m.handle === handle)
          ? prev
          : [...prev, { userId: person.userId, handle }],
      );
    },
    [body, cursor],
  );

  const confirmDelete = useCallback(
    (comment: PhotoComment) => {
      Alert.alert("Delete this comment?", "It will be removed for everybody on the job.", [
        { text: "Keep", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => remove.mutate(comment.id) },
      ]);
    },
    [remove],
  );

  /*
   * The countdown only appears near the ceiling. A permanent "3987 left" on a
   * comment box invites people to treat 4000 characters as a target, and the
   * limit is high enough that almost nobody will ever see this.
   */
  const remaining = MAX_COMMENT_LENGTH - body.trim().length;
  const countdown = remaining <= 200 ? `${remaining} characters left` : null;

  return (
    <>
      <Stack.Screen options={{ title: "Comments" }} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // The header is already on screen, so the offset is what the navigation
        // bar takes. Without it the composer sits under the keyboard on iOS.
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
      >
        <PageHeader
          title="Comments"
          subtitle={commentsQuery.isLoading ? undefined : commentsSummary(comments.length)}
        />

        {uri ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
            <PhotoThumb uri={uri} width="100%" height={160} contentFit="cover" showLabel />
            {caption ? (
              <Text variant="caption" tone="muted" style={{ paddingTop: spacing.xs }}>
                {caption}
              </Text>
            ) : null}
          </View>
        ) : null}

        {commentsQuery.isLoading ? (
          <SkeletonList rows={3} />
        ) : commentsQuery.error ? (
          <ErrorState
            title="Could not load comments"
            message={
              commentsQuery.error instanceof Error
                ? commentsQuery.error.message
                : "Something went wrong."
            }
            onRetry={() => void commentsQuery.refetch()}
          />
        ) : comments.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No comments yet"
            body="Ask a question about this photo, or use @ to pull a teammate in."
          />
        ) : (
          <FlatList
            ref={listRef}
            data={comments}
            keyExtractor={(comment) => comment.id}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.lg,
              gap: spacing.md,
            }}
            // Chronological and usually short, but a long-running job can carry
            // a hundred, so it windows like every other list here.
            initialNumToRender={12}
            windowSize={7}
            removeClippedSubviews
            renderItem={({ item }) => (
              <CommentRow
                comment={item}
                canDelete={canDeleteComment(item, user?.id ?? null)}
                onDelete={() => confirmDelete(item)}
              />
            )}
          />
        )}

        {/*
          The mention picker sits directly above the composer rather than
          floating over the list: on a phone the keyboard already owns the
          bottom half, and a popover anchored to the caret would be off screen
          as often as not.
        */}
        {candidates.length > 0 ? (
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.sm,
              gap: spacing.xs,
            }}
          >
            {candidates.map((person) => (
              <Pressable
                key={person.userId}
                accessibilityRole="button"
                accessibilityLabel={`Mention ${person.fullName ?? person.email ?? "teammate"}`}
                onPress={() => pick(person)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.md,
                  backgroundColor: pressed ? theme.colors.secondary : theme.colors.card,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                })}
              >
                <Avatar name={person.fullName ?? person.email} size="sm" />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {person.fullName ?? person.email ?? "Teammate"}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    @{mentionHandle(person)}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: spacing.sm,
            padding: spacing.lg,
            paddingTop: spacing.sm,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            backgroundColor: theme.colors.background,
          }}
        >
          <Field
            style={{ flex: 1 }}
            value={body}
            onChangeText={(next) => {
              setBody(next);
              if (formError) setFormError(null);
              // Released so the platform owns the caret again after an insert.
              setCaret(undefined);
            }}
            onSelectionChange={(selection) => {
              setCursor(selection.start);
              setCaret(undefined);
            }}
            selection={caret}
            placeholder="Add a comment"
            multiline
            rows={2}
            error={formError ?? undefined}
            hint={
              countdown ??
              (query !== null && candidates.length === 0 && people.length > 0
                ? "No teammate by that name"
                : undefined)
            }
          />
          <IconButton
            icon={Send}
            accessibilityLabel="Post comment"
            tone="primary"
            disabled={post.isPending || body.trim().length === 0}
            onPress={submit}
          />
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

function CommentRow({
  comment,
  canDelete,
  onDelete,
}: {
  comment: PhotoComment;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const label = authorLabel(comment);

  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
      <Avatar name={label} uri={comment.authorAvatarUrl} size="sm" />
      <View
        style={{
          flex: 1,
          gap: spacing.xs,
          padding: spacing.md,
          borderRadius: radius.md,
          backgroundColor: theme.colors.card,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            {label}
          </Text>
          <Text variant="caption" tone="muted">
            {relativeTime(comment.createdAt)}
          </Text>
          {canDelete ? (
            <IconButton
              icon={Trash2}
              accessibilityLabel={`Delete comment by ${label}`}
              tone="destructive"
              surface={false}
              size="sm"
              onPress={onDelete}
            />
          ) : null}
        </View>

        {/*
          Mentions are tinted so a reader can see at a glance that somebody was
          pulled in, which is most of what a mention is for. Drawn from the text
          rather than from `comment.mentions`, so a handle typed by hand still
          reads as one even though it notified nobody.
        */}
        <Text variant="body">
          {bodySegments(comment.body).map((segment, index) =>
            segment.mention ? (
              <Text key={index} variant="body" tone="primary">
                {segment.text}
              </Text>
            ) : (
              <Text key={index} variant="body">
                {segment.text}
              </Text>
            ),
          )}
        </Text>

        {comment.mentions.length > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Icon icon={AtSign} size="sm" tone="muted" />
            <Text variant="caption" tone="muted">
              {comment.mentions.length} notified
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
