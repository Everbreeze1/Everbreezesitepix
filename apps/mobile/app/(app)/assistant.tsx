import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { askAssistant, latestConversation, listMessages, type ChatMessage } from "@/api/assistant";
import {
  assistantFailure,
  canRetry,
  derivedTitle,
  inOrder,
  isFromUser,
  messageError,
  threadSummary,
} from "@/api/assistant-view";
import { radius, spacing, useTheme } from "@/theme";
import { Send, Sparkles } from "@/ui/icons";
import { Button, EmptyState, Field, Icon, IconButton, PageHeader, SkeletonList, Text } from "@/ui";

/**
 * The assistant, on the phone.
 *
 * A field supervisor to ask questions of. It is worth far more standing in
 * front of a plant room than sitting at a desk - "what should I check before I
 * sign this off" is a question people have on site, not at a laptop - and the
 * phone was the one client that could not reach it.
 *
 * The screen opens into the LAST conversation rather than a blank one. Most
 * follow-up questions are follow ups, and a thread that resets on every launch
 * makes somebody re-explain the job every time they ask anything.
 *
 * Gemini is geo-blocked on some networks, so a failure here is a real field
 * condition rather than a bug. The failure wording says so, and does not offer
 * a retry for the two failures that will fail identically forever.
 */
export default function AssistantScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingTurns, setPendingTurns] = useState<ChatMessage[]>([]);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const openQuery = useQuery({ queryKey: ["assistant-latest"], queryFn: latestConversation });

  useEffect(() => {
    if (conversationId || !openQuery.data) return;
    setConversationId(openQuery.data.id);
  }, [openQuery.data, conversationId]);

  const messagesKey = useMemo(() => ["assistant-messages", conversationId], [conversationId]);

  const messagesQuery = useQuery({
    queryKey: messagesKey,
    queryFn: () => listMessages(conversationId!),
    enabled: Boolean(conversationId),
  });

  /*
   * The saved thread plus whatever is in flight. Kept apart rather than written
   * into the cache, so a failed send leaves no phantom turn behind that the
   * next refetch would silently drop.
   */
  const thread = useMemo(
    () => inOrder([...(messagesQuery.data ?? []), ...pendingTurns]),
    [messagesQuery.data, pendingTurns],
  );

  const ask = useMutation({
    mutationFn: (message: string) =>
      askAssistant({
        message,
        ...(conversationId ? { conversationId } : {}),
        // Only on the first turn: after that the thread already has a name, and
        // sending one would rename it to whatever was last asked.
        ...(conversationId ? {} : { title: derivedTitle(message) }),
      }),
    onSuccess: (result) => {
      setFailure(null);
      setPendingTurns([]);
      const isNew = result.conversationId !== conversationId;
      setConversationId(result.conversationId);
      // Refetch rather than patch: the server wrote both rows, and their ids
      // and timestamps are its own.
      void queryClient.invalidateQueries({
        queryKey: ["assistant-messages", result.conversationId],
      });
      if (isNew) void queryClient.invalidateQueries({ queryKey: ["assistant-latest"] });
    },
    onError: (error: unknown) => {
      /*
       * The question is put back in the box rather than left hanging in the
       * thread. On a phone, retyping a paragraph is the expensive part of
       * failing, and a turn that stays on screen with no answer reads as the
       * assistant ignoring it.
       */
      const message = error instanceof Error ? error.message : null;
      setDraft(pendingTurns[0]?.content ?? "");
      setPendingTurns([]);
      setFailure(assistantFailure(message));
    },
  });

  const send = useCallback(() => {
    const bad = messageError(draft);
    if (bad) {
      setFormError(bad);
      return;
    }
    const message = draft.trim();
    setFormError(null);
    setFailure(null);
    setDraft("");
    // Shown immediately so the thread does not sit still while the model
    // thinks, which on a slow connection is several seconds.
    setPendingTurns([
      { id: "pending", role: "user", content: message, created_at: new Date().toISOString() },
    ]);
    ask.mutate(message);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [draft, ask]);

  const loading = openQuery.isLoading || (Boolean(conversationId) && messagesQuery.isLoading);

  return (
    <>
      <Stack.Screen options={{ title: "Assistant" }} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
      >
        <PageHeader
          title="Assistant"
          subtitle={loading ? undefined : threadSummary(messagesQuery.data ?? [])}
        />

        {loading ? (
          <SkeletonList rows={3} />
        ) : thread.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Ask about the job in front of you"
            body="What to check before sign-off, what a part is, how to word a note. Answers are short on purpose."
          />
        ) : (
          <FlatList
            ref={listRef}
            data={thread}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.lg,
              gap: spacing.sm,
            }}
            initialNumToRender={12}
            windowSize={7}
            removeClippedSubviews
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => <Turn message={item} />}
          />
        )}

        {ask.isPending ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.sm,
            }}
          >
            <Icon icon={Sparkles} size="sm" tone="primary" />
            <Text variant="caption" tone="muted">
              Thinking
            </Text>
          </View>
        ) : null}

        {failure ? (
          <View
            style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.xs }}
          >
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
            {/*
              No retry on the two failures that will fail identically forever:
              an unconfigured key and a plan refusal. A retry button on those
              wastes somebody's time twice.
            */}
            {canRetry(failure) ? (
              <Button
                label="Try again"
                variant="secondary"
                size="sm"
                onPress={() => {
                  setFailure(null);
                  send();
                }}
              />
            ) : null}
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
          }}
        >
          <Field
            style={{ flex: 1 }}
            value={draft}
            onChangeText={(next) => {
              setDraft(next);
              if (formError) setFormError(null);
            }}
            placeholder="Ask the assistant"
            multiline
            rows={2}
            error={formError ?? undefined}
          />
          <IconButton
            icon={Send}
            accessibilityLabel="Send to the assistant"
            tone="primary"
            disabled={ask.isPending || draft.trim().length === 0}
            onPress={send}
          />
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

function Turn({ message }: { message: ChatMessage }) {
  const theme = useTheme();
  const mine = isFromUser(message);

  return (
    <View
      style={{
        alignSelf: mine ? "flex-end" : "flex-start",
        maxWidth: "88%",
        padding: spacing.md,
        borderRadius: radius.lg,
        backgroundColor: mine ? theme.colors.primary : theme.colors.card,
        borderWidth: mine ? 0 : 1,
        borderColor: theme.colors.border,
      }}
    >
      <Text variant="body" tone={mine ? "inverse" : "default"}>
        {message.content}
      </Text>
    </View>
  );
}
