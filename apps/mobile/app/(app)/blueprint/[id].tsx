import { useMemo, useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams, type Href } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addSection,
  deleteBlueprint,
  duplicateBlueprint,
  listApplyTargets,
  loadBlueprintLibrary,
  removeSection,
  saveSectionOrder,
  setBlueprintArchived,
  updateBlueprint,
} from "@/api/blueprint-admin";
import {
  ADDABLE_KINDS,
  addableEntries,
  addRefusal,
  filterTargets,
  kindName,
  multiApplyHeadline,
  nextSectionPosition,
  sectionRows,
  swapped,
  targetAddress,
  type SectionRow,
  type TargetOutcome,
} from "@/api/blueprint-library-view";
import { applyBlueprint } from "@/api/blueprints";
import { failureLines, landedLines, OUTCOME, type BlueprintItemKind } from "@/api/blueprints-view";
import { templateNameError } from "@/api/template-edit";
import { GENERAL_CATEGORY, storedCategory, tradeOf } from "@/api/template-library-view";
import { getMyTeam } from "@/api/team";
import { useLabelCatalog } from "@/components/ProjectLabels";
import {
  canManageLibrary,
  confirmDelete,
  errorText,
  TradeChips,
} from "@/components/TemplateLibraryParts";
import { spacing, useLayout } from "@/theme";
import {
  Archive,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Copy,
  EllipsisVertical,
  FileText,
  FolderInput,
  Pencil,
  Plus,
  ScrollText,
  Star,
  Tag,
  Trash2,
  TriangleAlert,
  Workflow,
} from "@/ui/icons";
import {
  ActionSheet,
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SearchField,
  SectionHeader,
  Sheet,
  SkeletonList,
  Text,
  type LucideIcon,
} from "@/ui";

const KIND_ICON: Record<BlueprintItemKind, LucideIcon> = {
  checklist: ClipboardCheck,
  workflow: Workflow,
  document: FileText,
  report: ScrollText,
  walkthrough: Camera,
  label_set: Tag,
};

/** Where each kind of section is authored on the phone. */
function editorHref(section: SectionRow): Href | null {
  switch (section.kind) {
    case "checklist":
      return { pathname: "/template/[id]", params: { id: section.refId } };
    case "workflow":
      return {
        pathname: "/workflow-template/[templateId]",
        params: { templateId: section.refId, name: section.name },
      };
    case "document":
      return { pathname: "/document-template/[id]", params: { id: section.refId } };
    case "report":
      return { pathname: "/report-template/[id]", params: { id: section.refId } };
    case "walkthrough":
      return { pathname: "/walkthrough-template/[id]", params: { id: section.refId } };
    case "label_set":
      return null;
  }
}

/**
 * One blueprint: what it is, what is in it, and applying it to projects that
 * already exist. The web's blueprint editor and its Apply dialog.
 *
 * Sections reorder with arrows, like every list editor in the app, and the
 * order written back is the order the apply service runs them in. Tapping a
 * section opens that template in its own editor.
 */
