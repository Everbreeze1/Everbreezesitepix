import { useMemo, useState } from "react";
import { FolderPlus, Plus, Search } from "@/ui/icons";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { PROJECT_STATUS_LABELS, projectDisplayName, relativeTime } from "@everlumen/shared";
import { formatAddress, listProjects, type ProjectListItem } from "@/api/projects";
import { QueueBanner } from "@/components/QueueBanner";
import { LabelChip, useLabelCatalog } from "@/components/ProjectLabels";
import { FilterGlyph } from "@/components/ProjectGlyphs";
import { ProjectCrewAvatars, useProjectCrews } from "@/components/ProjectCrewAvatars";
import {
  ProjectFilterPills,
  ProjectStatusPill,
  projectStatusLabel,
  type ProjectFilterOption,
} from "@/components/ProjectStatusPill";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import {
  ActionSheet,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  PageHeader,
  SearchField,
  SkeletonList,
  Text,
} from "@/ui";

/*
 * "archived" is not a status, it is the `archived` flag. It sits in the same
 * row because that is where the web puts it, and so an archived job has one
 * place to be found rather than being mixed in among the live ones under All.
 */
type StatusFilter = "all" | "active" | "on_hold" | "completed" | "archived";

/** Diameter of the floating new-project button. */
const FAB = 60;

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
          data={projects}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            padding: spacing.lg,
            paddingTop: spacing.xl,
            gap: spacing.md,
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
          renderItem={({ item }) => <ProjectCard project={item} crew={crews[item.id]} />}
        />
      )}

      {/*
        The new-project button floats, like the design's, and hides while the
        list has no jobs at all: the empty state already offers "New project",
        and two controls for one intent is one too many. A filter that matches
        nothing still shows it, since "Nothing matches" offers only a reset.
      */}
      {isLoading || error || all.length === 0 ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New project"
          onPress={() => router.push("/project-new")}
          style={({ pressed }) => [
            styles.newProject,
            {
              backgroundColor: theme.colors.primary,
              shadowColor: theme.colors.primary,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Icon icon={Plus} size="lg" color={theme.colors.primaryForeground} />
        </Pressable>
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

/** "Client · Street", without repeating the client when the name already is it. */
function cardTitle(project: ProjectListItem): string {
  const name = projectDisplayName(project);
  const client = project.client_name?.trim();
  if (!client || name.toLowerCase().includes(client.toLowerCase())) return name;
  return `${client} · ${name}`;
}

/** "Folsom, CA", falling back to the free-text location. */
function cardPlace(project: ProjectListItem): string | null {
  const cityState = [project.city, project.state].filter(Boolean).join(", ");
  if (cityState) return cityState;
  // The street is already the title for most jobs, so only the loose
  // `location` text is worth a second line here.
  return project.location?.trim() || null;
}

function ProjectCard({
  project,
  crew,
}: {
  project: ProjectListItem;
  crew?: { name: string | null; uri: string | null }[];
}) {
  const theme = useTheme();
  const title = cardTitle(project);
  const place = cardPlace(project);
  const address = formatAddress(project);
  const label = projectStatusLabel(project.status);
  const done = project.status === "completed";
  // Same chips as the web project card, coloured from the workspace catalog.
  const { colorOf } = useLabelCatalog();
  const labels = project.labels ?? [];

  return (
    <Card
      onPress={() => router.push(`/project/${project.id}`)}
      accessibilityLabel={`${title}${address ? `, ${address}` : ""}, ${label}`}
      style={{
        borderRadius: radius.xl,
        backgroundColor: done ? theme.colors.background : undefined,
      }}
    >
      {/*
        `minWidth: 0` for the reason `ListRow` needed the same: a flex child
        defaults to its content width as its minimum, so a long name is
        measured against the width it wanted rather than the width it has, and
        `numberOfLines` then cuts far too early.
      */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            variant="bodyStrong"
            numberOfLines={2}
            style={{ fontSize: 17, fontWeight: "700", opacity: done ? 0.75 : 1 }}
          >
            {title}
          </Text>
          {place ? (
            <Text variant="caption" tone="muted" numberOfLines={2} style={{ fontSize: 14 }}>
              {place}
            </Text>
          ) : null}
        </View>
        <ProjectStatusPill status={project.status} />
      </View>

      {labels.length > 0 ? (
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm }}
        >
          {labels.slice(0, 4).map((name) => (
            <LabelChip key={name} name={name} color={colorOf(name)} size="sm" />
          ))}
          {labels.length > 4 ? (
            <Text variant="caption" tone="muted" style={{ alignSelf: "center" }}>
              {`+${labels.length - 4}`}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: spacing.md,
          minHeight: 28,
          gap: spacing.sm,
        }}
      >
        <ProjectCrewAvatars people={crew} />
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginLeft: "auto" }}>
          {relativeTime(project.updated_at)}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  glyphButton: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  /* Clear of the tab bar's raised camera, which overhangs the bar by 22. */
  newProject: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.xl,
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
