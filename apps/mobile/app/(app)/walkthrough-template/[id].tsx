import { useMemo, useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { moved, positionChanges, removed, templateNameError } from "@/api/template-edit";
import {
  addShot,
  deleteShot,
  deleteWalkthroughTemplate,
  duplicateWalkthroughTemplate,
  loadWalkthroughLibrary,
  saveShotPositions,
  setWalkthroughTemplateArchived,
  updateShot,
  updateWalkthroughTemplate,
} from "@/api/walkthrough-template-admin";
import {
  CAPTURE_OPTIONS,
  captureLabel,
  nextShotPosition,
  shotsFor,
  shotSummary,
  type ShotCapture,
  type ShotRow,
} from "@/api/walkthrough-template-view";
import { GENERAL_CATEGORY, storedCategory, tradeOf } from "@/api/template-library-view";
import { getMyTeam } from "@/api/team";
import {
  canManageLibrary,
  confirmDelete,
  errorText,
  TradeChips,
} from "@/components/TemplateLibraryParts";
import { spacing } from "@/theme";
import {
  Archive,
  Camera,
  ChevronDown,
  ChevronUp,
  Copy,
  EllipsisVertical,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
  Video,
} from "@/ui/icons";
import {
  ActionSheet,
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  Sheet,
  SkeletonList,
  Text,
  type LucideIcon,
} from "@/ui";

const CAPTURE_ICON: Record<ShotCapture, LucideIcon> = {
  photo: Camera,
  video: Video,
  note: NotebookPen,
};

type Draft = {
  id: string | null;
  label: string;
  description: string;
  capture: ShotCapture;
  required: boolean;
};

/**
 * One walkthrough template: its details and its shot list. Shots reorder with
 * arrows and write back only the rows that moved, like every list editor here.
 */
export default function WalkthroughTemplateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTrade, setEditTrade] = useState(GENERAL_CATEGORY);
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const key = ["walkthrough-templates-admin"];
  const libraryQuery = useQuery({ queryKey: key, queryFn: loadWalkthroughLibrary });
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });
  const canManage = canManageLibrary(teamQuery.data?.myRole, teamQuery.isSuccess);

  const library = libraryQuery.data;
  const template =
    library?.status === "ok" ? (library.templates.find((t) => t.id === id) ?? null) : null;
  const shots = useMemo(
    () => (library?.status === "ok" && id ? shotsFor(library.shots, id) : []),
    [library, id],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ["blueprint-library"] });
  };

  const run = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      invalidate();
      setFailure(null);
    },
    onError: (error) => {
      invalidate();
      setFailure(errorText(error, "That did not save."));
    },
  });

  const duplicate = useMutation({
    mutationFn: () => duplicateWalkthroughTemplate(template!, shots),
    onSuccess: async (newId) => {
      invalidate();
      await queryClient.refetchQueries({ queryKey: key });
      router.replace({ pathname: "/walkthrough-template/[id]", params: { id: newId } });
    },
    onError: (error) => setFailure(errorText(error, "Could not duplicate that walkthrough.")),
  });

  const remover = useMutation({
    mutationFn: () => deleteWalkthroughTemplate(id!),
    onSuccess: () => {
      invalidate();
      if (router.canGoBack()) router.back();
      else router.replace("/walkthrough-templates");
    },
    onError: (error) => setFailure(errorText(error, "Could not delete that walkthrough.")),
  });

  if (libraryQuery.isLoading || (!template && libraryQuery.isFetching)) {
    return (
      <>
        <Stack.Screen options={{ title: "Walkthrough template" }} />
        <SkeletonList rows={6} />
      </>
    );
  }

  if (libraryQuery.error || !template) {
    return (
      <>
        <Stack.Screen options={{ title: "Walkthrough template" }} />
        <ErrorState
          title="Could not open this walkthrough"
          message={
            libraryQuery.error ? errorText(libraryQuery.error, "") : "It may have been deleted."
          }
          onRetry={() => void libraryQuery.refetch()}
        />
      </>
    );
  }

  const openShot = (shot: ShotRow | null) => {
    setLabelError(null);
    setDraft(
      shot
        ? {
            id: shot.id,
            label: shot.label,
            description: shot.description ?? "",
            capture: shot.capture,
            required: shot.required,
          }
        : { id: null, label: "", description: "", capture: "photo", required: false },
    );
  };

  const saveShot = () => {
    if (!draft) return;
    if (!draft.label.trim()) {
      setLabelError("Say what to capture.");
      return;
    }
    const payload = {
      label: draft.label.trim(),
      description: draft.description.trim() || null,
      capture: draft.capture,
      required: draft.required,
    };
    const target = draft;
    setDraft(null);
    run.mutate(() =>
      target.id ? updateShot(target.id, payload) : addShot(id!, payload, nextShotPosition(shots)),
    );
  };

  const moveShot = (shotId: string, by: -1 | 1) => {
    const next = moved(shots, shotId, by);
    if (next === shots) return;
    const changes = positionChanges(shots, next);
    if (changes.length) run.mutate(() => saveShotPositions(changes));
  };

  const removeShot = (shot: ShotRow) =>
    confirmDelete(
      `Delete "${shot.label}"?`,
      "Walkthroughs already set up from this template keep the shot.",
      "Delete",
      () => {
        const next = removed(shots, shot.id);
        const changes = positionChanges(shots, next);
        run.mutate(async () => {
          await deleteShot(shot.id);
          if (changes.length) await saveShotPositions(changes);
        });
      },
    );

  const openDetails = () => {
    setEditName(template.name);
    setEditDescription(template.description ?? "");
    setEditTrade(tradeOf(template.category));
    setNameError(null);
    setDetailsOpen(true);
  };

  const saveDetails = () => {
    const error = templateNameError(editName);
    if (error) {
      setNameError(error);
      return;
    }
    setDetailsOpen(false);
    run.mutate(() =>
      updateWalkthroughTemplate(id!, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        category: storedCategory(editTrade),
      }),
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Walkthrough template",
          headerRight: () =>
            canManage ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <IconButton
                  icon={Plus}
                  accessibilityLabel="Add a shot"
                  surface={false}
                  tone="primary"
                  onPress={() => openShot(null)}
                />
                <IconButton
                  icon={EllipsisVertical}
                  accessibilityLabel="More walkthrough actions"
                  surface={false}
                  tone="muted"
                  onPress={() => setMenuOpen(true)}
                />
              </View>
            ) : null,
        }}
      />

      <Screen
        scroll
        padded={false}
        refreshing={libraryQuery.isRefetching}
        onRefresh={() => void libraryQuery.refetch()}
        bottomInset={spacing.xxl}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm }}>
          <Text variant="title">{template.name}</Text>
          {template.description ? (
            <Text variant="body" tone="muted">
              {template.description}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            <Badge label={tradeOf(template.category)} tone="neutral" variant="outline" />
            <Badge label={shotSummary(shots)} tone="neutral" variant="soft" />
            {template.archived ? <Badge label="Archived" tone="neutral" variant="outline" /> : null}
          </View>
          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}
        </View>

        <SectionHeader title={`Shots (${shots.length})`} />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {shots.length === 0 ? (
            <EmptyState
              icon={Camera}
              title="No shots yet"
              body="Add the first thing the crew should capture. You can reorder them afterwards."
              action={
                canManage
                  ? { label: "Add a shot", onPress: () => openShot(null), icon: Plus }
                  : undefined
              }
            />
          ) : (
            <ListGroup>
              {shots.map((shot, index) => (
                <View key={shot.id}>
                  {index > 0 ? <RowDivider inset={false} /> : null}
                  <ListRow
                    icon={CAPTURE_ICON[shot.capture]}
                    title={shot.label}
                    subtitle={[
                      shot.description ?? captureLabel(shot.capture),
                      shot.required ? "Required" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    chevron={false}
                    onPress={canManage ? () => openShot(shot) : undefined}
                    right={
                      canManage ? (
                        <View
                          style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
                        >
                          <IconButton
                            icon={ChevronUp}
                            tone="muted"
                            surface={false}
                            accessibilityLabel={`Move ${shot.label} up`}
                            disabled={index === 0}
                            onPress={() => moveShot(shot.id, -1)}
                          />
                          <IconButton
                            icon={ChevronDown}
                            tone="muted"
                            surface={false}
                            accessibilityLabel={`Move ${shot.label} down`}
                            disabled={index === shots.length - 1}
                            onPress={() => moveShot(shot.id, 1)}
                          />
                          <IconButton
                            icon={Trash2}
                            tone="destructive"
                            surface={false}
                            accessibilityLabel={`Delete ${shot.label}`}
                            onPress={() => removeShot(shot)}
                          />
                        </View>
                      ) : undefined
                    }
                  />
                </View>
              ))}
            </ListGroup>
          )}
        </View>
      </Screen>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={template.name}
        actions={[
          { label: "Edit details", icon: Pencil, onPress: openDetails },
          {
            label: "Duplicate",
            icon: Copy,
            disabled: duplicate.isPending,
            onPress: () => duplicate.mutate(),
          },
          {
            label: template.archived ? "Restore" : "Archive",
            icon: Archive,
            onPress: () =>
              run.mutate(() => setWalkthroughTemplateArchived(template.id, !template.archived)),
          },
          {
            label: "Delete",
            icon: Trash2,
            destructive: true,
            onPress: () =>
              confirmDelete(
                `Delete "${template.name}"?`,
                "Projects it has already been applied to keep their copy. Blueprints that reference it will show the section as missing until you remove it. This cannot be undone.",
                "Delete walkthrough",
                () => remover.mutate(),
              ),
          },
        ]}
      />

      <Sheet
        visible={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Walkthrough details"
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Name"
            value={editName}
            onChangeText={(next) => {
              setEditName(next);
              if (nameError) setNameError(null);
            }}
            error={nameError ?? undefined}
            autoCapitalize="sentences"
          />
          <Field
            label="Description"
            value={editDescription}
            onChangeText={setEditDescription}
            hint="Optional"
            multiline
            rows={2}
          />
          <TradeChips value={editTrade} onChange={setEditTrade} />
          <Button label="Save" fullWidth onPress={saveDetails} />
        </View>
      </Sheet>

      <Sheet
        visible={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit shot" : "New shot"}
      >
        {draft ? (
          <View style={{ gap: spacing.lg }}>
            <Field
              label="What to capture"
              value={draft.label}
              onChangeText={(label) => {
                setDraft({ ...draft, label });
                if (labelError) setLabelError(null);
              }}
              placeholder="Front elevation"
              error={labelError ?? undefined}
              autoCapitalize="sentences"
            />
            <Field
              label="Why, or how"
              value={draft.description}
              onChangeText={(description) => setDraft({ ...draft, description })}
              hint="Optional"
              multiline
              rows={2}
            />
            <View style={{ gap: spacing.sm }}>
              <Text variant="caption" tone="muted">
                Capture
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {CAPTURE_OPTIONS.map((option) => (
                  <Chip
                    key={option.id}
                    label={option.label}
                    icon={CAPTURE_ICON[option.id]}
                    selected={draft.capture === option.id}
                    onPress={() => setDraft({ ...draft, capture: option.id })}
                  />
                ))}
              </View>
              <Text variant="caption" tone="muted">
                {CAPTURE_OPTIONS.find((o) => o.id === draft.capture)?.hint}
              </Text>
            </View>
            <ListGroup>
              <ListRow
                title="Required"
                subtitle="The crew cannot skip this shot"
                right={
                  <Badge
                    label={draft.required ? "Yes" : "No"}
                    tone={draft.required ? "primary" : "neutral"}
                    variant={draft.required ? "soft" : "outline"}
                  />
                }
                onPress={() => setDraft({ ...draft, required: !draft.required })}
              />
            </ListGroup>
            <Button label="Save" fullWidth onPress={saveShot} />
          </View>
        ) : null}
      </Sheet>
    </>
  );
}
