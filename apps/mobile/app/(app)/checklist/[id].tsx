import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Keyboard, Pressable, RefreshControl, ScrollView, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  answerWantsPhoto,
  CHECKLIST_TYPE_LABELS,
  formatChecklistAnswer,
  isMissingRequiredPhoto,
  normalizeUnit,
  SEVERITY_LEVELS,
  type ChecklistItemType,
} from "@everlumen/shared";
import {
  addChecklistItems,
  applyItemPatch,
  choicesFor,
  completeChecklist,
  deleteChecklist,
  deleteChecklistItem,
  getChecklist,
  listItemPhotoIds,
  patchChecklist,
  saveChecklistAsTemplate,
  saveChecklistItemPositions,
  hasResponse,
  parseNumericAnswer,
  responsePatch,
  toggledResponse,
  type ChecklistDetail,
  type ChecklistItem,
  type NewItemOptions,
} from "@/api/checklists";
import {
  addCounts,
  canReopenRecord,
  CHECKLIST_OVERRIDE_DETAIL,
  checklistCompletedMessage,
  checklistCompletionBlock,
  checklistDeleteMessage,
  checklistSnapshot,
  completionRights,
  missingPhotoCount,
  overrideConfirm,
  pendingAnswerWrites,
  photoCountsOf,
  queuedItemPhotoCounts,
  recordPrintLinks,
  reopenChecklistPatch,
} from "@/api/record-edit-rules";
import { getProjectContributors } from "@/api/task-comments";
import { memberLabel } from "@/api/task-mentions";
import { isShareLive, openShareSheet, publicUrl, setRecordShareEnabled } from "@/api/sharing";
import { moved, nextPosition, ordered, positionChanges } from "@/api/template-edit";
import { ChecklistEditPanel, NameSheet } from "@/components/ChecklistEditor";
import { ProjectSubPageHeader } from "@/components/ProjectSubPageHeader";
import { QueueBanner } from "@/components/QueueBanner";
import { webAppUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useRecordAuthoring } from "@/lib/use-access";
import { checklistItemRowId, type ChecklistItemPatchPayload } from "@/offline/handlers";
import { enqueue, listRows } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import { useQueue } from "@/offline/use-queue";
import { HIT_TARGET, radius, spacing, useLayout, useTheme, type Theme } from "@/theme";
import {
  Camera,
  Check,
  CircleCheck,
  LayoutTemplate,
  PenLine,
  Printer,
  SquareCheckBig,
  RotateCcw,
  Share2,
  Star,
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
  SkeletonList,
  Text,
  type SheetAction,
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
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const theme = useTheme();
  // A form column, not a stretched phone layout, on a tablet.
  // Centred upright on a tablet; spread and clear of the notch on its side.
  const inset = useLayout().inset(spacing.lg);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [shareError, setShareError] = useState<string | null>(null);
  // Edit mode holds everything that changes the checklist's shape, so the
  // runner itself stays a plain list of answers. A blank checklist opens in it.
  const [editing, setEditing] = useState(edit === "1");
  const [menuOpen, setMenuOpen] = useState(false);
  const [naming, setNaming] = useState<"rename" | "template" | null>(null);
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const { canAuthor, isManager } = useRecordAuthoring();

  const queryKey = useMemo(() => ["checklist", id], [id]);

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey,
    queryFn: () => getChecklist(id!),
    enabled: Boolean(id),
  });

  /*
   * Photos per item, for the "Photo needed" badges and the completion gate.
   *
   * Attached photos plus the ones still in the outbox bound for an item: a
   * picture taken in a basement is evidence already, and nagging for it until
   * there is signal would teach people to ignore the badge. Refreshed when the
   * screen regains focus (back from the camera) and whenever the queue moves,
   * which is when a queued photo turns into an attached one.
   */
  const itemIds = useMemo(() => (data?.items ?? []).map((item) => item.id), [data?.items]);
  const photosKey = useMemo(() => ["checklist-item-photos", id], [id]);
  const photosQuery = useQuery({
    queryKey: [...photosKey, itemIds.join(",")],
    queryFn: async () => {
      const [attached, rows] = await Promise.all([listItemPhotoIds(itemIds), listRows(500)]);
      return addCounts(photoCountsOf(attached), queuedItemPhotoCounts(rows));
    },
    enabled: itemIds.length > 0,
  });
  const photoCounts = photosQuery.data;
  const queue = useQueue();
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: photosKey });
  }, [queue.outstanding, photosKey, queryClient]);
  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: photosKey });
    }, [photosKey, queryClient]),
  );

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

  /** The existing "Add photo evidence" flow: the camera, linked to this item. */
  const addPhoto = useCallback(
    (item: ChecklistItem) => {
      if (!data?.project_id) return;
      router.push(`/project/${data.project_id}/capture?checklistItemId=${item.id}`);
    },
    [data?.project_id],
  );

  /**
   * Record an answer, then offer the camera if the answer describes a problem.
   *
   * A Fail, a Poor or a High or Critical severity is the moment a photo is
   * worth most and the moment it is most often forgotten, so it is offered
   * right then. Not offered when the item already has a photo: the evidence is
   * there, and a prompt after every correction would be noise.
   */
  const setResponse = useCallback(
    (item: ChecklistItem, value: unknown) => {
      void patchItem(item, responsePatch(value, user?.id ?? null));
      if (!answerWantsPhoto(item.item_type, value)) return;
      if ((photoCounts?.get(item.id) ?? 0) > 0 || !data?.project_id) return;
      const answer = formatChecklistAnswer(item.item_type, value, item.unit);
      Alert.alert(
        "Add a photo of this issue?",
        `"${item.label}" was answered ${answer ?? "with a problem"}. A photo shows exactly what was found.`,
        [
          { text: "Not now", style: "cancel" },
          { text: "Add photo", onPress: () => addPhoto(item) },
        ],
      );
    },
    [addPhoto, data?.project_id, patchItem, photoCounts, user?.id],
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

  /**
   * Share this checklist, turning the link on first if it is off.
   *
   * One tap rather than a settings sheet: the reason someone opens this on site
   * is to hand the record to an inspector standing next to them, and a two-step
   * "enable, then share" is a step that exists only because the data model has
   * two fields.
   */
  const shareChecklist = useCallback(async () => {
    if (!data) return;
    try {
      if (!isShareLive(data.share_token, data.revoked_at)) {
        await setRecordShareEnabled("project_checklists", data.id, true);
        await refetch();
      }
      const url = publicUrl("checklists", data.share_token);
      if (!url) {
        setShareError("This checklist has no share link yet. Pull to refresh and try again.");
        return;
      }
      setShareError(null);
      await openShareSheet(url, data.name);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Could not share this checklist");
    }
  }, [data, refetch]);

  /*
   * Three locks, as on the web. Structure is an authoring right and a sealed
   * checklist is a compliance record, so neither may move once it is complete.
   * Reopening is the reviewing half of the assignment loop and has its own rule.
   */
  const sealed = Boolean(data?.completed_at);
  const canStructure = canAuthor && !sealed;
  const mayReopen =
    sealed &&
    canReopenRecord(
      {
        assignedTo: data?.assigned_to ?? null,
        assignedBy: data?.assigned_by ?? null,
        createdBy: data?.created_by ?? null,
        completedBy: data?.completed_by ?? null,
      },
      { userId: user?.id ?? null, isManager },
    );

  /**
   * Run one structure edit: online, not queued, and refetched afterwards so the
   * list shows what the server now holds. Returns whether it worked.
   */
  const runEdit = useCallback(
    async (work: () => Promise<void>, fallback: string): Promise<boolean> => {
      setBusy(true);
      setEditError(null);
      try {
        await work();
        await refetch();
        void queryClient.invalidateQueries({ queryKey: ["project-checklists", data?.project_id] });
        return true;
      } catch (e) {
        setEditError(e instanceof Error ? e.message : fallback);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [data?.project_id, queryClient, refetch],
  );

  const sortedItems = useMemo(() => ordered(data?.items ?? []), [data?.items]);

  /*
   * Names for the assignment sentences. The web says "Unknown" for an id it
   * cannot name; "the assignee" reads better in a sentence and is what the
   * shared rule falls back to anyway.
   */
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

  const rights = completionRights(
    { assignedTo: data?.assigned_to ?? null, assignedBy: data?.assigned_by ?? null },
    { userId: user?.id ?? null, isManager },
    nameOf(data?.assigned_to ?? null),
  );
  const completionBlock = checklistCompletionBlock(sortedItems, photoCounts);
  const [completing, setCompleting] = useState(false);

  /**
   * Mark as complete, in the web's order: who may close it (an override is
   * confirmed), every queued answer landed, required items answered, then one
   * update that seals it with a copy of every answer.
   */
  const seal = useCallback(async () => {
    if (!data || !user?.id) return;
    const userId = user.id;
    setCompleting(true);
    setEditError(null);
    try {
      // Commit a note or number still being typed (they save on blur), then
      // wait for the queue to carry every answer up, as the web flushes first.
      Keyboard.dismiss();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const itemIds = data.items.map((item) => item.id);
      let waiting = 0;
      let waitingPhotos = 0;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        requestSync();
        const rows = await listRows(500);
        waiting = pendingAnswerWrites(
          rows.map((row) => row.id),
          itemIds,
        );
        // A photo-required item is only satisfied once its photo is attached,
        // which happens when the upload lands, so those wait here too.
        const queuedPhotos = queuedItemPhotoCounts(rows);
        waitingPhotos = itemIds.reduce((sum, itemId) => sum + (queuedPhotos.get(itemId) ?? 0), 0);
        if (waiting === 0 && waitingPhotos === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      if (waiting > 0) {
        setEditError(
          `${waiting} answer${waiting === 1 ? " is" : "s are"} still waiting to upload. Complete the checklist once ${waiting === 1 ? "it has" : "they have"} synced.`,
        );
        return;
      }
      if (waitingPhotos > 0) {
        setEditError(
          `${waitingPhotos} photo${waitingPhotos === 1 ? " is" : "s are"} still uploading. Complete the checklist once ${waitingPhotos === 1 ? "it has" : "they have"} synced.`,
        );
        return;
      }

      const fresh = (await refetch()).data ?? data;
      // Photos read from the server, not the screen's count: only an attached
      // photo satisfies a photo-required item on the sealed record.
      const photos = await listItemPhotoIds(fresh.items.map((item) => item.id));
      const block = checklistCompletionBlock(fresh.items, photoCountsOf(photos));
      if (block) {
        setEditError(block);
        return;
      }
      const now = new Date().toISOString();
      await completeChecklist(fresh.id, {
        completedAt: now,
        userId,
        snapshot: checklistSnapshot(fresh.name, now, fresh.items, photos),
      });
      await refetch();
      void queryClient.invalidateQueries({ queryKey: ["project-checklists", fresh.project_id] });
      setEditing(false);
      Alert.alert(
        "Checklist complete",
        checklistCompletedMessage(fresh.assigned_by, userId, nameOf(fresh.assigned_by) || "They"),
      );
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Could not complete the checklist");
    } finally {
      setCompleting(false);
    }
  }, [data, nameOf, queryClient, refetch, user?.id]);

  const confirmComplete = useCallback(() => {
    if (!data) return;
    if (!rights.canComplete) {
      Alert.alert("Cannot complete", rights.reason ?? "You can't mark this complete.");
      return;
    }
    if (!rights.isOverride) {
      void seal();
      return;
    }
    const copy = overrideConfirm({
      what: data.name,
      who: nameOf(data.assigned_to) || "the assignee",
      detail: CHECKLIST_OVERRIDE_DETAIL,
    });
    Alert.alert(copy.title, copy.description, [
      { text: "Cancel", style: "cancel" },
      { text: copy.confirmText, onPress: () => void seal() },
    ]);
  }, [data, nameOf, rights, seal]);

  /** Print, as the workflow runner does: the web's print sheet in the in-app browser. */
  const print = useCallback(async () => {
    if (!data) return;
    const links = recordPrintLinks({
      kind: "checklists",
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
      "Print this checklist",
      "Printing opens the checklist's print sheet in the browser. Its share link is off: turn it on to print without signing in, or open it on the web and sign in there.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open on web", onPress: () => void WebBrowser.openBrowserAsync(webUrl) },
        {
          text: "Turn on link",
          onPress: async () => {
            try {
              await setRecordShareEnabled("project_checklists", data.id, true);
              await refetch();
              const url = publicUrl("checklists", data.share_token);
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

  const addItems = useCallback(
    (labels: string[], itemType: string, options?: NewItemOptions) =>
      runEdit(async () => {
        if (!data) return;
        await addChecklistItems(data.id, labels, itemType, nextPosition(data.items), options);
      }, "Could not add those items"),
    [data, runEdit],
  );

  const moveItem = useCallback(
    (item: ChecklistItem, by: -1 | 1) => {
      const before = sortedItems;
      const after = moved(before, item.id, by);
      const changes = positionChanges(before, after);
      if (changes.length === 0) return;
      void runEdit(() => saveChecklistItemPositions(changes), "Could not move that item");
    },
    [runEdit, sortedItems],
  );

  const toggleRequired = useCallback(
    (item: ChecklistItem) =>
      void runEdit(
        () => applyItemPatch(item.id, { required: !item.required }),
        "Could not change that item",
      ),
    [runEdit],
  );

  // Same right as "Required": both are checklist structure, and the authoring
  // trigger checks `photo_required` and `unit` with the other structure columns.
  const togglePhotoRequired = useCallback(
    (item: ChecklistItem) =>
      void runEdit(
        () => applyItemPatch(item.id, { photo_required: !item.photo_required }),
        "Could not change that item",
      ),
    [runEdit],
  );

  const setUnit = useCallback(
    (item: ChecklistItem, unit: string | null) =>
      runEdit(
        () => applyItemPatch(item.id, { unit: normalizeUnit(unit) }),
        "Could not change the unit",
      ),
    [runEdit],
  );

  const confirmDeleteItem = useCallback(
    (item: ChecklistItem) => {
      Alert.alert("Remove this item?", `"${item.label}" and any answer on it will be removed.`, [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            void runEdit(() => deleteChecklistItem(item.id), "Could not remove that item"),
        },
      ]);
    },
    [runEdit],
  );

  const rename = useCallback(
    async (name: string) => {
      if (!data) return;
      if (name === data.name) {
        setNaming(null);
        return;
      }
      const ok = await runEdit(() => patchChecklist(data.id, { name }), "Could not rename it");
      if (ok) setNaming(null);
    },
    [data, runEdit],
  );

  const saveTemplate = useCallback(
    async (name: string) => {
      if (!data || !user?.id) return;
      const userId = user.id;
      const ok = await runEdit(
        () => saveChecklistAsTemplate({ name, userId, items: data.items }),
        "Could not save that template",
      );
      if (!ok) return;
      setNaming(null);
      void queryClient.invalidateQueries({ queryKey: ["checklist-templates"] });
      Alert.alert("Template saved", `"${name}" is in your checklist templates now.`);
    },
    [data, queryClient, runEdit, user?.id],
  );

  const confirmReopen = useCallback(() => {
    if (!data) return;
    Alert.alert(
      "Reopen this checklist?",
      "The sealed record will be cleared so the checklist can be edited again. Anyone holding its share link will see the reopened version.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reopen",
          onPress: () =>
            void runEdit(
              () => patchChecklist(data.id, reopenChecklistPatch()),
              "Could not reopen it",
            ),
        },
      ],
    );
  }, [data, runEdit]);

  const confirmDeleteChecklist = useCallback(() => {
    if (!data) return;
    Alert.alert("Delete this checklist?", checklistDeleteMessage(data.name, data.items.length), [
      { text: "Keep", style: "cancel" },
      {
        text: "Delete checklist",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteChecklist(data.id);
            queryClient.removeQueries({ queryKey });
            await queryClient.invalidateQueries({
              queryKey: ["project-checklists", data.project_id],
            });
            if (router.canGoBack()) router.back();
            else router.replace(`/project/${data.project_id}/checklists`);
          } catch (e) {
            Alert.alert(
              "Could not delete the checklist",
              e instanceof Error ? e.message : "Try again when you have signal.",
            );
          }
        },
      },
    ]);
  }, [data, queryClient, queryKey]);

  const menuActions: SheetAction[] = [
    { label: "Print or save as PDF", icon: Printer, onPress: () => void print() },
    ...(canStructure
      ? [{ label: "Rename", icon: PenLine, onPress: () => setNaming("rename") }]
      : []),
    ...(mayReopen ? [{ label: "Reopen checklist", icon: RotateCcw, onPress: confirmReopen }] : []),
    ...(canAuthor
      ? [
          {
            label: "Save as template",
            icon: LayoutTemplate,
            onPress: () => setNaming("template"),
          },
          {
            label: "Delete checklist",
            icon: Trash2,
            destructive: true,
            onPress: confirmDeleteChecklist,
          },
        ]
      : []),
  ];

  const items = data?.items ?? [];
  const done = items.filter((item) => item.completed_at).length;
  const outstandingRequired = items.filter((item) => item.required && !item.completed_at).length;
  const photosNeeded = photoCounts ? missingPhotoCount(items, photoCounts) : 0;

  return (
    <>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ProjectSubPageHeader
          projectId={data?.project_id}
          title={data?.name ?? "Checklist"}
          summary={
            !data
              ? null
              : items.length === 0
                ? "No items on this checklist"
                : `${done} of ${items.length} answered · ${
                    outstandingRequired > 0
                      ? `${outstandingRequired} required left`
                      : "all required answered"
                  }${
                    photosNeeded > 0
                      ? ` · ${photosNeeded} photo${photosNeeded === 1 ? "" : "s"} needed`
                      : ""
                  }`
          }
          progress={
            items.length > 0
              ? {
                  value: done,
                  total: items.length,
                  tone: outstandingRequired === 0 && photosNeeded === 0 ? "success" : "primary",
                }
              : null
          }
          actions={
            data ? (
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                {canStructure ? (
                  <IconButton
                    icon={editing ? Check : PenLine}
                    accessibilityLabel={editing ? "Done editing" : "Edit items"}
                    tone="primary"
                    onPress={() => {
                      setEditError(null);
                      setEditing((current) => !current);
                    }}
                  />
                ) : null}
                <IconButton
                  icon={Share2}
                  accessibilityLabel={
                    isShareLive(data.share_token, data.revoked_at)
                      ? "Share this checklist"
                      : "Turn on sharing for this checklist"
                  }
                  /*
                   * Tinted while the link is live, muted while it is off, so the
                   * header says whether this record is currently public without
                   * anyone having to open the sheet to find out.
                   */
                  tone={isShareLive(data.share_token, data.revoked_at) ? "primary" : "muted"}
                  onPress={() => void shareChecklist()}
                />
                {menuActions.length > 0 ? (
                  <KebabButton
                    accessibilityLabel="Checklist actions"
                    onPress={() => setMenuOpen(true)}
                  />
                ) : null}
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
          <SkeletonList rows={5} />
        ) : error || !data ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Checklist not found"}
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
            {sealed ? (
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
                  Completed. The record is sealed, so answers cannot change until it is reopened.
                </Text>
                {mayReopen ? (
                  <Button
                    label="Reopen"
                    icon={RotateCcw}
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onPress={confirmReopen}
                  />
                ) : null}
              </Card>
            ) : null}

            {editing && canStructure ? (
              <ChecklistEditPanel
                items={sortedItems}
                busy={busy}
                error={editError}
                onAdd={addItems}
                onDelete={confirmDeleteItem}
                onMove={moveItem}
                onToggleRequired={toggleRequired}
                onTogglePhotoRequired={togglePhotoRequired}
                onSetUnit={setUnit}
              />
            ) : (
              <View
                // A sealed checklist is read, not filled: the same lock the web
                // runner applies.
                pointerEvents={sealed ? "none" : "auto"}
                style={{ gap: spacing.md, opacity: sealed ? 0.75 : 1 }}
              >
                {sortedItems.map((item) => (
                  <ChecklistRow
                    key={item.id}
                    item={item}
                    projectId={data.project_id}
                    photoCount={photoCounts?.get(item.id) ?? null}
                    onAddPhoto={addPhoto}
                    onSetResponse={setResponse}
                    onToggleDone={toggleDone}
                    onSetNote={setNote}
                  />
                ))}
              </View>
            )}

            {!sealed && !editing ? (
              <Card style={{ gap: spacing.sm }}>
                {completionBlock ? (
                  <Text variant="caption" tone="safety">
                    {completionBlock}
                  </Text>
                ) : null}
                {!rights.canComplete && rights.reason ? (
                  <Text variant="caption" tone="muted">
                    {rights.reason}
                  </Text>
                ) : null}
                <Button
                  label={
                    rights.isOverride
                      ? `Complete for ${nameOf(data.assigned_to) || "the assignee"}`
                      : "Mark as complete"
                  }
                  icon={SquareCheckBig}
                  fullWidth
                  loading={completing}
                  disabled={Boolean(completionBlock) || !rights.canComplete || busy}
                  onPress={confirmComplete}
                />
              </Card>
            ) : null}

            {!editing && editError ? (
              <Text variant="caption" tone="destructive">
                {editError}
              </Text>
            ) : null}
          </ScrollView>
        )}
      </View>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={data?.name}
        actions={menuActions}
      />

      <NameSheet
        visible={naming !== null}
        title={naming === "template" ? "Save as template" : "Rename checklist"}
        subtitle={
          naming === "template" ? "Reuse this checklist's items on other projects." : undefined
        }
        label={naming === "template" ? "Template name" : "Name"}
        initial={data?.name ?? ""}
        confirmLabel={naming === "template" ? "Save template" : "Save"}
        busy={busy}
        error={naming ? editError : null}
        onClose={() => setNaming(null)}
        onSubmit={(name) => void (naming === "template" ? saveTemplate(name) : rename(name))}
      />
    </>
  );
}

function ChecklistRow({
  item,
  projectId,
  photoCount,
  onAddPhoto,
  onSetResponse,
  onToggleDone,
  onSetNote,
}: {
  item: ChecklistItem;
  projectId: string | undefined;
  /** Attached plus queued photos, or null while not yet known. */
  photoCount: number | null;
  onAddPhoto: (item: ChecklistItem) => void;
  onSetResponse: (item: ChecklistItem, value: unknown) => void;
  onToggleDone: (item: ChecklistItem) => void;
  onSetNote: (item: ChecklistItem, text: string) => void;
}) {
  const theme = useTheme();
  const answered = Boolean(item.completed_at);
  const choices = choicesFor(item.item_type);
  // Unknown counts draw no badge: a "Photo needed" that flashes on every open
  // and then disappears is a badge people learn to ignore.
  const photoNeeded = photoCount !== null && isMissingRequiredPhoto(item, photoCount);

  return (
    <Card
      // An answered item keeps its green edge. On a long list this is what tells
      // you where you stopped without reading a single label.
      style={{
        borderColor: answered ? theme.colors.success : theme.colors.border,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {item.label}
        </Text>
        {answered ? <Icon icon={CircleCheck} size="md" tone="success" /> : null}
      </View>

      {/*
        The states sit under the label rather than beside it: two badges beside
        a label on a phone squeeze it to a word a line.
      */}
      {item.required || item.photo_required ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
          {item.required ? <Badge label="Required" tone="warning" /> : null}
          {photoNeeded ? (
            <Badge label="Photo needed" tone="danger" variant="solid" icon={Camera} />
          ) : item.photo_required ? (
            <Badge
              label={photoCount ? "Photo added" : "Photo required"}
              tone={photoCount ? "success" : "neutral"}
              icon={Camera}
            />
          ) : null}
        </View>
      ) : null}

      {item.description ? (
        <Text variant="caption" tone="muted">
          {item.description}
        </Text>
      ) : null}

      <Text variant="overline" tone="muted">
        {(
          CHECKLIST_TYPE_LABELS[item.item_type as ChecklistItemType] ?? item.item_type
        ).toUpperCase()}
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

      {item.item_type === "condition" ? (
        <ConditionChoices item={item} onSetResponse={onSetResponse} />
      ) : null}

      {choices && item.item_type !== "condition" ? (
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

      {item.item_type === "severity" ? (
        <Severity item={item} onSetResponse={onSetResponse} />
      ) : null}

      {item.item_type === "text" || item.item_type === "numeric" ? (
        <FreeTextAnswer item={item} onSetResponse={onSetResponse} />
      ) : null}

      <ItemNote item={item} onSetNote={onSetNote} />

      {projectId ? (
        <Button
          label={photoCount ? `Add photo evidence (${photoCount} added)` : "Add photo evidence"}
          icon={Camera}
          // Promoted from ghost while the item owes a photo, so the fix for the
          // red badge is the most visible thing in the card.
          variant={photoNeeded ? "outline" : "ghost"}
          size="sm"
          fullWidth
          onPress={() => onAddPhoto(item)}
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
            onPress={() =>
              onSetResponse(item, toggledResponse("rating", item.response_value, value))
            }
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
 * The colour of each severity step, green for Minor through to red for
 * Critical, with the label colour that reads on it.
 *
 * From the palette where it has the colour: success, safety amber, the primary
 * orange and destructive red. Low has no token, so it is the one mixed here,
 * a yellow-green between success and safety.
 */
function severityTone(level: number, theme: Theme): { fill: string; label: string } {
  const { colors } = theme;
  switch (level) {
    case 1:
      return { fill: colors.success, label: colors.successForeground };
    case 2:
      return {
        fill: theme.scheme === "dark" ? "#a8c45a" : "#8fb03a",
        label: colors.safetyForeground,
      };
    case 3:
      return { fill: colors.safety, label: colors.safetyForeground };
    case 4:
      return { fill: colors.primary, label: colors.primaryForeground };
    default:
      return { fill: colors.destructive, label: colors.destructiveForeground };
  }
}

/**
 * How bad an issue is, 1 (Minor) to 5 (Critical).
 *
 * Five buttons each carrying its number and its word, not stars: a rating is
 * "how good", and a row of stars here would read as a five-star Critical. Only
 * the selected one is filled, in its own colour, so a 5 reads as urgent from
 * across a room. The thin bar under each unselected step keeps the scale's
 * direction visible before anything is picked.
 */
function Severity({
  item,
  onSetResponse,
}: {
  item: ChecklistItem;
  onSetResponse: (item: ChecklistItem, value: unknown) => void;
}) {
  const theme = useTheme();
  const current =
    typeof item.response_value === "number" ? item.response_value : Number(item.response_value);

  return (
    <View style={{ flexDirection: "row", gap: spacing.sm }}>
      {SEVERITY_LEVELS.map((level) => {
        const selected = current === level.value;
        const tone = severityTone(level.value, theme);
        return (
          <Pressable
            key={level.value}
            accessibilityRole="button"
            accessibilityLabel={`Severity ${level.value}, ${level.label}`}
            accessibilityState={{ selected }}
            onPress={() =>
              onSetResponse(item, toggledResponse("severity", item.response_value, level.value))
            }
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 64,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              paddingHorizontal: 2,
              borderRadius: radius.md,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? tone.fill : theme.colors.border,
              borderBottomWidth: selected ? 2 : 4,
              borderBottomColor: tone.fill,
              backgroundColor: selected ? tone.fill : theme.colors.card,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text variant="heading" style={selected ? { color: tone.label } : undefined}>
              {level.value}
            </Text>
            <Text
              variant="caption"
              tone={selected ? "default" : "muted"}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={selected ? { color: tone.label, fontWeight: "600" } : undefined}
            >
              {level.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Good / Fair / Poor, laid out like the Pass / Fail buttons but each in its
 * own colour once chosen, so a column of conditions can be scanned for the
 * red ones.
 */
function ConditionChoices({
  item,
  onSetResponse,
}: {
  item: ChecklistItem;
  onSetResponse: (item: ChecklistItem, value: unknown) => void;
}) {
  const theme = useTheme();
  const tones: Record<string, { fill: string; label: string }> = {
    Good: { fill: theme.colors.success, label: theme.colors.successForeground },
    Fair: { fill: theme.colors.safety, label: theme.colors.safetyForeground },
    Poor: { fill: theme.colors.destructive, label: theme.colors.destructiveForeground },
  };

  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
      {(choicesFor("condition") ?? []).map((choice) => {
        const selected = item.response_value === choice;
        const tone = tones[choice];
        return (
          <Pressable
            key={choice}
            accessibilityRole="button"
            accessibilityLabel={choice}
            accessibilityState={{ selected }}
            onPress={() =>
              onSetResponse(item, toggledResponse("condition", item.response_value, choice))
            }
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 96,
              height: HIT_TARGET,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: selected ? tone.fill : theme.colors.border,
              backgroundColor: selected ? tone.fill : "transparent",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text variant="bodyStrong" style={selected ? { color: tone.label } : undefined}>
              {choice}
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
  const unit = numeric ? normalizeUnit(item.unit) : null;
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
      suffix={unit}
      autoCapitalize={numeric ? "none" : "sentences"}
    />
  );
}
