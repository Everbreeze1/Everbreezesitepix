import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyBlueprint,
  getBlueprintOrigin,
  listBlueprints,
  type ApplyResult,
  type BlueprintOption,
} from "@/api/blueprints";
import {
  applySummary,
  failureLines,
  filterBlueprints,
  landedLines,
  planWarning,
  provenanceWarning,
  sortedBlueprints,
} from "@/api/blueprints-view";
import { getMyTeam } from "@/api/team";
import { radius, spacing, useTheme } from "@/theme";
import { LayoutTemplate, Star, TriangleAlert } from "./icons";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { EmptyState, SkeletonList } from "./State";
import { SearchField } from "./PageHeader";
import { Sheet } from "./Sheet";
import { Text } from "./Text";

/**
 * Setting a job up from a blueprint.
 *
 * A blueprint bundles the checklists, workflows, documents, draft reports, shot
 * lists and label sets a company uses for one kind of job, and applying it
 * creates all of them at once. That is the difference between starting a job
 * and setting one up, and it is the thing most worth being able to do from a
 * van rather than back at a desk.
 *
 * The question this has to answer, which the web version was rebuilt to answer,
 * is "what happens when I pick one?". Naming the template type does not answer
 * it. So the result names the tab each thing landed in, and the failures and
 * the provenance warning are shown rather than swallowed: a partial apply is
 * the normal failure mode here, and somebody who is not told will assume the
 * whole blueprint is on the job.
 */
