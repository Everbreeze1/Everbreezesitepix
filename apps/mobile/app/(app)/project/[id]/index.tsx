import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { displayCaption, formatPhotoDateGroup } from "@everlumen/shared";
import { listProjectPhotoPage, PHOTO_PAGE_SIZE, type PhotoListItem } from "@/api/photos";
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

/** One rendered row of the grid. Sections hold rows, not photos. */
type PhotoRow = { key: string; photos: PhotoListItem[] };

function chunk(photos: PhotoListItem[], size: number): PhotoRow[] {
  const rows: PhotoRow[] = [];
  for (let i = 0; i < photos.length; i += size) {
    const slice = photos.slice(i, i + size);
    rows.push({ key: slice[0].id, photos: slice });
  }
  return rows;
}

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

  /*
   * Photos arrive a page at a time and each page carries its own signed URLs.
   * A busy project runs to hundreds of photos, and the previous version read
   * the first 60 and stopped: everything older was simply unreachable from the
   * phone.
   */
  const photosQuery = useInfiniteQuery({
    queryKey: ["project-photos", id],
    queryFn: ({ pageParam }) => listProjectPhotoPage(id!, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(id),
  });

  const photos = useMemo(
    () => photosQuery.data?.pages.flatMap((page) => page.photos) ?? [],
    [photosQuery.data],
  );

  const urls = useMemo(() => {
    const merged: Record<string, string> = {};
    for (const page of photosQuery.data?.pages ?? []) Object.assign(merged, page.urls);
    return merged;
  }, [photosQuery.data]);

  const filtered = useMemo(() => {
    if (filter === "all") return photos;
    return photos.filter((photo) => (photo.phase ?? "untagged") === filter);
  }, [photos, filter]);

  /** Photos bucketed by capture day, newest day first, each day chunked into rows. */
  const sections = useMemo(() => {
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
    return Array.from(buckets.entries()).map(([title, items]) => ({
      title,
      data: chunk(items, COLUMNS),
    }));
  }, [filtered]);

  const project = projectQuery.data;
  const address = project ? formatAddress(project) : null;
  const loading = projectQuery.isLoading || photosQuery.isLoading;
  const error = projectQuery.error ?? photosQuery.error;

  const screenWidth = Dimensions.get("window").width;
  const tileSize = (screenWidth - spacing.lg * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

  const lightboxPhoto = filtered.find((photo) => photo.id === lightboxId) ?? null;

  const loadMore = useCallback(() => {
    /*
     * A filter hides rows without changing what has been fetched, so a filtered
     * view can run out of visible photos long before the project does. Fetching
     * on until the filter finds something keeps "Before" from looking empty on a
     * project whose before-shots are all older than the first page.
     */
    if (photosQuery.hasNextPage && !photosQuery.isFetchingNextPage) {
      void photosQuery.fetchNextPage();
    }
  }, [photosQuery]);

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
              accessibilityRole="button"
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
          <SectionList
            sections={sections}
            keyExtractor={(row) => row.key}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
            onEndReached={loadMore}
            onEndReachedThreshold={0.6}
            // The grid is fixed-height rows, so windowing can be tighter than
            // the default without blank space appearing during a fast scroll.
            initialNumToRender={Math.ceil(PHOTO_PAGE_SIZE / COLUMNS)}
            windowSize={7}
            removeClippedSubviews
            refreshControl={
              <RefreshControl
                refreshing={photosQuery.isRefetching && !photosQuery.isFetchingNextPage}
                onRefresh={() => void photosQuery.refetch()}
                tintColor={theme.colors.primary}
              />
            }
            ListHeaderComponent={
              <View>
                <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
                  {address ? (
                    <Text style={[typography.body, { color: theme.colors.mutedForeground }]}>
                      {address}
                    </Text>
                  ) : null}
                  <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
                    {photos.length}
                    {photosQuery.hasNextPage ? "+" : ""} photo{photos.length === 1 ? "" : "s"} ·{" "}
                    {project?.status}
                  </Text>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push(`/project/${id}/walkthroughs`)}
                    style={[
                      styles.navRow,
                      { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                    ]}
                  >
                    <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                      Walkthroughs
                    </Text>
                    <Text style={[typography.body, { color: theme.colors.mutedForeground }]}>
                      ›
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push(`/project/${id}/workflows`)}
                    style={[
                      styles.navRow,
                      { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                    ]}
                  >
                    <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                      Workflows
                    </Text>
                    <Text style={[typography.body, { color: theme.colors.mutedForeground }]}>
                      ›
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push(`/project/${id}/tasks`)}
                    style={[
                      styles.navRow,
                      { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                    ]}
                  >
                    <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                      Tasks
                    </Text>
                    <Text style={[typography.body, { color: theme.colors.mutedForeground }]}>
                      ›
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push(`/project/${id}/checklists`)}
                    style={[
                      styles.navRow,
                      { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                    ]}
                  >
                    <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                      Checklists
                    </Text>
                    <Text style={[typography.body, { color: theme.colors.mutedForeground }]}>
                      ›
                    </Text>
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
                        accessibilityRole="button"
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
              </View>
            }
            ListEmptyComponent={
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
            }
            ListFooterComponent={
              photosQuery.isFetchingNextPage ? (
                <ActivityIndicator
                  style={{ marginVertical: spacing.lg }}
                  color={theme.colors.primary}
                />
              ) : null
            }
            renderSectionHeader={({ section }) => (
              <Text
                style={[
                  typography.overline,
                  {
                    color: theme.colors.mutedForeground,
                    marginBottom: spacing.sm,
                    marginTop: spacing.md,
                  },
                ]}
              >
                {section.title.toUpperCase()}
              </Text>
            )}
            renderItem={({ item }) => (
              <View style={[styles.gridRow, { marginBottom: GRID_GAP }]}>
                {item.photos.map((photo) => (
                  <Pressable
                    accessibilityRole="button"
                    key={photo.id}
                    onPress={() => setLightboxId(photo.id)}
                    accessibilityLabel={displayCaption(photo.caption, "Photo")}
                    accessibilityHint="Opens the photo full screen"
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
            )}
          />
        )}

        <Pressable
          accessibilityRole="button"
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
        <Pressable
          accessibilityRole="button"
          style={styles.lightbox}
          onPress={() => setLightboxId(null)}
        >
          {lightboxPhoto ? (
            <>
              <Image
                source={urls[lightboxPhoto.id] ? { uri: urls[lightboxPhoto.id] } : undefined}
                style={styles.lightboxImage}
                contentFit="contain"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Annotate this photo"
                onPress={() => {
                  const photo = lightboxPhoto;
                  setLightboxId(null);
                  router.push({
                    pathname: "/photo/[id]/annotate",
                    params: {
                      id: photo.id,
                      uri: urls[photo.id] ?? "",
                      projectId: String(id),
                      caption: photo.caption ?? "",
                      phase: photo.phase ?? "untagged",
                    },
                  });
                }}
                style={styles.annotateButton}
              >
                <Text style={[typography.bodyStrong, { color: "#fff" }]}>Annotate</Text>
              </Pressable>

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
  gridRow: { flexDirection: "row", gap: GRID_GAP },
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
  annotateButton: {
    position: "absolute",
    top: 56,
    right: spacing.xl,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: HIT_TARGET,
    justifyContent: "center",
  },
  lightboxMeta: { position: "absolute", bottom: 56, left: spacing.xl, right: spacing.xl, gap: 4 },
});
