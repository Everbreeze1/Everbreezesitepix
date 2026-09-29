import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import {
  PIPELINE_STAGE_COLORS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  pipelineNameBlocks,
  pipelineNameIssue,
  pipelineNameMessage,
} from "@everlumen/shared";
import {
  canAddStage,
  defaultStageDrafts,
  draftsFromStages,
  droppedStageCount,
  droppedStageWarning,
  looksStandard,
  moveDraft,
  patchDraft,
  removeDraft,
  renameDraft,
  stageDraftsIssue,
  withNewStage,
  type StageDraft,
} from "@/api/pipeline-edit-view";
import type { ProjectBoard } from "@/api/pipeline-view";
import { radius, spacing, useTheme } from "@/theme";
import { ChevronDown, ChevronUp, Plus, RotateCcw, Trash2 } from "@/ui/icons";
import { Button, Field, IconButton, Sheet, Text } from "@/ui";

/**
 * New pipeline, and Pipeline Settings: the web's `CreateBoardDialog` and
 * `BoardSettingsSheet` in one sheet, because on a phone they are the same form
 * (a name and a list of stages) with a different button at the bottom.
 *
 * Each stage row carries its colour, its name, which of the three buckets a job
 * standing in it counts as, and arrows to move it up or down. The web drags
 * rows by a grip; a drag inside a scrolling sheet fights the scroll, and two
 * arrows do the same job with a thumb.
 *
 * Destructive steps ask first, as the web's do: deleting the pipeline, and
 * saving a stage list that drops stages still holding jobs.
 */
