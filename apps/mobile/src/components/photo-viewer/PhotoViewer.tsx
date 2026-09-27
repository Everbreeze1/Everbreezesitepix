import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { FlatList, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useIsFocused } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { displayCaption, formatPhotoDate } from "@everlumen/shared";
import { phasePatch, type PhotoPatch } from "@/api/photo-edit";
import { listMentionable, listPhotoComments } from "@/api/photo-comments";
import { getPhotoDetail, listPhotoTasks, signOriginal } from "@/api/photo-viewer";
import {
  hasCoords,
  isTabletWidth,
  mapsLink,
  sidePanelWidth,
  stepIndex,
  toggleTagName,
  viewerPosition,
} from "@/api/photo-viewer-view";
import type { PhotoListItem } from "@/api/photos";
import { formatAddress, getProject } from "@/api/projects";
import { useAuth } from "@/lib/auth";
import { HIT_TARGET, radius, spacing, typography } from "@/theme";
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  RotateCcw,
  Share2,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "@/ui/icons";
import type { LucideIcon } from "@/ui";
import { PhotoCommentsThread, photoCommentsKey } from "./PhotoCommentsThread";
import { PhotoDetailsTab } from "./PhotoDetailsTab";
import { PanelBody, PanelHeader, type PanelTab } from "./PhotoPanel";
import { PhotoShareSheet } from "./PhotoShareSheet";
import { PhotoTagSheet } from "./PhotoTagSheet";
import { PhotoTasksTab, photoTasksKey } from "./PhotoTasksTab";
import { usePhotoEdit } from "./use-photo-edit";
import { ViewerSheet, type SheetSnap } from "./ViewerSheet";
import { viewerColors as c, viewerThreadColors } from "./viewer-theme";
import { ZoomableImage, type ZoomControls } from "./ZoomableImage";

/** A grid row, plus the project it belongs to when the grid spans projects. */
export type ViewerPhoto = PhotoListItem & {
  project_id?: string | null;
  project_name?: string | null;
};

export type PhotoViewerProps = {
  /** The photos to page through, in the order the grid shows them. */
  photos: ViewerPhoto[];
  /** The grid's signed URLs (thumbnails), shown while each original loads. */
  urls: Record<string, string | null | undefined>;
  /** The photo on screen; null closes the viewer. */
  photoId: string | null;
  onClose: () => void;
  /** Told whenever the photo on screen changes. */
  onChangePhoto?: (photoId: string) => void;
  /** The project, for photos whose row does not carry one. */
  projectId?: string | null;
  /** Near the end of `photos`: load the next page. */
  onEndReached?: () => void;
  /**
   * Opened from this project's own screen, so "Open project" would only push
   * the same screen again and is left out.
   */
  inProject?: boolean;
};

/**
 * The photo viewer: one component for every place a photo opens full screen.
 *
 * The phone's copy of the web's `PhotoLightbox` with its `PhotoDetailsPanel`:
 * the same top bar (description, date, "2 / 200", Annotate, Share, Close), the
 * same project header and Details / Tasks / Comments tabs, laid out for the
 * device in hand.
 *
 * **Phone.** The photo fills the screen; swipe between photos, pinch or double
 * tap to zoom, tap once to hide everything (web's full-screen button). The
 * panel is a sheet that drags up from the bottom.
 *
 * **Tablet** (768pt and wider). The photo on the left and the panel on the
 * right, as on the web, with previous/next arrows and zoom controls. The top
 * bar's actions sit at its right edge, under a right thumb.
 *
 * Leaving for Annotate, AI analysis or a task hides the viewer rather than
 * closing it, so Back comes straight back to the same photo on the same tab.
 */
