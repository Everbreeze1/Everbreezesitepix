import { useCallback, useMemo, useState } from "react";
import { Images } from "@/ui/icons";
import { Dimensions, FlatList, Modal, Pressable, RefreshControl, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import { useInfiniteQuery } from "@tanstack/react-query";
import { displayCaption, formatPhotoDateGroup } from "@everlumen/shared";
import { listGalleryPhotoPage, type GalleryPhotoItem } from "@/api/photos";
import { radius, spacing, useTheme } from "@/theme";
import {
  Button,
  ChipGroup,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchField,
  Skeleton,
  Text,
  type ChipOption,
} from "@/ui";

/**
 * Every photo in the workspace, newest first.
 *
 * The web app has had `/gallery` for as long as it has had photos, and it is
 * the screen someone opens when they remember the picture but not the job. The
 * field app had no equivalent: the only route to a photo was Projects, then the
 * right project, then scroll. That is the wrong order for "the cracked slab,
 * some time last week", which is how people actually search.
 *
 * Grouped by capture date rather than presented as one endless grid, because a
 * date is the thing a person can actually pin a memory to, and it is the same
 * grouping the project grid uses.
 */

type PhaseFilter = "all" | "before" | "after" | "untagged";

const FILTERS: ChipOption<PhaseFilter>[] = [
  { id: "all", label: "All" },
  { id: "before", label: "Before" },
  { id: "after", label: "After" },
  { id: "untagged", label: "Untagged" },
];

const COLUMNS = 3;
const GAP = spacing.xs;

export default function GalleryScreen() {
  const theme = useTheme();
  const [search, setSearch] = useState("");
  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["gallery-photos"],
    queryFn: ({ pageParam }) => listGalleryPhotoPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const photos = useMemo(
    () => query.data?.pages.flatMap((page) => page.photos) ?? [],
    [query.data],
  );

  const urls = useMemo(() => {
    const merged: Record<string, string> = {};
    for (const page of query.data?.pages ?? []) Object.assign(merged, page.urls);
    return merged;
  }, [query.data]);

  /*
   * Filtering happens over what has been loaded, not at the database.
   *
   * That is a deliberate limit and worth naming: a phase filter pushed into the
   * query would page correctly but would also re-fetch from scratch on every
   * chip tap, and on site data that is a visible stall for a filter people
   * flick between. Searching text server-side has the same problem plus a
   * missing index. So this filters the pages already in hand, and the empty
   * state says so when the filter empties the screen but more pages exist.
   */
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return photos.filter((photo) => {
      if (phase !== "all") {
        const value = photo.phase ?? "untagged";
        if (value !== phase) return false;
      }
      if (!needle) return true;
      return (
        (photo.caption ?? "").toLowerCase().includes(needle) ||
        (photo.project_name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [photos, phase, search]);

  const sections = useMemo(() => groupByDay(visible), [visible]);

  const lightboxPhoto = useMemo(
    () => visible.find((photo) => photo.id === lightboxId) ?? null,
    [visible, lightboxId],
  );

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  const tile = (Dimensions.get("window").width - spacing.lg * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <PageHeader title="Gallery" subtitle={photos.length ? `${photos.length} loaded` : undefined}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Search caption or project"
          accessibilityLabel="Search photos"
        />
        <ChipGroup options={FILTERS} value={phase} onChange={setPhase} label="Filter by phase" />
      </PageHeader>

      {query.isLoading ? (
        <GallerySkeleton tile={tile} />
      ) : query.error ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : "Failed to load photos"}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(section) => section.day}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: 120,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching && !query.isFetchingNextPage}
              onRefresh={() => void query.refetch()}
              tintColor={theme.colors.mutedForeground}
              colors={[theme.colors.primary]}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ListEmptyComponent={
            search.trim() || phase !== "all" ? (
              <EmptyState
                title="Nothing matches here"
                body={
                  query.hasNextPage
                    ? "Nothing in the photos loaded so far. Scroll to load more, or clear the filter."
                    : "Try a different search, or clear the filter."
                }
                action={{
                  label: "Clear filters",
                  onPress: () => {
                    setSearch("");
                    setPhase("all");
                  },
                }}
              />
            ) : (
              <EmptyState
                icon={Images}
                title="No photos yet"
                body="Photos from every project land here. Tap the camera to take the first one."
              />
            )
          }
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <View style={{ paddingVertical: spacing.xl }}>
                <Skeleton height={12} width="40%" />
              </View>
            ) : null
          }
          renderItem={({ item: section }) => (
            <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
              <Text variant="overline" tone="muted">
                {section.label.toUpperCase()}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
                {section.photos.map((photo) => (
                  <Pressable
                    key={photo.id}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={`${displayCaption(photo.caption, "Photo")}${
                      photo.project_name ? `, ${photo.project_name}` : ""
                    }`}
                    onPress={() => setLightboxId(photo.id)}
                    style={{ width: tile, height: tile }}
                  >
                    <Image
                      source={urls[photo.id] ? { uri: urls[photo.id] } : undefined}
                      style={{ width: "100%", height: "100%", borderRadius: radius.sm }}
                      contentFit="cover"
                      transition={120}
                    />
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        />
      )}

      <Modal
        visible={lightboxPhoto !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxId(null)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          onPress={() => setLightboxId(null)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.94)", justifyContent: "center" }}
        >
          {lightboxPhoto ? (
            <>
              <Image
                source={urls[lightboxPhoto.id] ? { uri: urls[lightboxPhoto.id] } : undefined}
                style={{ width: "100%", height: "70%" }}
                contentFit="contain"
              />
              <View
                style={{
                  position: "absolute",
                  bottom: 48,
                  left: spacing.xl,
                  right: spacing.xl,
                  gap: spacing.sm,
                }}
              >
                <Text variant="bodyStrong" style={{ color: "#fff" }} numberOfLines={2}>
                  {displayCaption(lightboxPhoto.caption, "Photo")}
                </Text>
                <Text variant="caption" style={{ color: "rgba(255,255,255,0.75)" }}>
                  {formatPhotoDateGroup(lightboxPhoto.taken_at ?? lightboxPhoto.created_at)}
                  {lightboxPhoto.phase ? ` · ${lightboxPhoto.phase}` : ""}
                </Text>
                {/*
                 * The project link is the point of a cross-project gallery. A
                 * photo you found here is usually the start of a job you now
                 * want to be inside, not the end of the search.
                 */}
                {lightboxPhoto.project_name ? (
                  <Button
                    label={`Open ${lightboxPhoto.project_name}`}
                    variant="secondary"
                    size="sm"
                    onPress={() => {
                      const projectId = lightboxPhoto.project_id;
                      setLightboxId(null);
                      router.push(`/project/${projectId}`);
                    }}
                  />
                ) : null}
              </View>
            </>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

type DaySection = { day: string; label: string; photos: GalleryPhotoItem[] };

/**
 * Buckets photos by the calendar day they were taken.
 *
 * Keyed on the ISO date rather than the rendered label, because two different
 * days can render the same string ("Yesterday" only ever means one, but a
 * locale that prints day and month alone collides across years).
 */
function groupByDay(photos: GalleryPhotoItem[]): DaySection[] {
  const sections: DaySection[] = [];
  let current: DaySection | null = null;

  for (const photo of photos) {
    const iso = photo.taken_at ?? photo.created_at;
    const day = iso.slice(0, 10);
    if (!current || current.day !== day) {
      current = { day, label: formatPhotoDateGroup(iso), photos: [] };
      sections.push(current);
    }
    current.photos.push(photo);
  }

  return sections;
}

function GallerySkeleton({ tile }: { tile: number }) {
  return (
    <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg, paddingTop: spacing.lg }}>
      {[0, 1].map((section) => (
        <View key={section} style={{ gap: spacing.sm }}>
          <Skeleton width="30%" height={11} />
          <View style={{ flexDirection: "row", gap: GAP }}>
            {Array.from({ length: COLUMNS }, (_, i) => (
              <Skeleton key={i} width={tile} height={tile} rounded={radius.sm} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
