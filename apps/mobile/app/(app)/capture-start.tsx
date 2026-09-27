import { useMemo, useState } from "react";
import { FolderPlus, MapPin } from "@/ui/icons";
import { FlatList, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  isProjectStatus,
  PROJECT_STATUS_LABELS,
  projectDisplayName,
  relativeTime,
} from "@everlumen/shared";
import { formatAddress, listProjects, type ProjectListItem } from "@/api/projects";
import { distanceLabel, nearestJobsFirst, ON_SITE_METRES } from "@/api/map-view";
import { useDeviceLocation } from "@/lib/use-device-location";
import { radius, spacing, useTheme } from "@/theme";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  SearchField,
  SkeletonList,
  Text,
  type BadgeTone,
} from "@/ui";

/**
 * Which job are these photos for?
 *
 * The camera button in the tab bar cannot open the viewfinder directly, because
 * a photo has to be filed against a project and a tab carries no argument. This
 * is that one question, asked once, with the job someone is standing on as
 * the first row: nearest first when the phone has a fix, and by `updated_at`
 * (last worked on) when it does not. A crew member on site should be able to
 * tap the top row without searching.
 *
 * `router.replace` rather than `push` on the way out. This screen has done its
 * job by then, and leaving it on the stack means backing out of the camera
 * lands on the picker again instead of where the person started.
 */
export default function CaptureStartScreen() {
  const theme = useTheme();
  const [search, setSearch] = useState("");
  const { here, noFix } = useDeviceLocation();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });

  const projects = useMemo(() => {
    const all = nearestJobsFirst(data ?? [], here);
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((project) => {
      const address = formatAddress(project) ?? "";
      return (
        projectDisplayName(project).toLowerCase().includes(needle) ||
        address.toLowerCase().includes(needle)
      );
    });
  }, [data, search, here]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ paddingTop: spacing.lg, gap: spacing.md }}>
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.xs }}>
          <Text variant="title">Where do these go?</Text>
          <Text variant="caption" tone="muted">
            Pick the job you are on. Photos upload in the background, so this works with no signal.
          </Text>
          {here ? (
            <Text variant="caption" tone="muted">
              Nearest jobs first.
            </Text>
          ) : noFix ? (
            <Text variant="caption" tone="muted">
              No location fix, so jobs are in the order they were last worked on.
            </Text>
          ) : null}
        </View>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Search projects"
          accessibilityLabel="Search projects"
        />
      </View>

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
          contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            search.trim() ? (
              <EmptyState
                title="No project matches"
                body="Check the spelling, or start a new project for this site."
                action={{
                  label: "New project",
                  icon: FolderPlus,
                  onPress: () => router.replace("/project-new"),
                }}
              />
            ) : (
              <EmptyState
                icon={FolderPlus}
                title="No projects yet"
                body="Photos are filed against a project, so there needs to be one first. It takes a name and nothing else."
                action={{
                  label: "New project",
                  icon: FolderPlus,
                  onPress: () => router.replace("/project-new"),
                }}
              />
            )
          }
          renderItem={({ item, index }) => (
            <PickerCard
              project={item}
              onSite={index === 0 && item.metres !== null && item.metres <= ON_SITE_METRES}
            />
          )}
          ListFooterComponent={
            projects.length ? (
              <Button
                label="New project instead"
                variant="ghost"
                icon={FolderPlus}
                fullWidth
                onPress={() => router.replace("/project-new")}
                style={{ marginTop: spacing.lg }}
              />
            ) : null
          }
        />
      )}
    </View>
  );
}

/**
 * Project status to pill colour, the same three buckets the Projects tab uses,
 * so a job reads the same colour here as it does on the list it came from.
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  active: "success",
  on_hold: "warning",
  completed: "neutral",
};

/**
 * One job, drawn as the warm card the Projects tab uses: name, a "City ·
 * distance" line, and the status pill.
 *
 * The distance sits in the subtitle rather than as a second pill so the card
 * keeps one badge. The job the phone is standing on says "You're here"
 * instead, in the success tone, because that row is the one a crew member on
 * site should be able to tap without reading.
 *
 * The full street address is deliberately not the subtitle any more: on a
 * picker the city is enough to tell two jobs apart, and the long line was what
 * pushed the status off the row on a narrow phone.
 */
function PickerCard({
  project,
  onSite,
}: {
  project: ProjectListItem & { metres: number | null };
  onSite: boolean;
}) {
  const theme = useTheme();
  const name = projectDisplayName(project);
  const place = project.city ?? formatAddress(project);
  const where = onSite
    ? "You're here"
    : project.metres === null
      ? null
      : distanceLabel(project.metres);
  const subtitle =
    [place, where].filter(Boolean).join(" · ") || `Updated ${relativeTime(project.updated_at)}`;
  const tone = isProjectStatus(project.status) ? STATUS_TONE[project.status] : "neutral";
  const label = isProjectStatus(project.status)
    ? PROJECT_STATUS_LABELS[project.status]
    : project.status;

  return (
    <Card
      onPress={() => router.replace(`/project/${project.id}/capture`)}
      accessibilityLabel={`${name}, ${subtitle}, ${label}. Opens the camera for this project`}
      style={{ marginBottom: spacing.sm }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.md,
            backgroundColor: onSite ? theme.colors.primary : theme.colors.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon
            icon={MapPin}
            size="md"
            color={onSite ? theme.colors.primaryForeground : theme.colors.accentForeground}
          />
        </View>
        {/* `minWidth: 0` so a long name truncates against the width it has. */}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {name}
          </Text>
          <Text variant="caption" tone={onSite ? "success" : "muted"} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <Badge label={label} tone={tone} />
      </View>
    </Card>
  );
}