export function PhotoViewer({
  photos,
  urls,
  photoId,
  onClose,
  onChangePhoto,
  projectId: fallbackProjectId,
  onEndReached,
  inProject = false,
}: PhotoViewerProps) {
  const focused = useIsFocused();
  const [currentId, setCurrentId] = useState<string | null>(photoId);
  /*
   * Held out here rather than inside the Modal: a Modal that hides unmounts
   * what is inside it, and the tab, the sheet and any unsaved edit should all
   * still be there after a trip to Annotate and back.
   */
  const [tab, setTab] = useState<PanelTab>("details");
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const [chromeHidden, setChromeHidden] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, PhotoPatch>>({});

  useEffect(() => {
    if (photoId) setCurrentId(photoId);
  }, [photoId]);

  const open = Boolean(photoId);

  const close = useCallback(() => {
    setChromeHidden(false);
    setSnap("peek");
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={open && focused}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (snap !== "peek") setSnap("peek");
        else close();
      }}
      statusBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
    >
      {open && currentId ? (
        <ViewerBody
          photos={photos}
          urls={urls}
          currentId={currentId}
          setCurrentId={(id) => {
            setCurrentId(id);
            onChangePhoto?.(id);
          }}
          onClose={close}
          fallbackProjectId={fallbackProjectId ?? null}
          onEndReached={onEndReached}
          inProject={inProject}
          tab={tab}
          setTab={setTab}
          snap={snap}
          setSnap={setSnap}
          chromeHidden={chromeHidden}
          setChromeHidden={setChromeHidden}
          panelOpen={panelOpen}
          setPanelOpen={setPanelOpen}
          overrides={overrides}
          setOverrides={setOverrides}
        />
      ) : null}
    </Modal>
  );
}

