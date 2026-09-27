import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import {
  Archive,
  Camera,
  CheckCheck,
  ChevronLeft,
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
  SlidersHorizontal,
  Star,
  Trash2,
  Video,
  Workflow,
  Link2,
  X,
} from "@/ui/icons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { displayCaption, formatPhotoDateGroup, projectDisplayName } from "@everlumen/shared";
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
  labelsPatch,
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
import { ActionRail } from "@/components/ActionRail";
import { QueueBanner } from "@/components/QueueBanner";
import { ProjectHero, ProjectHeroButton } from "@/components/ProjectHero";
import { ProjectTabs, type ProjectTab } from "@/components/ProjectTabs";
import { ProjectStatusChip } from "@/components/ProjectStatusChip";
import { ProjectWorkflowStrip } from "@/components/ProjectWorkflowStrip";
import { ProjectLabels } from "@/components/ProjectLabels";
import { ProjectPhotoCalendar } from "@/components/ProjectPhotoCalendar";
import { PhotoViewer } from "@/components/photo-viewer";
import { ProjectVideos } from "@/components/ProjectVideos";
import { PhotoFilterSheet } from "@/components/PhotoFilterSheet";
import { listProjectVideos } from "@/api/project-videos";
import { listProjectBoards } from "@/api/pipelines";
import {
  activeFilterCount,
  filterPhotos,
  photoTagCounts,
  toggleTag,
  type MediaFilter,
  type PhaseFilter,
  type TagLogic,
} from "@/api/photo-filter-view";
import { ProjectCrewAvatars } from "@/components/ProjectCrewAvatars";
import { MoreGlyph } from "@/components/ProjectGlyphs";
import { getBlueprintOrigin } from "@/api/blueprints";
import { getProjectCrew, listCrewCandidates } from "@/api/project-assignees";
import { crewName } from "@/api/project-assignees-view";
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
import { gridColumns, radius, spacing, useTheme } from "@/theme";
import {
  DailyLogCard,
  ProjectBlueprint,
  ProjectCrew,
  ActionSheet,
  Chip,
  ChipGroup,
  Icon,
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

const FILTERS: ChipOption<PhaseFilter>[] = [
  { id: "all", label: "All" },
  { id: "before", label: "Before" },
  { id: "after", label: "After" },
  { id: "untagged", label: "Untagged" },
];

const GRID_GAP = spacing.sm;

/** Tabs drawn on this screen. */
type InPlaceTab = "photos" | "calendar" | "details";
/** Tabs that open the section's own screen, which already exists as a route. */
type LinkedTab =
  | "documents"
  | "reports"
  | "checklists"
  | "workflows"
  | "tasks"
  | "site-logs"
  | "walkthroughs";
type DetailTab = InPlaceTab | LinkedTab;

/*
 * The tab row. Photos and Details render here; the others push the screen
 * that section has always had, so each keeps its own header, create action
 * and list rather than being squeezed into a second copy under this one.
 */
const TABS: ProjectTab<DetailTab>[] = [
  { id: "photos", label: "Photos" },
  { id: "documents", label: "Documents" },
  { id: "reports", label: "Reports" },
  { id: "checklists", label: "Checklists" },
  { id: "workflows", label: "Workflows" },
  { id: "tasks", label: "Tasks" },
  { id: "site-logs", label: "Site logs" },
  { id: "walkthroughs", label: "Walkthroughs" },
  // This job's photos by day, as the web project page's Calendar tab.
  { id: "calendar", label: "Calendar" },
  { id: "details", label: "Details" },
];

const LINKED_TABS: Record<LinkedTab, (id: string) => void> = {
  documents: (id) => router.push(`/project/${id}/documents`),
  reports: (id) => router.push(`/project/${id}/reports`),
  checklists: (id) => router.push(`/project/${id}/checklists`),
  workflows: (id) => router.push(`/project/${id}/workflows`),
  tasks: (id) => router.push(`/project/${id}/tasks`),
  "site-logs": (id) => router.push(`/project/${id}/site-logs`),
  walkthroughs: (id) => router.push(`/project/${id}/walkthroughs`),
};

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
  /*
   * The web grid's other filters: tags (any-of or all-of), photos against
   * videos, and whether the tag row is showing at all. Hiding the row clears
   * the tag filter, so a filter nobody can see never narrows the grid.
   */
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [tagLogic, setTagLogic] = useState<TagLogic>("or");
  const [showTags, setShowTags] = useState(false);
  const [media, setMedia] = useState<MediaFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  /*
   * A day opened from the Calendar tab. Its photos may not be in the loaded
   * grid, so the viewer pages through that day rather than the grid, as web's
   * calendar viewer does.
   */
  const [calendarPick, setCalendarPick] = useState<{
    photos: PhotoListItem[];
    urls: Record<string, string>;
  } | null>(null);
  const [tab, setTab] = useState<InPlaceTab>("photos");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  // Seeded from the param rather than set in an effect, so the lightbox is
  // already open on the first render instead of flashing the grid first.
  const [lightboxId, setLightboxId] = useState<string | null>(deepLinkPhoto ?? null);
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

  /*
   * Pages arrive newest first, so "oldest first" is the loaded list reversed.
   * That is only honest once every page is here, which the effect below sees
   * to: otherwise the "oldest" photo shown would just be the oldest one that
   * happened to be fetched.
   */
  const filtered = useMemo(() => {
    const phased = filterPhotos(photos, { phase: filter, tags: tagFilter, logic: tagLogic });
    return sort === "newest" ? phased : [...phased].reverse();
  }, [photos, filter, tagFilter, tagLogic, sort]);

  const tagCounts = useMemo(() => photoTagCounts(photos), [photos]);

  const videosQuery = useQuery({
    queryKey: ["project-videos", id],
    queryFn: () => listProjectVideos(String(id)),
    enabled: Boolean(id),
  });
  const videos = videosQuery.data ?? [];
  const showPhotos = media !== "videos";
  const moreFilters = activeFilterCount({ tags: tagFilter, media });

  /*
   * The stage name, for the edit sheet: where a stage owns the status, the
   * sheet says so rather than offering a status that would contradict it.
   * Same key as the status chip, so this is not a second fetch.
   */
  const boardsQuery = useQuery({
    queryKey: ["project-boards"],
    queryFn: listProjectBoards,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (sort !== "oldest") return;
    if (photosQuery.hasNextPage && !photosQuery.isFetchingNextPage) {
      void photosQuery.fetchNextPage();
    }
  }, [sort, photosQuery]);

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

  /*
   * What kind of job this is, read from the blueprint that set it up. The same
   * query key `ProjectBlueprint` reads, so the Details tab does not fetch it
   * twice.
   */
  const blueprintOrigin = useQuery({
    queryKey: ["blueprint-origin", String(id)],
    queryFn: () => getBlueprintOrigin(String(id)),
    enabled: Boolean(id),
  });

  /*
   * The crew as avatars for the row under the hero. Same keys as
   * `ProjectCrew`, so changing the crew on the Details tab updates these too.
   */
  const crewQuery = useQuery({
    queryKey: ["project-crew", String(id)],
    queryFn: () => getProjectCrew(String(id)),
    enabled: Boolean(id),
  });
  const peopleQuery = useQuery({
    queryKey: ["crew-candidates"],
    queryFn: listCrewCandidates,
    enabled: (crewQuery.data?.assigned.length ?? 0) > 0,
    staleTime: 5 * 60 * 1000,
  });
  const crewPeople = useMemo(
    () =>
      (crewQuery.data?.assigned ?? []).map((userId) => {
        const person = peopleQuery.data?.find((p) => p.userId === userId);
        return { name: person ? crewName(person) : null, uri: person?.avatarUrl ?? null };
      }),
    [crewQuery.data, peopleQuery.data],
  );
  const address = project ? formatAddress(project) : null;
  const loading = projectQuery.isLoading || photosQuery.isLoading;
  const error = projectQuery.error ?? photosQuery.error;

  const tileSize = (screenWidth - spacing.lg * 2 - GRID_GAP * (columns - 1)) / columns;

  /*
   * What the photo viewer pages through: the day picked on the Calendar tab,
   * or the grid as filtered and sorted on screen.
   */
  const viewerPhotos = calendarPick?.photos ?? filtered;
  const viewerUrls = calendarPick?.urls ?? urls;

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

  /*
   * The hero's second line: the client, then where the job is. The street is
   * usually the project's name already, so it is not repeated here.
   */
  const place = project
    ? [project.city, project.state].filter(Boolean).join(", ") || project.location || null
    : null;
  const heroSubtitle = project
    ? [project.client_name?.trim(), place].filter(Boolean).join(" · ") || null
    : null;
  // Newest loaded photo, which is what the project list and the web card use
  // as a job's cover. No photo falls back to the gradient.
  const coverUri = photos.length > 0 ? (urls[photos[0].id] ?? null) : null;
  const blueprintName = blueprintOrigin.data?.applications[0]?.blueprintName ?? null;
  const photoCount = showPhotos
    ? `${photos.length}${photosQuery.hasNextPage ? "+" : ""} photo${photos.length === 1 ? "" : "s"}`
    : `${videos.length} video${videos.length === 1 ? "" : "s"}`;
  const stageName = useMemo(() => {
    const stageId = project?.pipeline_stage_id;
    if (!stageId) return null;
    for (const board of boardsQuery.data ?? []) {
      const stage = (board.stages ?? []).find((s) => s.id === stageId);
      if (stage) return stage.name;
    }
    return null;
  }, [boardsQuery.data, project?.pipeline_stage_id]);

  /*
   * A stage move is written by the status chip itself (the server derives the
   * status from the stage); this only keeps both caches showing it meanwhile.
   */
  const onStageChanged = useCallback(
    (next: { status: string; stageId: string | null }) => {
      queryClient.setQueryData<ProjectListItem | null>(["project", id], (current) =>
        current ? { ...current, status: next.status, pipeline_stage_id: next.stageId } : current,
      );
      queryClient.setQueryData<ProjectListItem[]>(["projects"], (current) =>
        (current ?? []).map((row) => (row.id === id ? { ...row, status: next.status } : row)),
      );
    },
    [id, queryClient],
  );

  const onTab = (next: DetailTab) => {
    const go = LINKED_TABS[next as LinkedTab];
    if (go) go(String(id));
    else setTab(next as InPlaceTab);
  };

  return (
    <>
      {/*
        No navigator header: the hero runs under the status bar and carries
        its own back and overflow buttons.
      */}
      <Stack.Screen options={{ headerShown: false, title: project?.name ?? "Project" }} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
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
            sections={tab === "photos" && showPhotos ? sections : []}
            keyExtractor={(row) => row.key}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={{ paddingBottom: 140 }}
            onEndReached={tab === "photos" && showPhotos ? loadMore : undefined}
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
                <ProjectHero
                  title={selecting ? `${selected.size} selected` : projectDisplayName(project)}
                  subtitle={selecting ? "Tap photos to add or remove them" : heroSubtitle}
                  coverUri={coverUri}
                  left={
                    selecting ? (
                      <ProjectHeroButton
                        accessibilityLabel="Cancel selection"
                        onPress={() => setSelected(new Set())}
                      >
                        <Icon icon={X} size="md" color="#ffffff" />
                      </ProjectHeroButton>
                    ) : (
                      <ProjectHeroButton accessibilityLabel="Back" onPress={() => router.back()}>
                        <Icon icon={ChevronLeft} size="md" color="#ffffff" />
                      </ProjectHeroButton>
                    )
                  }
                  right={
                    selecting ? (
                      <ProjectHeroButton
                        accessibilityLabel="Select all loaded photos"
                        onPress={() => setSelected(new Set(filtered.map((photo) => photo.id)))}
                      >
                        <Icon icon={CheckCheck} size="md" color="#ffffff" />
                      </ProjectHeroButton>
                    ) : (
                      <>
                        {/*
                          A filled amber star for starred, a white outline for
                          not. Colour alone would not carry it on a photograph,
                          so the fill does the work.
                        */}
                        <ProjectHeroButton
                          accessibilityLabel={
                            project?.starred ? "Remove star" : "Star this project"
                          }
                          onPress={() => void patchProject("starred", starPatch(!project?.starred))}
                        >
                          <Star
                            size={20}
                            strokeWidth={2.25}
                            color={project?.starred ? theme.colors.safety : "#ffffff"}
                            fill={project?.starred ? theme.colors.safety : "transparent"}
                          />
                        </ProjectHeroButton>
                        <ProjectHeroButton
                          accessibilityLabel="Project actions"
                          onPress={() => setActionsOpen(true)}
                        >
                          <MoreGlyph color="#ffffff" />
                        </ProjectHeroButton>
                      </>
                    )
                  }
                />

                {/*
                  Status, what kind of job it is, and who is on it: the three
                  facts somebody opening a job checks before anything else.
                  The avatars open the Details tab, where the crew can be
                  changed.
                */}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.md,
                    paddingHorizontal: spacing.xl,
                    paddingVertical: spacing.md,
                    backgroundColor: theme.colors.card,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.colors.border,
                  }}
                >
                  {project?.status ? (
                    <ProjectStatusChip
                      projectId={String(id)}
                      status={project.status}
                      stageId={project.pipeline_stage_id}
                      onSetStatus={(status) => void patchProject("status", { status })}
                      onStageChanged={onStageChanged}
                    />
                  ) : null}
                  <UIText variant="body" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                    {blueprintName ?? ""}
                  </UIText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Who is on this job"
                    onPress={() => setTab("details")}
                    hitSlop={8}
                  >
                    <ProjectCrewAvatars people={crewPeople} size="md" />
                  </Pressable>
                </View>

                {/*
                  What the job is and how the team files it: the description
                  the web shows under the title, then the labels, which are
                  applied and removed right here as on the web header.
                */}
                <View
                  style={{
                    gap: spacing.sm,
                    paddingHorizontal: spacing.xl,
                    paddingVertical: spacing.md,
                    backgroundColor: theme.colors.card,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.colors.border,
                  }}
                >
                  {project?.description?.trim() ? (
                    <UIText variant="body" tone="muted" numberOfLines={6}>
                      {project.description.trim()}
                    </UIText>
                  ) : null}
                  <ProjectLabels
                    labels={project?.labels ?? []}
                    onChange={(next) => void patchProject("labels", labelsPatch(next))}
                  />
                </View>

                <ProjectWorkflowStrip
                  projectId={String(id)}
                  onOpen={() => router.push(`/project/${id}/workflows`)}
                />

                <ProjectTabs tabs={TABS} value={tab} onChange={onTab} />

                <QueueBanner />
                {shareError ? (
                  <UIText
                    variant="caption"
                    tone="destructive"
                    style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}
                  >
                    {shareError}
                  </UIText>
                ) : null}

                {tab === "photos" ? (
                  <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: spacing.md,
                      }}
                    >
                      <UIText variant="heading" style={{ fontWeight: "700" }}>
                        {photoCount}
                      </UIText>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={
                            moreFilters > 0 ? `Filters, ${moreFilters} on` : "Filters"
                          }
                          accessibilityHint="Tags, and photos or videos"
                          onPress={() => setFiltersOpen(true)}
                          hitSlop={12}
                          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                        >
                          <SlidersHorizontal
                            size={16}
                            strokeWidth={2.25}
                            color={theme.colors.primary}
                          />
                          <UIText variant="bodyStrong" tone="primary" style={{ fontWeight: "700" }}>
                            {moreFilters > 0 ? `Filters (${moreFilters})` : "Filters"}
                          </UIText>
                        </Pressable>
                        {showPhotos ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Sort: ${sort === "newest" ? "newest" : "oldest"} first`}
                            accessibilityHint="Switches between newest and oldest first"
                            onPress={() => setSort((s) => (s === "newest" ? "oldest" : "newest"))}
                            hitSlop={12}
                          >
                            <UIText
                              variant="bodyStrong"
                              tone="primary"
                              style={{ fontWeight: "700" }}
                            >
                              {`Sort: ${sort === "newest" ? "Newest" : "Oldest"}`}
                            </UIText>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>

                    {/*
                      Was a hand-rolled row of Pressables with its own chip
                      style. The same control exists on the gallery and the
                      task list, so it lives in the kit now and all three agree
                      on height.
                    */}
                    {showPhotos ? (
                      <View style={{ marginHorizontal: -spacing.lg, marginBottom: spacing.md }}>
                        <ChipGroup
                          options={FILTERS}
                          value={filter}
                          onChange={setFilter}
                          label="Filter photos by phase"
                        />
                      </View>
                    ) : null}

                    {/*
                      The photo tags, as the web's tag panel: tap to filter,
                      tap again to drop it. Any or all is set in Filters.
                    */}
                    {showPhotos && showTags ? (
                      <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <UIText variant="overline" tone="muted">
                            {`PHOTO TAGS · MATCH ${tagLogic === "and" ? "ALL" : "ANY"}`}
                          </UIText>
                          {tagFilter.length > 0 ? (
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => setTagFilter([])}
                              hitSlop={12}
                            >
                              <UIText
                                variant="caption"
                                tone="primary"
                                style={{ fontWeight: "700" }}
                              >
                                Clear
                              </UIText>
                            </Pressable>
                          ) : null}
                        </View>
                        {tagCounts.length === 0 ? (
                          <UIText variant="caption" tone="muted">
                            None of the loaded photos are tagged yet.
                          </UIText>
                        ) : (
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                            {tagCounts.map(({ tag, count }) => (
                              <Chip
                                key={tag}
                                label={tag}
                                count={count}
                                selected={tagFilter.includes(tag)}
                                onPress={() => setTagFilter((current) => toggleTag(current, tag))}
                              />
                            ))}
                          </View>
                        )}
                      </View>
                    ) : null}

                    {media !== "photos" && videos.length > 0 ? (
                      <View style={{ marginBottom: spacing.md }}>
                        <ProjectVideos videos={videos} />
                      </View>
                    ) : null}

                    {/*
                      Directly above the grid it was written from. The log is
                      the prose version of these photographs, and putting it
                      anywhere else makes it a report somebody has to go and
                      find, which is the exact thing it exists not to be.
                    */}
                    {showPhotos ? (
                      <DailyLogCard projectId={String(id)} pending={queued > 0} />
                    ) : null}
                  </View>
                ) : tab === "calendar" ? (
                  <View style={{ padding: spacing.lg }}>
                    <ProjectPhotoCalendar
                      projectId={String(id)}
                      width={screenWidth - spacing.lg * 2}
                      onOpenPhoto={(photo, _url, day) => {
                        setCalendarPick(day ?? null);
                        setLightboxId(photo.id);
                      }}
                    />
                  </View>
                ) : (
                  <View style={{ gap: spacing.md, padding: spacing.lg }}>
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
                      same kind of fact: where this is and who is there. The
                      row shows for everybody and only offers "Change" to a
                      role the server would actually accept a write from.
                    */}
                    <ProjectCrew projectId={String(id)} />

                    {/*
                      Next to the crew, because they are the same act: setting
                      a job up is deciding who is on it and what it needs. The
                      row reads as provenance once a blueprint has been applied.
                    */}
                    <ProjectBlueprint
                      projectId={String(id)}
                      projectName={project?.name ?? ""}
                      projectAddress={address}
                    />

                    {/*
                     * Every way deeper into a job, as one grouped block. Most
                     * are also tabs above; this is the full list, including
                     * the ones the tab row leaves off (Trash).
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
                )}
              </View>
            }
            ListEmptyComponent={
              tab !== "photos" ? null : !showPhotos ? (
                videos.length > 0 ? null : (
                  <EmptyState
                    icon={Video}
                    title="No site videos"
                    body="Videos recorded on this job show here. Switch the filter back to see its photos."
                    action={{ label: "Show photos", onPress: () => setMedia("all") }}
                  />
                )
              ) : photos.length === 0 ? (
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
                  title={
                    tagFilter.length > 0 ? "Nothing matches these filters" : "Nothing in this phase"
                  }
                  body="Switch the filter above, or tag some photos as you shoot them."
                  action={{
                    label: "Show all",
                    onPress: () => {
                      setFilter("all");
                      setTagFilter([]);
                    },
                  }}
                />
              )
            }
            ListFooterComponent={
              tab === "photos" && showPhotos && photosQuery.isFetchingNextPage ? (
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
                style={{
                  marginBottom: spacing.sm,
                  marginTop: spacing.md,
                  paddingHorizontal: spacing.lg,
                }}
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
                      <PhotoThumb
                        uri={urls[photo.id]}
                        width="100%"
                        height="100%"
                        rounded={radius.lg}
                      />
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
          <ActionRail
            actions={[
              {
                key: "capture",
                icon: Camera,
                label: "Capture",
                hint: "Opens the camera for this project",
                onPress: () => router.push(`/project/${id}/capture`),
              },
            ]}
          />
        )}
      </View>

      <ProjectEditorSheet
        visible={editing}
        onClose={() => setEditing(false)}
        project={project ?? null}
        stageName={stageName}
        onSave={(draft: ProjectDraft) => {
          setEditing(false);
          void patchProject(
            "details",
            draftToPatch(draft, { statusFromStage: Boolean(project?.pipeline_stage_id) }),
          );
        }}
      />

      <PhotoFilterSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        showTags={showTags}
        onShowTags={(next) => {
          setShowTags(next);
          if (!next) setTagFilter([]);
        }}
        logic={tagLogic}
        onLogic={setTagLogic}
        media={media}
        onMedia={setMedia}
        hasVideos={videos.length > 0}
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

      {/*
        The shared photo viewer: the web lightbox and its details panel, with
        Annotate, AI analysis, Share, tags, description, tasks and comments on
        the photo itself. Opens on the deep-linked photo when there is one.
      */}
      <PhotoViewer
        photos={viewerPhotos}
        urls={viewerUrls}
        photoId={lightboxId}
        onChangePhoto={setLightboxId}
        onClose={() => {
          setLightboxId(null);
          setCalendarPick(null);
        }}
        projectId={String(id)}
        onEndReached={calendarPick ? undefined : loadMore}
        inProject
      />
    </>
  );
}

const styles = StyleSheet.create({
  gridRow: { flexDirection: "row", gap: GRID_GAP, paddingHorizontal: spacing.lg },
  tile: { width: "100%", height: "100%", borderRadius: radius.sm },
  /* Sits over the whole tile so the ring reads as the tile being selected. */
  tileOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.lg,
    borderWidth: 3,
    alignItems: "flex-end",
    justifyContent: "flex-start",
    padding: 4,
  },
  tileCheck: {
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: radius.pill,
  },
});
