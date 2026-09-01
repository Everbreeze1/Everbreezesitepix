import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  Archive,
  Camera,
  CheckCheck,
  CircleCheck,
  ClipboardCheck,
  FileText,
  ImageOff,
  ListTodo,
  MapPin,
  NotebookPen,
  PenLine,
  Send,
  Share2,
  Star,
  Trash2,
  Video,
  Workflow,
  Link2,
} from "@/ui/icons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { displayCaption, formatPhotoDateGroup } from "@everlumen/shared";
import {
  listProjectPhotoPage,
  PHOTO_PAGE_SIZE,
  type PhotoListItem,
  type PhotoPage,
} from "@/api/photos";
import { mergeTags, phasePatch, trashPhotos, type PhotoPatch } from "@/api/photo-edit";
import { formatAddress, getProject, type ProjectListItem } from "@/api/projects";
import {
  archivePatch,
  draftToPatch,
  starPatch,
  trashProjectPatch,
  type ProjectDraft,
  type ProjectPatch,
} from "@/api/project-patch";
import {
  ensureProjectShareToken,
  openShareSheet,
  publicUrl,
  getProjectShareState,
  setProjectShareEnabled,
  isShareLive,
} from "@/api/sharing";
import { QueueBanner } from "@/components/QueueBanner";
import { PhotoBulkBar, type PhotoBulkAction } from "@/components/PhotoBulkBar";
import { generateSummaryFromPhotos } from "@/api/summaries";
import { photoSelectionError } from "@/api/summary-view";
import { randomUUID } from "expo-crypto";
import { ProjectEditorSheet } from "@/components/ProjectEditorSheet";
import {
  photoPatchRowId,
  projectPatchRowId,
  type PhotoPatchPayload,
  type ProjectPatchPayload,
} from "@/offline/handlers";
import { useQueue } from "@/offline/use-queue";
import { enqueue } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import { gridColumns, HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";
import {
  DailyLogCard,
  PhotoSharesSheet,
  ProjectBlueprint,
  ProjectCrew,
  ActionSheet,
  Badge,
  Button,
  ChipGroup,
  Icon,
  IconButton,
  EmptyState,
  ErrorState,
  ListGroup,
  ListRow,
  PhotoThumb,
  RowDivider,
  SkeletonList,
  Text as UIText,
  type ChipOption,
} from "@/ui";

type PhaseFilter = "all" | "before" | "after" | "untagged";

const FILTERS: ChipOption<PhaseFilter>[] = [
  { id: "all", label: "All" },
  { id: "before", label: "Before" },
  { id: "after", label: "After" },
  { id: "untagged", label: "Untagged" },
];

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
  /*
   * Grid width from the LIVE screen width.
   *
   * Two bugs in what this replaced, both only visible on a tablet. The count
   * was a hardcoded 3, which at 1024pt makes each tile over 300pt: a contact
   * sheet showing nine photos where it could show twenty-five. And the width
   * came from `Dimensions.get("window")`, read once at render and never again,
   * so rotating an iPad or dropping the app into split screen left the tiles
   * sized for the old width.
   *
   * Computed here rather than beside `tileSize` below because the section memo
   * chunks photos into fixed rows, so the count has to exist before it runs.
   */
  const { width: screenWidth } = useWindowDimensions();
  // Photos still in the outbox: the Daily Log for them has not been written
  // yet, because on a phone a capture session finishes when the queue does.
  const { outstanding: queued } = useQueue();
  const columns = gridColumns(screenWidth - spacing.lg * 2);
  /*
   * `photo` is a deep link, not something this screen ever sets.
   *
   * A comment mention notification is about one photo, and photos have no
   * screen of their own: they are viewed in the lightbox below. So the inbox
   * opens the project carrying the photo id, and the lightbox starts open on
   * it. Without this the reader lands on a grid of forty photos and has to find
   * the one somebody wrote about, which is the tap doing half its job.
   */
  const { id, photo: deepLinkPhoto } = useLocalSearchParams<{ id: string; photo?: string }>();
  const theme = useTheme();
  const [filter, setFilter] = useState<PhaseFilter>("all");
  // Seeded from the param rather than set in an effect, so the lightbox is
  // already open on the first render instead of flashing the grid first.
  const [lightboxId, setLightboxId] = useState<string | null>(deepLinkPhoto ?? null);
  const [sharing, setSharing] = useState<{ photoId: string; caption: string } | null>(null);
  /*
   * Selection lives as a Set of ids rather than a flag plus a list, so a photo
   * scrolled far out of view cannot fall out of the selection when the list
   * recycles its rows.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  /*
   * Kept apart from `shareError` rather than reusing it. They surface in
   * different places - one under the share action, one over the bulk bar - and
   * one message showing up in the wrong half of the screen is how somebody
   * concludes the wrong thing failed.
   */
  const [bulkError, setBulkError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const selecting = selected.size > 0;

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
      const label = formatPhotoDateGroup(when);
      const bucket = buckets.get(label);
      if (bucket) bucket.push(photo);
      else buckets.set(label, [photo]);
    }
    return Array.from(buckets.entries()).map(([title, items]) => ({
      title,
      data: chunk(items, columns),
    }));
  }, [filtered, columns]);

  const project = projectQuery.data;
  const address = project ? formatAddress(project) : null;
  const loading = projectQuery.isLoading || photosQuery.isLoading;
  const error = projectQuery.error ?? photosQuery.error;

  const tileSize = (screenWidth - spacing.lg * 2 - GRID_GAP * (columns - 1)) / columns;

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

  /**
   * Write a change to this project.
   *
   * Optimistic against both caches this screen and the list read from, then
   * queued. Starring a job while walking back to the van should not depend on
   * signal any more than a photo does.
   *
   * `field` keys the queue row, so toggling a star twice replaces its own row
   * while an edit to the name queues independently and both still land.
   */
  const patchProject = useCallback(
    async (field: string, patch: ProjectPatch) => {
      if (!id) return;

      queryClient.setQueryData<ProjectListItem | null>(["project", id], (current) =>
        current ? { ...current, ...patch } : current,
      );
      queryClient.setQueryData<ProjectListItem[]>(["projects"], (current) =>
        (current ?? []).map((row) => (row.id === id ? { ...row, ...patch } : row)),
      );

      const payload: ProjectPatchPayload & { invalidate: unknown[][] } = {
        projectId: id,
        patch,
        invalidate: [["project", id], ["projects"]],
      };

      await enqueue({
        id: projectPatchRowId(field, id),
        kind: "project_patch",
        projectId: id,
        payload,
      });

      await refreshQueue();
      requestSync();
    },
    [id, queryClient],
  );

  /**
   * Hand this project to someone outside the workspace.
   *
   * Not queued: a share link is only useful once it exists on the server and
   * someone else can open it, so an offline share would produce a URL that
   * resolves to nothing. The failure is surfaced rather than swallowed.
   */
  /*
   * Whether this job's public link is live right now.
   *
   * Its own read rather than a column on the project row: widening that select
   * would put a share token on every project in the list, which is a page of
   * live URLs held in memory for a screen that shows none of them.
   */
  const shareState = useQuery({
    queryKey: ["project-share", id],
    queryFn: () => getProjectShareState(String(id)),
    enabled: Boolean(id),
  });
  const shareLive = isShareLive(
    shareState.data?.shareToken ?? null,
    shareState.data?.revokedAt ?? null,
  );

  /**
   * Switch the job's link off.
   *
   * The half the phone was missing. It could mint a link to a whole job - every
   * photograph on it, readable by anyone holding the URL - and had no way to
   * take it back. The token survives, so turning it on again later restores the
   * same address rather than stranding a link already sent to a client.
   */
  const stopSharing = useMutation({
    mutationFn: () => setProjectShareEnabled(String(id), false),
    onSuccess: () => {
      setShareError(null);
      void queryClient.invalidateQueries({ queryKey: ["project-share", id] });
    },
    onError: (error: unknown) =>
      setShareError(
        error instanceof Error
          ? error.message
          : "The link is still live. It could not be switched off.",
      ),
  });

  const shareProject = useCallback(async () => {
    if (!id) return;
    setActionsOpen(false);
    try {
      const token = await ensureProjectShareToken(id);
      const url = publicUrl("projects", token);
      if (!url) {
        setShareError("Sharing is not set up for this workspace.");
        return;
      }
      setShareError(null);
      await openShareSheet(url, project?.name ?? "Project");
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Could not create the link");
    }
  }, [id, project?.name]);

  /**
   * Show the links already open on this photograph, and offer another.
   *
   * A share link is a jobsite photograph on the open internet with no login in
   * front of it, so the sheet leads with what already exists rather than
   * quietly adding to it.
   */
  const sharePhoto = useCallback((photoId: string, caption: string | null) => {
    /*
     * Opens the links sheet rather than minting one on the spot.
     *
     * The old path created a FRESH token per tap and showed nothing, so three
     * taps left three independently live URLs on the open internet with nothing
     * on the phone able to count or withdraw them.
     */
    setShareError(null);
    setSharing({ photoId, caption: displayCaption(caption, "Photo") });
  }, []);

  const toggle = useCallback((photoId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  /**
   * Apply a bulk action to the selection.
   *
   * Optimistic against the paged cache, then queued, like every other write in
   * the app. Trash and move remove the rows from this project's grid; phase and
   * tags rewrite them in place.
   *
   * Tags are merged per photo rather than written as one shared array. A single
   * `tags` value applied across a selection would overwrite each photo's own
   * tags with the union of everyone's, quietly relabelling work.
   */
  const applyBulk = useCallback(
    async (action: PhotoBulkAction) => {
      const ids = Array.from(selected);
      if (ids.length === 0) return;

      /*
       * The write-up leaves before the patch machinery below, because it is not
       * a patch: it spends an LLM call and produces a new artefact rather than
       * changing these photographs. Handled first so the optimistic cache
       * rewrite never runs for it.
       */
      if (action.kind === "summarise") {
        // The server rejects over its cap rather than trimming, so refusing
        // here saves the wait and the quota slot.
        const refusal = photoSelectionError(ids.length);
        if (refusal) {
          setBulkError(refusal);
          return;
        }
        setBusy(true);
        try {
          const { summaryId } = await generateSummaryFromPhotos({
            projectId: String(id),
            photoIds: ids,
            // Fresh per tap: asking for a second write-up of the same photos is
            // legitimate, a retry after a dropped response is not.
            idempotencyKey: randomUUID(),
          });
          setSelected(new Set());
          setBulkError(null);
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

      const removesFromThisProject = action.kind === "trash" || action.kind === "move";
      const basePatch: PhotoPatch =
        action.kind === "phase"
          ? phasePatch(action.phase)
          : action.kind === "trash"
            ? trashPhotos()
            : action.kind === "move"
              ? { project_id: action.projectId }
              : {};

      // Tag writes differ per photo, so they queue one row per photo.
      const perPhoto: { ids: string[]; patch: PhotoPatch }[] =
        action.kind === "tags"
          ? photos
              .filter((photo) => selected.has(photo.id))
              .map((photo) => ({
                ids: [photo.id],
                patch: { tags: mergeTags(photo.tags, action.tags) },
              }))
          : [{ ids, patch: basePatch }];

      queryClient.setQueryData<{ pages: PhotoPage[]; pageParams: unknown[] }>(
        ["project-photos", id],
        (current) => {
          if (!current) return current;
          return {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              photos: removesFromThisProject
                ? page.photos.filter((photo) => !selected.has(photo.id))
                : page.photos.map((photo) => {
                    if (!selected.has(photo.id)) return photo;
                    const patch = perPhoto.find((p) => p.ids[0] === photo.id)?.patch ?? basePatch;
                    return { ...photo, ...patch };
                  }),
            })),
          };
        },
      );

      for (const write of perPhoto) {
        const payload: PhotoPatchPayload & { invalidate: unknown[][] } = {
          photoIds: write.ids,
          patch: write.patch,
          invalidate: [["project-photos", id], ["gallery-photos"]],
        };
        await enqueue({
          id: photoPatchRowId(action.kind, write.ids),
          kind: "photo_patch",
          projectId: id ?? null,
          payload,
        });
      }

      await refreshQueue();
      requestSync();
      setSelected(new Set());
      setBusy(false);
    },
    [selected, photos, queryClient, id],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: selecting ? `${selected.size} selected` : (project?.name ?? "Project"),
          headerRight: () =>
            selecting ? (
              <IconButton
                icon={CheckCheck}
                accessibilityLabel="Select all loaded photos"
                surface={false}
                tone="primary"
                onPress={() => setSelected(new Set(filtered.map((photo) => photo.id)))}
              />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {/*
                  A filled star for starred, an outline for not. Colour alone
                  would not carry it: the header is the one place the app draws
                  on the chrome background, where a tinted glyph reads as
                  "tappable" rather than as "on".
                */}
                <IconButton
                  icon={Star}
                  accessibilityLabel={project?.starred ? "Remove star" : "Star this project"}
                  surface={false}
                  tone={project?.starred ? "safety" : "muted"}
                  onPress={() => void patchProject("starred", starPatch(!project?.starred))}
                />
                <IconButton
                  icon={PenLine}
                  accessibilityLabel="Project actions"
                  surface={false}
                  tone="primary"
                  onPress={() => setActionsOpen(true)}
                />
              </View>
            ),
        }}
      />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <QueueBanner />
        {shareError ? (
          <UIText
            variant="caption"
            tone="destructive"
            style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
          >
            {shareError}
          </UIText>
        ) : null}
        {loading ? (
          <SkeletonList rows={5} />
        ) : error ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Failed to load project"}
            onRetry={() => {
              void projectQuery.refetch();
              void photosQuery.refetch();
            }}
          />
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
            initialNumToRender={Math.ceil(PHOTO_PAGE_SIZE / columns)}
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
                <View style={{ gap: spacing.md, marginBottom: spacing.lg }}>
                  {address ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                      <MapPin size={14} color={theme.colors.mutedForeground} strokeWidth={2.25} />
                      <UIText variant="caption" tone="muted" style={{ flex: 1 }}>
                        {address}
                      </UIText>
                    </View>
                  ) : null}

                  {/*
                    Who is on the job, directly under the address. It is the
                    same kind of fact: where this is and who is there. The row
                    shows for everybody and only offers "Change" to a role the
                    server would actually accept a write from.
                  */}
                  <ProjectCrew projectId={String(id)} />

                  {/*
                    Next to the crew, because they are the same act: setting a
                    job up is deciding who is on it and what it needs. The row
                    reads as provenance once a blueprint has been applied.
                  */}
                  <ProjectBlueprint
                    projectId={String(id)}
                    projectName={project?.name ?? ""}
                    projectAddress={address}
                  />

                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Badge
                      label={`${photos.length}${photosQuery.hasNextPage ? "+" : ""} photo${photos.length === 1 ? "" : "s"}`}
                      tone="primary"
                    />
                    {project?.status ? <Badge label={project.status} tone="neutral" /> : null}
                  </View>

                  {/*
                   * The four ways deeper into a job, as one grouped block.
                   *
                   * These were four separate bordered rows, each drawn inline
                   * with a text chevron, and they carried no icons at all: on a
                   * screen whose whole job is to be scanned quickly they were
                   * four identical grey rectangles differing only by a word.
                   */}
                  <ListGroup>
                    <ListRow
                      icon={ClipboardCheck}
                      title="Checklists"
                      subtitle="Run the checks for this site"
                      onPress={() => router.push(`/project/${id}/checklists`)}
                    />
                    <RowDivider />
                    <ListRow
                      icon={ListTodo}
                      title="Tasks"
                      subtitle="Punch list and assignments"
                      onPress={() => router.push(`/project/${id}/tasks`)}
                    />
                    <RowDivider />
                    <ListRow
                      icon={Workflow}
                      title="Workflows"
                      subtitle="Phases and progress"
                      onPress={() => router.push(`/project/${id}/workflows`)}
                    />
                    <RowDivider />
                    <ListRow
                      icon={FileText}
                      title="Documents"
                      subtitle="Pages and files on this job"
                      onPress={() => router.push(`/project/${id}/documents`)}
                    />
                    <RowDivider />
                    <ListRow
                      icon={Send}
                      title="Reports"
                      subtitle="What the client receives"
                      onPress={() => router.push(`/project/${id}/reports`)}
                    />
                    <RowDivider />
                    <ListRow
                      // Not `FileText`: that is the Documents row above, and two
                      // rows in one list drawing the same glyph is the same as
                      // neither having one. `NotebookPen` is what `DailyLogCard`
                      // already uses for the same idea, a day written up.
                      icon={NotebookPen}
                      title="Site logs"
                      subtitle="The day's photos, written up"
                      onPress={() => router.push(`/project/${id}/site-logs`)}
                    />
                    <RowDivider />
                    <ListRow
                      icon={Video}
                      title="Walkthroughs"
                      subtitle="Recorded site walks"
                      onPress={() => router.push(`/project/${id}/walkthroughs`)}
                    />
                    <RowDivider />
                    <ListRow
                      icon={Trash2}
                      iconTone="muted"
                      title="Trash"
                      subtitle="Restore deleted photos"
                      onPress={() => router.push(`/project/${id}/trash`)}
                    />
                  </ListGroup>
                </View>

                {/*
                  Was a hand-rolled row of Pressables with its own chip style.
                  The same control exists on the gallery and the task list, so
                  it lives in the kit now and all three agree on height.
                */}
                <View style={{ marginHorizontal: -spacing.lg, marginBottom: spacing.lg }}>
                  <ChipGroup
                    options={FILTERS}
                    value={filter}
                    onChange={setFilter}
                    label="Filter photos by phase"
                  />
                </View>

                {/*
                  Directly above the grid it was written from. The log is the
                  prose version of these photographs, and putting it anywhere
                  else makes it a report somebody has to go and find, which is
                  the exact thing it exists not to be.
                */}
                <DailyLogCard projectId={String(id)} pending={queued > 0} />
              </View>
            }
            ListEmptyComponent={
              photos.length === 0 ? (
                <EmptyState
                  icon={Camera}
                  title="No photos yet"
                  body="Photos taken here upload on their own, and keep queueing when there is no signal."
                  action={{
                    label: "Take photos",
                    icon: Camera,
                    onPress: () => router.push(`/project/${id}/capture`),
                  }}
                />
              ) : (
                <EmptyState
                  icon={ImageOff}
                  title="Nothing in this phase"
                  body="Switch the filter above, or tag some photos as you shoot them."
                  action={{ label: "Show all", onPress: () => setFilter("all") }}
                />
              )
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
              <UIText
                variant="overline"
                tone="muted"
                style={{ marginBottom: spacing.sm, marginTop: spacing.md }}
              >
                {section.title.toUpperCase()}
              </UIText>
            )}
            renderItem={({ item }) => (
              <View style={[styles.gridRow, { marginBottom: GRID_GAP }]}>
                {item.photos.map((photo) => {
                  const picked = selected.has(photo.id);
                  return (
                    <Pressable
                      accessibilityRole="button"
                      key={photo.id}
                      /*
                       * Long press starts a selection, tap continues it. That is
                       * the platform convention for a photo grid, and it means a
                       * single tap keeps meaning "look at this" until the person
                       * has said otherwise.
                       */
                      onLongPress={() => toggle(photo.id)}
                      onPress={() => (selecting ? toggle(photo.id) : setLightboxId(photo.id))}
                      accessibilityLabel={displayCaption(photo.caption, "Photo")}
                      accessibilityHint={
                        selecting
                          ? "Adds or removes this photo from the selection"
                          : "Opens the photo full screen"
                      }
                      accessibilityState={{ selected: picked }}
                      style={{ width: tileSize, height: tileSize }}
                    >
                      <PhotoThumb uri={urls[photo.id]} width="100%" height="100%" />
                      {selecting ? (
                        <View
                          style={[
                            styles.tileOverlay,
                            {
                              borderColor: picked ? theme.colors.primary : "transparent",
                              // Unpicked tiles dim so the chosen ones read at a
                              // glance across a three-column grid.
                              backgroundColor: picked ? "transparent" : "rgba(0,0,0,0.35)",
                            },
                          ]}
                        >
                          {picked ? (
                            <View style={styles.tileCheck}>
                              <Icon icon={CircleCheck} size="lg" tone="inverse" />
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
          />
        )}

        {/*
          The capture button and the bulk bar are the same slot, never both.
          Offering "Capture" while forty photos are selected invites a tap that
          throws the selection away, and the two intents have nothing to do with
          each other.
        */}
        {/*
          No floating Capture button while the grid is empty.
          The empty state already offers the action ("Take photos", or "Show
          all" when a filter hid everything), and on device the button sat over
          the empty state body: "tag some photos as you shoot them" ran
          underneath it. Two controls for one intent, one of them obscuring the
          other.
        */}
        {selecting && bulkError ? (
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.xs,
              backgroundColor: theme.colors.background,
            }}
          >
            <UIText variant="caption" tone="destructive">
              {bulkError}
            </UIText>
          </View>
        ) : null}

        {selecting ? (
          <PhotoBulkBar
            count={selected.size}
            busy={busy}
            currentProjectId={id}
            onCancel={() => setSelected(new Set())}
            onAction={(action) => void applyBulk(action)}
          />
        ) : filtered.length === 0 ? null : (
          <View style={styles.fab}>
            <Button
              label="Capture"
              icon={Camera}
              size="lg"
              onPress={() => router.push(`/project/${id}/capture`)}
              accessibilityHint="Opens the camera for this project"
              style={{ borderRadius: radius.pill }}
            />
          </View>
        )}
      </View>

      <ProjectEditorSheet
        visible={editing}
        onClose={() => setEditing(false)}
        project={project ?? null}
        onSave={(draft: ProjectDraft) => {
          setEditing(false);
          void patchProject("details", draftToPatch(draft));
        }}
      />

      <ActionSheet
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title="Project"
        actions={[
          { label: "Edit details", icon: PenLine, onPress: () => setEditing(true) },
          { label: "Share project", icon: Share2, onPress: () => void shareProject() },
          /*
            Only when there is something to switch off. Offering "Stop sharing"
            on a job that was never shared invites somebody to press it and
            wonder what they just did.
          */
          ...(shareLive
            ? [
                {
                  label: "Stop sharing this job",
                  icon: Link2,
                  destructive: true,
                  onPress: () =>
                    Alert.alert(
                      "Stop sharing this job?",
                      "Anyone holding the link loses access to every photo on it. Turning it back on later gives out the same link again.",
                      [
                        { text: "Keep it live", style: "cancel" as const },
                        {
                          text: "Stop sharing",
                          style: "destructive" as const,
                          onPress: () => stopSharing.mutate(),
                        },
                      ],
                    ),
                },
              ]
            : []),
          {
            label: project?.starred ? "Remove star" : "Star this project",
            icon: Star,
            onPress: () => void patchProject("starred", starPatch(!project?.starred)),
          },
          {
            label: project?.archived ? "Unarchive" : "Archive",
            icon: Archive,
            onPress: () => void patchProject("archived", archivePatch(!project?.archived)),
          },
          {
            /*
             * Trashing leaves the screen, because staying on the detail view of
             * a project that is no longer in the list reads as the delete
             * having failed.
             */
            label: "Move project to trash",
            icon: Trash2,
            destructive: true,
            onPress: () => {
              void patchProject("deleted", trashProjectPatch());
              router.back();
            },
          },
        ]}
      />

      <Modal
        visible={Boolean(lightboxPhoto)}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxId(null)}
      >
        <Pressable
          accessibilityRole="button"
          /*
           * Labelled, like the gallery's lightbox. Without this the scrim takes
           * its accessible name from the caption text inside it, so a screen
           * reader announces the photograph's caption as a button - which says
           * nothing about what tapping does, and tapping closes the photo.
           */
          accessibilityLabel="Close photo"
          style={styles.lightbox}
          onPress={() => setLightboxId(null)}
        >
          {lightboxPhoto ? (
            <>
              <PhotoThumb
                uri={urls[lightboxPhoto.id]}
                width="100%"
                height="70%"
                contentFit="contain"
                rounded={0}
                showLabel
                onDark
              />
              <View style={styles.lightboxActions}>
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
                  style={styles.lightboxAction}
                >
                  <Text style={[typography.bodyStrong, { color: "#fff" }]}>Annotate</Text>
                </Pressable>

                {/*
                  Analyse sits next to Annotate because they are the same kind
                  of act: both take this one photograph and add to it. It reads
                  the equipment plate and finds visible defects, which is worth
                  doing while still standing in front of the thing.
                */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Analyse this photo"
                  onPress={() => {
                    const photo = lightboxPhoto;
                    setLightboxId(null);
                    router.push({
                      pathname: "/photo/[id]/analysis",
                      params: {
                        id: photo.id,
                        uri: urls[photo.id] ?? "",
                        caption: photo.caption ?? "",
                      },
                    });
                  }}
                  style={styles.lightboxAction}
                >
                  <Text style={[typography.bodyStrong, { color: "#fff" }]}>Analyse</Text>
                </Pressable>

                {/*
                  Comments last, because the first three change the photograph
                  and this one talks about it. `photo_comments` has been in the
                  database since July and the web has had a panel for it all
                  along; the phone could not read a word of it.
                */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Comment on this photo"
                  onPress={() => {
                    const photo = lightboxPhoto;
                    setLightboxId(null);
                    router.push({
                      pathname: "/photo/[id]/comments",
                      params: {
                        id: photo.id,
                        uri: urls[photo.id] ?? "",
                        projectId: String(id),
                        caption: photo.caption ?? "",
                      },
                    });
                  }}
                  style={styles.lightboxAction}
                >
                  <Text style={[typography.bodyStrong, { color: "#fff" }]}>Comments</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Share this photo"
                  onPress={() => {
                    const photo = lightboxPhoto;
                    setLightboxId(null);
                    sharePhoto(photo.id, photo.caption);
                  }}
                  style={styles.lightboxAction}
                >
                  <Text style={[typography.bodyStrong, { color: "#fff" }]}>Share</Text>
                </Pressable>
              </View>

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

      {sharing ? (
        <PhotoSharesSheet
          visible
          onClose={() => setSharing(null)}
          photoId={sharing.photoId}
          caption={sharing.caption}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  gridRow: { flexDirection: "row", gap: GRID_GAP },
  tile: { width: "100%", height: "100%", borderRadius: radius.sm },
  /* Sits over the whole tile so the ring reads as the tile being selected. */
  tileOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.sm,
    borderWidth: 3,
    alignItems: "flex-end",
    justifyContent: "flex-start",
    padding: 4,
  },
  tileCheck: {
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: radius.pill,
  },
  /*
   * Positioning and lift only. The button itself is the kit's, so its height,
   * radius and pressed state match every other primary action in the app.
   */
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.xl,
    borderRadius: radius.pill,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  lightbox: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", justifyContent: "center" },
  lightboxImage: { width: "100%", height: "78%" },
  /*
   * One right-anchored row, not two absolutely positioned pills.
   *
   * Share was originally placed with `right: spacing.xl + 150`, a number
   * chosen to clear the word "Annotate" at the current font size. It happened
   * to work and would have collided the first time either label changed or the
   * OS font scale went up. A row cannot drift.
   */
  /*
   * Bounded on both sides, and allowed to wrap.
   *
   * This was anchored to `right` only, with no left edge and no wrap, so the
   * row grew leftwards off the screen. Three pills fitted; the fourth did not.
   * Measured on a 1080px screen: Annotate ended at 1008, Analyse at 644,
   * Comments at 0 - already flush against the left edge - which put Share at a
   * negative x and made it unreachable. Not clipped visually and still in the
   * layout, so it drew nothing, took no taps, and merged into the parent
   * accessibility node, where the only trace of it was a screen-wide element
   * labelled "Share this photo, Photo, Jul 17 . before".
   *
   * It went unnoticed because Share was the newest of the four and the row had
   * fitted the previous three, so nothing about adding one more looked risky.
   * With `left` set the row has a width to wrap inside, so a fifth action, a
   * longer word, or a larger font size pushes a line down instead of off.
   */
  lightboxActions: {
    position: "absolute",
    top: 56,
    left: spacing.xl,
    right: spacing.xl,
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: spacing.sm,
  },
  lightboxAction: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: HIT_TARGET,
    justifyContent: "center",
  },
  lightboxMeta: { position: "absolute", bottom: 56, left: spacing.xl, right: spacing.xl, gap: 4 },
});
