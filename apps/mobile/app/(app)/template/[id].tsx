import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CHECKLIST_TYPE_LABELS, type ChecklistItemType } from "@everlumen/shared";
import { can } from "@everlumen/shared/team-permissions";
import {
  addTemplateItem,
  deleteTemplateItem,
  listAllChecklistTemplates,
  listTemplateItems,
  saveItemPositions,
  updateChecklistTemplate,
  updateTemplateItem,
} from "@/api/template-admin";
import {
  ITEM_TYPES,
  labelError,
  moved,
  nextPosition,
  normaliseItemType,
  ordered,
  positionChanges,
  removed,
  templateSummary,
  type TemplateItem,
} from "@/api/template-edit";
import { getMyTeam } from "@/api/team";
import { spacing } from "@/theme";
import { Archive, ChevronDown, ChevronUp, Plus, Trash2 } from "@/ui/icons";
import {
  Badge,
  Button,
  ButtonRow,
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
} from "@/ui";

/**
 * Editing one checklist template.
 *
 * Reordering is two arrows rather than a drag handle. Drag-to-reorder on a
 * touch screen needs a long press to disambiguate from scrolling, which on a
 * list of twenty items is both slow and easy to trigger by accident, and it
 * fights the outer ScrollView. Two arrows are ugly and unambiguous, and this is
 * a screen somebody uses twice a year.
 *
 * The positions written back are only the ones that moved. `position` is an
 * integer column with nothing enforcing it is dense or unique, so every
 * mutation renumbers the whole list locally and `positionChanges` reduces that
 * to the two or three rows the server actually needs told about.
 */
