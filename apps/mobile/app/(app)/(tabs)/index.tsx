import { useMemo, useState } from "react";
import { FolderPlus, MapPin, Plus } from "@/ui/icons";
import { FlatList, RefreshControl, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  isProjectStatus,
  PROJECT_STATUS_LABELS,
  projectDisplayName,
  relativeTime,
} from "@everlumen/shared";
import { formatAddress, listProjects, type ProjectListItem } from "@/api/projects";
import { QueueBanner } from "@/components/QueueBanner";
import { spacing, useTheme } from "@/theme";
import {
  Badge,
  Card,
  ChipGroup,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  PageHeader,
  SearchField,
  SkeletonList,
  Text,
  type BadgeTone,
  type ChipOption,
} from "@/ui";

type StatusFilter = "all" | "active" | "on_hold" | "completed";

/**
 * Status to badge colour.
 *
 * Taken from the same three buckets `PROJECT_STATUSES` defines rather than a
 * mobile-only list, so a status added in one place cannot quietly render as
 * "unknown" here.
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  active: "success",
  on_hold: "warning",
  completed: "neutral",
};

export default function ProjectsScreen() {
  const theme = useTheme();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });

  const all = useMemo(() => data ?? [], [data]);

  /*
   * Counts come off the unfiltered list, so a chip reading "On hold 3" keeps
   * saying 3 while you are looking at the active ones. Counting the filtered
   * list instead gives every unselected chip a zero, which reads as "there are
   * none" rather than "you are not looking at them".
   */
  const counts = useMemo(() => {
    const out: Record<string, number> = { all: all.length };
    for (const project of all) out[project.status] = (out[project.status] ?? 0) + 1;
    return out;
  }, [all]);

  const projects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((project) => {
      if (status !== "all" && project.status !== status) return false;
      if (!needle) return true;
      const address = formatAddress(project) ?? "";
      return (
        projectDisplayName(project).toLowerCase().includes(needle) ||
        address.toLowerCase().includes(needle)
      );
    });
  }, [all, search, status]);

  const filters: ChipOption<StatusFilter>[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "active", label: PROJECT_STATUS_LABELS.active, count: counts.active ?? 0 },
    { id: "on_hold", label: PROJECT_STATUS_LABELS.on_hold, count: counts.on_hold ?? 0 },
    { id: "completed", label: PROJECT_STATUS_LABELS.completed, count: counts.completed ?? 0 },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <PageHeader
        title="Projects"
        subtitle={all.length ? `${all.length} ${all.length === 1 ? "job" : "jobs"}` : undefined}
        actions={
          <IconButton
            icon={Plus}
            accessibilityLabel="New project"
            onPress={() => router.push("/project-new")}
          />
        }
      >
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Search name or address"
          accessibilityLabel="Search projects"
        />
        <ChipGroup options={filters} value={status} onChange={setStatus} label="Filter by status" />
      </PageHeader>

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
            gap: spacing.md,
            // Clears the raised camera button, which overhangs the bar by 22.
            paddingBottom: 120,
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
          renderItem={({ item }) => <ProjectCard project={item} />}
        />
      )}
    </View>
  );
}

function ProjectCard({ project }: { project: ProjectListItem }) {
  const address = formatAddress(project);
  const tone = isProjectStatus(project.status) ? STATUS_TONE[project.status] : "neutral";
  const label = isProjectStatus(project.status)
    ? PROJECT_STATUS_LABELS[project.status]
    : project.status;

  return (
    <Card
      onPress={() => router.push(`/project/${project.id}`)}
      accessibilityLabel={`${projectDisplayName(project)}${address ? `, ${address}` : ""}, ${label}`}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        {/*
          `minWidth: 0` and two lines, for the reason `ListRow` needed the same:
          a flex child defaults to its content width as its minimum, so a long
          name is measured against the width it wanted rather than the width it
          has, and `numberOfLines={1}` then cuts far too early. Seen on device
          as "20 Charlcote Crescent - ..." with most of the card still empty.
        */}
        <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
          <Text variant="heading" numberOfLines={2}>
            {projectDisplayName(project)}
          </Text>
          {address ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              <Icon icon={MapPin} size="xs" tone="muted" />
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                {address}
              </Text>
            </View>
          ) : null}
        </View>
        <Badge label={label} tone={tone} />
      </View>

      <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
        {`Updated ${relativeTime(project.updated_at)}`}
      </Text>
    </Card>
  );
}
