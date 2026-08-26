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
import { WORKFLOW_KIND_LABELS, type WorkflowItemKind } from "@everlumen/shared";
import {
  canSignOff,
  checkItemPatch,
  currentPhaseIndex,
  isItemComplete,
  phaseState,
  signoffPatch,
} from "@/api/workflow-state";
import {
  getWorkflow,
  type WorkflowDetail,
  type WorkflowItem,
  type WorkflowPhase,
} from "@/api/workflows";
import { QueueBanner } from "@/components/QueueBanner";
import { useAuth } from "@/lib/auth";
import {
  workflowItemRowId,
  workflowPhaseRowId,
  type WorkflowItemPatchPayload,
  type WorkflowPhasePatchPayload,
} from "@/offline/handlers";
import { enqueue } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

export default function WorkflowRunnerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = useMemo(() => ["workflow", id], [id]);

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey,
    queryFn: () => getWorkflow(id!),
    enabled: Boolean(id),
  });

  const patchLocalItem = useCallback(
    (itemId: string, patch: Record<string, unknown>) => {
      queryClient.setQueryData<WorkflowDetail | null>(queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          phases: current.phases.map((phase) => ({
            ...phase,
            items: phase.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
          })),
        };
      });
    },
    [queryClient, queryKey],
  );

  const toggleCheck = useCallback(
    async (item: WorkflowItem) => {
      const patch = checkItemPatch(item, user?.id ?? null);
      patchLocalItem(item.id, patch);

      const payload: WorkflowItemPatchPayload & { invalidate: unknown[][] } = {
        itemId: item.id,
        patch,
        invalidate: [queryKey],
      };

      await enqueue({
        id: workflowItemRowId(item.id),
        kind: "workflow_item_patch",
        projectId: data?.project_id ?? null,
        payload,
      });
      await refreshQueue();
      requestSync();
    },
    [data?.project_id, patchLocalItem, queryKey, user?.id],
  );

  const saveNote = useCallback(
    async (item: WorkflowItem, text: string) => {
      const trimmed = text.trim();
      // A note step is complete when it has text, so `completed_at` follows the
      // text rather than being set independently.
      const patch = {
        note_text: trimmed || null,
        completed_at: trimmed ? new Date().toISOString() : null,
        completed_by: trimmed ? (user?.id ?? null) : null,
      };
      patchLocalItem(item.id, patch);

      const payload: WorkflowItemPatchPayload & { invalidate: unknown[][] } = {
        itemId: item.id,
        patch,
        invalidate: [queryKey],
      };

      await enqueue({
        id: workflowItemRowId(item.id),
        kind: "workflow_item_patch",
        projectId: data?.project_id ?? null,
        payload,
      });
      await refreshQueue();
      requestSync();
    },
    [data?.project_id, patchLocalItem, queryKey, user?.id],
  );

  const signOff = useCallback(
    async (phase: WorkflowPhase, name: string) => {
      const patch = signoffPatch(name, user?.id ?? null);

      queryClient.setQueryData<WorkflowDetail | null>(queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          phases: current.phases.map((row) => (row.id === phase.id ? { ...row, ...patch } : row)),
        };
      });

      const payload: WorkflowPhasePatchPayload & { invalidate: unknown[][] } = {
        phaseId: phase.id,
        patch,
        // The completion trigger can refuse a sign-off. If it does, this puts
        // the real state back rather than leaving a signature on screen that
        // the record never accepted.
        invalidate: [queryKey],
      };

      await enqueue({
        id: workflowPhaseRowId(phase.id),
        kind: "workflow_phase_patch",
        projectId: data?.project_id ?? null,
        payload,
      });
      await refreshQueue();
      requestSync();
    },
    [data?.project_id, queryClient, queryKey, user?.id],
  );

  const phases = data?.phases ?? [];
  const cursor = useMemo(
    () => currentPhaseIndex(phases.map((phase) => ({ phase, items: phase.items }))),
    [phases],
  );

  return (
    <>
      <Stack.Screen options={{ title: data?.name ?? "Workflow" }} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <QueueBanner />

        {isLoading ? (
          <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={theme.colors.primary} />
        ) : error || !data ? (
          <View style={styles.centered}>
            <Text style={[typography.body, { color: theme.colors.destructive }]}>
              {error instanceof Error ? error.message : "Workflow not found"}
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
            {cursor === -1 && phases.length > 0 ? (
              <Text
                style={[
                  typography.bodyStrong,
                  { color: theme.colors.primary, marginBottom: spacing.lg },
                ]}
              >
                Every phase is complete.
              </Text>
            ) : null}

            {phases.map((phase, index) => (
              <PhaseCard
                key={phase.id}
                phase={phase}
                projectId={data.project_id}
                isCurrent={index === cursor}
                onToggleCheck={toggleCheck}
                onSaveNote={saveNote}
                onSignOff={signOff}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </>
  );
}

function PhaseCard({
  phase,
  projectId,
  isCurrent,
  onToggleCheck,
  onSaveNote,
  onSignOff,
}: {
  phase: WorkflowPhase;
  projectId: string;
  isCurrent: boolean;
  onToggleCheck: (item: WorkflowItem) => void;
  onSaveNote: (item: WorkflowItem, text: string) => void;
  onSignOff: (phase: WorkflowPhase, name: string) => void;
}) {
  const theme = useTheme();
  const [signName, setSignName] = useState("");
  const state = phaseState(phase, phase.items);
  const signable = canSignOff(phase, phase.items);

  return (
    <View
      style={[
        styles.phase,
        {
          backgroundColor: theme.colors.card,
          borderColor: isCurrent ? theme.colors.primary : theme.colors.border,
          borderWidth: isCurrent ? 2 : 1,
        },
      ]}
    >
      <View style={styles.phaseHead}>
        <Text style={[typography.heading, { color: theme.colors.foreground, flex: 1 }]}>
          {phase.name}
        </Text>
        {isCurrent ? (
          <Text style={[typography.overline, { color: theme.colors.primary }]}>NOW</Text>
        ) : state.complete ? (
          <Text style={[typography.overline, { color: theme.colors.mutedForeground }]}>DONE</Text>
        ) : null}
      </View>

      {phase.description ? (
        <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
          {phase.description}
        </Text>
      ) : null}

      <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
        {state.done} of {state.total} steps
        {state.requiredTotal > 0
          ? ` · ${state.requiredDone} of ${state.requiredTotal} required`
          : ""}
      </Text>

      {phase.items.map((item) => (
        <StepRow
          key={item.id}
          item={item}
          projectId={projectId}
          onToggleCheck={onToggleCheck}
          onSaveNote={onSaveNote}
        />
      ))}

      {phase.requires_signoff ? (
        phase.signed_off_at ? (
          <Text style={[typography.caption, { color: theme.colors.primary }]}>
            Signed off by {phase.signoff_name ?? "a teammate"}
          </Text>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <TextInput
              value={signName}
              onChangeText={setSignName}
              placeholder="Type your name to sign off"
              placeholderTextColor={theme.colors.mutedForeground}
              editable={signable}
              style={[
                styles.input,
                {
                  backgroundColor: theme.colors.background,
                  borderColor: theme.colors.border,
                  color: theme.colors.foreground,
                  opacity: signable ? 1 : 0.5,
                },
              ]}
            />
            <Pressable
              disabled={!signable || !signName.trim()}
              onPress={() => onSignOff(phase, signName)}
              style={[
                styles.signButton,
                {
                  backgroundColor: theme.colors.primary,
                  opacity: signable && signName.trim() ? 1 : 0.4,
                },
              ]}
            >
              <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
                Sign off phase
              </Text>
            </Pressable>
            {!signable ? (
              <Text style={[typography.caption, { color: theme.colors.safety }]}>
                Finish the required steps before signing off.
              </Text>
            ) : null}
          </View>
        )
      ) : null}
    </View>
  );
}

function StepRow({
  item,
  projectId,
  onToggleCheck,
  onSaveNote,
}: {
  item: WorkflowItem;
  projectId: string;
  onToggleCheck: (item: WorkflowItem) => void;
  onSaveNote: (item: WorkflowItem, text: string) => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState(item.note_text ?? "");
  const complete = isItemComplete(item);
  const kind = item.kind as WorkflowItemKind;

  return (
    <View style={[styles.step, { borderColor: theme.colors.border }]}>
      <View style={styles.stepHead}>
        <Text style={[typography.body, { color: theme.colors.foreground, flex: 1 }]}>
          {item.label}
        </Text>
        <Text
          style={[
            typography.overline,
            { color: complete ? theme.colors.primary : theme.colors.mutedForeground },
          ]}
        >
          {WORKFLOW_KIND_LABELS[kind] ?? item.kind}
          {item.required ? " · REQ" : ""}
        </Text>
      </View>

      {kind === "check" ? (
        <Pressable
          onPress={() => onToggleCheck(item)}
          style={[
            styles.stepAction,
            {
              backgroundColor: complete ? theme.colors.primary : theme.colors.background,
              borderColor: complete ? theme.colors.primary : theme.colors.border,
            },
          ]}
        >
          <Text
            style={[
              typography.bodyStrong,
              { color: complete ? theme.colors.primaryForeground : theme.colors.mutedForeground },
            ]}
          >
            {complete ? "Done" : "Mark done"}
          </Text>
        </Pressable>
      ) : null}

      {kind === "note" ? (
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={() => onSaveNote(item, draft)}
          multiline
          placeholder="Write the note"
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
      ) : null}

      {kind === "photo" ? (
        <Pressable
          onPress={() => router.push(`/project/${projectId}/capture?workflowItemId=${item.id}`)}
          style={[
            styles.stepAction,
            {
              backgroundColor: complete ? theme.colors.primary : theme.colors.background,
              borderColor: complete ? theme.colors.primary : theme.colors.border,
            },
          ]}
        >
          <Text
            style={[
              typography.bodyStrong,
              { color: complete ? theme.colors.primaryForeground : theme.colors.primary },
            ]}
          >
            {complete ? "Photo attached · replace" : "Take photo"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
  phase: {
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  phaseHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  step: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  stepHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stepAction: {
    borderWidth: 1,
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
  signButton: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: HIT_TARGET,
  },
});