export default function TemplateEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<TemplateItem | "new" | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftType, setDraftType] = useState<ChecklistItemType>("checkbox");
  const [draftRequired, setDraftRequired] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [name, setName] = useState("");

  const itemsKey = useMemo(() => ["template-items", id], [id]);

  const templatesQuery = useQuery({
    queryKey: ["checklist-templates-admin"],
    queryFn: listAllChecklistTemplates,
  });
  const itemsQuery = useQuery({
    queryKey: itemsKey,
    queryFn: () => listTemplateItems(id!),
    enabled: Boolean(id),
  });
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });

  const template = (templatesQuery.data ?? []).find((t) => t.id === id) ?? null;
  const canManage = can(teamQuery.data?.myRole, "manage_templates");
  const items = useMemo(() => ordered(itemsQuery.data ?? []), [itemsQuery.data]);
  const requiredCount = items.filter((item) => item.required).length;

  // Seeded once. Re-seeding on every refetch would discard a half-typed name
  // the moment a background refresh lands.
  useEffect(() => {
    if (template && !name) setName(template.name);
  }, [template, name]);

  const run = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: itemsKey });
      void queryClient.invalidateQueries({ queryKey: ["checklist-templates-admin"] });
      setFailure(null);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That did not save."),
  });

  /**
   * Reorder, then write back only what moved.
   *
   * The cache is updated first so the arrow feels instant; the write follows.
   * A failed write leaves the cache ahead of the server, which the invalidate
   * on either outcome corrects.
   */
  const reorder = useCallback(
    (itemId: string, by: -1 | 1) => {
      const next = moved(items, itemId, by);
      if (next === items) return;
      queryClient.setQueryData<TemplateItem[]>(itemsKey, next);
      const changes = positionChanges(items, next);
      if (changes.length) run.mutate(() => saveItemPositions(changes));
    },
    [items, queryClient, itemsKey, run],
  );

  const confirmDelete = useCallback(
    (item: TemplateItem) => {
      Alert.alert(
        `Delete "${item.label}"?`,
        "Checklists already started from this template keep the item. Only new ones lose it.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              // Renumber locally in the same breath, so the gap the delete
              // leaves never reaches the reorder controls.
              const next = removed(items, item.id);
              queryClient.setQueryData<TemplateItem[]>(itemsKey, next);
              const changes = positionChanges(items, next);
              run.mutate(async () => {
                await deleteTemplateItem(item.id);
                if (changes.length) await saveItemPositions(changes);
              });
            },
          },
        ],
      );
    },
    [items, queryClient, itemsKey, run],
  );

  const openNew = useCallback(() => {
    setDraftLabel("");
    setDraftDescription("");
    setDraftType("checkbox");
    setDraftRequired(false);
    setItemError(null);
    setEditing("new");
  }, []);

  const openEdit = useCallback((item: TemplateItem) => {
    setDraftLabel(item.label);
    setDraftDescription(item.description ?? "");
    setDraftType(normaliseItemType(item.item_type));
    setDraftRequired(item.required);
    setItemError(null);
    setEditing(item);
  }, []);

  const saveItem = useCallback(() => {
    const error = labelError(draftLabel);
    if (error) {
      setItemError(error);
      return;
    }
    const target = editing;
    const patch = {
      label: draftLabel.trim(),
      description: draftDescription.trim() || null,
      item_type: draftType,
      required: draftRequired,
    };
    setEditing(null);

    if (target === "new") {
      run.mutate(() => addTemplateItem(id!, { ...patch, position: nextPosition(items) }));
    } else if (target) {
      run.mutate(() => updateTemplateItem(target.id, patch));
    }
  }, [editing, draftLabel, draftDescription, draftType, draftRequired, items, id, run]);

  if (itemsQuery.isLoading || templatesQuery.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Template" }} />
        <SkeletonList rows={6} />
      </>
    );
  }

  if (itemsQuery.error) {
    return (
      <>
        <Stack.Screen options={{ title: "Template" }} />
        <ErrorState
          title="Could not load this template"
          message={itemsQuery.error instanceof Error ? itemsQuery.error.message : undefined}
          onRetry={() => void itemsQuery.refetch()}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: template?.name ?? "Template" }} />

      <Screen
        scroll
        padded={false}
        refreshing={itemsQuery.isRefetching}
        onRefresh={() => void itemsQuery.refetch()}
        bottomInset={spacing.xxl}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            editable={canManage}
            // On blur, like the site log title and the checklist runner's
            // answers. A write per keystroke is a write per keystroke on a
            // connection that may be one bar.
            onBlur={() => {
              const trimmed = name.trim();
              if (!trimmed || trimmed === template?.name) return;
              run.mutate(() => updateChecklistTemplate(id!, { name: trimmed }));
            }}
            returnKeyType="done"
          />

          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text variant="caption" tone="muted">
              {templateSummary(items.length, requiredCount)}
            </Text>
            {template?.archived ? (
              <Badge label="Archived" tone="neutral" variant="outline" />
            ) : null}
          </View>

          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}
        </View>

        <SectionHeader title="Items" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {items.length === 0 ? (
            <EmptyState
              title="No items yet"
              body="Add the first thing a crew has to check. You can reorder them afterwards."
              action={
                canManage ? { label: "Add an item", onPress: openNew, icon: Plus } : undefined
              }
            />
          ) : (
            <ListGroup>
              {items.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <RowDivider inset={false} /> : null}
                  <ListRow
                    title={item.label}
                    /*
                     * "Required" reads on the subtitle line, not as a badge on
                     * the right.
                     *
                     * `ListRow` gives its right slot `flexShrink: 0`, on the
                     * sound reasoning that a badge squeezed to a sliver is
                     * worse than a wrapped title. That holds for a badge. It
                     * does not hold for a badge plus three icon buttons: the
                     * cluster took about 260 of a 360dp row and the title got
                     * the remainder, so every required item rendered as
                     * "Ov / e... / Rat / ing" - one or two characters a line,
                     * while the optional items beside them read normally.
                     *
                     * The row's own type label already shares this line, so the
                     * separator is the pattern the inbox uses.
                     */
                    subtitle={[
                      item.description ?? CHECKLIST_TYPE_LABELS[normaliseItemType(item.item_type)],
                      item.required ? "Required" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    right={
                      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                        {canManage ? (
                          <>
                            {/*
                              Disabled at the ends rather than hidden. A row
                              whose controls change count as it moves through
                              the list makes every other row jump sideways.
                            */}
                            <IconButton
                              icon={ChevronUp}
                              tone="muted"
                              surface={false}
                              accessibilityLabel={`Move ${item.label} up`}
                              disabled={index === 0}
                              onPress={() => reorder(item.id, -1)}
                            />
                            <IconButton
                              icon={ChevronDown}
                              tone="muted"
                              surface={false}
                              accessibilityLabel={`Move ${item.label} down`}
                              disabled={index === items.length - 1}
                              onPress={() => reorder(item.id, 1)}
                            />
                            <IconButton
                              icon={Trash2}
                              tone="destructive"
                              surface={false}
                              accessibilityLabel={`Delete ${item.label}`}
                              onPress={() => confirmDelete(item)}
                            />
                          </>
                        ) : null}
                      </View>
                    }
                    onPress={canManage ? () => openEdit(item) : undefined}
                  />
                </View>
              ))}
            </ListGroup>
          )}

          {canManage ? (
            <ButtonRow>
              <Button label="Add an item" icon={Plus} onPress={openNew} />
              <Button
                label={template?.archived ? "Restore" : "Archive"}
                icon={Archive}
                variant="secondary"
                onPress={() =>
                  run.mutate(() => updateChecklistTemplate(id!, { archived: !template?.archived }))
                }
              />
            </ButtonRow>
          ) : (
            <Text variant="caption" tone="muted">
              Only an owner or admin can change the shared library.
            </Text>
          )}

          {/*
            Archiving rather than deleting the template itself. Checklists
            already started from it carry its id, and removing the row would
            leave them pointing at nothing.
          */}
          <Text variant="caption" tone="muted">
            Archiving hides a template from the list crews start from. Checklists already made from
            it are untouched.
          </Text>
        </View>
      </Screen>

      <Sheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New item" : "Edit item"}
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Label"
            value={draftLabel}
            onChangeText={(next) => {
              setDraftLabel(next);
              if (itemError) setItemError(null);
            }}
            placeholder="Photograph the panel before closing"
            error={itemError ?? undefined}
            autoCapitalize="sentences"
            multiline
            rows={2}
          />

          <Field
            label="Guidance"
            value={draftDescription}
            onChangeText={setDraftDescription}
            placeholder="Anything the crew needs to know"
            hint="Optional"
            multiline
            rows={2}
          />

          <View style={{ gap: spacing.sm }}>
            <Text variant="caption" tone="muted">
              Answer type
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {ITEM_TYPES.map((type) => (
                <Chip
                  key={type}
                  label={CHECKLIST_TYPE_LABELS[type]}
                  selected={draftType === type}
                  onPress={() => setDraftType(type)}
                />
              ))}
            </View>
          </View>

          <ListGroup>
            <ListRow
              title="Required"
              subtitle="The checklist cannot be completed until this is answered"
              right={
                <Badge
                  label={draftRequired ? "Yes" : "No"}
                  tone={draftRequired ? "primary" : "neutral"}
                  variant={draftRequired ? "soft" : "outline"}
                />
              }
              onPress={() => setDraftRequired((current) => !current)}
            />
          </ListGroup>

          <Button label="Save" fullWidth onPress={saveItem} />
        </View>
      </Sheet>
    </>
  );
}
