import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { displayCaption, formatPhotoDateGroup } from "@everlumen/shared";
import { listProjectPhotos, signPhotoUrls, type PhotoListItem } from "@/api/photos";
import { formatAddress, getProject } from "@/api/projects";
import { QueueBanner } from "@/components/QueueBanner";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

type PhaseFilter = "all" | "before" | "after" | "untagged";

const FILTERS: { id: PhaseFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "before", label: "Before" },
  { id: "after", label: "After" },
  { id: "untagged", label: "Untagged" },
];

const COLUMNS = 3;
const GRID_GAP = spacing.xs;

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const [filter, setFilter] = useState<PhaseFilter>("all");
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const projectQuery = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id!),
    enabled: Boolean(id),
  });

  const photosQuery = useQuery({
    queryKey: ["project-photos", id],
    queryFn: () => listProjectPhotos(id!),
    enabled: Boolean(id),
  });

  const photos = useMemo(() => photosQuery.data ?? [], [photosQuery.data]);

  /*
   * Signed URLs are fetched for the whole page in one request rather than per
   * tile. Supabase signs in batch, and a grid of 60 tiles each signing its own
   * URL is 60 round trips on a connection that may only have one bar.
   */
  const urlsQuery = useQuery({
    queryKey: ["photo-urls", id, photos.map((p) => p.id).join(",")],
    queryFn: () => signPhotoUrls(photos),
    enabled: photos.length > 0,
    // Signed URLs last an hour; refetching sooner just burns requests.
    staleTime: 45 * 60 * 1000,
  });

  const urls = urlsQuery.data ?? {};

  const filtered = useMemo(() => {
    if (filter === "all") return photos;
    return photos.filter((photo) => (photo.phase ?? "untagged") === filter);
  }, [photos, filter]);

  /** Photos bucketed by capture day, newest day first. */
  const groups = useMemo(() => {
    const buckets = new Map<string, PhotoListItem[]>();
    for (const photo of filtered) {
      // `taken_at` is when the shutter fired; `created_at` is when it finished
      // uploading. A photo shot offline yesterday and synced today belongs to
      // yesterday.
      const when = photo.taken_at ?? photo.created_at;
      const label = formatPhotoDateGroup(when) || "Earlier";
      const bucket = buckets.get(label);
      if (bucket) bucket.push(photo);
      else buckets.set(label, [photo]);
    }
    return Array.from(buckets.entries());
  }, [filtered]);

  const project = projectQuery.data;
  const address = project ? formatAddress(project) : null;
  const loading = projectQuery.isLoading || photosQuery.isLoading;
  const error = projectQuery.error ?? photosQuery.error;

  const screenWidth = Dimensions.get("window").width;
  const tileSize = (screenWidth - spacing.lg * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

  const lightboxPhoto = filtered.find((photo) => photo.id === lightboxId) ?? null;

  return (
    <>
      <Stack.Screen options={{ title: project?.name ?? "Project" }} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <QueueBanner />
        {loading ? (
          <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={theme.colors.primary} />
        ) : error ? (
          <View style={styles.centered}>
            <Text style={[typography.body, { color: theme.colors.destructive }]}>
              {error instanceof Error ? error.message : "Failed to load project"}
            </Text>
            <Pressable
              style={[styles.primaryButton, { backgroundColor: theme.colors.primary }]}
              onPress={() => {
                void projectQuery.refetch();
                void photosQuery.refetch();
              }}
            >
              <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
                Retry
              </Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
            refreshControl={
              <RefreshControl
                refreshing={photosQuery.isRefetching}
                onRefresh={() => void photosQuery.refetch()}
                tintColor={theme.colors.primary}
              />
            }
          >
            <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
              {address ? (
                <Text style={[typography.body, { color: theme.colors.mutedForeground }]}>
                  {address}
                </Text>
              ) : null}
              <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
                {photos.length} photo{photos.length === 1 ? "" : "s"} · {project?.status}
              </Text>

              <Pressable
                onPress={() => router.push(`/project/${id}/tasks`)}
                style={[
                  styles.navRow,
                  { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                ]}
              >
                <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                  Tasks
                </Text>
                <Text style={[typography.body, { color: theme.colors.mutedForeground }]}>›</Text>
              </Pressable>

              <Pressable
                onPress={() => router.push(`/project/${id}/walkthroughs`)}
                style={[
                  styles.navRow,
                  { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                ]}
              >
                <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                  Walkthroughs
                </Text>
                <Text style={[typography.body, { color: theme.colors.mutedForeground }]}>›</Text>
              </Pressable>

              <Pressable
                onPress={() => router.push(`/project/${id}/workflows`)}
                style={[
                  styles.navRow,
                  { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                ]}
              >
                <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                  Workflows
                </Text>
                <Text style={[typography.body, { color: theme.colors.mutedForeground }]}>›</Text>
              </Pressable>

              <Pressable
                onPress={() => router.push(`/project/${id}/checklists`)}
                style={[
                  styles.navRow,
                  { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                ]}
              >
                <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                  Checklists
                </Text>
                <Text style={[typography.body, { color: theme.colors.mutedForeground }]}>›</Text>
              </Pressable>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm, marginBottom: spacing.lg }}
            >
              {FILTERS.map((option) => {
                const active = filter === option.id;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => setFilter(option.id)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: active ? theme.colors.primary : theme.colors.card,
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        typography.caption,
                        {
                          fontWeight: "600",
                          color: active
                            ? theme.colors.primaryForeground
                            : theme.colors.mutedForeground,
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {filtered.length === 0 ? (
              <Text
                style={[
                  typography.body,
                  {
                    color: theme.colors.mutedForeground,
                    textAlign: "center",
                    marginTop: spacing.xxl,
                  },
                ]}
              >
                {photos.length === 0
                  ? "No photos yet. Capture one from the field."
                  : "No photos in this phase."}
              </Text>
            ) : (
              groups.map(([label, items]) => (
                <View key={label} style={{ marginBottom: spacing.xl }}>
                  <Text
                    style={[
                      typography.overline,
                      { color: theme.colors.mutedForeground, marginBottom: spacing.sm },
                    ]}
                  >
                    {label.toUpperCase()}
                  </Text>
                  <View style={styles.grid}>
                    {items.map((photo) => (
                      <Pressable
                        key={photo.id}
                        onPress={() => setLightboxId(photo.id)}
                        style={{ width: tileSize, height: tileSize }}
                      >
                        <Image
                          source={urls[photo.id] ? { uri: urls[photo.id] } : undefined}
                          style={[styles.tile, { backgroundColor: theme.colors.muted }]}
                          contentFit="cover"
                          transition={120}
                        />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        )}

        <Pressable
          style={[styles.fab, { backgroundColor: theme.colors.primary }]}
          onPress={() => router.push(`/project/${id}/capture`)}
        >
          <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
            Capture
          </Text>
        </Pressable>
      </View>

      <Modal
        visible={Boolean(lightboxPhoto)}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxId(null)}
      >
        <Pressable style={styles.lightbox} onPress={() => setLightboxId(null)}>
          {lightboxPhoto ? (
            <>
              <Image
                source={urls[lightboxPhoto.id] ? { uri: urls[lightboxPhoto.id] } : undefined}
                style={styles.lightboxImage}
                contentFit="contain"
              />
              <View style={styles.lightboxMeta}>
                <Text style={[typography.bodyStrong, { color: "#fff" }]} numberOfLines={2}>
                  {displayCaption(lightboxPhoto.caption, "Photo")}
                </Text>
                <Text style={[typography.caption, { color: "rgba(255,255,255,0.75)" }]}>
                  {formatPhotoDateGroup(lightboxPhoto.taken_at ?? lightboxPhoto.created_at)}
                  {lightboxPhoto.phase ? ` · ${lightboxPhoto.phase}` : ""}
                </Text>
              </View>
            </>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  tile: { width: "100%", height: "100%", borderRadius: radius.sm },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    minHeight: HIT_TARGET,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  primaryButton: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: HIT_TARGET,
    justifyContent: "center",
  },
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.xl,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    minHeight: HIT_TARGET,
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  lightbox: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", justifyContent: "center" },
  lightboxImage: { width: "100%", height: "78%" },
  lightboxMeta: { position: "absolute", bottom: 56, left: spacing.xl, right: spacing.xl, gap: 4 },
});
