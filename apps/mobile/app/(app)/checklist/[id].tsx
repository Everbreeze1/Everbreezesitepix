import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

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
          <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={theme.colors.primary} />
        ) : error || !data ? (
          <View style={styles.centered}>
            <Text style={[typography.body, { color: theme.colors.destructive }]}>
              {error instanceof Error ? error.message : "Checklist not found"}
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={theme.colors.primary}
              />
            }
          >
            <View style={{ marginBottom: spacing.lg, gap: spacing.xs }}>
              <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
                {done} of {items.length} done
              </Text>
              {outstandingRequired > 0 ? (
                <Text style={[typography.caption, { color: theme.colors.safety }]}>
                  {outstandingRequired} required item{outstandingRequired === 1 ? "" : "s"} left
                </Text>
              ) : items.length > 0 ? (
                <Text style={[typography.caption, { color: theme.colors.primary }]}>
                  All required items answered
                </Text>
              ) : null}
            </View>

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
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.card,
          borderColor: answered ? theme.colors.primary : theme.colors.border,
        },
      ]}
    >
      <View style={styles.cardHead}>
        <Text style={[typography.bodyStrong, { color: theme.colors.foreground, flex: 1 }]}>
          {item.label}
        </Text>
        {item.required ? (
          <Text style={[typography.overline, { color: theme.colors.safety }]}>REQUIRED</Text>
        ) : null}
      </View>

      {item.description ? (
        <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
          {item.description}
        </Text>
      ) : null}

      <Text style={[typography.overline, { color: theme.colors.mutedForeground }]}>
        {CHECKLIST_TYPE_LABELS[item.item_type as ChecklistItemType] ?? item.item_type}
      </Text>

      {item.item_type === "checkbox" ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onToggleDone(item)}
          style={[
            styles.checkbox,
            {
              backgroundColor: answered ? theme.colors.primary : theme.colors.background,
              borderColor: answered ? theme.colors.primary : theme.colors.border,
            },
          ]}
        >
          <Text
            style={[
              typography.bodyStrong,
              { color: answered ? theme.colors.primaryForeground : theme.colors.mutedForeground },
            ]}
          >
            {answered ? "Done" : "Mark done"}
          </Text>
        </Pressable>
      ) : null}

      {choices ? (
        <View style={styles.choiceRow}>
          {choices.map((choice) => {
            const selected = item.response_value === choice;
            return (
              <Pressable
                accessibilityRole="button"
                key={choice}
                onPress={() =>
                  onSetResponse(item, toggledResponse(item.item_type, item.response_value, choice))
                }
                style={[
                  styles.choice,
                  {
                    backgroundColor: selected ? theme.colors.primary : theme.colors.background,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    typography.bodyStrong,
                    {
                      color: selected ? theme.colors.primaryForeground : theme.colors.foreground,
                    },
                  ]}
                >
                  {choice}
                </Text>
              </Pressable>
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
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/project/${projectId}/capture?checklistItemId=${item.id}`)}
          style={[styles.attach, { borderColor: theme.colors.border }]}
        >
          <Text style={[typography.caption, { color: theme.colors.primary, fontWeight: "600" }]}>
            Add photo evidence
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

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
    <View style={styles.choiceRow}>
      {[1, 2, 3, 4, 5].map((value) => {
        const active = value <= current;
        return (
          <Pressable
            accessibilityRole="button"
            key={value}
            accessibilityLabel={`Rate ${value} out of 5`}
            accessibilityState={{ selected: active }}
            onPress={() =>
              onSetResponse(item, toggledResponse("rating", item.response_value, value))
            }
            style={[
              styles.star,
              {
                backgroundColor: active ? theme.colors.safety : theme.colors.background,
                borderColor: active ? theme.colors.safety : theme.colors.border,
              },
            ]}
          >
            <Text
              style={[
                typography.bodyStrong,
                { color: active ? theme.colors.safetyForeground : theme.colors.mutedForeground },
              ]}
            >
              {value}
            </Text>
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
  const theme = useTheme();
  const [draft, setDraft] = useState(item.notes ?? "");

  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onBlur={() => onSetNote(item, draft)}
      multiline
      placeholder="Note (optional)"
      placeholderTextColor={theme.colors.mutedForeground}
      style={[
        styles.note,
        {
          backgroundColor: theme.colors.background,
          borderColor: theme.colors.border,
          color: theme.colors.foreground,
        },
      ]}
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
  const theme = useTheme();
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
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      keyboardType={numeric ? "numeric" : "default"}
      multiline={!numeric}
      placeholder={numeric ? "Enter a number" : "Enter a note"}
      placeholderTextColor={theme.colors.mutedForeground}
      style={[
        styles.input,
        {
          backgroundColor: theme.colors.background,
          borderColor: theme.colors.border,
          color: theme.colors.foreground,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  centered: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  checkbox: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: HIT_TARGET,
  },
  choiceRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  choice: {
    flex: 1,
    minWidth: 96,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: HIT_TARGET,
  },
  star: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: HIT_TARGET,
  },
  note: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    minHeight: 40,
  },
  attach: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: HIT_TARGET,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    minHeight: HIT_TARGET,
  },
});
