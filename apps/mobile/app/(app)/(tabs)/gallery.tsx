import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Images, Search, SlidersHorizontal } from "@/ui/icons";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { displayCaption, formatPhotoDateGroup } from "@everlumen/shared";
import { listGalleryPhotoPage, type GalleryPage, type GalleryPhotoItem } from "@/api/photos";
import {
  activeFilterCount,
  dateRangeLabel,
  EMPTY_GALLERY_FILTERS,
  parseCalendarDay,
  type GalleryFilters,
} from "@/api/gallery-filters";
import { GalleryFilterSheet } from "@/components/GalleryFilterSheet";
import { PhotoViewer, ThumbTagBadge, TileCaption } from "@/components/photo-viewer";
import { mergeTags, phasePatch, trashPhotos, type PhotoPatch } from "@/api/photo-edit";
import { generateSummaryFromPhotos } from "@/api/summaries";
import { photoSelectionError } from "@/api/summary-view";
import { PhotoBulkBar, type PhotoBulkAction } from "@/components/PhotoBulkBar";
import { GalleryFilterPills } from "@/components/GalleryFilterPills";
import { photoPatchRowId, type PhotoPatchPayload } from "@/offline/handlers";
import { enqueue } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import { gridColumns, HIT_TARGET, radius, spacing, useLayout, useTheme } from "@/theme";
import {
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  PageHeader,
  PhotoThumb,
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

/*
 * One row of pills, one choice at a time, as the design draws it.
 *
 * "By project" regroups rather than filters: the same photos, sectioned under
 * their job instead of their day. "This week" and the three phases narrow the
 * set. The design also shows a "Flagged" pill, which is left out on purpose:
 * `photos` has no flag or star column, so the pill would have nothing to read
 * and would always come up empty.
 */
type LibraryFilter = "all" | "project" | "week" | "before" | "after" | "untagged";

const FILTERS: ChipOption<LibraryFilter>[] = [
  { id: "all", label: "All photos" },
  { id: "project", label: "By project" },
  { id: "week", label: "This week" },
  { id: "before", label: "Before" },
  { id: "after", label: "After" },
  { id: "untagged", label: "Untagged" },
];

const GAP = spacing.sm;

/*
 * A smaller target than the app-wide default, so a phone draws the design's
 * four columns. `gridColumns` still floors at three, so a narrow phone keeps
 * the tiles it always had, and a tablet still grows toward eight.
 */
const LIBRARY_TILE = 80;

export default function GalleryScreen() {
  // Live width: a value read once never updates when an iPad rotates.
  const { width, safeSide } = useLayout();
  // The grid's gutter, plus the notch of a phone held on its side (zero upright).
  const side = spacing.lg + safeSide;
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  /*
   * Select mode is its own flag here, unlike the project grid where the first
   * long press is the only way in. The design gives the library a "Select"
   * button, and a mode entered by a button has to be able to exist with
   * nothing picked yet. The Set holds the picks, so a photo scrolled far out
   * of view cannot drop out when the list recycles its rows.
   */
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  /*
   * The web gallery's refinements (projects, dates, tags, taken by, needs
   * review), applied at the database and edited in a sheet. Part of the query
   * key, so each combination pages on its own and flicking back to "no
   * filters" lands on the cache rather than a refetch.
   */
  const [refine, setRefine] = useState<GalleryFilters>(EMPTY_GALLERY_FILTERS);
  const [filterSheet, setFilterSheet] = useState(false);
  const refineCount = activeFilterCount(refine);

  /*
   * Deep links into a filtered library: the timeline opens a day, the home
   * screen's Needs review tile opens the untagged photos. `nonce` changes on
   * every push, so opening the same day twice still applies it even after the
   * filter was cleared in between.
   */
  const params = useLocalSearchParams<{
    from?: string;
    to?: string;
    review?: string;
    projectId?: string;
    nonce?: string;
  }>();
  useEffect(() => {
    if (!params.nonce) return;
    const from = parseCalendarDay(params.from) ? params.from! : null;
    const to = parseCalendarDay(params.to) ? params.to! : null;
    setRefine({
      ...EMPTY_GALLERY_FILTERS,
      from,
      to,
      needsReview: params.review === "1",
      projectIds: params.projectId ? [params.projectId] : [],
    });
    setFilter("all");
    setSearch("");
    setLightboxId(null);
  }, [params.nonce, params.from, params.to, params.review, params.projectId]);

  const queryKey = useMemo(() => ["gallery-photos", refine] as const, [refine]);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => listGalleryPhotoPage(pageParam, undefined, refine),
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
    const weekStart = startOfWeek(new Date()).getTime();
    return photos.filter((photo) => {
      if (filter === "before" || filter === "after" || filter === "untagged") {
        const value = photo.phase ?? "untagged";
        if (value !== filter) return false;
      }
      if (filter === "week") {
        const at = new Date(photo.taken_at ?? photo.created_at).getTime();
        if (!(at >= weekStart)) return false;
      }
      if (!needle) return true;
      return (
        (photo.caption ?? "").toLowerCase().includes(needle) ||
        (photo.project_name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [photos, filter, search]);

  const sections = useMemo(
    () => (filter === "project" ? groupByProject(visible) : groupByDay(visible)),
    [visible, filter],
  );

  const filtered =
    search.trim() !== "" || (filter !== "all" && filter !== "project") || refineCount > 0;

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  /*
   * Columns and tile size from the LIVE width.
   *
   * Was a hardcoded 3 and a one-off `Dimensions.get("window")`. Both are wrong
   * on a tablet: three tiles at 1024pt are over 300pt each, a contact sheet
   * showing nine photos where it could show twenty-five, and a width read once
   * never updates when an iPad rotates or is put into split screen.
   */
  const columns = gridColumns(width - side * 2, LIBRARY_TILE);
  const tile = (width - side * 2 - GAP * (columns - 1)) / columns;

  const toggle = useCallback((photoId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  const endSelection = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
    setBulkError(null);
  }, []);

  const selecting = selectMode || selected.size > 0;

  /**
   * Apply a bulk action to the selection.
   *
   * The same writes the project grid makes, through the same outbox, with one
   * difference that matters: a library selection can span jobs. So the queued
   * rows are split per project (the outbox row carries one), and every job the
   * selection touched has its grid invalidated, not just one.
   *
   * The write-up is the exception that cannot span jobs - the service files it
   * under one project - so it refuses a mixed selection rather than guessing
   * which job the result belongs to.
   */
  const applyBulk = useCallback(
    async (action: PhotoBulkAction) => {
      const picked = photos.filter((photo) => selected.has(photo.id));
      if (picked.length === 0) return;
      const projectIds = Array.from(new Set(picked.map((photo) => photo.project_id)));

      if (action.kind === "summarise") {
        const refusal = photoSelectionError(picked.length);
        if (refusal) {
          setBulkError(refusal);
          return;
        }
        if (projectIds.length !== 1) {
          setBulkError("A write-up belongs to one job. Pick photos from a single project.");
          return;
        }
        setBusy(true);
        try {
          const { summaryId } = await generateSummaryFromPhotos({
            projectId: projectIds[0]!,
            photoIds: picked.map((photo) => photo.id),
            idempotencyKey: randomUUID(),
          });
          endSelection();
          if (summaryId) {
            router.push({ pathname: "/summary/[summaryId]", params: { summaryId } });
          }
        } catch (error) {
          setBulkError(error instanceof Error ? error.message : "Could not write those photos up.");
        } finally {
          setBusy(false);
        }
        return;
      }

      setBusy(true);

      const basePatch: PhotoPatch =
        action.kind === "phase"
          ? phasePatch(action.phase)
          : action.kind === "trash"
            ? trashPhotos()
            : action.kind === "move"
              ? { project_id: action.projectId }
              : {};

      // Tags merge per photo, so each photo is its own write.
      const writes: { ids: string[]; projectId: string; patch: PhotoPatch }[] =
        action.kind === "tags"
          ? picked.map((photo) => ({
              ids: [photo.id],
              projectId: photo.project_id,
              patch: { tags: mergeTags(photo.tags, action.tags) },
            }))
          : projectIds.map((projectId) => ({
              ids: picked.filter((photo) => photo.project_id === projectId).map((p) => p.id),
              projectId,
              patch: basePatch,
            }));

      queryClient.setQueryData<{ pages: GalleryPage[]; pageParams: unknown[] }>(
        queryKey,
        (current) => {
          if (!current) return current;
          return {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              photos:
                action.kind === "trash"
                  ? page.photos.filter((photo) => !selected.has(photo.id))
                  : page.photos.map((photo) => {
                      if (!selected.has(photo.id)) return photo;
                      const patch =
                        writes.find((w) => w.ids.length === 1 && w.ids[0] === photo.id)?.patch ??
                        basePatch;
                      // A moved photo's job name is unknown until the refetch,
                      // and the old one would now be wrong.
                      return action.kind === "move"
                        ? { ...photo, ...patch, project_name: null }
                        : { ...photo, ...patch };
                    }),
            })),
          };
        },
      );

      const touched = action.kind === "move" ? [...projectIds, action.projectId] : projectIds;
      const invalidate: unknown[][] = [
        ["gallery-photos"],
        ...Array.from(new Set(touched)).map((projectId) => ["project-photos", projectId]),
      ];

      for (const write of writes) {
        const payload: PhotoPatchPayload & { invalidate: unknown[][] } = {
          photoIds: write.ids,
          patch: write.patch,
          invalidate,
        };
        await enqueue({
          id: photoPatchRowId(action.kind, write.ids),
          kind: "photo_patch",
          projectId: write.projectId,
          payload,
        });
      }

      await refreshQueue();
      requestSync();
      endSelection();
      setBusy(false);
    },
    [photos, selected, queryClient, endSelection, queryKey],
  );

  const showSearch = searchOpen || search.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/*
        The hairline under the pills is the design's; the band itself stays the
        canvas colour because PageHeader paints its own background.
      */}
      <View
        style={{
          backgroundColor: theme.colors.background,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          paddingBottom: spacing.sm,
        }}
      >
        <PageHeader
          title={selecting && selected.size > 0 ? `${selected.size} selected` : "Photo Library"}
          actions={
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              {selecting ? null : (
                <IconButton
                  icon={SlidersHorizontal}
                  accessibilityLabel={
                    refineCount > 0 ? `Filters, ${refineCount} on` : "Filter by project, date, tag"
                  }
                  surface={false}
                  tone={refineCount > 0 ? "primary" : "default"}
                  onPress={() => setFilterSheet(true)}
                />
              )}
              {selecting ? null : (
                <IconButton
                  icon={Search}
                  accessibilityLabel={showSearch ? "Hide search" : "Search photos"}
                  surface={false}
                  onPress={() => {
                    if (showSearch) setSearch("");
                    setSearchOpen(!showSearch);
                  }}
                />
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={selecting ? "Done selecting" : "Select photos"}
                onPress={() => (selecting ? endSelection() : setSelectMode(true))}
                hitSlop={8}
                style={({ pressed }) => ({
                  minHeight: HIT_TARGET,
                  justifyContent: "center",
                  paddingHorizontal: spacing.xs,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text variant="bodyStrong" tone="primary">
                  {selecting ? "Done" : "Select"}
                </Text>
              </Pressable>
            </View>
          }
        >
          {showSearch ? (
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search caption or project"
              accessibilityLabel="Search photos"
            />
          ) : null}
          <GalleryFilterPills
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            label="Filter photos"
          />
          {refineCount > 0 ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingHorizontal: spacing.lg,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit filters"
                onPress={() => setFilterSheet(true)}
                style={{ flex: 1, minHeight: 32, justifyContent: "center" }}
              >
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {refineSummary(refine)}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear all filters"
                onPress={() => setRefine(EMPTY_GALLERY_FILTERS)}
                hitSlop={8}
              >
                <Text variant="caption" tone="primary" style={{ fontWeight: "600" }}>
                  Clear all
                </Text>
              </Pressable>
            </View>
          ) : null}
        </PageHeader>
      </View>

      {query.isLoading ? (
        <GallerySkeleton tile={tile} columns={columns} side={side} />
      ) : query.error ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : "Failed to load photos"}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(section) => section.key}
          contentContainerStyle={{
            paddingHorizontal: side,
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
          /*
           * Windowing, which this list had none of.
           *
           * It is the largest list in the app: every photo across every project,
           * grouped by day, and it paginates without a ceiling. The project
           * grid next door already carries these props; this one was missed,
           * and it is the one that grows fastest.
           *
           * Each row is a whole day of photos, so the counts are lower than a
           * flat list would want: rendering four days ahead is already a
           * screenful of images being decoded.
           */
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={5}
          removeClippedSubviews
          ListEmptyComponent={
            filtered ? (
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
                    setFilter("all");
                    setRefine(EMPTY_GALLERY_FILTERS);
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
            <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
              <Text variant="overline" tone="muted" style={{ fontSize: 13, letterSpacing: 1 }}>
                {section.label.toUpperCase()}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
                {section.photos.map((photo) => {
                  const picked = selected.has(photo.id);
                  return (
                    <Pressable
                      key={photo.id}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`${displayCaption(photo.caption, "Photo")}${
                        photo.project_name ? `, ${photo.project_name}` : ""
                      }`}
                      accessibilityHint={
                        selecting
                          ? "Adds or removes this photo from the selection"
                          : "Opens the photo full screen"
                      }
                      accessibilityState={{ selected: picked }}
                      /*
                       * Long press starts a selection as well as the Select
                       * button, the platform convention for a photo grid and
                       * the same gesture the project grid uses.
                       */
                      onLongPress={() => {
                        setSelectMode(true);
                        toggle(photo.id);
                      }}
                      onPress={() => (selecting ? toggle(photo.id) : setLightboxId(photo.id))}
                      style={{ width: tile }}
                    >
                      <View style={{ width: tile, height: tile }}>
                        <PhotoThumb
                          uri={urls[photo.id]}
                          width="100%"
                          height="100%"
                          rounded={radius.md}
                        />
                        {/* The photo's tags on the photo, as the web grid shows them. */}
                        {tile >= 72 ? <ThumbTagBadge tags={photo.tags} /> : null}
                        {picked ? (
                          <View
                            pointerEvents="none"
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              borderRadius: radius.md,
                              borderWidth: 3,
                              borderColor: theme.colors.primary,
                              alignItems: "flex-end",
                              padding: spacing.xs,
                            }}
                          >
                            <View
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: radius.pill,
                                backgroundColor: theme.colors.primary,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Icon icon={Check} size="sm" tone="inverse" />
                            </View>
                          </View>
                        ) : null}
                      </View>
                      {/* The photo's note, as a caption under it, as on the project grid. */}
                      <TileCaption caption={photo.caption} tileWidth={tile} />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        />
      )}

      {selecting && bulkError ? (
        <View style={{ paddingHorizontal: side, paddingBottom: spacing.xs }}>
          <Text variant="caption" tone="destructive">
            {bulkError}
          </Text>
        </View>
      ) : null}

      {selected.size > 0 ? (
        <PhotoBulkBar
          count={selected.size}
          busy={busy}
          currentProjectId={
            new Set(photos.filter((p) => selected.has(p.id)).map((p) => p.project_id)).size === 1
              ? photos.find((p) => selected.has(p.id))?.project_id
              : undefined
          }
          onCancel={endSelection}
          onAction={(action) => void applyBulk(action)}
        />
      ) : null}

      <GalleryFilterSheet
        visible={filterSheet}
        value={refine}
        onClose={() => setFilterSheet(false)}
        onApply={setRefine}
      />

      {/*
        The shared photo viewer, the same one the project grid opens: the web
        lightbox and its details panel. "Open project" is in its header, since a
        photo found in the library is usually the start of a job you now want
        to be inside.
      */}
      <PhotoViewer
        photos={visible}
        urls={urls}
        photoId={lightboxId}
        onChangePhoto={setLightboxId}
        onClose={() => setLightboxId(null)}
        onEndReached={loadMore}
      />
    </View>
  );
}

type Section = { key: string; label: string; photos: GalleryPhotoItem[] };

/**
 * Buckets photos by the calendar day they were taken.
 *
 * Keyed on the ISO date rather than the rendered label, because two different
 * days can render the same string ("Yesterday" only ever means one, but a
 * locale that prints day and month alone collides across years).
 */
function groupByDay(photos: GalleryPhotoItem[]): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const photo of photos) {
    const iso = photo.taken_at ?? photo.created_at;
    const day = iso.slice(0, 10);
    if (!current || current.key !== day) {
      current = { key: day, label: formatPhotoDateGroup(iso), photos: [] };
      sections.push(current);
    }
    current.photos.push(photo);
  }

  return sections;
}

/**
 * Buckets photos by the job they belong to, for "By project".
 *
 * Ordered by each job's newest photo, which is the order the pages arrived in,
 * so the job somebody was on most recently is still at the top. Keyed on the
 * project id: two jobs can share a name, and merging them would show one
 * section with somebody else's photos in it.
 */
function groupByProject(photos: GalleryPhotoItem[]): Section[] {
  const byProject = new Map<string, Section>();
  for (const photo of photos) {
    let section = byProject.get(photo.project_id);
    if (!section) {
      section = {
        key: `project:${photo.project_id}`,
        label: photo.project_name ?? "Untitled project",
        photos: [],
      };
      byProject.set(photo.project_id, section);
    }
    section.photos.push(photo);
  }
  return Array.from(byProject.values());
}

/** One line naming what the filter sheet has narrowed the library to. */
function refineSummary(refine: GalleryFilters): string {
  const parts: string[] = [];
  if (refine.from || refine.to) parts.push(dateRangeLabel(refine.from, refine.to));
  if (refine.needsReview) parts.push("needs review");
  if (refine.projectIds.length > 0) {
    parts.push(`${refine.projectIds.length} project${refine.projectIds.length === 1 ? "" : "s"}`);
  }
  if (refine.tags.length > 0) {
    parts.push(refine.tags.length === 1 ? `tag ${refine.tags[0]}` : `${refine.tags.length} tags`);
  }
  if (refine.uploaders.length > 0) {
    parts.push(`${refine.uploaders.length} ${refine.uploaders.length === 1 ? "person" : "people"}`);
  }
  return `Filtered: ${parts.join(", ")}`;
}

/** Local midnight on the Monday of this week, for "This week". */
function startOfWeek(now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - sinceMonday);
  return start;
}

function GallerySkeleton({ tile, columns, side }: { tile: number; columns: number; side: number }) {
  return (
    <View style={{ paddingHorizontal: side, gap: spacing.lg, paddingTop: spacing.lg }}>
      {[0, 1].map((section) => (
        <View key={section} style={{ gap: spacing.sm }}>
          <Skeleton width="30%" height={11} />
          <View style={{ flexDirection: "row", gap: GAP }}>
            {Array.from({ length: columns }, (_, i) => (
              <Skeleton key={i} width={tile} height={tile} rounded={radius.md} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
