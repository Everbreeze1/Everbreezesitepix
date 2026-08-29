import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { can } from "@everlumen/shared/team-permissions";
import { createLabel, deleteLabel, listLabels, updateLabel, type LabelRow } from "@/api/labels";
import {
  cleanLabelName,
  labelColor,
  labelNameError,
  LABEL_SWATCHES,
  MAX_LABEL_LENGTH,
} from "@/api/label-rules";
import { getMyTeam } from "@/api/team";
import { useAuth } from "@/lib/auth";
import { radius, spacing } from "@/theme";
import { Plus, Tag, Trash2 } from "@/ui/icons";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Workspace labels.
 *
 * Small, and one of the four rows that used to open a browser. It is worth
 * having natively for a reason that is not obvious from the web app: labels are
 * applied on site, from a phone, and a crew that cannot make one has to either
 * pick the wrong existing label or leave the job untagged. Both are worse than
 * the thirty seconds this screen costs.
 *
 * The colours are the web's palette exactly. A label made here has to sit
 * alongside labels made at a desk without looking like it came from somewhere
 * else.
 */

const QUERY_KEY = ["labels"] as const;

export default function LabelsScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<LabelRow | "new" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<string>(LABEL_SWATCHES[10]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const labelsQuery = useQuery({ queryKey: QUERY_KEY, queryFn: listLabels });
  /*
   * The team is read only to answer two questions: which team a new label
   * belongs to, and whether this person may edit the shared library at all.
   * Both are cheap and neither is worth a second screen.
   */
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });

  const labels = useMemo(() => labelsQuery.data ?? [], [labelsQuery.data]);
  const canManage = can(teamQuery.data?.myRole, "manage_templates");

  const run = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That did not work."),
  });

  const openNew = useCallback(() => {
    setDraftName("");
    // Not the first swatch. Opening every new label on the same red means a
    // workspace where nobody changed it is a wall of identical chips.
    setDraftColor(LABEL_SWATCHES[labels.length % LABEL_SWATCHES.length]);
    setNameError(null);
    setEditing("new");
  }, [labels.length]);

  const openEdit = useCallback((label: LabelRow) => {
    setDraftName(label.name);
    setDraftColor(labelColor(label));
    setNameError(null);
    setEditing(label);
  }, []);

  const save = useCallback(() => {
    const selfId = editing && editing !== "new" ? editing.id : undefined;
    const error = labelNameError(draftName, labels, selfId);
    if (error) {
      setNameError(error);
      return;
    }
    const name = cleanLabelName(draftName);
    const color = draftColor;
    const target = editing;
    setEditing(null);

    if (target === "new") {
      if (!user) return;
      run.mutate(() =>
        createLabel({ name, color, teamId: teamQuery.data?.team?.id ?? null, userId: user.id }),
      );
    } else if (target) {
      run.mutate(() => updateLabel(target.id, { name, color }));
    }
  }, [editing, draftName, draftColor, labels, run, teamQuery.data, user]);

  /**
   * Deletion asks first and says what it costs.
   *
   * Removing a label does not delete anything it was on; it just stops those
   * projects being findable by it. That is worth saying, because "delete" next
   * to a label somebody has put on forty jobs reads far more dangerous than it
   * is, and a person who does not know that leaves the mess in place instead.
   */
  const confirmDelete = useCallback(
    (label: LabelRow) => {
      Alert.alert(
        `Delete "${label.name}"?`,
        "Projects keep their photos and notes. They just stop being findable by this label.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => run.mutate(() => deleteLabel(label.id)),
          },
        ],
      );
    },
    [run],
  );

  return (
    <>
      <Stack.Screen options={{ title: "Labels" }} />

      <Screen
        scroll
        padded={false}
        refreshing={labelsQuery.isRefetching}
        onRefresh={() => void labelsQuery.refetch()}
        bottomInset={spacing.xxl}
      >
        {labelsQuery.isLoading ? (
          <SkeletonList rows={5} />
        ) : labelsQuery.error ? (
          <ErrorState
            title="Could not load labels"
            message={labelsQuery.error instanceof Error ? labelsQuery.error.message : undefined}
            onRetry={() => void labelsQuery.refetch()}
          />
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
            {failure ? (
              <Text variant="caption" tone="destructive">
                {failure}
              </Text>
            ) : null}

            {labels.length === 0 ? (
              <EmptyState
                icon={Tag}
                title="No labels yet"
                body="Labels group projects across sites: a client name, a contract, a season. Everyone on the team sees the same set."
                action={
                  canManage ? { label: "New label", onPress: openNew, icon: Plus } : undefined
                }
              />
            ) : (
              <>
                <ListGroup>
                  {labels.map((label, index) => (
                    <View key={label.id}>
                      {index > 0 ? <RowDivider inset={false} /> : null}
                      <ListRow
                        title={label.name}
                        right={
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: spacing.md,
                            }}
                          >
                            <Swatch color={labelColor(label)} />
                            {canManage ? (
                              <IconButton
                                icon={Trash2}
                                tone="destructive"
                                surface={false}
                                accessibilityLabel={`Delete ${label.name}`}
                                onPress={() => confirmDelete(label)}
                              />
                            ) : null}
                          </View>
                        }
                        onPress={canManage ? () => openEdit(label) : undefined}
                      />
                    </View>
                  ))}
                </ListGroup>

                {canManage ? (
                  <Button
                    label="New label"
                    icon={Plus}
                    variant="secondary"
                    fullWidth
                    onPress={openNew}
                  />
                ) : (
                  <Text variant="caption" tone="muted">
                    Only an owner or admin can change the shared label set.
                  </Text>
                )}
              </>
            )}
          </View>
        )}
      </Screen>

      <Sheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New label" : "Edit label"}
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Name"
            value={draftName}
            onChangeText={(next) => {
              setDraftName(next);
              if (nameError) setNameError(null);
            }}
            placeholder="Riverside contract"
            error={nameError ?? undefined}
            hint={`Up to ${MAX_LABEL_LENGTH} characters`}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={save}
          />

          <View style={{ gap: spacing.sm }}>
            <Text variant="caption" tone="muted">
              Colour
            </Text>
            {/*
              Wrapped rather than scrolled. Twenty swatches fit in four rows on
              the narrowest phone, and a horizontal strip hides half of them
              behind a gesture nobody knows is there.
            */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {LABEL_SWATCHES.map((color) => (
                <Pressable
                  key={color}
                  accessibilityRole="button"
                  accessibilityLabel={`Colour ${color}`}
                  accessibilityState={{ selected: draftColor === color }}
                  onPress={() => setDraftColor(color)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: radius.md,
                    backgroundColor: color,
                    // The ring is the only selection signal, so it has to
                    // survive being drawn on top of a dark swatch.
                    borderWidth: draftColor === color ? 3 : 0,
                    borderColor: "#ffffff",
                  }}
                />
              ))}
            </View>
          </View>

          <Button label="Save" fullWidth onPress={save} />
        </View>
      </Sheet>
    </>
  );
}

/** The colour chip on a roster row. */
function Swatch({ color }: { color: string }) {
  return (
    <View style={{ width: 20, height: 20, borderRadius: radius.sm, backgroundColor: color }} />
  );
}
