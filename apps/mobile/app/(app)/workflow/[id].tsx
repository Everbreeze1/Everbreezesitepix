import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WORKFLOW_KIND_LABELS, type WorkflowItemKind } from "@everlumen/shared";
import {
  canSignOff,
  checkItemPatch,
  currentPhaseIndex,
  describeMissing,
  isItemComplete,
  pendingStageWrites,
  phaseDone,
  phaseState,
  runIsStaged,
  signoffPatch,
  workflowStages,
  type StageView,
} from "@/api/workflow-state";
import {
  completionRights,
  overrideConfirm,
  recordPrintLinks,
  workflowCompletedMessage,
  workflowDeleteMessage,
  workflowReadiness,
} from "@/api/record-edit-rules";
import { getProjectContributors } from "@/api/task-comments";
import { memberLabel } from "@/api/task-mentions";
import {
  completeWorkflow,
  deleteWorkflow,
  getWorkflow,
  markStageDone,
  reopenWorkflow,
  unlockStage,
  type WorkflowDetail,
  type WorkflowItem,
  type WorkflowPhase,
} from "@/api/workflows";
import { isShareLive, openShareSheet, publicUrl, setRecordShareEnabled } from "@/api/sharing";
import { ProjectSubPageHeader } from "@/components/ProjectSubPageHeader";
import { QueueBanner } from "@/components/QueueBanner";
import { webAppUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useRecordAuthoring } from "@/lib/use-access";
import {
  workflowItemRowId,
  workflowPhaseRowId,
  type WorkflowItemPatchPayload,
  type WorkflowPhasePatchPayload,
} from "@/offline/handlers";
import { enqueue, listRows } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import { radius, spacing, useLayout, useTheme } from "@/theme";
import {
  Camera,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Lock,
  LockOpen,
  PenLine,
  Printer,
  RotateCcw,
  Share2,
  SquareCheckBig,
  Trash2,
} from "@/ui/icons";
import {
  ActionSheet,
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Icon,
  IconButton,
  KebabButton,
  ProgressBar,
  SkeletonList,
  StepProgress,
  Text,
} from "@/ui";