export default function BlueprintScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const layout = useLayout();
  const labels = useLabelCatalog();

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addKind, setAddKind] = useState<BlueprintItemKind>("checklist");
  const [applyOpen, setApplyOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftTrade, setDraftTrade] = useState(GENERAL_CATEGORY);
  const [draftDefault, setDraftDefault] = useState(false);
  const [draftLabels, setDraftLabels] = useState<string[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);

  const [targetSearch, setTargetSearch] = useState("");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<TargetOutcome[] | null>(null);

  const libraryQuery = useQuery({ queryKey: ["blueprint-library"], queryFn: loadBlueprintLibrary });
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });
  const targetsQuery = useQuery({
    queryKey: ["blueprint-apply-targets"],
    queryFn: listApplyTargets,
    enabled: applyOpen,
  });
  const canManage = canManageLibrary(teamQuery.data?.myRole, teamQuery.isSuccess);
  const teamId = teamQuery.data?.team?.id ?? null;

  const blueprint = libraryQuery.data?.blueprints.find((b) => b.id === id) ?? null;
  const libraries = libraryQuery.data?.libraries;
  const sections = useMemo(
    () =>
      libraryQuery.data && id
        ? sectionRows(id, libraryQuery.data.links, libraryQuery.data.libraries)
        : [],
    [libraryQuery.data, id],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["blueprint-library"] });
    void queryClient.invalidateQueries({ queryKey: ["blueprints"] });
  };

  const run = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      refresh();
      setFailure(null);
    },
    onError: (error) => {
      refresh();
      setFailure(errorText(error, "That did not save."));
    },
  });

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/blueprints");
  };

  const openEdit = () => {
    if (!blueprint) return;
    setDraftName(blueprint.name);
    setDraftDescription(blueprint.description ?? "");
    setDraftTrade(tradeOf(blueprint.category));
    setDraftDefault(blueprint.isDefault);
    setDraftLabels(blueprint.labels);
    setNameError(null);
    setEditing(true);
  };

  const saveEdit = () => {
    const error = templateNameError(draftName);
    if (error) {
      setNameError(error);
      return;
    }
    setEditing(false);
    run.mutate(() =>
      updateBlueprint(id!, {
        name: draftName.trim(),
        description: draftDescription.trim() || null,
        category: storedCategory(draftTrade),
        isDefault: draftDefault,
        labels: draftLabels,
      }),
    );
  };

  const move = (index: number, by: -1 | 1) => {
    const next = swapped(sections, index, by);
    if (next === sections) return;
    run.mutate(() => saveSectionOrder(id!, next));
  };

  const remove = (section: SectionRow) =>
    confirmDelete(
      `Remove "${section.name}"?`,
      "Only this blueprint changes. The template stays in its library, and projects already set up keep what they were given.",
      "Remove",
      () => run.mutate(() => removeSection(section)),
    );

  const add = (refId: string) => {
    const refusal = addRefusal(addKind, sections);
    if (refusal) {
      setFailure(refusal);
      setAdding(false);
      return;
    }
    setAdding(false);
    run.mutate(() =>
      addSection({
        blueprintId: id!,
        kind: addKind,
        refId,
        position: nextSectionPosition(sections),
      }),
    );
  };

  const duplicate = useMutation({
    mutationFn: () => duplicateBlueprint(blueprint!, libraryQuery.data?.links ?? [], teamId),
    onSuccess: async (newId) => {
      refresh();
      await queryClient.refetchQueries({ queryKey: ["blueprint-library"] });
      router.replace({ pathname: "/blueprint/[id]", params: { id: newId } });
    },
    onError: (error) => setFailure(errorText(error, "Could not duplicate that blueprint.")),
  });

  const remover = useMutation({
    mutationFn: () => deleteBlueprint(id!),
    onSuccess: () => {
      refresh();
      leave();
    },
    onError: (error) => setFailure(errorText(error, "Could not delete that blueprint.")),
  });

  /** Sequential, like the web: each apply fans out across several tables. */
  const apply = useMutation({
    mutationFn: async () => {
      const targets = (targetsQuery.data ?? []).filter((t) => targetIds.includes(t.id));
      const collected: TargetOutcome[] = [];
      setProgress({ done: 0, total: targets.length });
      for (const target of targets) {
        try {
          const result = await applyBlueprint({
            blueprintId: id!,
            projectId: target.id,
            projectName: target.name,
            projectAddress: targetAddress(target),
          });
          collected.push({
            projectId: target.id,
            projectName: target.name,
            counts: result.counts,
            failed: result.failed,
          });
          for (const key of ["project-checklists", "project-workflows", "document-tree"]) {
            void queryClient.invalidateQueries({ queryKey: [key, target.id] });
          }
          void queryClient.invalidateQueries({ queryKey: ["blueprint-origin", target.id] });
        } catch (error) {
          collected.push({
            projectId: target.id,
            projectName: target.name,
            counts: {},
            failed: [],
            error: errorText(error, "Could not apply this blueprint."),
          });
        }
        setProgress({ done: collected.length, total: targets.length });
      }
      return collected;
    },
    onSuccess: (collected) => setOutcomes(collected),
    onSettled: () => setProgress(null),
  });

  const closeApply = () => {
    if (apply.isPending) return;
    setApplyOpen(false);
    setOutcomes(null);
    setTargetIds([]);
    setTargetSearch("");
  };

  if (libraryQuery.isLoading || (!blueprint && libraryQuery.isFetching)) {
    return (
      <>
        <Stack.Screen options={{ title: "Blueprint" }} />
        <SkeletonList rows={6} />
      </>
    );
  }

  if (libraryQuery.error || !blueprint) {
    return (
      <>
        <Stack.Screen options={{ title: "Blueprint" }} />
        <ErrorState
          title={libraryQuery.error ? "Could not load this blueprint" : "This blueprint is gone"}
          message={
            libraryQuery.error ? errorText(libraryQuery.error, "") : "It may have been deleted."
          }
          onRetry={() => void libraryQuery.refetch()}
        />
      </>
    );
  }

  const addable = libraries ? addableEntries(addKind, libraries, sections) : [];
  const refusal = addRefusal(addKind, sections);
  const targets = filterTargets(targetsQuery.data ?? [], targetSearch);

  return (
    <>
      <Stack.Screen
        options={{
          title: "Blueprint",
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <IconButton
                icon={FolderInput}
                accessibilityLabel="Apply to projects"
                surface={false}
                tone="muted"
                onPress={() => setApplyOpen(true)}
              />
              {canManage ? (
                <>
                  <IconButton
                    icon={Plus}
                    accessibilityLabel="Add a section"
                    surface={false}
                    tone="primary"
                    onPress={() => setAdding(true)}
                  />
                  <IconButton
                    icon={EllipsisVertical}
                    accessibilityLabel="More blueprint actions"
                    surface={false}
                    tone="muted"
                    onPress={() => setMenuOpen(true)}
                  />
                </>
              ) : null}
            </View>
          ),
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
          <Text variant="title">{blueprint.name}</Text>
          {blueprint.description ? (
            <Text variant="body" tone="muted">
              {blueprint.description}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            <Badge label={tradeOf(blueprint.category)} tone="neutral" variant="outline" />
            {blueprint.isDefault ? (
              <Badge label="Trade default" icon={Star} tone="primary" variant="soft" />
            ) : null}
            {blueprint.archived ? (
              <Badge label="Archived" tone="neutral" variant="outline" />
            ) : null}
            {blueprint.labels.map((label) => (
              <Badge key={label} label={label} icon={Tag} tone="neutral" variant="soft" />
            ))}
          </View>
          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}
        </View>

        <SectionHeader title={`Sections (${sections.length})`} />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {sections.length === 0 ? (
            <EmptyState
              icon={Plus}
              title="Nothing in it yet"
              body="Add the checklists, workflow, documents and report templates a job of this kind needs. Applying the blueprint creates them all on the project."
              action={
                canManage
                  ? { label: "Add a section", onPress: () => setAdding(true), icon: Plus }
                  : undefined
              }
            />
          ) : (
            <ListGroup>
              {sections.map((section, index) => {
                const href = editorHref(section);
                return (
                  <View key={section.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      icon={section.missing ? TriangleAlert : KIND_ICON[section.kind]}
                      iconTone={section.missing ? "destructive" : "primary"}
                      title={section.name}
                      subtitle={`${OUTCOME[section.kind].one} · lands in ${OUTCOME[section.kind].where}`}
                      chevron={false}
                      onPress={href && !section.missing ? () => router.push(href) : undefined}
                      right={
                        canManage ? (
                          <View
                            style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
                          >
                            <IconButton
                              icon={ChevronUp}
                              tone="muted"
                              surface={false}
                              accessibilityLabel={`Move ${section.name} up`}
                              disabled={index === 0 || run.isPending}
                              onPress={() => move(index, -1)}
                            />
                            <IconButton
                              icon={ChevronDown}
                              tone="muted"
                              surface={false}
                              accessibilityLabel={`Move ${section.name} down`}
                              disabled={index === sections.length - 1 || run.isPending}
                              onPress={() => move(index, 1)}
                            />
                            <IconButton
                              icon={Trash2}
                              tone="destructive"
                              surface={false}
                              accessibilityLabel={`Remove ${section.name}`}
                              onPress={() => remove(section)}
                            />
                          </View>
                        ) : undefined
                      }
                    />
                  </View>
                );
              })}
            </ListGroup>
          )}
          <Text variant="caption" tone="muted">
            Sections apply in this order. Tap one to edit the template itself; every blueprint using
            it stays in step.
          </Text>
        </View>
      </Screen>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={blueprint.name}
        actions={[
          { label: "Edit details", icon: Pencil, onPress: openEdit },
          {
            label: "Duplicate",
            icon: Copy,
            disabled: duplicate.isPending,
            onPress: () => duplicate.mutate(),
          },
          {
            label: blueprint.archived ? "Restore" : "Archive",
            icon: Archive,
            onPress: () => run.mutate(() => setBlueprintArchived(id!, !blueprint.archived)),
          },
          {
            label: "Delete",
            icon: Trash2,
            destructive: true,
            onPress: () =>
              confirmDelete(
                `Delete "${blueprint.name}"?`,
                "Projects it has already been applied to keep everything it created. This cannot be undone.",
                "Delete blueprint",
                () => remover.mutate(),
              ),
          },
        ]}
      />

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Blueprint details">
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Name"
            value={draftName}
            onChangeText={(next) => {
              setDraftName(next);
              if (nameError) setNameError(null);
            }}
            error={nameError ?? undefined}
            autoCapitalize="sentences"
          />
          <Field
            label="Description"
            value={draftDescription}
            onChangeText={setDraftDescription}
            hint="Optional"
            multiline
            rows={2}
          />
          <TradeChips value={draftTrade} onChange={setDraftTrade} />
          {draftTrade !== GENERAL_CATEGORY ? (
            <ListGroup>
              <ListRow
                icon={Star}
                title={`Default for ${draftTrade}`}
                subtitle="New projects of this trade start from it"
                right={
                  <Badge
                    label={draftDefault ? "Yes" : "No"}
                    tone={draftDefault ? "primary" : "neutral"}
                    variant={draftDefault ? "soft" : "outline"}
                  />
                }
                onPress={() => setDraftDefault((cur) => !cur)}
              />
            </ListGroup>
          ) : null}
          <View style={{ gap: spacing.sm }}>
            <Text variant="caption" tone="muted">
              Labels it puts on the project
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {[...new Set([...labels.rows.map((l) => l.name), ...draftLabels])]
                .sort((a, b) => a.localeCompare(b))
                .map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    selected={draftLabels.includes(name)}
                    onPress={() =>
                      setDraftLabels((cur) =>
                        cur.includes(name) ? cur.filter((l) => l !== name) : [...cur, name],
                      )
                    }
                  />
                ))}
            </View>
          </View>
          <Button label="Save" fullWidth onPress={saveEdit} />
        </View>
      </Sheet>

      <Sheet
        visible={adding}
        onClose={() => setAdding(false)}
        title="Add a section"
        subtitle={`Pick a ${kindName(addKind)} template from your library.`}
      >
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {ADDABLE_KINDS.map((kind) => (
              <Chip
                key={kind}
                label={OUTCOME[kind].many}
                icon={KIND_ICON[kind]}
                selected={addKind === kind}
                onPress={() => setAddKind(kind)}
              />
            ))}
          </View>
          {refusal ? (
            <Text variant="caption" tone="muted">
              {refusal}
            </Text>
          ) : addable.length === 0 ? (
            <Text variant="caption" tone="muted">
              {`Every ${kindName(addKind)} template is already in this blueprint, or the library has none yet.`}
            </Text>
          ) : (
            <View style={{ maxHeight: layout.listMaxHeight(420) }}>
              <ListGroup>
                {addable.map((entry, index) => (
                  <View key={entry.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      icon={KIND_ICON[addKind]}
                      title={entry.name}
                      right={<Icon icon={Plus} size="sm" tone="primary" />}
                      chevron={false}
                      onPress={() => add(entry.id)}
                    />
                  </View>
                ))}
              </ListGroup>
            </View>
          )}
        </View>
      </Sheet>

      <Sheet
        visible={applyOpen}
        onClose={closeApply}
        title={outcomes ? multiApplyHeadline(outcomes) : `Apply "${blueprint.name}"`}
        subtitle={
          outcomes
            ? undefined
            : "Nothing is created until you pick the projects and apply. Each project gets its own copy."
        }
      >
        {outcomes ? (
          <View style={{ gap: spacing.md }}>
            {outcomes.map((o) => {
              const lines = o.error
                ? [o.error]
                : [
                    ...landedLines(o.counts),
                    ...failureLines({
                      counts: o.counts,
                      failed: o.failed,
                      ledgerRecorded: true,
                      originTagged: true,
                    }),
                  ];
              return (
                <View key={o.projectId} style={{ gap: spacing.xs }}>
                  <Text variant="bodyStrong">{o.projectName}</Text>
                  {(lines.length ? lines : ["Nothing was added."]).map((line) => (
                    <Text
                      key={line}
                      variant="caption"
                      tone={o.error || o.failed.length ? "destructive" : "muted"}
                    >
                      {line}
                    </Text>
                  ))}
                </View>
              );
            })}
            <Button label="Done" fullWidth onPress={closeApply} />
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            <SearchField
              value={targetSearch}
              onChangeText={setTargetSearch}
              placeholder="Search projects"
              accessibilityLabel="Search projects"
            />
            {targetsQuery.isLoading ? (
              <SkeletonList rows={4} />
            ) : targets.length === 0 ? (
              <Text variant="caption" tone="muted">
                No open projects match.
              </Text>
            ) : (
              <View style={{ maxHeight: layout.listMaxHeight(360) }}>
                <ListGroup>
                  {targets.map((target, index) => {
                    const picked = targetIds.includes(target.id);
                    return (
                      <View key={target.id}>
                        {index > 0 ? <RowDivider /> : null}
                        <ListRow
                          title={target.name}
                          subtitle={targetAddress(target) ?? undefined}
                          chevron={false}
                          right={
                            picked ? (
                              <Badge label="Picked" icon={Check} tone="primary" variant="soft" />
                            ) : undefined
                          }
                          onPress={() =>
                            setTargetIds((cur) =>
                              picked ? cur.filter((x) => x !== target.id) : [...cur, target.id],
                            )
                          }
                        />
                      </View>
                    );
                  })}
                </ListGroup>
              </View>
            )}
            <Button
              label={
                progress
                  ? `Applying ${progress.done + 1} of ${progress.total}`
                  : targetIds.length
                    ? `Apply to ${targetIds.length} project${targetIds.length === 1 ? "" : "s"}`
                    : "Pick projects to apply to"
              }
              icon={FolderInput}
              fullWidth
              loading={apply.isPending}
              disabled={!targetIds.length || apply.isPending}
              onPress={() => apply.mutate()}
            />
          </View>
        )}
      </Sheet>
    </>
  );
}
