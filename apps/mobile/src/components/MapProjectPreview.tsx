import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { projectDisplayName } from "@everlumen/shared";
import { listProjectPhotoStats } from "@/api/dashboard";
import { photoCountLabel } from "@/api/dashboard-view";
import { listProjectCovers } from "@/api/photos";
import { formatAddress, type ProjectListItem } from "@/api/projects";
import { ProjectStatusPill } from "@/components/ProjectStatusPill";
import { elevation, radius, spacing, useTheme } from "@/theme";
import { MapPin, X } from "@/ui/icons";
import { Button, Icon, IconButton, PhotoThumb, Skeleton, Text } from "@/ui";

/**
 * The card a tapped pin opens, the web map's preview.
 *
 * Tapping a pin used to show the platform callout (a name on a white bubble)
 * and the only way on was a second tap on that bubble. The web map replaced its
 * equivalent with a card for the same reason: which job this is gets answered
 * by its newest photo, its status and how much work is filed against it, not by
 * its name alone.
 *
 * The stats are read for this one job when it is tapped, not for every pin up
 * front: one count request and one cover, whatever size the board is.
 */
export function MapProjectPreview({
  project,
  onClose,
}: {
  project: ProjectListItem;
  onClose: () => void;
}) {
  const theme = useTheme();

  const preview = useQuery({
    queryKey: ["map-project-preview", project.id],
    queryFn: async () => {
      const [stats, covers] = await Promise.all([
        listProjectPhotoStats([project.id]),
        listProjectCovers([project.id]),
      ]);
      return { stats: stats[project.id] ?? null, cover: covers[project.id] ?? null };
    },
    staleTime: 60_000,
  });

  const name = projectDisplayName(project);
  const address = formatAddress(project);
  const stats = preview.data?.stats ?? null;
  const last = stats?.lastPhotoAt
    ? `Last photo ${new Date(stats.lastPhotoAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`
    : "No activity yet";

  return (
    <View
      accessibilityLabel={`${name} preview`}
      style={{
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        ...elevation.sheet,
      }}
    >
      {/*
        The web card's layout: the job's newest photo across the top, then the
        name, its status and photo count, where it is, and one way in.
      */}
      <View>
        {preview.isLoading ? (
          <Skeleton width="100%" height={128} rounded={radius.lg} />
        ) : (
          <PhotoThumb
            uri={preview.data?.cover ?? undefined}
            width="100%"
            height={128}
            rounded={radius.lg}
          />
        )}
        <View style={{ position: "absolute", top: spacing.xs, right: spacing.xs }}>
          <IconButton icon={X} accessibilityLabel="Close preview" size="sm" onPress={onClose} />
        </View>
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {name}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <ProjectStatusPill status={project.status} />
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {[
              project.archived ? "Archived" : null,
              stats ? photoCountLabel(stats.photoCount) : preview.isLoading ? "Counting" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
      </View>

      {address ? (
        <View style={{ flexDirection: "row", gap: spacing.xs, alignItems: "flex-start" }}>
          <Icon icon={MapPin} size="sm" tone="muted" />
          <Text variant="caption" tone="muted" numberOfLines={2} style={{ flex: 1 }}>
            {address}
          </Text>
        </View>
      ) : null}
      {preview.isLoading ? null : (
        <Text variant="caption" tone="muted">
          {last}
        </Text>
      )}

      <Button
        label="Open project"
        fullWidth
        onPress={() => router.push({ pathname: "/project/[id]", params: { id: project.id } })}
      />
    </View>
  );
}
