import { useMemo, useState } from "react";
import { FolderPlus, Plus, Search } from "@/ui/icons";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { PROJECT_STATUS_LABELS, projectDisplayName } from "@everlumen/shared";
import { formatAddress, listProjects } from "@/api/projects";
import { listProjectBoards } from "@/api/pipelines";
import type { PipelineStage } from "@/api/pipeline-view";
import { listProjectCardExtras } from "@/api/project-cards";
import { cardColumns } from "@/api/project-cards-view";
import { ActionRail } from "@/components/ActionRail";
import { QueueBanner } from "@/components/QueueBanner";
import { useLabelCatalog } from "@/components/ProjectLabels";
import { FilterGlyph } from "@/components/ProjectGlyphs";
import { useProjectCrews } from "@/components/ProjectCrewAvatars";
import { ProjectListCard } from "@/components/ProjectListCard";
import { ProjectFilterPills, type ProjectFilterOption } from "@/components/ProjectStatusPill";
import { HIT_TARGET, spacing, useTheme } from "@/theme";
import {
  ActionSheet,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  SearchField,
  SkeletonList,
} from "@/ui";

/*
 * "archived" is not a status, it is the `archived` flag. It sits in the same
 * row because that is where the web puts it, and so an archived job has one
 * place to be found rather than being mixed in among the live ones under All.
 */
type StatusFilter = "all" | "active" | "on_hold" | "completed" | "archived";

/** What a card shows when its photos could not be read at all. */
const FAILED = { urls: [], count: null, latestAt: null, stageId: null };

