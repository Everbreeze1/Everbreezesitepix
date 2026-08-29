import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { moved, nextPosition, ordered, positionChanges, removed } from "@/api/template-edit";
import {
  createItem,
  createPhase,
  deleteItem,
  deletePhase,
  listPhaseItems,
  listPhases,
  savePositions,
  updateItem,
  updatePhase,
} from "@/api/workflow-template-admin";
import {
  emptyPhaseIds,
  ITEM_KINDS,
  itemsInPhase,
  normaliseKind,
  phaseNameError,
  phaseSummary,
  templateUsabilityWarning,
  type WorkflowItemKind,
  type WorkflowPhase,
  type WorkflowTemplateItem,
} from "@/api/workflow-template-edit";
import { spacing } from "@/theme";
import { ChevronLeft, ChevronRight, CircleCheck, Plus, Trash2, TriangleAlert } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
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
 * Editing a workflow template: the phases, and the steps inside each.
 *
 * This was the last thing built and the reason is the nesting. A checklist
 * template is one list; this is a list of phases each holding its own list, on
 * two tables whose `position` columns are independent. Shipping half of it,
 * phases you can reorder holding steps you cannot, would be worse than shipping
 * none: it looks finished.
 *
 * Reordering is arrows, not drag. Drag on a touch screen needs a long press to
 * disambiguate from scrolling, and on a nested list the target is usually off
 * screen anyway. The same choice the checklist editor made, for the same
 * reason, using the same helpers: `template-edit.ts` is generic over anything
 * with `{ id, position, label }`, which phases and steps both are.
 */
