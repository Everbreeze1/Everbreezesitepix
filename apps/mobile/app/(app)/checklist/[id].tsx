import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CHECKLIST_TYPE_LABELS, type ChecklistItemType } from "@everlumen/shared";
import {
  choicesFor,
  getChecklist,
  hasResponse,
  parseNumericAnswer,
  responsePatch,
  toggledResponse,
  type ChecklistDetail,
  type ChecklistItem,
} from "@/api/checklists";
import { QueueBanner } from "@/components/QueueBanner";
import { useAuth } from "@/lib/auth";
import { checklistItemRowId, type ChecklistItemPatchPayload } from "@/offline/handlers";
import { enqueue } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { Camera, CircleCheck, Star } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Icon,
  ProgressBar,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * The checklist runner: the screen someone actually stands in a building and
 * uses.
 *
 * The write path below is unchanged and deliberately so. Every tap updates the
 * cache first and queues the write second, so an answer lands identically on
 * office wifi and in a basement. What changed is only what it looks like, and
 * the one thing that was genuinely hard to read: progress was two lines of
 * caption text, so "am I nearly done" had to be worked out by comparing two
 * numbers. It is a bar now.
 */
export default function ChecklistRunnerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = useMemo(() => ["checklist", id], [id]);

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey,
    queryFn: () => getChecklist(id!),
    enabled: Boolean(id),
  });

  /**
   * Record an answer.
   *
   * The cache is updated first and the write is queued second, so a tap lands
   * instantly whether or not there is signal. This is the whole point of the
   * screen: someone working through a checklist in a basement should see it
   * respond exactly as it does on the office wifi.
   */
  const patchItem = useCallback(
    async (
      item: ChecklistItem,
      patch: Record<string, unknown>,
      field: "answer" | "notes" = "answer",
    ) => {
      queryClient.setQueryData<ChecklistDetail | null>(queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          items: current.items.map((row) => (row.id === item.id ? { ...row, ...patch } : row)),
        };
      });

      const payload: ChecklistItemPatchPayload & { invalidate: unknown[][] } = {
        itemId: item.id,
        patch,
        // If the completion trigger refuses this, the drain uses these keys to
        // put the real state back instead of leaving a tick that never landed.
        invalidate: [queryKey],
      };
      await enqueue({
        // Deterministic per item, so correcting an answer replaces the queued
        // write instead of stacking another one behind it.
        id: checklistItemRowId(item.id, field),
        kind: "checklist_item_patch",
        projectId: data?.project_id ?? null,
        payload,
      });

      await refreshQueue();
      requestSync();
    },
    [data?.project_id, queryClient, queryKey],
  );

  const setResponse = useCallback(
    (item: ChecklistItem, value: unknown) =>
      void patchItem(item, responsePatch(value, user?.id ?? null)),
    [patchItem, user?.id],
  );

  /**
   * A free-text note against an item, saved on blur.
   *
   * Separate from the answer. A pass/fail item still needs somewhere to record
   * why it failed, and overwriting `response_value` to hold that would lose the
   * answer the report prints.
   */
  const setNote = useCallback(
    (item: ChecklistItem, text: string) => {
      const trimmed = text.trim();
      if ((item.notes ?? "") === trimmed) return;
      return void patchItem(item, { notes: trimmed || null }, "notes");
    },
    [patchItem],
  );

  const toggleDone = useCallback(
    (item: ChecklistItem) => {
      const next = item.completed_at ? null : new Date().toISOString();
      return void patchItem(item, {
        completed_at: next,
        completed_by: next ? (user?.id ?? null) : null,
      });
    },
    [patchItem, user?.id],
  );

  const items = data?.items ?? [];
  const done = items.filter((item) => item.completed_at).length;
  const outstandingRequired = items.filter((item) => item.required && !item.completed_at).length;

  return (
    <>
      <Stack.Screen options={{ title: data?.name ?? "Checklist" }} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <QueueBanner />

        {isLoading ? (
          <SkeletonList rows={5} />
        ) : error || !data ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Checklist not found"}
            onRetry={() => void refetch()}
          />
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={theme.colors.mutedForeground}
                colors={[theme.colors.primary]}
              />
            }
          >
            <Card>
              <ProgressBar
                value={done}
                total={items.length}
                tone={outstandingRequired === 0 && items.length > 0 ? "success" : "primary"}
                showLabel
              />
              {outstandingRequired > 0 ? (
                <Badge
                  label={`${outstandingRequired} required left`}
                  tone="warning"
                  style={{ marginTop: spacing.md }}
                />
              ) : items.length > 0 ? (
                <Badge
                  label="All required answered"
                  tone="success"
                  icon={CircleCheck}
                  style={{ marginTop: spacing.md }}
                />
              ) : null}
            </Card>

            {items.map((item) => (
              <ChecklistRow
                key={item.id}
                item={item}
                projectId={data.project_id}
                onSetResponse={setResponse}
                onToggleDone={toggleDone}
                onSetNote={setNote}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </>
  );
}

function ChecklistRow({
  item,
  projectId,
  onSetResponse,
  onToggleDone,
  onSetNote,
}: {
  item: ChecklistItem;
  projectId: string | undefined;
  onSetResponse: (item: ChecklistItem, value: unknown) => void;
  onToggleDone: (item: ChecklistItem) => void;
  onSetNote: (item: ChecklistItem, text: string) => void;
}) {
  const theme = useTheme();
  const answered = Boolean(item.completed_at);
  const choices = choicesFor(item.item_type);

  return (
    <Card
      // An answered item keeps its green edge. On a long list this is what tells
      // you where you stopped without reading a single label.
      style={{ borderColor: answered ? theme.colors.success : theme.colors.border, gap: spacing.sm }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {item.label}
        </Text>
        {item.required ? <Badge label="Required" tone="warning" /> : null}
        {answered ? <Icon icon={CircleCheck} size="md" tone="success" /> : null}
      </View>

      {item.description ? (
        <Text variant="caption" tone="muted">
          {item.description}
        </Text>
      ) : null}

      <Text variant="overline" tone="muted">
        {(CHECKLIST_TYPE_LABELS[item.item_type as ChecklistItemType] ?? item.item_type).toUpperCase()}
      </Text>

      {item.item_type === "checkbox" ? (
        <Button
          label={answered ? "Done" : "Mark done"}
          icon={answered ? CircleCheck : undefined}
          variant={answered ? "success" : "outline"}
          fullWidth
          onPress={() => onToggleDone(item)}
        />
      ) : null}

      {choices ? (
        <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
          {choices.map((choice) => {
            const selected = item.response_value === choice;
            return (
              <Button
                key={choice}
                label={choice}
                variant={selected ? "primary" : "outline"}
                onPress={() =>
                  onSetResponse(item, toggledResponse(item.item_type, item.response_value, choice))
                }
                /*
                 * `flex` widens the button while its fixed height keeps the row
                 * even. `alignSelf` stays at the Button default, which only
                 * governs the cross axis and so cannot squash it here.
                 */
                style={{ flex: 1, minWidth: 96 }}
              />
            );
          })}
        </View>
      ) : null}

      {item.item_type === "rating" ? <Rating item={item} onSetResponse={onSetResponse} /> : null}

      {item.item_type === "text" || item.item_type === "numeric" ? (
        <FreeTextAnswer item={item} onSetResponse={onSetResponse} />
      ) : null}

      <ItemNote item={item} onSetNote={onSetNote} />

      {projectId ? (
        <Button
          label="Add photo evidence"
          icon={Camera}
          variant="ghost"
          size="sm"
          fullWidth
          onPress={() => router.push(`/project/${projectId}/capture?checklistItemId=${item.id}`)}
        />
      ) : null}
    </Card>
  );
}

/**
 * A one-to-five rating.
 *
 * Five identical numbered boxes is what this was, and five identical anything
 * is the hardest control on the screen to read back: the score had to be
 * counted. Stars fill left to right, so the value is legible without reading.
 * The numeric accessibility labels are unchanged, because a screen reader gets
 * nothing from a shape.
 */
function Rating({
  item,
  onSetResponse,
}: {
  item: ChecklistItem;
  onSetResponse: (item: ChecklistItem, value: unknown) => void;
}) {
  const theme = useTheme();
  const current = typeof item.response_value === "number" ? item.response_value : 0;

  return (
    <View style={{ flexDirection: "row", gap: spacing.sm }}>
      {[1, 2, 3, 4, 5].map((value) => {
        const active = value <= current;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${value} out of 5`}
            accessibilityState={{ selected: active }}
            onPress={() => onSetResponse(item, toggledResponse("rating", item.response_value, value))}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: HIT_TARGET,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: active ? theme.colors.safety : theme.colors.border,
              backgroundColor: theme.colors.card,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Icon
              icon={Star}
              size="lg"
              color={active ? theme.colors.safety : theme.colors.mutedForeground}
              fill={active ? theme.colors.safety : "none"}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The note field carried by every item, whatever its answer type.
 *
 * Held locally and committed on blur, and skipped entirely when nothing
 * changed, so opening a checklist and scrolling past an item does not queue a
 * write that says the same thing it already said.
 */
function ItemNote({
  item,
  onSetNote,
}: {
  item: ChecklistItem;
  onSetNote: (item: ChecklistItem, text: string) => void;
}) {
  const [draft, setDraft] = useState(item.notes ?? "");

  return (
    <Field
      value={draft}
      onChangeText={setDraft}
      onBlur={() => onSetNote(item, draft)}
      multiline
      rows={2}
      placeholder="Note (optional)"
    />
  );
}

/**
 * Text and numeric answers.
 *
 * Held locally and committed on blur rather than on every keystroke. Each
 * commit queues a row and pokes the drain, and doing that per character would
 * mean a network attempt for every letter of a note typed on site.
 */
function FreeTextAnswer({
  item,
  onSetResponse,
}: {
  item: ChecklistItem;
  onSetResponse: (item: ChecklistItem, value: unknown) => void;
}) {
  const numeric = item.item_type === "numeric";
  const [draft, setDraft] = useState(
    hasResponse(item.response_value) ? String(item.response_value) : "",
  );

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      onSetResponse(item, null);
      return;
    }
    if (numeric) {
      const parsed = parseNumericAnswer(trimmed);
      // Keep the draft on screen rather than storing something unusable.
      if (parsed === null) return;
      onSetResponse(item, parsed);
      return;
    }
    onSetResponse(item, trimmed);
  }

  return (
    <Field
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      keyboardType={numeric ? "numeric" : "default"}
      multiline={!numeric}
      rows={2}
      placeholder={numeric ? "Enter a number" : "Enter a note"}
      autoCapitalize={numeric ? "none" : "sentences"}
    />
  );
}
