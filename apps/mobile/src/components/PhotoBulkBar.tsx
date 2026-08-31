import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { projectDisplayName } from "@everlumen/shared";
import { formatAddress, listProjects } from "@/api/projects";
import type { PhotoPhase } from "@/api/photos";
import { spacing, useTheme } from "@/theme";
import { FolderInput, MapPin, Sparkles, Tag, Trash2, X } from "@/ui/icons";
import {
  Badge,
  Button,
  Chip,
  Field,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * The bar that appears when photos are selected.
 *
 * Docked to the bottom rather than floating over the grid, because on a phone
 * the grid is the whole screen and a floating bar covers the photos being
 * chosen. Docking costs one row of height and keeps every thumbnail visible.
 *
 * The four actions are the ones the web bulk bar offers that make sense in the
 * field. Download and Print are deliberately absent: a photo is already on the
 * phone that took it, and nobody prints from a job site. Share is Block A5 and
 * lands with the rest of sharing rather than alone here.
 */

export type PhotoBulkAction =
  | { kind: "phase"; phase: PhotoPhase }
  | { kind: "tags"; tags: string[] }
  | { kind: "move"; projectId: string }
  /*
   * The odd one out, and deliberately last in the bar.
   *
   * Every other action here is a patch that goes through the offline outbox and
   * lands whenever there is signal. This one is an online RPC that spends an
   * LLM call and produces a NEW artefact - a write-up of the photographs
   * selected - so it cannot be queued and it is not undone by selecting
   * differently afterwards.
   */
  | { kind: "summarise" }
  | { kind: "trash" };

export function PhotoBulkBar({
  count,
  onCancel,
  onAction,
  /** Hidden when the selection is already the whole of one project. */
  currentProjectId,
  busy = false,
}: {
  count: number;
  onCancel: () => void;
  onAction: (action: PhotoBulkAction) => void;
  currentProjectId?: string;
  busy?: boolean;
}) {
  const theme = useTheme();
  const [sheet, setSheet] = useState<"phase" | "tags" | "move" | null>(null);

  return (
    <>
      <View
        style={[
          {
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            backgroundColor: theme.colors.card,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          },
          theme.elevation.sheet,
        ]}
      >
        <IconButton
          icon={X}
          accessibilityLabel="Clear selection"
          surface={false}
          tone="muted"
          onPress={onCancel}
        />
        <Badge label={`${count} selected`} tone="primary" variant="solid" />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm, paddingLeft: spacing.sm }}
        >
          <Button
            label="Phase"
            size="sm"
            variant="outline"
            disabled={busy}
            onPress={() => setSheet("phase")}
          />
          <Button
            label="Tag"
            icon={Tag}
            size="sm"
            variant="outline"
            disabled={busy}
            onPress={() => setSheet("tags")}
          />
          {/*
            Placed before the destructive one and after the cheap ones, because
            it is the only button here that costs anything to press.
          */}
          <Button
            label="Write up"
            icon={Sparkles}
            size="sm"
            variant="outline"
            disabled={busy}
            onPress={() => onAction({ kind: "summarise" })}
          />
          <Button
            label="Move"
            icon={FolderInput}
            size="sm"
            variant="outline"
            disabled={busy}
            onPress={() => setSheet("move")}
          />
          <Button
            label="Trash"
            icon={Trash2}
            size="sm"
            variant="destructive"
            disabled={busy}
            onPress={() => onAction({ kind: "trash" })}
          />
        </ScrollView>
      </View>

      <PhaseSheet
        visible={sheet === "phase"}
        count={count}
        onClose={() => setSheet(null)}
        onPick={(phase) => {
          setSheet(null);
          onAction({ kind: "phase", phase });
        }}
      />

      <TagSheet
        visible={sheet === "tags"}
        count={count}
        onClose={() => setSheet(null)}
        onApply={(tags) => {
          setSheet(null);
          onAction({ kind: "tags", tags });
        }}
      />

      <MoveSheet
        visible={sheet === "move"}
        count={count}
        currentProjectId={currentProjectId}
        onClose={() => setSheet(null)}
        onPick={(projectId) => {
          setSheet(null);
          onAction({ kind: "move", projectId });
        }}
      />
    </>
  );
}

const PHASES: { id: PhotoPhase; label: string; hint: string }[] = [
  { id: "before", label: "Before", hint: "Condition on arrival" },
  { id: "after", label: "After", hint: "Work completed" },
  { id: "untagged", label: "No phase", hint: "Clears the phase" },
];

function PhaseSheet({
  visible,
  count,
  onClose,
  onPick,
}: {
  visible: boolean;
  count: number;
  onClose: () => void;
  onPick: (phase: PhotoPhase) => void;
}) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Set phase"
      subtitle={`${count} ${count === 1 ? "photo" : "photos"}`}
    >
      <ListGroup>
        {PHASES.map((option, i) => (
          <View key={option.id}>
            {i === 0 ? null : <RowDivider inset={false} />}
            <ListRow
              title={option.label}
              subtitle={option.hint}
              onPress={() => onPick(option.id)}
            />
          </View>
        ))}
      </ListGroup>
    </Sheet>
  );
}

/**
 * Adding tags to a selection.
 *
 * Adds only. There is no "replace all tags" here, because the one-way door is
 * the dangerous one: a bulk replace across forty photos silently discards
 * whatever each of them already carried, and nothing on the phone can undo it.
 * Removing a tag is a per-photo action on the photo itself.
 */
function TagSheet({
  visible,
  count,
  onClose,
  onApply,
}: {
  visible: boolean;
  count: number;
  onClose: () => void;
  onApply: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const tags = useMemo(
    () =>
      draft
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [draft],
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Add tags"
      subtitle={`${count} ${count === 1 ? "photo" : "photos"}`}
      footer={
        <Button
          label={tags.length ? `Add ${tags.length === 1 ? "tag" : `${tags.length} tags`}` : "Add"}
          fullWidth
          disabled={tags.length === 0}
          onPress={() => {
            onApply(tags);
            setDraft("");
          }}
        />
      }
    >
      <Field
        label="Tags"
        value={draft}
        onChangeText={setDraft}
        placeholder="Separate with commas"
        hint="Existing tags on each photo are kept."
        autoCapitalize="none"
      />
      {tags.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {tags.map((tag) => (
            <Chip key={tag} label={tag} selected />
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}

function MoveSheet({
  visible,
  count,
  currentProjectId,
  onClose,
  onPick,
}: {
  visible: boolean;
  count: number;
  currentProjectId?: string;
  onClose: () => void;
  onPick: (projectId: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    enabled: visible,
  });

  // The project the photos are already in is not a destination.
  const projects = (data ?? []).filter((p) => p.id !== currentProjectId);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Move to project"
      subtitle={`${count} ${count === 1 ? "photo" : "photos"}`}
    >
      {isLoading ? (
        <SkeletonList rows={5} />
      ) : projects.length === 0 ? (
        <Text variant="body" tone="muted">
          There is nowhere else to move these. Create another project first.
        </Text>
      ) : (
        <ListGroup>
          {projects.map((project, i) => (
            <View key={project.id}>
              {i === 0 ? null : <RowDivider />}
              <ListRow
                icon={MapPin}
                title={projectDisplayName(project)}
                subtitle={formatAddress(project) ?? undefined}
                onPress={() => onPick(project.id)}
              />
            </View>
          ))}
        </ListGroup>
      )}
    </Sheet>
  );
}