export default function WorkflowTemplateScreen() {
  const { templateId, name } = useLocalSearchParams<{ templateId: string; name?: string }>();
  const queryClient = useQueryClient();

  const [phaseSheet, setPhaseSheet] = useState<WorkflowPhase | "new" | null>(null);
  const [itemSheet, setItemSheet] = useState<{
    phaseId: string;
    item: WorkflowTemplateItem | null;
  } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftKind, setDraftKind] = useState<WorkflowItemKind>("check");
  const [draftRequired, setDraftRequired] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const phasesKey = useMemo(() => ["workflow-template-phases", templateId], [templateId]);

  const phasesQuery = useQuery({
    queryKey: phasesKey,
    queryFn: () => listPhases(templateId!),
    enabled: Boolean(templateId),
  });

  const phases = useMemo(() => ordered(phasesQuery.data ?? []), [phasesQuery.data]);

  /*
   * Every step across every phase, in one query.
   *
   * A query per phase would be one round trip per phase on a connection that
   * may be one bar, and eight phases is normal.
   */
  const itemsQuery = useQuery({
    queryKey: ["workflow-template-items", templateId, phases.map((p) => p.id).join(",")],
    queryFn: () => listPhaseItems(phases.map((p) => p.id)),
    enabled: phases.length > 0,
  });

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const empties = useMemo(() => new Set(emptyPhaseIds(phases, items)), [phases, items]);
  const warning = templateUsabilityWarning(phases.length, items.length);

  const run = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: phasesKey });
      void queryClient.invalidateQueries({ queryKey: ["workflow-template-items", templateId] });
      setFailure(null);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That did not save."),
  });

  /** Move a phase, and write back only the rows whose position actually changed. */
  const movePhase = useCallback(
    (id: string, by: -1 | 1) => {
      const next = moved(phases, id, by);
      if (next === phases) return;
      const changes = positionChanges(phases, next);
      queryClient.setQueryData(phasesKey, next);
      run.mutate(() => savePositions("workflow_template_phases", changes));
    },
    [phases, phasesKey, queryClient, run],
  );

  const moveItem = useCallback(
    (phaseId: string, id: string, by: -1 | 1) => {
      const inPhase = ordered(itemsInPhase(items, phaseId));
      const next = moved(inPhase, id, by);
      if (next === inPhase) return;
      run.mutate(() => savePositions("workflow_template_items", positionChanges(inPhase, next)));
    },
    [items, run],
  );

  const confirmDeletePhase = useCallback(
    (phase: WorkflowPhase) => {
      const count = itemsInPhase(items, phase.id).length;
      Alert.alert(
        `Delete "${phase.name}"?`,
        count > 0
          ? // The cascade is the database's: workflow_template_items.phase_id is
            // ON DELETE CASCADE. Saying the number is the difference between a
            // confirm that is true and one that is not.
            `Its ${count} step${count === 1 ? "" : "s"} go with it. Workflows already running from this template are untouched.`
          : "Workflows already running from this template are untouched.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              queryClient.setQueryData(phasesKey, removed(phases, phase.id));
              run.mutate(() => deletePhase(phase.id));
            },
          },
        ],
      );
    },
    [items, phases, phasesKey, queryClient, run],
  );

  const savePhase = useCallback(() => {
    const error = phaseNameError(draftName);
    if (error) {
      setNameError(error);
      return;
    }
    const target = phaseSheet;
    const phaseName = draftName.trim();
    const description = draftDescription.trim() || null;
    setPhaseSheet(null);

    if (target === "new") {
      run.mutate(() =>
        createPhase({
          templateId: templateId!,
          name: phaseName,
          description,
          position: nextPosition(phases),
        }),
      );
    } else if (target) {
      run.mutate(() => updatePhase(target.id, { name: phaseName, description }));
    }
  }, [phaseSheet, draftName, draftDescription, phases, templateId, run]);

  const saveItem = useCallback(() => {
    const label = draftLabel.trim();
    if (!label) {
      setNameError("Give the step a label.");
      return;
    }
    const target = itemSheet;
    setItemSheet(null);
    if (!target) return;

    if (target.item) {
      run.mutate(() =>
        updateItem(target.item!.id, { label, kind: draftKind, required: draftRequired }),
      );
    } else {
      run.mutate(() =>
        createItem({
          phaseId: target.phaseId,
          label,
          kind: draftKind,
          required: draftRequired,
          position: nextPosition(itemsInPhase(items, target.phaseId)),
        }),
      );
    }
  }, [itemSheet, draftLabel, draftKind, draftRequired, items, run]);

  if (phasesQuery.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: name || "Workflow template" }} />
        <SkeletonList rows={5} />
      </>
    );
  }

  if (phasesQuery.error) {
    return (
      <>
        <Stack.Screen options={{ title: name || "Workflow template" }} />
        <ErrorState
          title="Could not load this template"
          message={phasesQuery.error instanceof Error ? phasesQuery.error.message : undefined}
          onRetry={() => void phasesQuery.refetch()}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: name || "Workflow template" }} />

      <Screen
        scroll
        padded={false}
        refreshing={phasesQuery.isRefetching}
        onRefresh={() => void phasesQuery.refetch()}
        bottomInset={spacing.xxl}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm }}>
          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}
          {/*
            Said before somebody applies it to a job and finds out there. Neither
            of these states throws: the apply succeeds and produces a workflow
            with nothing in it.
          */}
          {warning ? (
            <Badge label={warning} tone="warning" variant="soft" icon={TriangleAlert} />
          ) : null}
        </View>

        {phases.length === 0 ? (
          <EmptyState
            icon={CircleCheck}
            title="No phases yet"
            body="A workflow is phases with steps in them: First fix, Second fix, Sign-off. Add the phases, then the steps inside each."
            action={{
              label: "Add a phase",
              icon: Plus,
              onPress: () => {
                setDraftName("");
                setDraftDescription("");
                setNameError(null);
                setPhaseSheet("new");
              },
            }}
          />
        ) : (
          phases.map((phase, phaseIndex) => {
            const phaseItems = ordered(itemsInPhase(items, phase.id));
            return (
              <View key={phase.id}>
                <SectionHeader title={`${phaseIndex + 1}. ${phase.name}`} />
                <View style={{ paddingHorizontal: spacing.lg }}>
                  <Card>
                    <View style={{ gap: spacing.md }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <Text variant="caption" tone="muted">
                            {phaseSummary(phaseItems.length, phase.requires_signoff)}
                          </Text>
                          {empties.has(phase.id) ? (
                            <Text variant="caption" tone="muted">
                              {/*
                                Informs rather than blocks: a milestone phase
                                with only a sign-off is legal and deliberate.
                              */}
                              Nothing to work through in this phase yet.
                            </Text>
                          ) : null}
                        </View>
                        <IconButton
                          icon={ChevronLeft}
                          tone="muted"
                          surface={false}
                          accessibilityLabel={`Move ${phase.name} earlier`}
                          disabled={phaseIndex === 0}
                          onPress={() => movePhase(phase.id, -1)}
                        />
                        <IconButton
                          icon={ChevronRight}
                          tone="muted"
                          surface={false}
                          accessibilityLabel={`Move ${phase.name} later`}
                          disabled={phaseIndex === phases.length - 1}
                          onPress={() => movePhase(phase.id, 1)}
                        />
                        <IconButton
                          icon={Trash2}
                          tone="destructive"
                          surface={false}
                          accessibilityLabel={`Delete ${phase.name}`}
                          onPress={() => confirmDeletePhase(phase)}
                        />
                      </View>

                      {phase.description ? (
                        <Text variant="caption" tone="muted">
                          {phase.description}
                        </Text>
                      ) : null}

                      {phaseItems.length > 0 ? (
                        <ListGroup>
                          {phaseItems.map((templateItem, itemIndex) => (
                            <View key={templateItem.id}>
                              {itemIndex > 0 ? <RowDivider inset={false} /> : null}
                              <ListRow
                                title={templateItem.label}
                                subtitle={
                                  ITEM_KINDS.find(
                                    (kind) => kind.id === normaliseKind(templateItem.kind),
                                  )?.label
                                }
                                right={
                                  <View
                                    style={{
                                      flexDirection: "row",
                                      alignItems: "center",
                                      gap: spacing.xs,
                                    }}
                                  >
                                    {templateItem.required ? (
                                      <Badge label="Required" tone="primary" variant="outline" />
                                    ) : null}
                                    <IconButton
                                      icon={ChevronLeft}
                                      tone="muted"
                                      surface={false}
                                      accessibilityLabel="Move this step up"
                                      disabled={itemIndex === 0}
                                      onPress={() => moveItem(phase.id, templateItem.id, -1)}
                                    />
                                    <IconButton
                                      icon={ChevronRight}
                                      tone="muted"
                                      surface={false}
                                      accessibilityLabel="Move this step down"
                                      disabled={itemIndex === phaseItems.length - 1}
                                      onPress={() => moveItem(phase.id, templateItem.id, 1)}
                                    />
                                    <IconButton
                                      icon={Trash2}
                                      tone="destructive"
                                      surface={false}
                                      accessibilityLabel={`Delete ${templateItem.label}`}
                                      onPress={() => run.mutate(() => deleteItem(templateItem.id))}
                                    />
                                  </View>
                                }
                                onPress={() => {
                                  setDraftLabel(templateItem.label);
                                  setDraftKind(normaliseKind(templateItem.kind));
                                  setDraftRequired(templateItem.required);
                                  setNameError(null);
                                  setItemSheet({ phaseId: phase.id, item: templateItem });
                                }}
                              />
                            </View>
                          ))}
                        </ListGroup>
                      ) : null}

                      <View style={{ flexDirection: "row", gap: spacing.sm }}>
                        <Button
                          label="Add a step"
                          icon={Plus}
                          size="sm"
                          variant="secondary"
                          onPress={() => {
                            setDraftLabel("");
                            setDraftKind("check");
                            setDraftRequired(false);
                            setNameError(null);
                            setItemSheet({ phaseId: phase.id, item: null });
                          }}
                        />
                        <Button
                          label={phase.requires_signoff ? "Sign-off on" : "Sign-off off"}
                          size="sm"
                          variant="ghost"
                          onPress={() =>
                            run.mutate(() =>
                              updatePhase(phase.id, {
                                requires_signoff: !phase.requires_signoff,
                              }),
                            )
                          }
                        />
                        <Button
                          label="Rename"
                          size="sm"
                          variant="ghost"
                          onPress={() => {
                            setDraftName(phase.name);
                            setDraftDescription(phase.description ?? "");
                            setNameError(null);
                            setPhaseSheet(phase);
                          }}
                        />
                      </View>
                    </View>
                  </Card>
                </View>
              </View>
            );
          })
        )}

        {phases.length > 0 ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
            <Button
              label="Add a phase"
              icon={Plus}
              variant="secondary"
              fullWidth
              onPress={() => {
                setDraftName("");
                setDraftDescription("");
                setNameError(null);
                setPhaseSheet("new");
              }}
            />
          </View>
        ) : null}
      </Screen>

      <Sheet
        visible={phaseSheet !== null}
        onClose={() => setPhaseSheet(null)}
        title={phaseSheet === "new" ? "New phase" : "Rename phase"}
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Name"
            value={draftName}
            onChangeText={(next) => {
              setDraftName(next);
              if (nameError) setNameError(null);
            }}
            placeholder="First fix"
            error={nameError ?? undefined}
            autoCapitalize="sentences"
          />
          <Field
            label="Description"
            value={draftDescription}
            onChangeText={setDraftDescription}
            placeholder="What this phase covers"
            hint="Optional"
            multiline
            rows={2}
          />
          <Button label="Save" fullWidth onPress={savePhase} />
        </View>
      </Sheet>

      <Sheet
        visible={itemSheet !== null}
        onClose={() => setItemSheet(null)}
        title={itemSheet?.item ? "Edit step" : "New step"}
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Label"
            value={draftLabel}
            onChangeText={(next) => {
              setDraftLabel(next);
              if (nameError) setNameError(null);
            }}
            placeholder="Photograph the consumer unit"
            error={nameError ?? undefined}
            autoCapitalize="sentences"
          />

          <View style={{ gap: spacing.sm }}>
            <Text variant="caption" tone="muted">
              What the crew does
            </Text>
            <ListGroup>
              {ITEM_KINDS.map((kind, index) => (
                <View key={kind.id}>
                  {index > 0 ? <RowDivider inset={false} /> : null}
                  <ListRow
                    title={kind.label}
                    subtitle={kind.hint}
                    value={draftKind === kind.id ? "Chosen" : undefined}
                    onPress={() => setDraftKind(kind.id)}
                  />
                </View>
              ))}
            </ListGroup>
          </View>

          <ListGroup>
            <ListRow
              title="Required"
              subtitle="The phase cannot be finished until this is done"
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