function ViewerBody({
  photos,
  urls,
  currentId,
  setCurrentId,
  onClose,
  fallbackProjectId,
  onEndReached,
  inProject,
  tab,
  setTab,
  snap,
  setSnap,
  chromeHidden,
  setChromeHidden,
  panelOpen,
  setPanelOpen,
  overrides,
  setOverrides,
}: {
  photos: ViewerPhoto[];
  urls: Record<string, string | null | undefined>;
  currentId: string;
  setCurrentId: (id: string) => void;
  onClose: () => void;
  fallbackProjectId: string | null;
  onEndReached?: () => void;
  inProject: boolean;
  tab: PanelTab;
  setTab: (tab: PanelTab) => void;
  snap: SheetSnap;
  setSnap: (snap: SheetSnap) => void;
  chromeHidden: boolean;
  setChromeHidden: (next: boolean | ((prev: boolean) => boolean)) => void;
  panelOpen: boolean;
  setPanelOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  overrides: Record<string, PhotoPatch>;
  setOverrides: (next: (prev: Record<string, PhotoPatch>) => Record<string, PhotoPatch>) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const tablet = isTabletWidth(windowWidth);
  const showPanel = !tablet || panelOpen;

  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const [area, setArea] = useState<number>(0);
  const [zoomed, setZoomed] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null);
  const [topBarHeight, setTopBarHeight] = useState(0);
  const listRef = useRef<FlatList<ViewerPhoto>>(null);
  const controls = useRef<Record<string, ZoomControls | null>>({});

  /* ------------------------------------------------------------ the list */

  const found = photos.findIndex((photo) => photo.id === currentId);

  /*
   * The photo on screen, read on its own. Gives the panel its GPS and author,
   * and lets a photo opened by deep link draw before its grid page has loaded.
   */
  const detailQuery = useQuery({
    queryKey: ["photo-detail", currentId],
    queryFn: () => getPhotoDetail(currentId),
    staleTime: 60_000,
  });
  const detail = detailQuery.data ?? null;

  /*
   * The last photo seen, so a tag edit that drops it out of a filtered grid
   * does not snatch it from under the person editing it.
   */
  const lastSeen = useRef<ViewerPhoto | null>(null);
  if (found >= 0) lastSeen.current = photos[found];
  const loose: ViewerPhoto | null = lastSeen.current?.id === currentId ? lastSeen.current : detail;
  const list = found >= 0 ? photos : loose ? [loose] : [];
  const index = found >= 0 ? found : 0;
  const listMode = found >= 0 ? "all" : "one";

  const base = list[index] ?? null;
  const photo = useMemo(() => {
    if (!base) return null;
    return {
      ...base,
      ...(detail && detail.id === base.id
        ? {
            latitude: detail.latitude,
            longitude: detail.longitude,
            uploaded_by: detail.uploaded_by,
            project_id: base.project_id ?? detail.project_id,
          }
        : { latitude: null, longitude: null, uploaded_by: null }),
      ...(overrides[base.id] ?? {}),
    };
  }, [base, detail, overrides]);

  const projectId = photo?.project_id ?? fallbackProjectId ?? null;

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });
  const project = projectQuery.data ?? null;
  const address = project ? formatAddress(project) : null;

  const originalQuery = useQuery({
    queryKey: ["photo-original", photo?.id],
    queryFn: () => signOriginal(photo!),
    enabled: Boolean(photo),
    staleTime: 45 * 60 * 1000,
  });
  const imageUrl = originalQuery.data ?? (photo ? (urls[photo.id] ?? null) : null);

  const people = useQuery({
    queryKey: ["mentionable"],
    queryFn: listMentionable,
    staleTime: 5 * 60 * 1000,
  });
  const takenBy = useMemo(() => {
    const uploader = photo?.uploaded_by;
    if (!uploader) return null;
    if (uploader === user?.id) return "You";
    const person = people.data?.find((p) => p.userId === uploader);
    return person?.fullName || person?.email?.split("@")[0] || "A teammate";
  }, [photo?.uploaded_by, people.data, user?.id]);

  /* The tab counts read the same keys the tabs load, so they cost nothing. */
  const tasksQuery = useQuery({
    queryKey: photoTasksKey(currentId),
    queryFn: () => listPhotoTasks(projectId!, currentId),
    enabled: Boolean(projectId),
  });
  const commentsQuery = useQuery({
    queryKey: photoCommentsKey(currentId),
    queryFn: () => listPhotoComments(currentId),
  });

  /* ------------------------------------------------------------ editing */

  const applyLocal = useCallback(
    (id: string, patch: PhotoPatch) =>
      setOverrides((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } })),
    [setOverrides],
  );
  const edit = usePhotoEdit(applyLocal);

  const tags = photo?.tags ?? [];
  const toggleTag = (name: string) => {
    if (!photo) return;
    void edit(photo.id, projectId, "tags", { tags: toggleTagName(photo.tags, name) });
  };

  /* ------------------------------------------------------------- paging */

  const go = (delta: number) => {
    const next = stepIndex(index, delta, list.length);
    if (next === index || !list[next]) return;
    setCurrentId(list[next].id);
    listRef.current?.scrollToIndex({ index: next, animated: true });
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!stage) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / stage.width);
    const next = list[Math.min(Math.max(i, 0), list.length - 1)];
    if (next && next.id !== currentId) setCurrentId(next.id);
  };

  /* Leaving for another screen keeps the viewer; see the component note. */
  const annotate = () => {
    if (!photo || !projectId) return;
    router.push({
      pathname: "/photo/[id]/annotate",
      params: {
        id: photo.id,
        uri: imageUrl ?? "",
        projectId,
        caption: photo.caption ?? "",
        phase: photo.phase ?? "untagged",
      },
    });
  };
  const analyse = () => {
    if (!photo) return;
    router.push({
      pathname: "/photo/[id]/analysis",
      params: { id: photo.id, uri: imageUrl ?? "", caption: photo.caption ?? "" },
    });
  };
  const openProject =
    !inProject && projectId
      ? () => {
          onClose();
          router.push(`/project/${projectId}`);
        }
      : undefined;

  const chooseTab = (next: PanelTab) => {
    setTab(next);
    if (!tablet && snap === "peek") setSnap("half");
  };

  /* ---------------------------------------------------------------- draw */

  const caption = photo ? displayCaption(photo.caption, "") : "";
  const dateLabel = photo ? formatPhotoDate(photo.taken_at ?? photo.created_at) || null : null;
  const position = viewerPosition(index, found >= 0 ? photos.length : 1);
  const gps = hasCoords(photo?.latitude, photo?.longitude);
  const maps = mapsLink(photo?.latitude, photo?.longitude, address);
  const panelWidth = sidePanelWidth(windowWidth);
  const bottomInset = Math.max(insets.bottom, spacing.md);

  const header = (
    <PanelHeader
      projectName={project?.name ?? (photo as ViewerPhoto | null)?.project_name ?? "Project"}
      address={address}
      dateLabel={dateLabel}
      hasGps={gps}
      mapsUrl={maps}
      onOpenProject={openProject}
      tab={tab}
      onTab={chooseTab}
      taskCount={tasksQuery.data?.tasks.length ?? null}
      commentCount={commentsQuery.data?.length ?? null}
      grabber={!tablet}
      onGrabber={() => setSnap(snap === "peek" ? "half" : "peek")}
    />
  );

  const expand = () => {
    if (!tablet) setSnap("full");
  };

  const body = photo ? (
    <PanelBoundary photoId={photo.id}>
      <PanelBody
        tab={tab}
        details={
          <PhotoDetailsTab
            photo={{
              id: photo.id,
              caption: photo.caption,
              tags,
              phase: photo.phase,
              taken_at: photo.taken_at,
              created_at: photo.created_at,
              latitude: photo.latitude ?? null,
              longitude: photo.longitude ?? null,
            }}
            projectAddress={address}
            takenBy={takenBy}
            onSaveDescription={(next) =>
              void edit(photo.id, projectId, "caption", { caption: next })
            }
            onRemoveTag={toggleTag}
            onOpenTags={() => setTagsOpen(true)}
            onSetPhase={(phase) => void edit(photo.id, projectId, "phase", phasePatch(phase))}
            onAnalyse={analyse}
            onInputFocus={expand}
            bottomInset={bottomInset}
          />
        }
        tasks={<PhotoTasksTab photoId={photo.id} projectId={projectId} bottomInset={bottomInset} />}
        comments={
          <View style={{ flex: 1, paddingBottom: tablet ? 0 : insets.bottom }}>
            <PhotoCommentsThread
              photoId={photo.id}
              projectId={projectId}
              colors={viewerThreadColors}
              seed={seed}
              onComposerFocus={expand}
            />
          </View>
        }
      />
    </PanelBoundary>
  ) : null;

  const topBar = (
    <View
      onLayout={(e) => setTopBarHeight(e.nativeEvent.layout.height)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingTop: insets.top + spacing.sm,
        paddingBottom: spacing.sm,
        paddingLeft: Math.max(insets.left, spacing.lg),
        paddingRight: tablet && showPanel ? spacing.md : Math.max(insets.right, spacing.md),
        backgroundColor: tablet ? c.chrome : "rgba(17, 13, 9, 0.82)",
        borderBottomWidth: 1,
        borderBottomColor: c.border,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[typography.bodyStrong, { color: c.foreground }]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {caption || "Photo"}
        </Text>
        <Text style={[typography.caption, { color: c.muted }]} numberOfLines={1}>
          {[dateLabel, position].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {/* Right-aligned, for the right thumb: the owner's call and web's order. */}
      {/*
        Icons, as on the web's top bar: pencil to annotate, sparkles for AI,
        the full-screen corners, the share glyph and a close cross. Every one
        carries its name for a screen reader. Annotate is the one primary
        action, so it is the one drawn in the brand colour.
      */}
      <View style={{ flexDirection: "row", gap: spacing.xs }}>
        <BarButton
          icon={PenLine}
          label="Annotate"
          onPress={annotate}
          disabled={!projectId}
          primary
        />
        <BarButton icon={Sparkles} label="Analyse with AI" onPress={analyse} />
        {tablet ? (
          <BarButton
            icon={panelOpen ? PanelRightClose : PanelRightOpen}
            label={panelOpen ? "Hide details" : "Show details"}
            onPress={() => setPanelOpen((v) => !v)}
          />
        ) : null}
        <BarButton
          icon={Maximize}
          label="Full screen"
          onPress={() => {
            setChromeHidden(true);
            if (tablet) setPanelOpen(false);
          }}
        />
        <BarButton icon={Share2} label="Share photo" onPress={() => setShareOpen(true)} />
        <BarButton icon={X} label="Close photo" onPress={onClose} />
      </View>
    </View>
  );

  const pager =
    stage && list.length > 0 ? (
      <FlatList
        key={`${listMode}:${stage.width}`}
        ref={listRef}
        data={list}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed && list.length > 1}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        initialScrollIndex={index}
        getItemLayout={(_data, i) => ({ length: stage.width, offset: stage.width * i, index: i })}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        onMomentumScrollEnd={onMomentumEnd}
        onEndReached={listMode === "all" ? onEndReached : undefined}
        onEndReachedThreshold={3}
        extraData={index}
        renderItem={({ item, index: i }) => (
          <ViewerPage
            photo={item}
            thumb={urls[item.id] ?? null}
            width={stage.width}
            height={stage.height}
            active={i === index}
            near={Math.abs(i - index) <= 1}
            register={(r) => {
              controls.current[item.id] = r;
            }}
            onZoomChange={i === index ? setZoomed : undefined}
            onTap={() => setChromeHidden((v) => !v)}
          />
        )}
      />
    ) : (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        {detailQuery.isLoading || !stage ? (
          <ActivityIndicator color={c.muted} size="large" />
        ) : (
          <Text style={[typography.body, { color: c.muted }]}>This photo is not available.</Text>
        )}
      </View>
    );

  const zoom = (act: keyof ZoomControls) => controls.current[currentId]?.[act]();

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.stage }}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={{ flex: 1, flexDirection: tablet ? "row" : "column" }}
          onLayout={(e) => setArea(e.nativeEvent.layout.height)}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            {tablet && !chromeHidden ? topBar : null}
            <View
              style={{ flex: 1 }}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                setStage((prev) =>
                  prev && prev.width === width && prev.height === height ? prev : { width, height },
                );
              }}
            >
              {pager}

              {tablet && !chromeHidden && list.length > 1 ? (
                <>
                  <ArrowButton
                    side="left"
                    icon={ChevronLeft}
                    label="Previous photo"
                    disabled={index === 0}
                    onPress={() => go(-1)}
                  />
                  <ArrowButton
                    side="right"
                    icon={ChevronRight}
                    label="Next photo"
                    disabled={index >= list.length - 1}
                    onPress={() => go(1)}
                  />
                </>
              ) : null}

              {tablet && !chromeHidden && list.length > 0 ? (
                <View
                  style={{
                    position: "absolute",
                    bottom: spacing.xl + insets.bottom,
                    alignSelf: "center",
                    flexDirection: "row",
                    gap: spacing.xs,
                    padding: 6,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: c.border,
                    backgroundColor: c.glass,
                  }}
                >
                  <BarButton icon={ZoomOut} label="Zoom out" onPress={() => zoom("zoomOut")} bare />
                  <BarButton
                    icon={RotateCcw}
                    label="Reset zoom"
                    onPress={() => zoom("reset")}
                    bare
                  />
                  <BarButton icon={ZoomIn} label="Zoom in" onPress={() => zoom("zoomIn")} bare />
                </View>
              ) : null}
            </View>
          </View>

          {tablet && showPanel ? (
            <View
              style={{
                width: panelWidth,
                paddingTop: insets.top,
                paddingRight: insets.right,
                backgroundColor: c.chrome,
                borderLeftWidth: 1,
                borderLeftColor: c.border,
              }}
            >
              {header}
              <View style={{ flex: 1, paddingBottom: insets.bottom }}>{body}</View>
            </View>
          ) : null}
        </View>

        {!tablet && !chromeHidden ? (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0 }}>{topBar}</View>
        ) : null}

        {/*
          Zoom on a phone: pinch and double tap still work, and these are the
          web's zoom out / reset / zoom in for anyone who does not know that.
          A column at the right edge under the top bar, clear of the sheet,
          and only while the sheet is lowered so it never floats over text.
        */}
        {!tablet && !chromeHidden && snap === "peek" && list.length > 0 && topBarHeight > 0 ? (
          <View
            style={{
              position: "absolute",
              top: topBarHeight + spacing.md,
              right: Math.max(insets.right, spacing.md),
              gap: 2,
              padding: 4,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.glass,
            }}
          >
            <BarButton icon={ZoomIn} label="Zoom in" onPress={() => zoom("zoomIn")} bare />
            <BarButton icon={RotateCcw} label="Reset zoom" onPress={() => zoom("reset")} bare />
            <BarButton icon={ZoomOut} label="Zoom out" onPress={() => zoom("zoomOut")} bare />
          </View>
        ) : null}

        {/*
          Full screen hides every control, so one stays behind to say how to
          get them back: a tap on the photo does it too, but nobody guesses that.
        */}
        {chromeHidden ? (
          <View
            style={{
              position: "absolute",
              top: insets.top + spacing.sm,
              right: Math.max(insets.right, spacing.md),
            }}
          >
            <BarButton
              icon={Minimize}
              label="Exit full screen"
              onPress={() => {
                setChromeHidden(false);
                if (tablet) setPanelOpen(true);
              }}
              glass
            />
          </View>
        ) : null}

        {!tablet && area > 0 ? (
          <ViewerSheet
            height={area}
            topLimit={topBarHeight || insets.top + 64}
            bottomInset={insets.bottom}
            snap={snap}
            hidden={chromeHidden}
            onSnap={setSnap}
            handle={header}
          >
            {body}
          </ViewerSheet>
        ) : null}
      </KeyboardAvoidingView>

      {photo ? (
        <>
          <PhotoTagSheet
            visible={tagsOpen}
            photoTags={tags}
            userId={user?.id ?? null}
            onToggle={toggleTag}
            onClose={() => setTagsOpen(false)}
          />
          <PhotoShareSheet
            visible={shareOpen}
            onClose={() => setShareOpen(false)}
            photoId={photo.id}
            caption={displayCaption(photo.caption, "Photo")}
            imageUrl={imageUrl}
            onAskTeammate={() => {
              setShareOpen(false);
              setTab("comments");
              if (!tablet) setSnap("full");
              else setPanelOpen(true);
              setChromeHidden(false);
              setSeed({ text: "@", nonce: Date.now() });
            }}
          />
        </>
      ) : null}
    </GestureHandlerRootView>
  );
}

