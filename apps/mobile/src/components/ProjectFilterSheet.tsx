import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { parseCalendarDay, presetRange } from "@/api/gallery-filters";
import type { ProjectBoard } from "@/api/pipeline-view";
import type { ProjectFilterFacts } from "@/api/project-filters";
import {
  EMPTY_PROJECT_FILTERS,
  NO_STAGE,
  activeProjectFilterCount,
  toggleValue,
  type ProjectFilters,
} from "@/api/project-filters-view";
import { radius, spacing, useTheme } from "@/theme";
import { Archive, Bookmark, Calendar, Eye, Kanban, Star, Tag, Users, X } from "@/ui/icons";
import { Button, Chip, ChipGroup, Field, Icon, Sheet, Text } from "@/ui";

export type ArchiveMode = "hide" | "include" | "only";

type Pane = "views" | "stage" | "tags" | "labels" | "people" | "date";

/**
 * The Projects filter sheet: the web's Filters popover and its six panes
 * (Views, Stage, Tags, Labels, People, Date), opened from the filter button.
 *
 * The panes are a chip row across the top rather than one long scroll, so the
 * sheet stays short on a phone and each pane's count says where a refinement
 * is on. Edits are a draft until Apply, and Clear all empties the draft
 * without closing, like the Photo Library's sheet.
 */