export default function ProjectsScreen() {
  const theme = useTheme();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  /*
   * The search field is behind the magnifier rather than always open, so the
   * first screen of jobs starts under the filter row instead of under a field
   * most visits never type into. It stays open while it holds text: hiding a
   * field that is still filtering the list is how a list looks broken.
   */
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterSheet, setFilterSheet] = useState(false);

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });

  const all = useMemo(() => data ?? [], [data]);

  /*
   * Crews for the whole list in one round trip, keyed on the ids so a rename or
   * a status change does not refetch every card's avatars.
   */
  const projectIds = useMemo(() => all.map((project) => project.id), [all]);
  const crews = useProjectCrews(projectIds);

  /*
   * Photos for every card in one read (plus one signing batch), keyed on the
   * ids like the crews. Separate from the list query so the cards draw the
   * moment the jobs arrive and the strips fill in behind them; a failure here
   * leaves the strips saying so and the jobs still reachable.
   */
  const extrasQuery = useQuery({
    queryKey: ["project-card-extras", projectIds.join(",")],
    queryFn: () => listProjectCardExtras(projectIds),
    enabled: projectIds.length > 0,
    // Signed URLs last an hour; refetching well inside that keeps them live.
    staleTime: 10 * 60 * 1000,
  });
  const extras = extrasQuery.data;

  // Same key as the status chip and the Pipelines screen: one shared fetch.
  const boardsQuery = useQuery({
    queryKey: ["project-boards"],
    queryFn: listProjectBoards,
    staleTime: 60_000,
  });
  const stages = useMemo(() => {
    const out: Record<string, PipelineStage> = {};
    for (const board of boardsQuery.data ?? []) {
      for (const stage of board.stages ?? []) out[stage.id] = stage;
    }
    return out;
  }, [boardsQuery.data]);

  const { colorOf } = useLabelCatalog();

  /* One column on a phone, a grid of cards on a tablet. */
  const { width } = useWindowDimensions();
  const columns = cardColumns(width);
  const gap = spacing.md;
  const pad = columns > 1 ? spacing.xl : spacing.lg;
  const cellWidth = (width - pad * 2 - gap * (columns - 1)) / columns;

  /*
   * Counts come off the unfiltered list, so a chip reading "On hold 3" keeps
   * saying 3 while you are looking at the active ones. Counting the filtered
   * list instead gives every unselected chip a zero, which reads as "there are
   * none" rather than "you are not looking at them".
   */
  const counts = useMemo(() => {
    // Archived jobs are counted once, under Archived, and nowhere else: the
    // other pills describe the live board, as they do on the web.
    const out: Record<string, number> = { all: 0, archived: 0 };
    for (const project of all) {
      if (project.archived) {
        out.archived += 1;
        continue;
      }
      out.all += 1;
      out[project.status] = (out[project.status] ?? 0) + 1;
    }
    return out;
  }, [all]);

  const projects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matched = all.filter((project) => {
      if (status === "archived") {
        if (!project.archived) return false;
      } else {
        if (project.archived) return false;
        if (status !== "all" && project.status !== status) return false;
      }
      if (!needle) return true;
      const address = formatAddress(project) ?? "";
      return (
        projectDisplayName(project).toLowerCase().includes(needle) ||
        address.toLowerCase().includes(needle)
      );
    });

    /*
     * Starred first, then the existing order (most recently updated).
     * A star that does not move the row up the list is decoration: the whole
     * point is that the two or three jobs someone is actually on stay reachable
     * without scrolling past the ones they are not.
     */
    return [...matched].sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)));
  }, [all, search, status]);

  const filters: ProjectFilterOption<StatusFilter>[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "active", label: PROJECT_STATUS_LABELS.active, count: counts.active ?? 0 },
    { id: "on_hold", label: PROJECT_STATUS_LABELS.on_hold, count: counts.on_hold ?? 0 },
    { id: "completed", label: PROJECT_STATUS_LABELS.completed, count: counts.completed ?? 0 },
    { id: "archived", label: "Archived", count: counts.archived ?? 0 },
  ];

  const showSearch = searchOpen || search.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          backgroundColor: theme.colors.card,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        }}
      >
        <PageHeader
          title="Projects"
          actions={
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <IconButton
                icon={Search}
                accessibilityLabel={showSearch ? "Hide search" : "Search projects"}
                surface={false}
                tone={showSearch ? "primary" : "default"}
                onPress={() => {
                  if (showSearch) {
                    setSearch("");
                    setSearchOpen(false);
                  } else {
                    setSearchOpen(true);
                  }
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filter projects"
                onPress={() => setFilterSheet(true)}
                style={({ pressed }) => [styles.glyphButton, { opacity: pressed ? 0.7 : 1 }]}
              >
                <FilterGlyph
                  color={status === "all" ? theme.colors.foreground : theme.colors.primary}
                />
              </Pressable>
            </View>
          }
        >
          {showSearch ? (
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search name or address"
              accessibilityLabel="Search projects"
            />
          ) : null}
          <ProjectFilterPills
            options={filters}
            value={status}
            onChange={setStatus}
            label="Filter by status"
          />
        </PageHeader>
      </View>

      <QueueBanner />

      {isLoading ? (
        <SkeletonList rows={6} />
      ) : error ? (
        <ErrorState
          message={error instanceof Error ? error.message : "Failed to load projects"}
          onRetry={() => void refetch()}
        />
      ) : (
        <FlatList
          key={`cols-${columns}`}
          data={projects}
          keyExtractor={(item) => item.id}
          numColumns={columns}
          columnWrapperStyle={columns > 1 ? { gap } : undefined}
          contentContainerStyle={{
            padding: pad,
            paddingTop: spacing.xl,
            gap,
            // Clears the raised camera button, which overhangs the bar by 22,
            // and the new-project button floating above the last card.
            paddingBottom: 140,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              tintColor={theme.colors.mutedForeground}
              colors={[theme.colors.primary]}
            />
          }
          ListEmptyComponent={
            search.trim() || status !== "all" ? (
              <EmptyState
                title="Nothing matches"
                body="Try a different search, or clear the status filter."
                action={{
                  label: "Clear filters",
                  onPress: () => {
                    setSearch("");
                    setStatus("all");
                  },
                }}
              />
            ) : (
              <EmptyState
                icon={FolderPlus}
                title="No projects yet"
                body="A project is where photos, checklists and walkthroughs get filed. Start one from the site you are standing on."
                action={{
                  label: "New project",
                  icon: Plus,
                  onPress: () => router.push("/project-new"),
                }}
              />
            )
          }
          renderItem={({ item }) => {
            const card = extras?.[item.id] ?? (extrasQuery.isError ? FAILED : undefined);
            const stageId = card?.stageId ?? null;
            return (
              <View style={columns > 1 ? { width: cellWidth } : undefined}>
                <ProjectListCard
                  project={item}
                  extras={card}
                  stage={stageId ? (stages[stageId] ?? null) : null}
                  crew={crews[item.id]}
                  colorOf={colorOf}
                  onPress={() => router.push(`/project/${item.id}`)}
                />
              </View>
            );
          }}
        />
      )}

      {/*
        The new-project button floats, like the design's, and hides while the
        list has no jobs at all: the empty state already offers "New project",
        and two controls for one intent is one too many. A filter that matches
        nothing still shows it, since "Nothing matches" offers only a reset.
      */}
      {isLoading || error || all.length === 0 ? null : (
        <ActionRail
          actions={[
            {
              key: "new-project",
              icon: Plus,
              label: "New project",
              onPress: () => router.push("/project-new"),
            },
          ]}
        />
      )}

      <ActionSheet
        visible={filterSheet}
        onClose={() => setFilterSheet(false)}
        title="Show projects"
        actions={[
          ...filters.map((option) => ({
            label: `${option.id === status ? "✓ " : ""}${option.label} (${option.count ?? 0})`,
            onPress: () => setStatus(option.id),
          })),
          ...(search || status !== "all"
            ? [
                {
                  label: "Clear search and filter",
                  onPress: () => {
                    setSearch("");
                    setSearchOpen(false);
                    setStatus("all");
                  },
                },
              ]
            : []),
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  glyphButton: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
});