export default function WorkflowRunnerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  // A form column, not a stretched phone layout, on a tablet.
  // Centred upright on a tablet; spread and clear of the notch on its side.
  const inset = useLayout().inset(spacing.lg);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [shareError, setShareError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The stage whose "Mark stage done" or "Unlock early" is in flight.
  const [stageBusy, setStageBusy] = useState<string | null>(null);
  const { canAuthor, isManager } = useRecordAuthoring();

  const queryKey = useMemo(() => ["workflow", id], [id]);

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey,
    queryFn: () => getWorkflow(id!),
    enabled: Boolean(id),
  });

  /*
   * Coming back from a linked checklist or the camera is when a step may have
   * changed underneath this screen (a completed checklist completes its step
   * in the database), so the run is read again on focus.
   */
  useFocusEffect(
    useCallback(() => {
      if (id) void refetch();
    }, [id, refetch]),
  );

  /**
   * Share this workflow, turning the link on first if it is off.
   *
   * Same one-tap shape as the checklist runner: the reason to open this on site
   * is to hand the record to someone standing next to you, and splitting it
   * into "enable" then "share" is a step that exists only because the row has
   * two columns.
   */
  const shareWorkflow = useCallback(async () => {
    if (!data) return;
    try {
      if (!isShareLive(data.share_token, data.revoked_at)) {
        await setRecordShareEnabled("project_workflows", data.id, true);
        await refetch();
      }
      const url = publicUrl("workflows", data.share_token);
      if (!url) {
        setShareError("This workflow has no share link yet. Pull to refresh and try again.");
        return;
      }
      setShareError(null);
      await openShareSheet(url, data.name);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Could not share this workflow");
    }
  }, [data, refetch]);

  /**
   * Reopen a completed workflow. Anyone on the job may, as on the web: closing
   * is the assignee's call, sending it back for more work is not guarded.
   */
  const reopen = useCallback(async () => {
    if (!data) return;
    setBusy(true);
    try {
      await reopenWorkflow(data.id);
      await refetch();
      void queryClient.invalidateQueries({ queryKey: ["project-workflows", data.project_id] });
    } catch (e) {
      Alert.alert(
        "Could not reopen the workflow",
        e instanceof Error ? e.message : "Try again when you have signal.",
      );
    } finally {
      setBusy(false);
    }
  }, [data, queryClient, refetch]);

  const membersQuery = useQuery({
    queryKey: ["project-contributors", data?.project_id],
    queryFn: () => getProjectContributors(data!.project_id),
    enabled: Boolean(data?.project_id),
    staleTime: 10 * 60 * 1000,
  });
  const nameOf = useCallback(
    (userId: string | null) => {
      const member = userId ? membersQuery.data?.find((m) => m.user_id === userId) : null;
      return member ? memberLabel(member) : "";
    },
    [membersQuery.data],
  );

  /*
   * Two separate questions, as on the web: is the run ready (every required
   * step and sign-off done), and is it this person's to close.
   */
  /*
   * A staged run (every run but a walkthrough) works its phases as stages: in
   * order, each marked done by hand once its proof is in. A walkthrough is a
   * shot list and keeps the old rules exactly, so `stages` is null for one.
   */
  const staged = runIsStaged(data);
  const stages = useMemo(
    () => (data && staged ? workflowStages(data.phases) : null),
    [data, staged],
  );
  const readiness = workflowReadiness(
    (data?.phases ?? []).map((phase) => phaseState(phase, phase.items)),
    stages?.map((view) => ({
      name: view.phase.name || `Stage ${view.index + 1}`,
      done: view.done,
    })) ?? null,
  );
  const rights = completionRights(
    { assignedTo: data?.assigned_to ?? null, assignedBy: data?.assigned_by ?? null },
    { userId: user?.id ?? null, isManager },
    nameOf(data?.assigned_to ?? null),
  );

  const complete = useCallback(async () => {
    if (!data) return;
    setBusy(true);
    try {
      await completeWorkflow(data.id, new Date().toISOString());
      await refetch();
      void queryClient.invalidateQueries({ queryKey: ["project-workflows", data.project_id] });
      Alert.alert(
        "Workflow complete",
        workflowCompletedMessage(
          data.name,
          data.assigned_by,
          user?.id ?? null,
          nameOf(data.assigned_by) || "They",
        ),
      );
    } catch (e) {
      Alert.alert(
        "Could not complete the workflow",
        e instanceof Error ? e.message : "Try again when you have signal.",
      );
    } finally {
      setBusy(false);
    }
  }, [data, nameOf, queryClient, refetch, user?.id]);

  const confirmComplete = useCallback(() => {
    if (!data) return;
    if (!rights.canComplete) {
      Alert.alert("Cannot complete", rights.reason ?? "You can't mark this workflow complete.");
      return;
    }
    if (!rights.isOverride) {
      void complete();
      return;
    }
    const copy = overrideConfirm({
      what: data.name,
      who: nameOf(data.assigned_to) || "the assignee",
    });
    Alert.alert(copy.title, copy.description, [
      { text: "Cancel", style: "cancel" },
      { text: copy.confirmText, onPress: () => void complete() },
    ]);
  }, [complete, data, nameOf, rights]);

  const confirmDelete = useCallback(() => {
    if (!data) return;
    const message = workflowDeleteMessage(data.name, {
      phases: data.phases.length,
      steps: data.phases.reduce((sum, phase) => sum + phase.items.length, 0),
      signoffs: data.phases.filter((phase) => phase.signed_off_at).length,
    });
    Alert.alert("Delete this workflow?", message, [
      { text: "Keep", style: "cancel" },
      {
        text: "Delete workflow",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteWorkflow(data.id);
            queryClient.removeQueries({ queryKey });
            await queryClient.invalidateQueries({
              queryKey: ["project-workflows", data.project_id],
            });
            if (router.canGoBack()) router.back();
            else router.replace(`/project/${data.project_id}/workflows`);
          } catch (e) {
            Alert.alert(
              "Could not delete the workflow",
              e instanceof Error ? e.message : "Try again when you have signal.",
            );
          }
        },
      },
    ]);
  }, [data, queryClient, queryKey]);

  /**
   * Print, the way the web does it: the record sheet, printed by the browser.
   *
   * There is no PDF endpoint for a workflow, so this opens the print sheet in
   * the in-app browser, whose share menu prints or saves a PDF. The public
   * page needs no sign-in, so it is used when the link is already live. When it
   * is off, turning it on is a choice about making the record public, so the
   * person is asked rather than having it done for them; the alternative is the
   * signed-in web page.
   */
  const print = useCallback(async () => {
    if (!data) return;
    const links = recordPrintLinks({
      kind: "workflows",
      webOrigin: webAppUrl,
      projectId: data.project_id,
      recordId: data.id,
      shareToken: data.share_token,
      revokedAt: data.revoked_at,
    });
    if (links.publicUrl) {
      void WebBrowser.openBrowserAsync(links.publicUrl);
      return;
    }
    if (!links.webUrl) {
      Alert.alert("Printing is not set up", "This build has no web address to print from.");
      return;
    }
    const webUrl = links.webUrl;
    Alert.alert(
      "Print this workflow",
      "Printing opens the workflow's print sheet in the browser. Its share link is off: turn it on to print without signing in, or open it on the web and sign in there.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open on web", onPress: () => void WebBrowser.openBrowserAsync(webUrl) },
        {
          text: "Turn on link",
          onPress: async () => {
            try {
              await setRecordShareEnabled("project_workflows", data.id, true);
              await refetch();
              const url = publicUrl("workflows", data.share_token);
              if (url) void WebBrowser.openBrowserAsync(url);
            } catch (e) {
              Alert.alert(
                "Could not turn on the link",
                e instanceof Error ? e.message : "Try again when you have signal.",
              );
            }
          },
        },
      ],
    );
  }, [data, refetch]);

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

  /**
   * Mark one stage done.
   *
   * Waits for this stage's queued ticks, notes, sign-off and photos to reach
   * the server first, the way closing a checklist does: the screen already
   * shows them, and the database judges the stage on what it has. If it still
   * refuses (an earlier stage reopened on another phone, a photo removed), its
   * sentence is what the crew sees.
   */
  const markDone = useCallback(
    async (phase: WorkflowPhase) => {
      if (!data) return;
      setStageBusy(phase.id);
      try {
        const itemIds = phase.items.map((item) => item.id);
        let waiting = 0;
        for (let attempt = 0; attempt < 15; attempt += 1) {
          requestSync();
          waiting = pendingStageWrites(await listRows(500), phase.id, itemIds);
          if (waiting === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        if (waiting > 0) {
          Alert.alert(
            "Still uploading",
            `${waiting} change${waiting === 1 ? " is" : "s are"} still waiting to upload. Mark the stage done once ${waiting === 1 ? "it has" : "they have"} synced.`,
          );
          return;
        }
        await markStageDone(phase.id, user?.id ?? null);
      } catch (e) {
        Alert.alert(
          "Could not mark this stage done",
          e instanceof Error ? e.message : "Try again when you have signal.",
        );
      } finally {
        setStageBusy(null);
        await refetch();
        void queryClient.invalidateQueries({ queryKey: ["project-workflows", data.project_id] });
        void queryClient.invalidateQueries({
          queryKey: ["project-workflow-strip", data.project_id],
        });
      }
    },
    [data, queryClient, refetch, user?.id],
  );

  /** Open a locked stage early: an Owner, Admin or Manager's call. */
  const unlock = useCallback(
    (phase: WorkflowPhase, waitingOn: string | null) => {
      if (!data) return;
      Alert.alert(
        `Unlock "${phase.name}" early?`,
        waitingOn
          ? `The crew can work this stage before "${waitingOn}" is done.`
          : "The crew can work this stage before the ones ahead of it are done.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unlock",
            onPress: async () => {
              setStageBusy(phase.id);
              try {
                await unlockStage(phase.id, user?.id ?? null);
              } catch (e) {
                Alert.alert(
                  "Could not unlock this stage",
                  e instanceof Error ? e.message : "Try again when you have signal.",
                );
              } finally {
                setStageBusy(null);
                await refetch();
              }
            },
          },
        ],
      );
    },
    [data, refetch, user?.id],
  );

  // Memoised for the same reason as the cursor below it: a fresh array each
  // render would recompute the phase walk on every keystroke in a note field.
  const phases = useMemo(() => data?.phases ?? [], [data?.phases]);
  const cursor = useMemo(
    () =>
      currentPhaseIndex(
        phases.map((phase) => ({ phase, items: phase.items })),
        staged,
      ),
    [phases, staged],
  );
  const viewById = useMemo(
    () => new Map((stages ?? []).map((view) => [view.phase.id, view])),
    [stages],
  );
  const unit = staged ? "stage" : "phase";

  return (
    <>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ProjectSubPageHeader
          projectId={data?.project_id}
          title={data?.name ?? "Workflow"}
          summary={
            !data
              ? null
              : phases.length === 0
                ? "No phases on this workflow"
                : cursor === -1
                  ? `All ${phases.length} ${unit}s ${staged ? "done" : "complete"}`
                  : `${staged ? "Stage" : "Phase"} ${cursor + 1} of ${phases.length}: ${phases[cursor]?.name ?? ""}`
          }
          actions={
            data ? (
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <IconButton
                  icon={Share2}
                  accessibilityLabel={
                    isShareLive(data.share_token, data.revoked_at)
                      ? "Share this workflow"
                      : "Turn on sharing for this workflow"
                  }
                  // Tinted while live, muted while off: the header states whether
                  // this record is public without anyone opening a sheet.
                  tone={isShareLive(data.share_token, data.revoked_at) ? "primary" : "muted"}
                  onPress={() => void shareWorkflow()}
                />
                <KebabButton
                  accessibilityLabel="Workflow actions"
                  onPress={() => setMenuOpen(true)}
                />
              </View>
            ) : null
          }
        />
        <QueueBanner />

        {shareError ? (
          <Text
            variant="caption"
            tone="destructive"
            style={{ paddingHorizontal: inset, paddingVertical: spacing.sm }}
          >
            {shareError}
          </Text>
        ) : null}

        {isLoading ? (
          <SkeletonList rows={4} />
        ) : error || !data ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Workflow not found"}
            onRetry={() => void refetch()}
          />
        ) : (
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: inset,
              paddingVertical: spacing.lg,
              gap: spacing.md,
            }}
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
            {data.completed_at ? (
              <Card
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.md,
                  borderColor: theme.colors.success,
                }}
              >
                <Icon icon={CircleCheck} size="md" tone="success" />
                <Text variant="body" style={{ flex: 1 }}>
                  This workflow is marked complete. Reopen it to make changes.
                </Text>
                <Button
                  label="Reopen"
                  icon={RotateCcw}
                  variant="outline"
                  size="sm"
                  loading={busy}
                  onPress={() => void reopen()}
                />
              </Card>
            ) : null}

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
              </Card>
            ) : null}

            {!data.completed_at ? (
              <Card style={{ gap: spacing.sm }}>
                {readiness.reason ? (
                  <Text variant="caption" tone="safety">
                    {readiness.reason}
                  </Text>
                ) : !rights.canComplete || rights.isOverride ? (
                  <Text variant="caption" tone="muted">
                    {rights.reason}
                  </Text>
                ) : null}
                <Button
                  label={rights.isOverride ? "Complete for them" : "Mark complete"}
                  icon={SquareCheckBig}
                  fullWidth
                  loading={busy}
                  disabled={!readiness.canComplete || !rights.canComplete}
                  onPress={confirmComplete}
                />
              </Card>
            ) : null}

            <View
              // A completed run is locked until it is reopened, as on the web.
              pointerEvents={data.completed_at ? "none" : "auto"}
              style={{ gap: spacing.md, opacity: data.completed_at ? 0.75 : 1 }}
            >
              {phases.map((phase, index) => (
                <PhaseCard
                  key={phase.id}
                  phase={phase}
                  projectId={data.project_id}
                  isCurrent={index === cursor}
                  stage={viewById.get(phase.id) ?? null}
                  canUnlock={canAuthor}
                  busy={stageBusy === phase.id}
                  onToggleCheck={toggleCheck}
                  onSaveNote={saveNote}
                  onSignOff={signOff}
                  onSavePhaseNote={savePhaseNote}
                  onMarkDone={markDone}
                  onUnlock={unlock}
                />
              ))}
            </View>
          </ScrollView>
        )}
      </View>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={data?.name}
        actions={[
          { label: "Print or save as PDF", icon: Printer, onPress: () => void print() },
          ...(data?.completed_at
            ? [{ label: "Reopen workflow", icon: RotateCcw, onPress: () => void reopen() }]
            : [
                {
                  label: rights.isOverride ? "Complete for them" : "Mark complete",
                  icon: SquareCheckBig,
                  disabled: !readiness.canComplete || !rights.canComplete,
                  onPress: confirmComplete,
                },
              ]),
          ...(canAuthor
            ? [
                {
                  label: "Delete workflow",
                  icon: Trash2,
                  destructive: true,
                  onPress: confirmDelete,
                },
              ]
            : []),
        ]}
      />
    </>
  );
}

