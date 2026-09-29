import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from "react-native";
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
import { supabase } from "@/lib/supabase";
import { HIT_TARGET, radius, spacing, typography } from "@/theme";
import { AtSign, MessageSquare, Send, Trash2 } from "@/ui/icons";
import { Avatar } from "@/ui";
import type { ThreadColors } from "./viewer-theme";

export const photoCommentsKey = (photoId: string) => ["photo-comments", photoId] as const;

/**
 * The comments on one photograph: the list, the @mention picker and the
 * composer. Web's `PhotoCommentsPanel`.
 *
 * Shared by the viewer's Comments tab and the standalone comments route, so
 * the two cannot drift. Posting goes through `createPhotoComment`, which also
 * notifies everybody @mentioned, exactly as web's panel does, and the thread
 * listens for teammates' comments arriving while it is open.
 *
 * Not queued offline, for the reason given in `api/photo-comments.ts`: the
 * server mints the id, so a retried post could land twice and notify twice.
 */
export function PhotoCommentsThread({
  photoId,
  projectId,
  colors: c,
  header,
  seed,
  onComposerFocus,
  empty,
}: {
  photoId: string;
  projectId: string | null | undefined;
  colors: ThreadColors;
  /** Drawn above the list, such as the photo on the standalone route. */
  header?: ReactNode;
  /** Text to start the composer with; a new `nonce` applies it again. */
  seed?: { text: string; nonce: number } | null;
  onComposerFocus?: () => void;
  /** Replaces the default empty state, for a host drawn in the app theme. */
  empty?: ReactNode;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pending, setPending] = useState<PendingMention[]>([]);
  const [caret, setCaret] = useState<{ start: number; end: number } | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const listRef = useRef<FlatList<PhotoComment>>(null);
  const inputRef = useRef<TextInput>(null);

  const queryKey = useMemo(() => photoCommentsKey(photoId), [photoId]);

  const commentsQuery = useQuery({
    queryKey,
    queryFn: () => listPhotoComments(photoId),
    enabled: Boolean(photoId),
  });

  /*
   * The roster is fetched before anybody types an `@`: waiting for the first
   * keystroke opens the picker empty, and it is one cached request that every
   * other screen already has warm.
   */
  const peopleQuery = useQuery({
    queryKey: ["mentionable"],
    queryFn: listMentionable,
    staleTime: 5 * 60 * 1000,
  });

  const comments = useMemo(() => commentsQuery.data ?? [], [commentsQuery.data]);
  const people = peopleQuery.data ?? [];
  const me = people.find((person) => person.userId === user?.id) ?? null;
  const myName = me?.fullName ?? me?.email ?? user?.email ?? null;
  const query = mentionQuery(body, cursor);
  const candidates = mentionCandidates(people, query, user?.id ?? null);

  /* A new photo starts with an empty composer. */
  useEffect(() => {
    setBody("");
    setPending([]);
    setFormError(null);
  }, [photoId]);

  useEffect(() => {
    if (!seed) return;
    setBody(seed.text);
    setCursor(seed.text.length);
    setCaret({ start: seed.text.length, end: seed.text.length });
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [seed]);

  /*
   * Live, like web's panel: a teammate's comment appears while this is open
   * rather than on the next visit. Refetching rather than splicing the row in,
   * because the author's name comes from a join the client cannot make.
   */
  useEffect(() => {
    if (!photoId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`photo-comments:${photoId}`)
        .on(
          "postgres_changes" as never,
          {
            event: "*",
            schema: "public",
            table: "photo_comments",
            filter: `photo_id=eq.${photoId}`,
          },
          () => {
            void queryClient.invalidateQueries({ queryKey });
          },
        )
        .subscribe();
    } catch {
      // Realtime is a nicety; the list still loads and refreshes on post.
    }
    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [photoId, queryClient, queryKey]);

  const post = useMutation({
    mutationFn: async () =>
      createPhotoComment({
        photoId,
        projectId: String(projectId ?? ""),
        body,
        mentions: mentionsInBody(body, pending),
      }),
    onSuccess: (comment) => {
      queryClient.setQueryData<PhotoComment[]>(queryKey, (prev) => {
        const list = prev ?? [];
        return list.some((row) => row.id === comment.id) ? list : [...list, comment];
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
        (prev ?? []).filter((row) => row.id !== commentId),
      );
      return { previous };
    },
    onError: (error: unknown, _id, context) => {
      // Put it back: a comment that vanishes after a failed delete reads as deleted.
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
      setCaret({ start: next.cursor, end: next.cursor });
      setPending((prev) =>
        prev.some((m) => m.userId === person.userId && m.handle === handle)
          ? prev
          : [...prev, { userId: person.userId, handle }],
      );
    },
    [body, cursor],
  );

  /* Web's @ button: starts a mention at the caret, opening the picker. */
  const startMention = useCallback(() => {
    const before = body.slice(0, cursor);
    const after = body.slice(cursor);
    const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
    const next = `${before}${lead}@${after}`;
    const at = before.length + lead.length + 1;
    setBody(next);
    setCursor(at);
    setCaret({ start: at, end: at });
    inputRef.current?.focus();
  }, [body, cursor]);

  const confirmDelete = useCallback(
    (comment: PhotoComment) => {
      Alert.alert("Delete this comment?", "It will be removed for everybody on the job.", [
        { text: "Keep", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => remove.mutate(comment.id) },
      ]);
    },
    [remove],
  );

  const remaining = MAX_COMMENT_LENGTH - body.trim().length;
  const hint =
    remaining <= 200
      ? `${remaining} characters left`
      : query !== null && candidates.length === 0 && people.length > 0
        ? "No teammate by that name"
        : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {commentsQuery.isLoading ? (
        <View style={{ flex: 1 }}>
          {header}
          <ActivityIndicator color={c.muted} style={{ marginTop: spacing.xl }} />
        </View>
      ) : commentsQuery.error ? (
        <View style={{ flex: 1, padding: spacing.lg, gap: spacing.sm }}>
          {header}
          <Text style={[typography.bodyStrong, { color: c.foreground }]}>
            Could not load comments
          </Text>
          <Text style={[typography.caption, { color: c.muted }]}>
            {commentsQuery.error instanceof Error
              ? commentsQuery.error.message
              : "Something went wrong."}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void commentsQuery.refetch()}
            style={{ alignSelf: "flex-start", paddingVertical: spacing.sm }}
          >
            <Text style={[typography.bodyStrong, { color: c.primary }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={comments}
          keyExtractor={(comment) => comment.id}
          ListHeaderComponent={header ? <>{header}</> : null}
          ListEmptyComponent={
            empty ? (
              <>{empty}</>
            ) : (
              <View
                style={{
                  alignItems: "center",
                  gap: spacing.sm,
                  padding: spacing.xl,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderStyle: "dashed",
                  borderColor: c.border,
                }}
              >
                <MessageSquare size={26} color={c.muted} />
                <Text style={[typography.bodyStrong, { color: c.foreground }]}>
                  No messages yet
                </Text>
                <Text style={[typography.caption, { color: c.muted, textAlign: "center" }]}>
                  Start the conversation for this photo. Use @ to pull a teammate in.
                </Text>
              </View>
            )
          }
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          windowSize={7}
          onContentSizeChange={() => {
            if (comments.length > 0) listRef.current?.scrollToEnd({ animated: false });
          }}
          renderItem={({ item }) => (
            <CommentRow
              comment={item}
              colors={c}
              canDelete={canDeleteComment(item, user?.id ?? null)}
              onDelete={() => confirmDelete(item)}
            />
          )}
        />
      )}

      {/*
        The mention picker sits directly above the composer rather than floating
        over the list: the keyboard already owns the bottom half of a phone.
      */}
      {candidates.length > 0 ? (
        <View
          style={{
            marginHorizontal: spacing.md,
            marginBottom: spacing.sm,
            paddingVertical: spacing.xs,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.card,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: spacing.md,
              paddingTop: spacing.xs,
              paddingBottom: 2,
            }}
          >
            <AtSign size={12} color={c.muted} />
            <Text style={[typography.overline, { color: c.muted }]}>MENTION TEAMMATE</Text>
          </View>
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
                minHeight: HIT_TARGET,
                paddingVertical: 6,
                paddingHorizontal: spacing.md,
                backgroundColor: pressed ? c.border : "transparent",
              })}
            >
              <Avatar name={person.fullName ?? person.email} size="sm" />
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyStrong, { color: c.foreground }]} numberOfLines={1}>
                  {person.fullName ?? person.email ?? "Teammate"}
                </Text>
                <Text style={[typography.caption, { color: c.muted }]} numberOfLines={1}>
                  @{mentionHandle(person)}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View
        style={{
          gap: 4,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm,
          paddingBottom: spacing.md,
          borderTopWidth: 1,
          borderTopColor: c.border,
          backgroundColor: c.background,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
          <View style={{ height: HIT_TARGET, justifyContent: "center" }}>
            <Avatar name={myName} size="sm" />
          </View>
          <TextInput
            ref={inputRef}
            value={body}
            onChangeText={(next) => {
              setBody(next);
              if (formError) setFormError(null);
              setCaret(undefined);
            }}
            onSelectionChange={(e) => {
              setCursor(e.nativeEvent.selection.start);
              setCaret(undefined);
            }}
            onFocus={onComposerFocus}
            selection={caret}
            placeholder="Write a message"
            placeholderTextColor={c.muted}
            multiline
            accessibilityLabel="Add a comment"
            style={[
              typography.body,
              {
                flex: 1,
                color: c.foreground,
                minHeight: HIT_TARGET,
                maxHeight: 140,
                borderWidth: 1,
                borderColor: formError ? c.destructive : c.input,
                backgroundColor: c.card,
                borderRadius: radius.xl,
                paddingHorizontal: spacing.md,
                paddingTop: 10,
                paddingBottom: 10,
                textAlignVertical: "top",
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mention a teammate"
            onPress={startMention}
            hitSlop={4}
            style={({ pressed }) => ({
              width: 36,
              height: HIT_TARGET,
              borderRadius: radius.md,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? c.border : "transparent",
            })}
          >
            <AtSign size={20} color={c.muted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Post comment"
            disabled={post.isPending || body.trim().length === 0}
            onPress={submit}
            style={({ pressed }) => ({
              width: HIT_TARGET,
              height: HIT_TARGET,
              borderRadius: HIT_TARGET / 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: c.primary,
              opacity: post.isPending || body.trim().length === 0 ? 0.45 : pressed ? 0.85 : 1,
            })}
          >
            {post.isPending ? (
              <ActivityIndicator color={c.primaryForeground} />
            ) : (
              <Send size={18} color={c.primaryForeground} strokeWidth={2.25} />
            )}
          </Pressable>
        </View>
        {formError ? (
          <Text style={[typography.caption, { color: c.destructive }]}>{formError}</Text>
        ) : hint ? (
          <Text style={[typography.caption, { color: c.muted }]}>{hint}</Text>
        ) : null}
      </View>
    </View>
  );
}

function CommentRow({
  comment,
  colors: c,
  canDelete,
  onDelete,
}: {
  comment: PhotoComment;
  colors: ThreadColors;
  canDelete: boolean;
  onDelete: () => void;
}) {
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
          backgroundColor: c.card,
          borderWidth: 1,
          borderColor: c.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text style={[typography.bodyStrong, { color: c.foreground, flex: 1 }]} numberOfLines={1}>
            {label}
          </Text>
          <Text style={[typography.caption, { color: c.muted }]}>
            {relativeTime(comment.createdAt)}
          </Text>
          {canDelete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete comment by ${label}`}
              onPress={onDelete}
              hitSlop={10}
            >
              <Trash2 size={16} color={c.destructive} />
            </Pressable>
          ) : null}
        </View>

        {/* Mentions are tinted so a reader can see somebody was pulled in. */}
        <Text style={[typography.body, { color: c.foreground }]}>
          {bodySegments(comment.body).map((segment, index) => (
            <Text
              key={index}
              style={segment.mention ? { color: c.primary, fontWeight: "600" } : undefined}
            >
              {segment.text}
            </Text>
          ))}
        </Text>

        {comment.mentions.length > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <AtSign size={14} color={c.muted} />
            <Text style={[typography.caption, { color: c.muted }]}>
              {comment.mentions.length} notified
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
