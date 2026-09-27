import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isProjectStatus,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from "@everlumen/shared";
import { listProjectBoards, setProjectStage } from "@/api/pipelines";
import { orderedStages, readableOn, type PipelineStage } from "@/api/pipeline-view";
import { projectStatusLabel, ProjectStatusPill, withAlpha } from "@/components/ProjectStatusPill";
import { radius, spacing, useTheme } from "@/theme";
import { Check, ChevronDown, X } from "@/ui/icons";
import { Icon, Sheet, Text } from "@/ui";

/**
 * Where the project is, as one control: its status, or its pipeline stage.
 *
 * The phone port of the web `ProjectStatusChip`. A project standing in a stage
 * shows the stage, because the stage owns the three-value bucket the map and
 * the list filters read: moving a job to "Paid" changes its status in the same
 * write. A project outside every pipeline sets the bucket directly. So the
 * sheet only ever offers one live vocabulary, and the two can never disagree.
 *
 * The bucket write goes through the caller, which queues it like every other
 * project edit. A stage move goes straight to `setProjectPipelineStage`,
 * because the server is what derives the status from the stage.
 */
export function ProjectStatusChip({
  projectId,
  status,
  stageId,
  onSetStatus,
  onStageChanged,
}: {
  projectId: string;
  status: string;
  stageId: string | null | undefined;
  /** Write a plain status. The caller queues it. */
  onSetStatus: (next: ProjectStatus) => void;
  /** Optimistic local update for a stage move, called again with the old values on failure. */
  onStageChanged: (next: { status: string; stageId: string | null }) => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same key as the Pipelines screen, so the two share one fetch.
  const boardsQuery = useQuery({
    queryKey: ["project-boards"],
    queryFn: listProjectBoards,
    staleTime: 60_000,
  });
  const boards = useMemo(
    () => (boardsQuery.data ?? []).filter((board) => (board.stages ?? []).length > 0),
    [boardsQuery.data],
  );

  const current = useMemo(() => {
    if (!stageId) return null;
    for (const board of boards) {
      const stage = board.stages.find((s) => s.id === stageId);
      if (stage) return { stage, boardName: board.name };
    }
    return null;
  }, [boards, stageId]);

  /*
   * A stage we cannot name yet. Falling back to the bucket would flash
   * "Active" on a job the team calls "Invoiced" while the boards load, which
   * is the confusion this chip exists to remove.
   */
  const stagePending = Boolean(stageId) && !current && boardsQuery.isPending;

  async function move(stage: PipelineStage | null) {
    if ((stageId ?? null) === (stage?.id ?? null) || saving) return;
    const previous = { status, stageId: stageId ?? null };
    const predicted =
      stage && isProjectStatus(stage.status) && status !== "archived" ? stage.status : status;
    onStageChanged({ status: predicted, stageId: stage?.id ?? null });
    setSaving(true);
    setError(null);
    try {
      await setProjectStage(projectId, stage?.id ?? null);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["staged-projects"] });
    } catch (e) {
      onStageChanged(previous);
      setError(e instanceof Error ? e.message : "Could not change the stage.");
    } finally {
      setSaving(false);
    }
  }

  const label = current ? current.stage.name : projectStatusLabel(status);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Project status: ${stagePending ? "loading" : label}. Change status`}
        onPress={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={stagePending}
        hitSlop={8}
        style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
      >
        {stagePending ? (
          <View
            style={{
              width: 96,
              height: 26,
              borderRadius: radius.pill,
              backgroundColor: theme.colors.secondary,
            }}
          />
        ) : current ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              borderRadius: radius.pill,
              backgroundColor: current.stage.color,
              maxWidth: 220,
            }}
          >
            <Text
              variant="caption"
              numberOfLines={1}
              style={{ color: readableOn(current.stage.color), fontWeight: "700", flexShrink: 1 }}
            >
              {current.stage.name}
            </Text>
            <ChevronDown size={14} color={readableOn(current.stage.color)} strokeWidth={2.5} />
          </View>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <ProjectStatusPill status={status} />
            <View style={{ marginLeft: -spacing.xs }}>
              <ChevronDown size={14} color={theme.colors.mutedForeground} strokeWidth={2.5} />
            </View>
          </View>
        )}
      </Pressable>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Where this job stands"
        subtitle={
          current
            ? `At ${current.stage.name}, which counts as ${projectStatusLabel(current.stage.status)} on the map and in filters.`
            : `Status: ${projectStatusLabel(status)}`
        }
      >
        {error ? (
          <Text variant="caption" tone="destructive">
            {error}
          </Text>
        ) : null}

        {/*
          Only one vocabulary is ever live. A project in a stage takes its
          bucket from that stage, so offering the three buckets as well would
          be offering a way to make them disagree again.
        */}
        {!current ? (
          <View style={{ gap: spacing.xs }}>
            <Text variant="overline" tone="muted">
              SET STATUS
            </Text>
            {PROJECT_STATUSES.map((key) => (
              <OptionRow
                key={key}
                label={PROJECT_STATUS_LABELS[key]}
                dot={statusDot(theme, key)}
                selected={key === status}
                disabled={saving}
                onPress={() => {
                  if (key !== status) onSetStatus(key);
                  setOpen(false);
                }}
              />
            ))}
          </View>
        ) : null}

        {boardsQuery.isLoading ? <ActivityIndicator color={theme.colors.primary} /> : null}

        {boards.map((board) => (
          <View key={board.id} style={{ gap: spacing.xs }}>
            <Text variant="overline" tone="muted">
              {board.name.toUpperCase()}
            </Text>
            {orderedStages(board).map((stage) => (
              <OptionRow
                key={stage.id}
                label={stage.name}
                dot={stage.color}
                // What moving there does to the bucket, before you move there.
                trailing={
                  isProjectStatus(stage.status) ? PROJECT_STATUS_LABELS[stage.status] : null
                }
                selected={stage.id === stageId}
                disabled={saving}
                onPress={() => void move(stage)}
              />
            ))}
          </View>
        ))}

        {boards.length > 0 ? (
          <OptionRow
            label="Not in a pipeline"
            icon
            selected={!stageId}
            disabled={saving || !stageId}
            onPress={() => void move(null)}
          />
        ) : null}

        {saving ? <ActivityIndicator color={theme.colors.primary} /> : null}
      </Sheet>
    </>
  );
}

function statusDot(theme: ReturnType<typeof useTheme>, status: string): string {
  if (status === "active") return theme.colors.success;
  if (status === "on_hold") return theme.colors.safety;
  return theme.colors.mutedForeground;
}

function OptionRow({
  label,
  dot,
  icon,
  trailing,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  dot?: string;
  icon?: boolean;
  trailing?: string | null;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={trailing ? `${label}, counts as ${trailing}` : label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        minHeight: 48,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        backgroundColor: selected
          ? withAlpha(theme.colors.primary, 0.12)
          : pressed
            ? theme.colors.secondary
            : "transparent",
        opacity: disabled && !selected ? 0.5 : 1,
      })}
    >
      {icon ? (
        <Icon icon={X} size="sm" tone="muted" />
      ) : (
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: dot }} />
      )}
      <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
        {label}
      </Text>
      {trailing ? (
        <Text variant="overline" tone="muted">
          {trailing.toUpperCase()}
        </Text>
      ) : null}
      {selected ? <Icon icon={Check} size="sm" tone="primary" /> : null}
    </Pressable>
  );
}