function PhaseCard({
  phase,
  projectId,
  isCurrent,
  stage,
  canUnlock,
  busy,
  onToggleCheck,
  onSaveNote,
  onSignOff,
  onSavePhaseNote,
  onMarkDone,
  onUnlock,
}: {
  phase: WorkflowPhase;
  projectId: string;
  isCurrent: boolean;
  /** This phase as a stage, or null on a walkthrough run, which has none. */
  stage: StageView<WorkflowPhase> | null;
  /** Owners, Admins and Managers may open a locked stage early. */
  canUnlock: boolean;
  busy: boolean;
  onToggleCheck: (item: WorkflowItem) => void;
  onSaveNote: (item: WorkflowItem, text: string) => void;
  onSignOff: (phase: WorkflowPhase, name: string) => void;
  onSavePhaseNote: (phase: WorkflowPhase, text: string) => void;
  onMarkDone: (phase: WorkflowPhase) => void;
  onUnlock: (phase: WorkflowPhase, waitingOn: string | null) => void;
}) {
  const theme = useTheme();
  const [signName, setSignName] = useState("");
  const [phaseNote, setPhaseNote] = useState(phase.notes ?? "");
  const state = phaseState(phase, phase.items);
  // A locked stage is read-only: nothing in it can be ticked, photographed,
  // noted or signed until the stage ahead is done or a manager unlocks it.
  const locked = stage?.locked ?? false;
  const signable = !locked && canSignOff(phase, phase.items);
  const done = phaseDone(phase, phase.items, stage !== null);
  const missing = stage ? describeMissing(stage.missing) : null;

  return (
    <Card
      style={{
        // The phase being worked gets the heavier blue edge. On a workflow with
        // eight phases this is the only thing that answers "where am I" without
        // reading every heading.
        borderColor: isCurrent
          ? theme.colors.primary
          : done
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
        ) : done ? (
          <Badge label="Done" tone="success" icon={CircleCheck} />
        ) : locked ? (
          <Badge label="Locked" tone="neutral" icon={Lock} />
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
        tone={done ? "success" : "primary"}
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
          locked={locked}
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
        editable={!locked}
        placeholder={stage ? "Stage note (optional)" : "Phase note (optional)"}
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
              hint={
                signable
                  ? undefined
                  : locked
                    ? `Finish "${stage?.waitingOn ?? ""}" first.`
                    : "Finish the required steps first."
              }
            />
            <Button
              label={stage ? "Sign off stage" : "Sign off phase"}
              icon={PenLine}
              fullWidth
              disabled={!signable || !signName.trim()}
              onPress={() => onSignOff(phase, signName)}
            />
          </View>
        )
      ) : null}

      {/*
        The stage's own action, last in the card so it is the thing the crew
        reaches after the work above it. Walkthrough runs have no stages, so
        none of this is drawn for them.
      */}
      {stage ? (
        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
            paddingTop: spacing.md,
            marginTop: spacing.sm,
            gap: spacing.sm,
          }}
        >
          {stage.done ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Icon icon={CircleCheck} size="md" tone="success" />
              <Text variant="caption" tone="success" style={{ flex: 1 }}>
                Stage marked done
              </Text>
            </View>
          ) : (
            <>
              {locked ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Icon icon={Lock} size="sm" tone="muted" />
                  <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                    {`Finish "${stage.waitingOn}" first`}
                  </Text>
                </View>
              ) : missing ? (
                <Text variant="caption" tone="safety">
                  {`${missing} left`}
                </Text>
              ) : null}
              <Button
                label="Mark stage done"
                icon={SquareCheckBig}
                fullWidth
                loading={busy}
                disabled={!stage.canMarkDone || busy}
                onPress={() => onMarkDone(phase)}
              />
              {locked && canUnlock ? (
                <Button
                  label="Unlock early"
                  icon={LockOpen}
                  variant="outline"
                  fullWidth
                  disabled={busy}
                  onPress={() => onUnlock(phase, stage.waitingOn)}
                />
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </Card>
  );
}

function StepRow({
  item,
  projectId,
  locked,
  onToggleCheck,
  onSaveNote,
}: {
  item: WorkflowItem;
  projectId: string;
  /** The stage is waiting on an earlier one: show the step, change nothing. */
  locked: boolean;
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
      {kind === "checklist" ? null : (
        // A checklist step draws its label inside its own row, below.
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
          <Text variant="body" style={{ flex: 1 }}>
            {item.label}
          </Text>
          {item.required ? <Badge label="Required" tone="warning" /> : null}
          {complete ? <Icon icon={CircleCheck} size="md" tone="success" /> : null}
        </View>
      )}

      <Text variant="overline" tone="muted">
        {(WORKFLOW_KIND_LABELS[kind] ?? item.kind).toUpperCase()}
      </Text>

      {kind === "check" ? (
        <Button
          label={complete ? "Done" : "Mark done"}
          icon={complete ? CircleCheck : undefined}
          variant={complete ? "success" : "outline"}
          fullWidth
          disabled={locked}
          onPress={() => onToggleCheck(item)}
        />
      ) : null}

      {kind === "note" ? (
        <Field
          value={draft}
          onChangeText={setDraft}
          onBlur={() => {
            if (!locked) onSaveNote(item, draft);
          }}
          multiline
          rows={2}
          editable={!locked}
          placeholder="Write the note"
        />
      ) : null}

      {kind === "photo" ? (
        <Button
          label={complete ? "Photo attached · replace" : "Take photo"}
          icon={Camera}
          variant={complete ? "success" : "outline"}
          fullWidth
          disabled={locked}
          onPress={() => router.push(`/project/${projectId}/capture?workflowItemId=${item.id}`)}
        />
      ) : null}

      {kind === "checklist" ? <ChecklistStep item={item} complete={complete} /> : null}
    </View>
  );
}

/**
 * A `checklist` step: the project checklist the stage waits on.
 *
 * The crew cannot tick this by hand. The database mirrors the checklist's
 * completion onto the step, so the row opens the checklist and reports where
 * it stands. Opening it is allowed on a locked stage too: looking is not
 * working, and the checklist screen has its own rules for editing.
 */
function ChecklistStep({ item, complete }: { item: WorkflowItem; complete: boolean }) {
  const theme = useTheme();
  const checklistId = item.checklist_id ?? null;
  const status = !checklistId ? "Checklist was removed" : complete ? "Done" : "Not done yet";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open checklist ${item.label}`}
      accessibilityState={{ disabled: !checklistId }}
      disabled={!checklistId}
      onPress={() => {
        if (checklistId) router.push(`/checklist/${checklistId}`);
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: complete ? theme.colors.success : theme.colors.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Icon icon={ClipboardCheck} size="md" tone={complete ? "success" : "primary"} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="body" numberOfLines={2}>
          {item.label}
        </Text>
        <Text variant="caption" tone={complete ? "success" : "muted"}>
          {status}
        </Text>
      </View>
      {item.required && !complete ? <Badge label="Required" tone="warning" /> : null}
      {checklistId ? <Icon icon={ChevronRight} size="sm" tone="muted" /> : null}
    </Pressable>
  );
}
