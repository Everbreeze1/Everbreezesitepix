import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
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
import { spacing, useTheme } from "@/theme";
import { Camera, CircleCheck, PenLine } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Icon,
  ProgressBar,
  SkeletonList,
  StepProgress,
  Text,
} from "@/ui";

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

  /** A free-text note against a phase, saved on blur. */
  const savePhaseNote = useCallback(
    async (phase: WorkflowPhase, text: string) => {
      const trimmed = text.trim();
      if ((phase.notes ?? "") === trimmed) return;
      const patch = { notes: trimmed || null };

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
        invalidate: [queryKey],
      };

      await enqueue({
        id: workflowPhaseRowId(phase.id, "notes"),
        kind: "workflow_phase_patch",
        projectId: data?.project_id ?? null,
        payload,
      });
      await refreshQueue();
      requestSync();
    },
    [data?.project_id, queryClient, queryKey],
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
        id: workflowPhaseRowId(phase.id, "signoff"),
        kind: "workflow_phase_patch",
        projectId: data?.project_id ?? null,
        payload,
      });
      await refreshQueue();
      requestSync();
    },
    [data?.project_id, queryClient, queryKey, user?.id],
  );

  // Memoised for the same reason as the cursor below it: a fresh array each
  // render would recompute the phase walk on every keystroke in a note field.
  const phases = useMemo(() => data?.phases ?? [], [data?.phases]);
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
          <SkeletonList rows={4} />
        ) : error || !data ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Workflow not found"}
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
            {phases.length > 0 ? (
              <Card>
                {/*
                 * One segment per phase, which a continuous bar cannot do. The
                 * question here is "which phase am I on and how many are left",
                 * and that is answered by counting blocks, not by a percentage.
                 */}
                <StepProgress
                  steps={phases.map((phase) => phase.name)}
                  currentIndex={cursor === -1 ? phases.length - 1 : cursor}
                />
                <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
                  {cursor === -1
                    ? "Every phase is complete."
                    : `Phase ${cursor + 1} of ${phases.length}: ${phases[cursor]?.name ?? ""}`}
                </Text>
              </Card>
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
                onSavePhaseNote={savePhaseNote}
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
  onSavePhaseNote,
}: {
  phase: WorkflowPhase;
  projectId: string;
  isCurrent: boolean;
  onToggleCheck: (item: WorkflowItem) => void;
  onSaveNote: (item: WorkflowItem, text: string) => void;
  onSignOff: (phase: WorkflowPhase, name: string) => void;
  onSavePhaseNote: (phase: WorkflowPhase, text: string) => void;
}) {
  const theme = useTheme();
  const [signName, setSignName] = useState("");
  const [phaseNote, setPhaseNote] = useState(phase.notes ?? "");
  const state = phaseState(phase, phase.items);
  const signable = canSignOff(phase, phase.items);

  return (
    <Card
      style={{
        // The phase being worked gets the heavier blue edge. On a workflow with
        // eight phases this is the only thing that answers "where am I" without
        // reading every heading.
        borderColor: isCurrent
          ? theme.colors.primary
          : state.complete
            ? theme.colors.success
            : theme.colors.border,
        borderWidth: isCurrent ? 2 : 1,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text variant="heading" style={{ flex: 1 }} numberOfLines={2}>
          {phase.name}
        </Text>
        {isCurrent ? (
          <Badge label="Now" tone="primary" variant="solid" />
        ) : state.complete ? (
          <Badge label="Done" tone="success" icon={CircleCheck} />
        ) : null}
      </View>

      {phase.description ? (
        <Text variant="caption" tone="muted">
          {phase.description}
        </Text>
      ) : null}

      <ProgressBar
        value={state.done}
        total={state.total}
        tone={state.complete ? "success" : "primary"}
        showLabel
        label={
          state.requiredTotal > 0
            ? `${state.done} of ${state.total} steps · ${state.requiredDone}/${state.requiredTotal} required`
            : `${state.done} of ${state.total} steps`
        }
      />

      {phase.items.map((item) => (
        <StepRow
          key={item.id}
          item={item}
          projectId={projectId}
          onToggleCheck={onToggleCheck}
          onSaveNote={onSaveNote}
        />
      ))}

      <Field
        value={phaseNote}
        onChangeText={setPhaseNote}
        onBlur={() => onSavePhaseNote(phase, phaseNote)}
        multiline
        rows={2}
        placeholder="Phase note (optional)"
      />

      {phase.requires_signoff ? (
        phase.signed_off_at ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Icon icon={CircleCheck} size="md" tone="success" />
            <Text variant="caption" tone="success">
              {`Signed off by ${phase.signoff_name ?? "a teammate"}`}
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Field
              label="Sign off"
              value={signName}
              onChangeText={setSignName}
              placeholder="Type your name to sign off"
              editable={signable}
              autoCapitalize="words"
              hint={signable ? undefined : "Finish the required steps first."}
            />
            <Button
              label="Sign off phase"
              icon={PenLine}
              fullWidth
              disabled={!signable || !signName.trim()}
              onPress={() => onSignOff(phase, signName)}
            />
          </View>
        )
      ) : null}
    </Card>
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
    <View
      style={{
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border,
        paddingTop: spacing.md,
        marginTop: spacing.sm,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <Text variant="body" style={{ flex: 1 }}>
          {item.label}
        </Text>
        {item.required ? <Badge label="Required" tone="warning" /> : null}
        {complete ? <Icon icon={CircleCheck} size="md" tone="success" /> : null}
      </View>

      <Text variant="overline" tone="muted">
        {(WORKFLOW_KIND_LABELS[kind] ?? item.kind).toUpperCase()}
      </Text>

      {kind === "check" ? (
        <Button
          label={complete ? "Done" : "Mark done"}
          icon={complete ? CircleCheck : undefined}
          variant={complete ? "success" : "outline"}
          fullWidth
          onPress={() => onToggleCheck(item)}
        />
      ) : null}

      {kind === "note" ? (
        <Field
          value={draft}
          onChangeText={setDraft}
          onBlur={() => onSaveNote(item, draft)}
          multiline
          rows={2}
          placeholder="Write the note"
        />
      ) : null}

      {kind === "photo" ? (
        <Button
          label={complete ? "Photo attached · replace" : "Take photo"}
          icon={Camera}
          variant={complete ? "success" : "outline"}
          fullWidth
          onPress={() => router.push(`/project/${projectId}/capture?workflowItemId=${item.id}`)}
        />
      ) : null}
    </View>
  );
}
