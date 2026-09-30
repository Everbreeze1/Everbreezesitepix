import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createBlueprint,
  installBlueprintStarter,
  loadBlueprintLibrary,
} from "@/api/blueprint-admin";
import {
  contentsSummary,
  installSummary,
  tradesInUse,
  visibleBlueprints,
} from "@/api/blueprint-library-view";
import { BLUEPRINT_STARTERS, type BlueprintStarter } from "@/api/blueprint-starters";
import { templateNameError } from "@/api/template-edit";
import { GENERAL_CATEGORY, storedCategory, tradeOf } from "@/api/template-library-view";
import { getMyTeam } from "@/api/team";
import { useLabelCatalog } from "@/components/ProjectLabels";
import { canManageLibrary, errorText, TradeChips } from "@/components/TemplateLibraryParts";
import { spacing } from "@/theme";
import { Archive, LayoutTemplate, Plus, Sparkles, Star } from "@/ui/icons";
import {
  Badge,
  Button,
  Chip,
  ChipGroup,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SearchField,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

const ALL = "__all";

/**
 * The blueprint library: the web's Templates > Blueprints tab.
 *
 * A blueprint bundles the checklists, workflow, documents and report templates
 * a company uses for one kind of job. This screen lists and makes them; each
 * one opens on `blueprint/[id]`, where its sections are edited and it can be
 * applied to projects already running.
 *
 * Two ways in, both in the header so they never scroll away: a blank
 * blueprint, and the web's pre-built starters, which build any library piece
 * they need first.
 */
export default function BlueprintsScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [trade, setTrade] = useState<string>(ALL);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [startersOpen, setStartersOpen] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftTrade, setDraftTrade] = useState(GENERAL_CATEGORY);
  const [draftLabels, setDraftLabels] = useState<string[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const libraryQuery = useQuery({ queryKey: ["blueprint-library"], queryFn: loadBlueprintLibrary });
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });
  const labels = useLabelCatalog();
  const canManage = canManageLibrary(teamQuery.data?.myRole, teamQuery.isSuccess);

  // Arriving from the Templates chooser opens the create sheet once.
  const { create: createParam } = useLocalSearchParams<{ create?: string }>();
  const autoOpened = useRef(false);
  useEffect(() => {
    if (createParam !== "1" || !canManage || autoOpened.current) return;
    autoOpened.current = true;
    setCreating(true);
  }, [createParam, canManage]);
  const teamId = teamQuery.data?.team?.id ?? null;

  const all = useMemo(() => libraryQuery.data?.blueprints ?? [], [libraryQuery.data]);
  const links = useMemo(() => libraryQuery.data?.links ?? [], [libraryQuery.data]);
  const trades = useMemo(() => tradesInUse(all, showArchived), [all, showArchived]);
  const visible = useMemo(
    () =>
      visibleBlueprints(all, {
        showArchived,
        search,
        trade: trade === ALL || !trades.includes(trade) ? null : trade,
      }),
    [all, showArchived, search, trade, trades],
  );
  const archivedCount = all.filter((b) => b.archived).length;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["blueprint-library"] });
    // The project chooser caches the list separately.
    void queryClient.invalidateQueries({ queryKey: ["blueprints"] });
  };

  const create = useMutation({
    mutationFn: () =>
      createBlueprint({
        name: draftName.trim(),
        description: draftDescription.trim() || null,
        category: storedCategory(draftTrade),
        labels: draftLabels,
        teamId,
      }),
    onSuccess: async (id) => {
      refresh();
      // The editor reads from this list, so it must hold the new row first.
      await queryClient.refetchQueries({ queryKey: ["blueprint-library"] });
      setCreating(false);
      setDraftName("");
      setDraftDescription("");
      setDraftTrade(GENERAL_CATEGORY);
      setDraftLabels([]);
      // Straight in: an empty blueprint's next step is always its first section.
      router.push({ pathname: "/blueprint/[id]", params: { id } });
    },
    onError: (error) => setFailure(errorText(error, "Could not create that blueprint.")),
  });

  const install = useMutation({
    mutationFn: (starter: BlueprintStarter) => {
      setInstalling(starter.name);
      return installBlueprintStarter(starter, teamId);
    },
    onSuccess: async (result, starter) => {
      refresh();
      await queryClient.refetchQueries({ queryKey: ["blueprint-library"] });
      setStartersOpen(false);
      const summary = installSummary(starter.name, starter.pieces.length, result);
      Alert.alert(summary.title, summary.lines.join("\n") || undefined);
      router.push({ pathname: "/blueprint/[id]", params: { id: result.blueprintId } });
    },
    onError: (error) => setFailure(errorText(error, "Could not add that starter.")),
    onSettled: () => setInstalling(null),
  });

  const submit = () => {
    const error = templateNameError(draftName);
    if (error) {
      setNameError(error);
      return;
    }
    setNameError(null);
    create.mutate();
  };

  const labelChoices = useMemo(() => {
    const set = new Set<string>(labels.rows.map((l) => l.name));
    for (const b of all) for (const l of b.labels) set.add(l);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [labels.rows, all]);

  return (
    <>
      <Stack.Screen
        options={{
          title: "Blueprints",
          headerRight: () =>
            canManage ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <IconButton
                  icon={Sparkles}
                  accessibilityLabel="Starter blueprints"
                  surface={false}
                  tone="muted"
                  onPress={() => setStartersOpen(true)}
                />
                <IconButton
                  icon={Plus}
                  accessibilityLabel="New blueprint"
                  surface={false}
                  tone="primary"
                  disabled={create.isPending}
                  onPress={() => setCreating(true)}
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
        {libraryQuery.isLoading ? (
          <SkeletonList rows={5} />
        ) : libraryQuery.error ? (
          <ErrorState
            title="Could not load blueprints"
            message={errorText(libraryQuery.error, "")}
            onRetry={() => void libraryQuery.refetch()}
          />
        ) : (
          <View style={{ gap: spacing.md, paddingTop: spacing.lg }}>
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search blueprints"
              accessibilityLabel="Search blueprints"
            />
            {trades.length > 1 ? (
              <ChipGroup
                label="Trade"
                value={trades.includes(trade) ? trade : ALL}
                onChange={setTrade}
                options={[
                  { id: ALL, label: "Every trade" },
                  ...trades.map((t) => ({ id: t, label: t })),
                ]}
              />
            ) : null}

            {failure ? (
              <View style={{ paddingHorizontal: spacing.lg }}>
                <Text variant="caption" tone="destructive">
                  {failure}
                </Text>
              </View>
            ) : null}

            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
              {visible.length === 0 ? (
                <EmptyState
                  icon={LayoutTemplate}
                  title={all.length ? "Nothing matches" : "No blueprints yet"}
                  body={
                    all.length
                      ? "Try another search or trade."
                      : "A blueprint sets a job up in one go: its checklists, workflow, documents and report templates. Start from a pre-built one to see the pattern."
                  }
                  action={
                    canManage && !all.length
                      ? {
                          label: "Browse starters",
                          onPress: () => setStartersOpen(true),
                          icon: Sparkles,
                        }
                      : undefined
                  }
                />
              ) : (
                <ListGroup>
                  {visible.map((blueprint, index) => (
                    <View key={blueprint.id}>
                      {index > 0 ? <RowDivider /> : null}
                      <ListRow
                        icon={LayoutTemplate}
                        iconTone={blueprint.archived ? "muted" : "primary"}
                        title={blueprint.name}
                        subtitle={[
                          tradeOf(blueprint.category),
                          contentsSummary(links.filter((l) => l.blueprintId === blueprint.id)),
                        ].join(" · ")}
                        right={
                          blueprint.archived ? (
                            <Badge label="Archived" tone="neutral" variant="outline" />
                          ) : blueprint.isDefault ? (
                            <Badge label="Default" icon={Star} tone="primary" variant="soft" />
                          ) : undefined
                        }
                        onPress={() =>
                          router.push({ pathname: "/blueprint/[id]", params: { id: blueprint.id } })
                        }
                      />
                    </View>
                  ))}
                </ListGroup>
              )}

              {archivedCount > 0 ? (
                <Button
                  label={showArchived ? "Hide archived" : `Show ${archivedCount} archived`}
                  icon={Archive}
                  variant="ghost"
                  fullWidth
                  onPress={() => setShowArchived((current) => !current)}
                />
              ) : null}

              {!canManage && teamQuery.isSuccess ? (
                <Text variant="caption" tone="muted">
                  Only an owner or admin can change the shared library. You can still apply any of
                  these to a project from the project page.
                </Text>
              ) : null}
            </View>
          </View>
        )}
      </Screen>

      <Sheet
        visible={creating}
        onClose={() => setCreating(false)}
        title="New blueprint"
        subtitle="Name it now and add its sections next."
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Name"
            value={draftName}
            onChangeText={(next) => {
              setDraftName(next);
              if (nameError) setNameError(null);
            }}
            placeholder="Bathroom remodel"
            error={nameError ?? undefined}
            autoCapitalize="sentences"
          />
          <Field
            label="Description"
            value={draftDescription}
            onChangeText={setDraftDescription}
            placeholder="What kind of job this sets up"
            hint="Optional"
            multiline
            rows={2}
          />
          <TradeChips value={draftTrade} onChange={setDraftTrade} />
          {labelChoices.length ? (
            <View style={{ gap: spacing.sm }}>
              <Text variant="caption" tone="muted">
                Labels it puts on the project
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {labelChoices.map((name) => (
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
          ) : null}
          <Button
            label="Save and open"
            icon={Plus}
            fullWidth
            loading={create.isPending}
            onPress={submit}
          />
        </View>
      </Sheet>

      <Sheet
        visible={startersOpen}
        onClose={() => (install.isPending ? undefined : setStartersOpen(false))}
        title="Starter blueprints"
        subtitle="Each one builds any checklist, workflow or shot list it needs in your libraries first."
      >
        <ListGroup>
          {BLUEPRINT_STARTERS.map((starter, index) => (
            <View key={starter.name}>
              {index > 0 ? <RowDivider /> : null}
              <ListRow
                icon={Sparkles}
                title={starter.name}
                subtitle={`${starter.category} · ${starter.pieces.length} sections. ${starter.description}`}
                right={
                  installing === starter.name ? (
                    <Badge label="Adding" tone="primary" variant="soft" />
                  ) : undefined
                }
                disabled={install.isPending}
                onPress={() => install.mutate(starter)}
              />
            </View>
          ))}
        </ListGroup>
      </Sheet>
    </>
  );
}