export function ProjectFilterSheet({
  visible,
  value,
  archiveMode,
  facts,
  factsLoading,
  boards,
  labels,
  people,
  starredCount,
  archivedCount,
  onClose,
  onApply,
}: {
  visible: boolean;
  value: ProjectFilters;
  archiveMode: ArchiveMode;
  facts: ProjectFilterFacts | undefined;
  factsLoading: boolean;
  boards: ProjectBoard[];
  labels: { name: string }[];
  people: { id: string; name: string }[];
  starredCount: number;
  archivedCount: number;
  onClose: () => void;
  onApply: (next: ProjectFilters, archiveMode: ArchiveMode) => void;
}) {
  const [draft, setDraft] = useState<ProjectFilters>(value);
  const [archive, setArchive] = useState<ArchiveMode>(archiveMode);
  const [pane, setPane] = useState<Pane>("views");
  const [fromText, setFromText] = useState(value.from ?? "");
  const [toText, setToText] = useState(value.to ?? "");

  // Every open starts from what is applied, not from an abandoned draft.
  useEffect(() => {
    if (!visible) return;
    setDraft(value);
    setArchive(archiveMode);
    setFromText(value.from ?? "");
    setToText(value.to ?? "");
  }, [visible, value, archiveMode]);

  const stageCounts = useMemo(() => {
    const out = new Map<string, number>();
    for (const fact of Object.values(facts?.byProject ?? {})) {
      const id = fact.pipeline_stage_id ?? NO_STAGE;
      out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  }, [facts]);

  const fromError = fromText.trim() && !parseCalendarDay(fromText) ? "Use YYYY-MM-DD" : undefined;
  const toError = toText.trim() && !parseCalendarDay(toText) ? "Use YYYY-MM-DD" : undefined;
  const reversed =
    !fromError && !toError && fromText.trim() && toText.trim() && fromText.trim() > toText.trim()
      ? "The start is after the end"
      : undefined;

  const applied: ProjectFilters = {
    ...draft,
    includeArchived: archive === "include",
    from: parseCalendarDay(fromText) ? fromText.trim() : null,
    to: parseCalendarDay(toText) ? toText.trim() : null,
  };
  const count = activeProjectFilterCount(applied) + (archive === "hide" ? 0 : 1);

  const paneCount: Record<Pane, number> = {
    views: (draft.starredOnly ? 1 : 0) + (archive === "hide" ? 0 : 1),
    stage: draft.stageIds.length,
    tags: draft.tagIds.length,
    labels: draft.labels.length,
    people: draft.people.length,
    date: applied.from || applied.to ? 1 : 0,
  };
  const panes: { id: Pane; label: string; icon: typeof Eye; count?: number }[] = [
    { id: "views", label: "Views", icon: Eye },
    { id: "stage", label: "Stage", icon: Kanban },
    { id: "tags", label: "Tags", icon: Tag },
    { id: "labels", label: "Labels", icon: Bookmark },
    { id: "people", label: "People", icon: Users },
    { id: "date", label: "Date", icon: Calendar },
  ].map((p) => ({ ...p, id: p.id as Pane, count: paneCount[p.id as Pane] || undefined }));

  const loadingNote =
    factsLoading && !facts ? (
      <Text variant="caption" tone="muted">
        Loading...
      </Text>
    ) : null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filter projects"
      subtitle={count === 0 ? "Showing every live project" : `${count} filter${count === 1 ? "" : "s"} on`}
      footer={
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button
            label="Clear all"
            variant="outline"
            disabled={count === 0}
            onPress={() => {
              setDraft(EMPTY_PROJECT_FILTERS);
              setArchive("hide");
              setFromText("");
              setToText("");
            }}
            style={{ flex: 1 }}
          />
          <Button
            label="Apply"
            disabled={Boolean(fromError || toError || reversed)}
            onPress={() => {
              onApply(applied, archive);
              onClose();
            }}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      <View style={{ marginHorizontal: -spacing.lg }}>
        <ChipGroup options={panes} value={pane} onChange={setPane} label="Filter panes" />
      </View>

      {pane === "views" ? (
        <>
          <Text variant="overline" tone="muted">
            NARROW THE CURRENT VIEW
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            <Chip
              icon={Star}
              label="Starred only"
              count={starredCount}
              selected={draft.starredOnly}
              onPress={() => setDraft({ ...draft, starredOnly: !draft.starredOnly })}
            />
          </View>
          <Text variant="overline" tone="muted">
            ARCHIVED PROJECTS
          </Text>
          <Text variant="caption" tone="muted">
            {`Hidden by default, shown alongside the rest, or on their own (${archivedCount}).`}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {(
              [
                { id: "hide", label: "Hide" },
                { id: "include", label: "Include" },
                { id: "only", label: "Only" },
              ] as const
            ).map((option) => (
              <Chip
                key={option.id}
                icon={option.id === "hide" ? undefined : Archive}
                label={option.label}
                selected={archive === option.id}
                onPress={() => setArchive(option.id)}
              />
            ))}
          </View>
        </>
      ) : null}

      {pane === "stage" ? (
        <>
          <Text variant="caption" tone="muted">
            Pick any number: a job is in one stage, so these match either.
          </Text>
          {loadingNote}
          {boards
            .filter((board) => (board.stages ?? []).length > 0)
            .map((board) => (
              <View key={board.id} style={{ gap: spacing.sm }}>
                <Text variant="overline" tone="muted">
                  {board.name.toUpperCase()}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                  {[...(board.stages ?? [])]
                    .sort((a, b) => a.position - b.position)
                    .map((stage) => (
                      <Chip
                        key={stage.id}
                        label={stage.name}
                        count={stageCounts.get(stage.id) ?? 0}
                        selected={draft.stageIds.includes(stage.id)}
                        onPress={() =>
                          setDraft({ ...draft, stageIds: toggleValue(draft.stageIds, stage.id) })
                        }
                      />
                    ))}
                </View>
              </View>
            ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            <Chip
              label="Not in a pipeline"
              count={stageCounts.get(NO_STAGE) ?? 0}
              selected={draft.stageIds.includes(NO_STAGE)}
              onPress={() => setDraft({ ...draft, stageIds: toggleValue(draft.stageIds, NO_STAGE) })}
            />
          </View>
        </>
      ) : null}

      {pane === "tags" ? (
        <>
          <Text variant="caption" tone="muted">
            A job must carry every tag picked.
          </Text>
          {loadingNote}
          {facts && facts.tags.length === 0 ? (
            <Text variant="caption" tone="muted">
              No tags yet. Tag a project and it can be filtered by here.
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {(facts?.tags ?? []).map((tag) => (
              <Chip
                key={tag.id}
                label={tag.name}
                selected={draft.tagIds.includes(tag.id)}
                onPress={() => setDraft({ ...draft, tagIds: toggleValue(draft.tagIds, tag.id) })}
              />
            ))}
          </View>
        </>
      ) : null}

      {pane === "labels" ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            <Chip
              label="Any of these"
              selected={draft.labelMode === "any"}
              onPress={() => setDraft({ ...draft, labelMode: "any" })}
            />
            <Chip
              label="All of these"
              selected={draft.labelMode === "all"}
              onPress={() => setDraft({ ...draft, labelMode: "all" })}
            />
          </View>
          {labels.length === 0 ? (
            <Text variant="caption" tone="muted">
              No labels yet.
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {labels.map((label) => (
              <Chip
                key={label.name}
                label={label.name}
                selected={draft.labels.includes(label.name)}
                onPress={() => setDraft({ ...draft, labels: toggleValue(draft.labels, label.name) })}
              />
            ))}
          </View>
        </>
      ) : null}

      {pane === "people" ? (
        <>
          <Text variant="caption" tone="muted">
            Jobs somebody uploaded photos to or created.
          </Text>
          {people.length === 0 ? (
            <Text variant="caption" tone="muted">
              No contributors yet. Upload photos to a project.
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {people.map((person) => (
              <Chip
                key={person.id}
                label={person.name}
                selected={draft.people.includes(person.id)}
                onPress={() => setDraft({ ...draft, people: toggleValue(draft.people, person.id) })}
              />
            ))}
          </View>
        </>
      ) : null}

      {pane === "date" ? (
        <>
          <Text variant="caption" tone="muted">
            Start is when a project was created. End is when it was completed, or its last
            activity while it is still open.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {(
              [
                { id: "today", label: "Today" },
                { id: "7d", label: "Last 7 days" },
                { id: "30d", label: "Last 30 days" },
              ] as const
            ).map((preset) => (
              <Chip
                key={preset.id}
                label={preset.label}
                onPress={() => {
                  const range = presetRange(preset.id);
                  setFromText(range.from);
                  setToText(range.to);
                }}
              />
            ))}
          </View>
          <Field
            label="Start (created)"
            value={fromText}
            onChangeText={setFromText}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            error={fromError}
          />
          <Field
            label="End (completed)"
            value={toText}
            onChangeText={setToText}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            error={toError ?? reversed}
          />
        </>
      ) : null}
    </Sheet>
  );
}

/**
 * The applied refinements as a row of chips under the status pills, each with
 * its own remove target, so the list says why it is short and one tap takes a
 * refinement off without opening the sheet.
 */
export function ActiveFilterChips({
  chips,
  onRemove,
  onClearAll,
}: {
  chips: { key: string; label: string }[];
  onRemove: (key: string) => void;
  onClearAll: () => void;
}) {
  const theme = useTheme();
  if (chips.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}
    >
      {chips.map((chip) => (
        <Pressable
          key={chip.key}
          accessibilityRole="button"
          accessibilityLabel={`Remove filter ${chip.label}`}
          onPress={() => onRemove(chip.key)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
            height: 36,
            paddingLeft: spacing.md,
            paddingRight: spacing.sm,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: theme.colors.primary,
            backgroundColor: theme.colors.accent,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text variant="caption" numberOfLines={1} style={{ maxWidth: 220 }}>
            {chip.label}
          </Text>
          <Icon icon={X} size="sm" tone="muted" />
        </Pressable>
      ))}
      {chips.length > 1 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          onPress={onClearAll}
          style={{ height: 36, justifyContent: "center", paddingHorizontal: spacing.sm }}
        >
          <Text variant="caption" tone="primary">
            Clear all
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