export function ProjectBlueprint({
  projectId,
  projectName,
  projectAddress,
}: {
  projectId: string;
  projectName: string;
  projectAddress?: string | null;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const originQuery = useQuery({
    queryKey: ["blueprint-origin", projectId],
    queryFn: () => getBlueprintOrigin(projectId),
    enabled: Boolean(projectId),
  });

  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });

  const listQuery = useQuery({
    queryKey: ["blueprints"],
    queryFn: listBlueprints,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const options = useMemo(
    () => sortedBlueprints(filterBlueprints(listQuery.data ?? [], search)),
    [listQuery.data, search],
  );

  const applied = originQuery.data?.applications ?? [];
  const origin = applied[0] ?? null;
  const warning = planWarning(teamQuery.data?.plan);

  const apply = useMutation({
    mutationFn: (blueprintId: string) =>
      applyBlueprint({
        blueprintId,
        projectId,
        // The service fills `{{ }}` tokens in the blueprint's documents with
        // these. Sending a blank name does not fail, it leaves the token
        // unreplaced for a client to read in a finished site log.
        projectName,
        projectAddress: projectAddress ?? null,
      }),
    onSuccess: (applyResult) => {
      setResult(applyResult);
      setFailure(null);
      /*
       * Everything a blueprint creates lives on another screen, so the caches
       * that back those screens are now stale. Invalidated rather than patched:
       * the counts say how many landed, not what they were.
       */
      for (const key of [
        ["project-checklists", projectId],
        ["project-workflows", projectId],
        ["project-documents", projectId],
        ["project-reports", projectId],
        ["blueprint-origin", projectId],
        ["project", projectId],
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That blueprint could not be applied."),
  });

  function close() {
    setOpen(false);
    // Cleared on close rather than on open, so the result stays readable while
    // the sheet is being dismissed.
    setResult(null);
    setFailure(null);
    setSearch("");
  }

  // The ledger table may not exist on this database, which the service reports
  // as "unavailable" rather than throwing. Nothing useful to draw in that case.
  if (originQuery.isLoading || originQuery.error) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          origin ? "Blueprint that set this job up" : "Set this job up from a blueprint"
        }
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          paddingVertical: spacing.sm,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Icon icon={LayoutTemplate} size="md" tone="muted" />
        <Text variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={1}>
          {origin?.blueprintName
            ? `Set up from ${origin.blueprintName}`
            : "Set this job up from a blueprint"}
        </Text>
        {warning ? <Badge label={warning} tone="neutral" variant="soft" /> : null}
        <Text variant="caption" tone="primary">
          {origin ? "Add another" : "Choose"}
        </Text>
      </Pressable>

      <Sheet
        visible={open}
        onClose={close}
        title={result ? "Blueprint applied" : "Choose a blueprint"}
        subtitle={
          result
            ? undefined
            : "Creates the checklists, workflows, documents and labels for this kind of job."
        }
        footer={result ? <Button label="Done" fullWidth onPress={close} /> : undefined}
      >
        {result ? (
          <View style={{ gap: spacing.sm }}>
            <Text variant="bodyStrong">{applySummary(result)}</Text>

            {/*
              Each line names the tab the thing landed in. "I don't know what
              happens when I select a template" is answered by pointing at a
              screen somebody has already seen, not by naming a template type.
            */}
            {landedLines(result.counts).map((line) => (
              <View key={line} style={{ flexDirection: "row", gap: spacing.sm }}>
                <View
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    marginTop: 8,
                    backgroundColor: theme.colors.primary,
                  }}
                />
                <Text variant="body" style={{ flex: 1 }}>
                  {line}
                </Text>
              </View>
            ))}

            {failureLines(result).length > 0 ? (
              <View style={{ gap: spacing.xs, paddingTop: spacing.sm }}>
                <Badge
                  label="Some parts did not apply"
                  tone="warning"
                  icon={TriangleAlert}
                  variant="soft"
                />
                {failureLines(result).map((line) => (
                  <Text key={line} variant="caption" tone="muted">
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}

            {provenanceWarning(result) ? (
              <Text variant="caption" tone="muted">
                {provenanceWarning(result)}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {failure ? (
              <View style={{ gap: spacing.xs }}>
                <Badge label="Not applied" tone="danger" icon={TriangleAlert} variant="soft" />
                <Text variant="body" tone="muted">
                  {failure}
                </Text>
              </View>
            ) : null}

            {(listQuery.data ?? []).length > 5 ? (
              <SearchField
                value={search}
                onChangeText={setSearch}
                placeholder="Search blueprints"
                accessibilityLabel="Search blueprints"
              />
            ) : null}

            {listQuery.isLoading ? (
              <SkeletonList rows={4} />
            ) : listQuery.error ? (
              <View style={{ gap: spacing.sm }}>
                <Text variant="body" tone="muted">
                  {listQuery.error instanceof Error
                    ? listQuery.error.message
                    : "Could not load your blueprints."}
                </Text>
                <Button
                  label="Try again"
                  variant="secondary"
                  onPress={() => void listQuery.refetch()}
                />
              </View>
            ) : options.length === 0 ? (
              <EmptyState
                icon={LayoutTemplate}
                title={search ? "Nothing matches" : "No blueprints yet"}
                body={
                  search
                    ? "Try a different word."
                    : "Blueprints are set up on the web, under Templates."
                }
              />
            ) : (
              <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
                <View style={{ gap: spacing.sm }}>
                  {options.map((option) => (
                    <BlueprintRow
                      key={option.id}
                      option={option}
                      busy={apply.isPending}
                      onPress={() => apply.mutate(option.id)}
                    />
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        )}
      </Sheet>
    </>
  );
}

function BlueprintRow({
  option,
  busy,
  onPress,
}: {
  option: BlueprintOption;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Apply ${option.name}`}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        gap: spacing.xs,
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.secondary : theme.colors.card,
        opacity: busy ? 0.6 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        {/*
          The category default first and marked. A company with one blueprint per
          job type has picked one for each, and that is the one being reached for
          nine times out of ten.
        */}
        {option.isDefault ? <Icon icon={Star} size="sm" tone="safety" /> : null}
        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
          {option.name}
        </Text>
      </View>
      {option.category || option.labels.length > 0 ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {[option.category, ...option.labels].filter(Boolean).join(" · ")}
        </Text>
      ) : null}
    </Pressable>
  );
}