export function PipelineEditorSheet({
  visible,
  board,
  otherBoardNames,
  tagNames,
  projectNames,
  counts,
  saving,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  /** Null to create a new pipeline. */
  board: ProjectBoard | null;
  otherBoardNames: string[];
  tagNames: string[];
  projectNames: string[];
  /** Jobs per stage id, so removing a stage can say what it costs. */
  counts: ReadonlyMap<string, number>;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (name: string, stages: StageDraft[]) => void;
  onDelete?: () => void;
}) {
  const theme = useTheme();
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<StageDraft[]>([]);
  const [paletteFor, setPaletteFor] = useState<string | null>(null);

  // Every open starts from the saved pipeline, or the standard set for a new one.
  useEffect(() => {
    if (!visible) return;
    setName(board?.name ?? "");
    setDrafts(board ? draftsFromStages(board.stages ?? []) : defaultStageDrafts());
    setPaletteFor(null);
  }, [visible, board]);

  const nameIssue = useMemo(
    () =>
      name.trim() || board
        ? pipelineNameIssue(name, { otherPipelineNames: otherBoardNames, tagNames, projectNames })
        : null,
    [name, board, otherBoardNames, tagNames, projectNames],
  );
  const stagesIssue = stageDraftsIssue(drafts);
  const blocked = pipelineNameBlocks(nameIssue) || Boolean(stagesIssue) || !name.trim();

  const save = () => {
    if (blocked || saving) return;
    const dropped = board ? droppedStageCount(board.stages ?? [], drafts, counts) : 0;
    if (dropped > 0) {
      Alert.alert("Remove stages that still hold work?", droppedStageWarning(dropped), [
        { text: "Cancel", style: "cancel" },
        { text: "Remove stages", style: "destructive", onPress: () => onSave(name.trim(), drafts) },
      ]);
      return;
    }
    onSave(name.trim(), drafts);
  };

  const confirmDelete = () => {
    if (!board || !onDelete) return;
    Alert.alert(
      "Delete this pipeline?",
      `Delete "${board.name}"? The projects stay; only the pipeline and its stages are removed.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete pipeline", style: "destructive", onPress: onDelete },
      ],
    );
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={board ? "Pipeline settings" : "New pipeline"}
      subtitle="A pipeline is the process work moves through. Each project sits in one stage at a time."
      maxHeightRatio={0.92}
      footer={
        <View style={{ flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" }}>
          {board && onDelete ? (
            <Button
              label="Delete"
              icon={Trash2}
              variant="destructive"
              accessibilityLabel="Delete pipeline"
              onPress={confirmDelete}
              disabled={saving}
              style={{ flex: 1 }}
            />
          ) : (
            <Button label="Cancel" variant="outline" onPress={onClose} style={{ flex: 1 }} />
          )}
          <Button
            label={board ? "Done" : "Create pipeline"}
            onPress={save}
            loading={saving}
            disabled={blocked}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      <Field
        label="Pipeline name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Install Jobs"
        autoCapitalize="words"
        error={nameIssue && pipelineNameBlocks(nameIssue) ? pipelineNameMessage(nameIssue) : undefined}
        hint={
          nameIssue && !pipelineNameBlocks(nameIssue)
            ? pipelineNameMessage(nameIssue)
            : "Name it after the process it represents, not a customer, job or location."
        }
      />

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {`Stages (${drafts.length})`}
        </Text>
        {!looksStandard(drafts) ? (
          <Button
            label="Use standard"
            icon={RotateCcw}
            variant="ghost"
            size="sm"
            accessibilityLabel="Use the standard stages"
            onPress={() => setDrafts(defaultStageDrafts())}
          />
        ) : null}
      </View>
      <Text variant="caption" tone="muted">
        Each stage also says whether a job in it is live, paused or done. That is what the map and
        the project filters read.
      </Text>

      {drafts.map((draft, index) => {
        const label = draft.name.trim() || `stage ${index + 1}`;
        const holding = draft.id ? (counts.get(draft.id) ?? 0) : 0;
        return (
          <View
            key={draft.key}
            style={{
              gap: spacing.sm,
              padding: spacing.sm,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.background,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Colour for ${label}`}
                onPress={() => setPaletteFor(paletteFor === draft.key ? null : draft.key)}
                hitSlop={8}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: radius.pill,
                  backgroundColor: draft.color,
                  borderWidth: 2,
                  borderColor: paletteFor === draft.key ? theme.colors.foreground : theme.colors.border,
                }}
              />
              <Field
                value={draft.name}
                onChangeText={(next) => setDrafts(renameDraft(drafts, draft.key, next))}
                placeholder="Stage name"
                autoCapitalize="words"
                style={{ flex: 1 }}
              />
              <IconButton
                icon={ChevronUp}
                accessibilityLabel={`Move ${label} up`}
                surface={false}
                size="sm"
                disabled={index === 0}
                onPress={() => setDrafts(moveDraft(drafts, draft.key, -1))}
              />
              <IconButton
                icon={ChevronDown}
                accessibilityLabel={`Move ${label} down`}
                surface={false}
                size="sm"
                disabled={index === drafts.length - 1}
                onPress={() => setDrafts(moveDraft(drafts, draft.key, 1))}
              />
              <IconButton
                icon={Trash2}
                accessibilityLabel={`Remove ${label}`}
                surface={false}
                size="sm"
                tone="destructive"
                disabled={drafts.length <= 1}
                onPress={() => setDrafts(removeDraft(drafts, draft.key))}
              />
            </View>

            {paletteFor === draft.key ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {PIPELINE_STAGE_COLORS.map((color) => {
                  const chosen = draft.color.toLowerCase() === color.toLowerCase();
                  return (
                    <Pressable
                      key={color}
                      accessibilityRole="button"
                      accessibilityLabel={`Colour ${color}`}
                      accessibilityState={{ selected: chosen }}
                      onPress={() => {
                        setDrafts(patchDraft(drafts, draft.key, { color }));
                        setPaletteFor(null);
                      }}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: radius.pill,
                        backgroundColor: color,
                        borderWidth: chosen ? 3 : 1,
                        borderColor: chosen ? theme.colors.foreground : theme.colors.border,
                      }}
                    />
                  );
                })}
              </View>
            ) : null}

            <View style={{ flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" }}>
              {PROJECT_STATUSES.map((status) => {
                const chosen = draft.status === status;
                return (
                  <Pressable
                    key={status}
                    accessibilityRole="button"
                    accessibilityLabel={`${label} counts as ${PROJECT_STATUS_LABELS[status]}`}
                    accessibilityState={{ selected: chosen }}
                    onPress={() => setDrafts(patchDraft(drafts, draft.key, { status }))}
                    style={{
                      paddingHorizontal: spacing.md,
                      height: 32,
                      justifyContent: "center",
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: chosen ? theme.colors.primary : theme.colors.border,
                      backgroundColor: chosen ? theme.colors.primary : theme.colors.card,
                    }}
                  >
                    <Text variant="caption" tone={chosen ? "inverse" : "default"}>
                      {PROJECT_STATUS_LABELS[status]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {holding > 0 ? (
              <Text variant="caption" tone="muted">
                {`${holding} job${holding === 1 ? "" : "s"} here now`}
              </Text>
            ) : null}
          </View>
        );
      })}

      <Button
        label={canAddStage(drafts) ? "Add stage" : "Stage limit reached"}
        icon={Plus}
        variant="outline"
        disabled={!canAddStage(drafts)}
        onPress={() => setDrafts(withNewStage(drafts))}
      />

      {stagesIssue ? (
        <Text variant="caption" tone="destructive">
          {stagesIssue}
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" tone="destructive">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}