/** One page of the pager: the zoomable photo, signing its original when near. */
function ViewerPage({
  photo,
  thumb,
  width,
  height,
  active,
  near,
  register,
  onZoomChange,
  onTap,
}: {
  photo: ViewerPhoto;
  thumb: string | null;
  width: number;
  height: number;
  active: boolean;
  near: boolean;
  register: (controls: ZoomControls | null) => void;
  onZoomChange?: (zoomed: boolean) => void;
  onTap: () => void;
}) {
  /*
   * The original is signed for this photo and its neighbours only, so a swipe
   * lands on the full-size file and paging through two hundred photos does
   * not sign two hundred originals.
   */
  const original = useQuery({
    queryKey: ["photo-original", photo.id],
    queryFn: () => signOriginal(photo),
    enabled: near,
    staleTime: 45 * 60 * 1000,
  });
  return (
    <ZoomableImage
      ref={register}
      uri={original.data ?? null}
      placeholder={thumb}
      width={width}
      height={height}
      active={active}
      onZoomChange={onZoomChange}
      onSingleTap={onTap}
      accessibilityLabel={displayCaption(photo.caption, "Photo")}
    />
  );
}

function BarButton({
  icon: Glyph,
  label,
  onPress,
  disabled,
  bare,
  primary,
  glass,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  bare?: boolean;
  /** The one brand-coloured action in the bar. */
  primary?: boolean;
  /** Floating over the photograph with nothing behind it. */
  glass?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={2}
      style={({ pressed }) => ({
        width: HIT_TARGET,
        height: HIT_TARGET,
        borderRadius: HIT_TARGET / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: primary
          ? c.primary
          : pressed
            ? "rgba(233,228,220,0.22)"
            : bare
              ? "transparent"
              : glass
                ? c.glass
                : "rgba(233,228,220,0.1)",
        opacity: disabled ? 0.4 : primary && pressed ? 0.85 : 1,
      })}
    >
      <Glyph size={20} color={primary ? c.primaryForeground : c.foreground} strokeWidth={2.1} />
    </Pressable>
  );
}

function ArrowButton({
  side,
  icon: Glyph,
  label,
  onPress,
  disabled,
}: {
  side: "left" | "right";
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        position: "absolute",
        top: "50%",
        marginTop: -26,
        [side]: spacing.lg,
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? c.glassPressed : c.glass,
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Glyph size={28} color={c.foreground} />
    </Pressable>
  );
}

/**
 * Keeps a broken panel from taking the photo down with it, as web's
 * `PhotoLightboxPanelBoundary` does. Moving to another photo tries again.
 */
class PanelBoundary extends Component<
  { photoId: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[photo-viewer] panel failed", error, info.componentStack);
  }

  componentDidUpdate(prev: { photoId: string }) {
    if (prev.photoId !== this.props.photoId && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={[typography.bodyStrong, { color: c.foreground }]}>
            Details could not load
          </Text>
          <Text style={[typography.caption, { color: c.muted, textAlign: "center" }]}>
            The photo is still open. Try another photo, or close and reopen this one.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}
