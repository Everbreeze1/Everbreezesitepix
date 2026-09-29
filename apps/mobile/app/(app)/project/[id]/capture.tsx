import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions, type CameraType, type FlashMode } from "expo-camera";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useQuery } from "@tanstack/react-query";
import { listProjectPhotos, type CapturedAsset, type PhotoPhase } from "@/api/photos";
import { getMyTeam } from "@/api/team";
import { type WatermarkTag } from "@/api/watermark";
import { downscaleForStamp, makePreviewThumb, renderWatermarked } from "@/api/watermark-render";
import { WatermarkCanvas } from "@/components/WatermarkCanvas";
import { ScanCanvas } from "@/components/ScanCanvas";
import { ScanCropper } from "@/components/ScanCropper";
import { prepareScanSource } from "@/components/ScanSurface";
import { guideToImageQuad, type Quad } from "@/components/scan-warp";
import { CameraModeRow, cameraModes, type CameraMode } from "@/components/CameraModeRow";
import { LevelIndicator } from "@/components/LevelIndicator";
import { ShotAnnotator } from "@/components/ShotAnnotator";
import { ShotEditor, type ShotPatch } from "@/components/ShotEditor";
import { TagPickerSheet } from "@/components/TagPickerSheet";
import { PhotoNoteEditor, type NoteEditorAction } from "@/components/capture/PhotoNoteEditor";
import { useTagLibrary } from "@/components/photo-viewer/TagPill";
import { formatAddress, getProject, projectCoords } from "@/api/projects";
import { projectDisplayName } from "@everlumen/shared";
import { useAuth } from "@/lib/auth";
import { takeCaptureNotice } from "@/lib/capture-notice";
import { deviceSupportsMeasure } from "@/lib/measure-support";
import {
  addRecent,
  EMPTY_NOTE,
  metaForNewShot,
  noteIsActive,
  noteSummary,
  patchRecent,
  phaseAtShutter,
  pillChanged,
  pillOf,
  queuedMetaPatch,
  uploadedMetaPatch,
  type CaptureNote,
} from "@/lib/capture-batch";
import { persistCapture, replaceCapture } from "@/offline/media";
import {
  discardUnsent,
  enqueue,
  finishHeld,
  holdQueued,
  newOutboxId,
  updateQueuedPayload,
} from "@/offline/outbox";
import {
  closeCaptureSession,
  openCaptureSession,
  recordSessionPhoto,
} from "@/offline/capture-session";
import { refreshQueue, requestSync } from "@/offline/sync";
import {
  capturedPhotoPatchRowId,
  type CapturedPhotoPatchPayload,
  type PhotoUploadPayload,
} from "@/offline/handlers";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";
import { Icon } from "@/ui";
import {
  ChevronDown,
  Crop,
  Grid3x3,
  ImageIcon,
  MapPin,
  Mic,
  RefreshCw,
  Ruler,
  StickyNote,
  SwitchCamera,
  X,
} from "@/ui/icons";

/**
 * One shot this camera visit has taken. It is saved (queued to the outbox)
 * the moment it is taken; this is what the camera keeps so the shot can be
 * retagged, captioned or annotated on its own afterwards.
 */
type RecentShot = {
  /** The outbox row id, which is also the upload's idempotency key. */
  id: string;
  asset: CapturedAsset;
  /**
   * The shot's own picture, without its before/after pill: the camera's file,
   * or its annotated or cropped version. The pill is always burnt in from
   * this, so a retag redraws it rather than stacking a second pill.
   */
  source: string;
  width?: number | null;
  height?: number | null;
  /** The queued copy in app storage, once it is queued. */
  localUri: string | null;
  /** A small copy for the corner and the strip, once it has been made. */
  thumb?: string;
  /** Taken in Scan mode: filed with the scan tag, never given a pill. */
  scan: boolean;
  /** Before/After as selected when this shot's shutter fired, or as retagged since. */
  phase: PhotoPhase;
  caption: string;
  tags: string[];
  /** When the shutter fired (ISO), for the timeline when EXIF has no time. */
  capturedAt: string;
  /** Could not be stored on the device. Still on screen, with a retry. */
  failed?: boolean;
};

/** The camera file work for one queued shot: its pill, or an edit's new picture. */
type FileJob = { gen: number; running: boolean; edited: boolean };

/**
 * The note editor, for the shots still to come or for one saved shot.
 * `start` opens it straight into dictation ("voice") or typing.
 */
type Panel =
  | { kind: "next"; start?: "voice" | "type" }
  | { kind: "shot"; id: string; start?: "voice" | "type" };

/**
 * How long a queued Before/After photo waits for its pill before it uploads
 * without one. The pill takes about a second a photo; this is only the
 * ceiling for a camera closed, or an app killed, before it finished.
 */
const STAMP_HOLD_MS = 2 * 60_000;

/** How long a caption keeps typing before the queued row is rewritten. */
const META_DEBOUNCE_MS = 700;

/** The viewfinder's Before/After toggle, worded as web's. */
const PHASE_TOGGLE: { id: PhotoPhase; label: string }[] = [
  { id: "before", label: "BEFORE" },
  { id: "untagged", label: "None" },
  { id: "after", label: "AFTER" },
];

export default function CaptureScreen() {
  /*
   * `checklistItemId` arrives when the capture was started from a checklist
   * item, so the resulting photo becomes evidence against it. The link is made
   * by the queue handler after the upload lands, because the photo has no id
   * until then.
   */
  const {
    id: projectId,
    checklistItemId,
    workflowItemId,
  } = useLocalSearchParams<{
    id: string;
    checklistItemId?: string;
    workflowItemId?: string;
  }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  /*
   * A tablet by its short side, in either orientation. There the camera's
   * note, voice and library controls sit on a rail on the right, where the
   * hand holding it can reach, and the note panel docks to that side.
   */
  const wide = Math.min(winWidth, winHeight) >= 600;
  const { user } = useAuth();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [facing, setFacing] = useState<CameraType>("back");
  const [flash, setFlash] = useState<FlashMode>("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A passing word on the viewfinder, such as Dual being on its way. */
  const [notice, setNotice] = useState<string | null>(null);

  const [phase, setPhase] = useState<PhotoPhase>("untagged");
  const [mode, setMode] = useState<CameraMode>("photo");
  /**
   * The caption and tags the next shots are saved with. Sticky until cleared,
   * and shown on the camera's note pill whenever either is set.
   */
  const [note, setNote] = useState<CaptureNote>(EMPTY_NOTE);
  /** The note panel, open for the next shots or for one saved shot. */
  const [panel, setPanel] = useState<Panel | null>(null);
  /** Whose tags the tag picker is changing: the next shots', or one shot's. */
  const [tagsFor, setTagsFor] = useState<"next" | string | null>(null);
  /**
   * Whether the whole mode bar is showing. It opens on arrival so the modes
   * can be seen, then settles to the chosen mode once one is picked and after
   * every shot; tapping that pill opens it again.
   */
  const [modeBarOpen, setModeBarOpen] = useState(true);

  /** Rule-of-thirds grid, on by default as on web. */
  const [gridOn, setGridOn] = useState(true);

  /*
   * What this visit has saved, newest first. The ref is the truth for the
   * background work (pill burning, retags), which must read the latest state
   * of a shot rather than the one its closure saw; the state is for drawing.
   */
  const recentRef = useRef<RecentShot[]>([]);
  const [recent, setRecentState] = useState<RecentShot[]>([]);
  const setRecent = useCallback((next: RecentShot[]) => {
    recentRef.current = next;
    setRecentState(next);
  }, []);
  /** How many shots this visit has saved, for the corner's count. */
  const [savedCount, setSavedCount] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  /** The saved shot open full screen to annotate, measure or crop. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The picture Measure mode has just taken, open in the annotator's Measure tool. */
  const [measuring, setMeasuring] = useState<{ asset: CapturedAsset; phase: PhotoPhase } | null>(
    null,
  );
  /**
   * The page Scan mode has just taken, open on its corner step, with the
   * corners starting where the viewfinder's paper guide framed it.
   */
  const [scanPending, setScanPending] = useState<{
    asset: CapturedAsset;
    quad: Quad | null;
  } | null>(null);
  /** The paper guide and the viewfinder it sits in, as laid out, for that start. */
  const scanGuide = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const scanView = useRef<{ width: number; height: number } | null>(null);

  /*
   * The off-screen surface the before/after pill is burnt in on.
   *
   * One shot at a time rather than mounting a canvas per photo: a burst of
   * twenty at 2048px would be twenty full-resolution images held at once, and
   * the phone that just took them is the one least able to afford it.
   */
  const stampRef = useRef<Svg>(null);
  const [stamping, setStamping] = useState<
    | { kind: "watermark"; uri: string; width: number; height: number; tag: WatermarkTag }
    | { kind: "scan"; uri: string; width: number; height: number }
    | null
  >(null);
  const stampResolve = useRef<((uri: string) => void) | null>(null);

  const [deviceCoords, setDeviceCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  /*
   * The tags this project's photos already use, for the tag picker. The same
   * list web's camera offers (every tag on the project's photos).
   */
  const { data: projectTags = [] } = useQuery({
    queryKey: ["capture-tags", projectId],
    queryFn: async () => {
      const photos = await listProjectPhotos(projectId!, 200);
      return Array.from(new Set(photos.flatMap((photo) => photo.tags ?? []))).sort();
    },
    enabled: Boolean(projectId),
    staleTime: 5 * 60_000,
  });
  /*
   * Plus the workspace's tag library, which is what web's "Tag this photo"
   * sheet lists: a crew's standard tags (Condenser, Furnace Nameplate, Gas
   * Line) have to be pickable on a job that has not used them yet.
   */
  const tagLibrary = useTagLibrary();
  const existingTags = useMemo(
    () =>
      Array.from(new Set([...projectTags, ...(tagLibrary.data ?? []).map((tag) => tag.name)])).sort(
        (a, b) => a.localeCompare(b),
      ),
    [projectTags, tagLibrary.data],
  );

  /*
   * Measure is Pro/Team on web (`isPro`: an active pro or team plan). Same rule
   * here, read from the team the viewer belongs to. Until that answers, and if
   * it fails, the chip stays hidden rather than flickering in.
   */
  const { data: team } = useQuery({
    queryKey: ["my-team"],
    queryFn: getMyTeam,
    staleTime: 10 * 60_000,
  });
  /*
   * And only on a phone that can measure: iPhone 15 Pro and later Pro models
   * (Jon, 2026-09-27). Android never offers it, so the mode chip and the
   * preview's Measure button are both gone there.
   */
  const canMeasure =
    deviceSupportsMeasure() &&
    Boolean(team?.isActive && (team.plan === "pro" || team.plan === "team"));

  /*
   * Ask for location once, in the background, and never block capture on it.
   * A photo with no coordinates is still a useful photo; a shutter that will
   * not fire because a GPS fix is pending is not a useful camera.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const granted = await Location.requestForegroundPermissionsAsync();
      if (!granted.granted || cancelled) return;
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }).catch(() => null);
      if (position && !cancelled) {
        setDeviceCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** A shot of this visit, as it is now. */
  function recentShot(id: string): RecentShot | undefined {
    return recentRef.current.find((shot) => shot.id === id);
  }

  function patchShot(id: string, patch: Partial<RecentShot>) {
    setRecent(patchRecent(recentRef.current, id, patch));
  }

  /**
   * Make the corner's small copy in the background. A thumb made for a
   * picture the shot has since replaced (crop, annotate) is dropped.
   */
  const thumbFor = useCallback(
    (id: string, uri: string) => {
      void makePreviewThumb(uri).then((thumb) => {
        if (!thumb) return;
        const shot = recentRef.current.find((item) => item.id === id);
        if (shot && shot.source === uri) {
          setRecent(patchRecent(recentRef.current, id, { thumb }));
        }
      });
    },
    [setRecent],
  );

  /*
   * The job switch on the viewfinder. Only for a plain capture: one opened
   * for a checklist or workflow item files its evidence against this job.
   */
  const canSwitchJob = !checklistItemId && !workflowItemId;

  /**
   * Pick another job. `replace`, so the picker takes this camera's place and
   * opens the new job's camera in its own place in turn: backing out lands
   * where the person started, not on a second camera. Nothing is waiting to
   * be saved: every shot was queued, for this job, when it was taken.
   */
  function switchJob() {
    if (busy) return;
    router.replace("/capture-start");
  }

  /**
   * Switch camera mode from the row under the shutter.
   *
   * Mirrors web: Video and Walkthrough hand off to a recorder rather than
   * becoming a mode here. A site video is queued by the recorder the moment
   * it stops (`video_upload`), which then closes straight back to here. Video is a
   * plain site video saved to the project's videos, as web's "Record a site
   * video"; Walkthrough is the narrated walk with photos pinned to it. Leaving
   * Before/After clears the phase, as web clears its tag, so a Photo or Scan
   * run never inherits a pill picked for a different job.
   */
  function changeMode(next: CameraMode) {
    if (next === "video" || next === "walkthrough") {
      if (!projectId || busy) return;
      router.push({
        pathname: "/project/[id]/walkthrough-record",
        params: next === "video" ? { id: projectId, kind: "video" } : { id: projectId },
      });
      return;
    }
    if (next === "dual") {
      // Coming soon on web too; say so rather than fake a second stream.
      showNotice("Dual camera is coming soon");
      return;
    }
    if (next === "measure" && !canMeasure) return;
    setError(null);
    setMode(next);
    setModeBarOpen(false);
    if (next !== "before-after") setPhase("untagged");
    // Untagged is where tags are picked, as web's tag picker: it opens the
    // picker every time it is tapped, and the bar then shows what was picked.
    if (next === "untagged") setTagsFor("next");
  }

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showNotice(text: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  }
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  /*
   * Back from the video recorder: it queued the clip and closed at once, and
   * leaves its "saved" line here instead of holding the screen to say it.
   */
  useFocusEffect(
    useCallback(() => {
      const text = takeCaptureNotice();
      if (text) showNotice(text);
    }, []),
  );

  /**
   * Where a new picture goes, by mode.
   *
   * Measure opens it in the annotator's Measure tool first, as web does, and
   * saves it from there. Everything else is saved at once.
   *
   * `phase` is the one selected when the shutter fired, passed in rather than
   * read here, because a capture can land after the toggle has moved on.
   */
  function afterCapture(
    asset: CapturedAsset,
    scan: boolean,
    phase: PhotoPhase,
    allowMeasure = true,
  ) {
    if (allowMeasure && mode === "measure" && canMeasure) {
      setMeasuring({ asset, phase });
      return;
    }
    saveShot(asset, scan, phase);
  }

  /**
   * The paper guide mapped onto the photo, or null to use the default inset.
   * The camera's reported size can be the sensor's rather than the upright
   * picture's, so it is turned to match the viewfinder's orientation first.
   */
  function guideQuad(asset: CapturedAsset): Quad | null {
    const guide = scanGuide.current;
    const view = scanView.current;
    if (!guide || !view || !asset.width || !asset.height) return null;
    const turned = asset.width > asset.height !== view.width > view.height;
    const image = turned
      ? { width: asset.height, height: asset.width }
      : { width: asset.width, height: asset.height };
    return guideToImageQuad(guide, view, image);
  }

  async function takeShot() {
    if (!cameraRef.current || busy) return;
    setError(null);
    setModeBarOpen(false);
    // Read now, at the shutter, not after the picture comes back.
    const shutterPhase = phaseAtShutter(mode, phase);
    try {
      /*
       * `quality: 1` because `uploadProjectPhoto` re-encodes exactly once.
       * Compressing here as well would stack two lossy passes on the same
       * image for no saving, since the second pass sets the final size.
       */
      const picture = await cameraRef.current.takePictureAsync({ exif: true, quality: 1 });
      if (picture) {
        const asset: CapturedAsset = {
          uri: picture.uri,
          width: picture.width,
          height: picture.height,
          exif: picture.exif ?? null,
        };
        if (mode === "scan") {
          /*
           * Straight to the corner step, as a document scanner does, rather
           * than saved as a photo of a desk with a page on it. The
           * page is straightened and given its look there, before the strip
           * shows it, so it looks the way it will be filed.
           */
          setScanPending({ asset, quad: guideQuad(asset) });
        } else {
          afterCapture(asset, false, shutterPhase);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not take photo");
    }
  }

  async function pickFromLibrary() {
    const granted = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted.granted) {
      setError("Photo library permission is required");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      exif: true,
      quality: 1,
    });
    if (result.canceled) return;
    const scan = mode === "scan";
    const pickedPhase = phaseAtShutter(mode, phase, scan);
    if (scan) setBusy(true);
    try {
      for (const asset of result.assets) {
        const picked: CapturedAsset = {
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType,
          exif: (asset.exif as Record<string, unknown> | null) ?? null,
        };
        // Imports never open the Measure tool one after another; they can be
        // measured from the recent photos (Annotate) instead.
        if (scan) {
          // The document look is a new JPEG, so the picker's mime no longer applies.
          afterCapture(
            { ...picked, ...(await scanLook(picked)), mimeType: "image/jpeg" },
            true,
            pickedPhase,
            false,
          );
        } else {
          afterCapture(picked, false, pickedPhase, false);
        }
      }
    } finally {
      if (scan) setBusy(false);
    }
  }

  /*
   * Jobs for the one off-screen surface, run strictly one after another. The
   * background pill burner can be stamping one shot while Scan mode is
   * rendering the next, and two jobs on one surface would each resolve with
   * the other's picture.
   */
  const surfaceQueue = useRef<Promise<unknown>>(Promise.resolve());
  /** False once the screen has gone, so queued surface work stops waiting on it. */
  const alive = useRef(true);
  /** Ends the render in flight early, with the original, when the screen goes. */
  const stampAbort = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      alive.current = false;
      stampAbort.current?.();
    },
    [],
  );

  /** Mount the off-screen surface, flatten it, and hand back the file. */
  const renderOffscreen = useCallback((job: NonNullable<typeof stamping>) => {
    const now = async (): Promise<string> => {
      // No screen, no surface: waiting out the timeout would only delay the queue.
      if (!alive.current) return job.uri;
      try {
        const rendered = await new Promise<string>((resolve, reject) => {
          stampResolve.current = resolve;
          stampAbort.current = () => reject(new Error("Camera closed"));
          setStamping(job);
          // The canvas has to mount and lay out before it can rasterise. This is
          // the outer bound on that, separate from the rasteriser's own timeout.
          setTimeout(() => reject(new Error("Watermark surface never became ready")), 20_000);
        });
        return rendered;
      } catch {
        return job.uri;
      } finally {
        stampResolve.current = null;
        stampAbort.current = null;
        if (alive.current) setStamping(null);
      }
    };
    const run = surfaceQueue.current.then(now);
    surfaceQueue.current = run.catch(() => undefined);
    return run;
  }, []);

  /**
   * Give one imported page the document look, without the corner step (a run
   * of library imports should not open one after another; each can be
   * straightened from its preview's Crop).
   *
   * Upright and resized first, so the look is drawn at the picture's real
   * orientation and size. Fails open: a scan that keeps its colour is still a
   * scan.
   */
  const scanLook = useCallback(
    async (
      asset: CapturedAsset,
    ): Promise<{ uri: string; width?: number | null; height?: number | null }> => {
      const source = await prepareScanSource(asset.uri).catch(() => null);
      if (!source) return { uri: asset.uri, width: asset.width, height: asset.height };
      const uri = await renderOffscreen({ kind: "scan", ...source });
      return { uri, width: source.width, height: source.height };
    },
    [renderOffscreen],
  );

  /*
   * Rasterise once the surface has actually mounted.
   *
   * Driven by an effect rather than called inline, because `toDataURL` needs a
   * laid-out native view and the ref is null until React has committed it.
   */
  useEffect(() => {
    if (!stamping) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const uri = await renderWatermarked(stampRef.current);
          if (!cancelled) stampResolve.current?.(uri);
        } catch {
          // Resolving with the original is what makes this fail open.
          if (!cancelled) stampResolve.current?.(stamping.uri);
        }
      })();
      // One frame is enough for the view to exist; 120ms is generous cover for
      // a slow device decoding a 2048px image into the surface first.
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stamping]);

  /*
   * The capture session this visit's shots are recorded against, which is what
   * the Daily Log is written from. One per camera visit, the way one Save used
   * to be one trip to the van and back. Opened with the first shot and kept
   * from being written up until the camera closes (`openCaptureSession`), so
   * a shot landing between two shutter presses does not write the visit up
   * with only that photo in it.
   *
   * The offset is read from THIS device, on purpose. "Daily" has to mean the
   * technician's day: the API runs in UTC, so a 6:30pm job in California is
   * already tomorrow to the server.
   */
  const sessionRef = useRef<{ sessionId: string; tzOffsetMinutes: number } | null>(null);
  function captureSession() {
    if (!sessionRef.current) {
      sessionRef.current = {
        sessionId: newOutboxId(),
        tzOffsetMinutes: new Date().getTimezoneOffset(),
      };
      openCaptureSession(sessionRef.current.sessionId);
    }
    return sessionRef.current;
  }

  /**
   * Save one new picture: it joins this visit's shots at once, with the
   * phase from its shutter and the camera's note, and is queued straight
   * away. No Save step: it is on its way to the project timeline before the
   * next shot.
   */
  function saveShot(asset: CapturedAsset, scan: boolean, phase: PhotoPhase) {
    const meta = metaForNewShot(note, scan);
    const shot: RecentShot = {
      id: newOutboxId(),
      asset,
      source: asset.uri,
      width: asset.width,
      height: asset.height,
      localUri: null,
      scan,
      phase: scan ? "untagged" : phase,
      caption: meta.caption,
      tags: meta.tags,
      capturedAt: new Date().toISOString(),
    };
    setRecent(addRecent(recentRef.current, shot));
    thumbFor(shot.id, shot.source);
    void storeShot(shot.id);
  }

  /**
   * Queue one shot: copy it into app storage and enqueue it, as it is now.
   *
   * Milliseconds per photo: nothing is decoded or drawn here. A Before/After
   * photo is queued held and its pill is burnt in afterwards by `refile`.
   * Nothing is uploaded here either; the drain delivers it whenever the
   * network allows, with the queue banner showing progress.
   *
   * If the device cannot store it (local storage, never the network), the shot
   * stays in the strip marked unsaved, with a retry, because its file is still
   * only in the camera cache.
   */
  async function storeShot(id: string) {
    const shot = recentShot(id);
    if (!shot || !projectId || !user) return;
    try {
      // Named after the row id, which is also the upload's idempotency key.
      const localUri = persistCapture(shot.source, shot.id);
      const pill = pillOf(shot);
      const session = captureSession();
      const payload: PhotoUploadPayload = {
        userId: user.id,
        projectId,
        captureSessionId: session.sessionId,
        attachToChecklistItemId: checklistItemId ?? null,
        attachToWorkflowItemId: workflowItemId ?? null,
        width: shot.width,
        height: shot.height,
        exif: shot.asset.exif,
        ...queuedMetaPatch(shot),
        deviceCoords,
        projectCoords: projectCoords(project ?? null),
        capturedAt: shot.capturedAt,
      };
      await enqueue({
        id: shot.id,
        kind: "photo_upload",
        projectId,
        localUri,
        payload,
        holdUntil: pill ? Date.now() + STAMP_HOLD_MS : undefined,
      });
      // After the enqueue, so a session row can never point at a photo that
      // was never queued. A failure here costs the log, not the photograph.
      await recordSessionPhoto({
        outboxId: shot.id,
        sessionId: session.sessionId,
        projectId,
        source: "camera",
        tzOffsetMinutes: session.tzOffsetMinutes,
      }).catch(() => {});
      patchShot(shot.id, { localUri, failed: false });
      setSavedCount((count) => count + 1);
      flashSaved();
      await refreshQueue();
      requestSync();
      if (pill) void refile(shot.id);
      /*
       * A retag made while this was being stored went to a row that did not
       * exist yet; write the shot as it is now.
       */
      const now = recentShot(shot.id);
      if (now && now.source !== shot.source) void refileAfterEdit(shot.id);
      if (now && metaKey(now) !== metaKey(shot)) void flushMeta(shot.id);
    } catch {
      patchShot(shot.id, { failed: true });
      setError("Could not save that photo to this device. Tap it in the corner to try again.");
    }
  }

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flashSaved() {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSavedFlash(true);
    savedTimer.current = setTimeout(() => setSavedFlash(false), 700);
  }

  /*
   * The file work per queued shot. `gen` counts edits to its picture (a new
   * pill, an annotation, a crop), so a render that finishes after the shot
   * changed again is thrown away and done over rather than queued stale.
   */
  const fileJobs = useRef(new Map<string, FileJob>());
  function fileJob(id: string): FileJob {
    let job = fileJobs.current.get(id);
    if (!job) {
      job = { gen: 0, running: false, edited: false };
      fileJobs.current.set(id, job);
    }
    return job;
  }

  /**
   * Bring a queued shot's file up to date: its pill burnt in from its own
   * picture, or the picture as it is when it has no pill. The row is held
   * (`holdUntil` at queue time, `holdQueued` after an edit) while this works,
   * and released at the end.
   *
   * Per pass: shrink once, natively, to the 2048px the upload stores anyway;
   * draw the pill on that; swap the queued file for the result. **Fails open,
   * always**: any problem, or the camera closing first, releases the row with
   * the picture as it was. Losing a pill is a cosmetic difference from a
   * web-captured photo; losing the photo is what the whole queue exists to
   * prevent. `photos.phase` is written either way.
   */
  async function refile(id: string) {
    const job = fileJob(id);
    if (job.running) return;
    job.running = true;
    try {
      for (;;) {
        const gen = job.gen;
        const shot = recentShot(id);
        if (!shot?.localUri) {
          // Taken back, or aged out of the strip: let the row go as it is.
          await finishHeld(id).catch(() => false);
          break;
        }
        const pill = pillOf(shot);
        let file: string | null = null;
        let keepSource = false;
        if (pill) {
          if (alive.current) {
            try {
              const small = await downscaleForStamp(shot.source);
              const out = await renderOffscreen({ kind: "watermark", ...small, tag: pill });
              if (out !== small.uri) file = out;
            } catch {
              // Released without the pill below.
            }
          }
          // An edited shot's queued copy is out of date, so even a failed
          // pill swaps in the shot's own picture.
          if (!file && job.edited) {
            file = shot.source;
            keepSource = true;
          }
        } else {
          file = shot.source;
          keepSource = true;
        }
        // Changed again while this was drawn: draw it again.
        if (job.gen !== gen) continue;
        const target = shot.localUri;
        const swap = file;
        await finishHeld(
          id,
          swap ? () => replaceCapture(swap, target, { keepSource }) : undefined,
        ).catch(() => false);
        requestSync();
        if (job.gen === gen) break;
        // Changed while it was being released: hold it again, if it has not gone.
        if (!(await holdQueued(id, Date.now() + STAMP_HOLD_MS).catch(() => false))) {
          if (alive.current) showNotice(ALREADY_SENT);
          break;
        }
      }
    } finally {
      job.running = false;
    }
  }

  /**
   * One saved shot's picture changed (a new pill, an annotation, a crop).
   * Held before the work starts, so the old file cannot go up in the
   * meantime; if it already has, the photo on the timeline keeps its picture
   * and only its phase, caption and tags change.
   */
  async function refileAfterEdit(id: string) {
    const job = fileJob(id);
    job.gen += 1;
    job.edited = true;
    if (job.running) return;
    const held = await holdQueued(id, Date.now() + STAMP_HOLD_MS).catch(() => false);
    if (!held) {
      if (alive.current) showNotice(ALREADY_SENT);
      return;
    }
    void refile(id);
  }

  /*
   * Caption typing rewrites the queued row once it pauses, not per letter.
   */
  const metaTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  function scheduleMeta(id: string) {
    const timers = metaTimers.current;
    const pending = timers.get(id);
    if (pending) clearTimeout(pending);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        void flushMeta(id);
      }, META_DEBOUNCE_MS),
    );
  }

  /**
   * Write one shot's phase, caption and tags to wherever its photo is now.
   *
   * Still queued and untried: into the queued upload itself. Otherwise it may
   * already be on the server, so a `captured_photo_patch` row is queued,
   * which finds the photo by its storage path once the upload has landed.
   */
  async function flushMeta(id: string) {
    const shot = recentShot(id);
    if (!shot?.localUri || !projectId || !user) return;
    try {
      const inQueue = await updateQueuedPayload(id, {
        ...queuedMetaPatch(shot),
        width: shot.width,
        height: shot.height,
      });
      if (inQueue) return;
      const payload: CapturedPhotoPatchPayload = {
        userId: user.id,
        projectId,
        uploadId: id,
        patch: uploadedMetaPatch(shot),
      };
      await enqueue({
        id: capturedPhotoPatchRowId(id),
        kind: "captured_photo_patch",
        projectId,
        payload,
      });
      await refreshQueue();
      requestSync();
    } catch {
      if (alive.current) setError("Could not save that change on this device. Try again.");
    }
  }

  /** Every retag still waiting on its pause, written now (the camera is closing). */
  const flushAllMeta = useRef<() => void>(() => {});
  flushAllMeta.current = () => {
    for (const [id, timer] of metaTimers.current) {
      clearTimeout(timer);
      void flushMeta(id);
    }
    metaTimers.current.clear();
  };

  /**
   * Change one saved shot, and only that shot: its phase, caption, tags, or
   * (from the full-screen editor) its picture. Never several at once.
   */
  function editShot(
    id: string,
    patch: Partial<Pick<RecentShot, "phase" | "caption" | "tags" | "source" | "width" | "height">>,
  ) {
    const before = recentShot(id);
    if (!before) return;
    const after: RecentShot = {
      ...before,
      ...patch,
      phase: before.scan ? "untagged" : (patch.phase ?? before.phase),
    };
    patchShot(id, after);
    const newPicture = patch.source !== undefined && patch.source !== before.source;
    if (newPicture) thumbFor(id, after.source);
    // Not queued yet (still storing, or failed): it is stored as it is now.
    if (!before.localUri) return;
    if (newPicture || pillChanged(before, after)) void refileAfterEdit(id);
    if (metaKey(before) !== metaKey(after) || newPicture) scheduleMeta(id);
  }

  /**
   * Take one saved shot back: dropped from the queue if it has not gone yet.
   * One that has already been sent is deleted from the timeline, like any
   * other photo, rather than silently kept here.
   */
  async function removeShot(id: string) {
    const shot = recentShot(id);
    if (!shot) return;
    const timer = metaTimers.current.get(id);
    if (timer) clearTimeout(timer);
    metaTimers.current.delete(id);
    const gone = shot.localUri ? await discardUnsent(id).catch(() => false) : true;
    if (!gone) {
      showNotice("Already uploaded. Delete it from the project timeline.");
      return;
    }
    setRecent(recentRef.current.filter((item) => item.id !== id));
    setPanel((current) => (current?.kind === "shot" && current.id === id ? null : current));
    if (shot.localUri) setSavedCount((count) => Math.max(0, count - 1));
    await refreshQueue();
    showNotice("Photo removed");
  }

  /*
   * Closing the camera: write any retag still waiting, and let the Daily Log
   * write this visit up once the queue has delivered it.
   */
  useEffect(
    () => () => {
      flushAllMeta.current();
      if (sessionRef.current) closeCaptureSession(sessionRef.current.sessionId);
      requestSync();
    },
    [],
  );

  /*
   * The off-screen surface, in every view: Scan mode renders its document
   * look from the viewfinder, and the pill burner runs whichever view is
   * showing.
   */
  const offscreenSurface = stamping ? (
    <View style={styles.stampSurface} pointerEvents="none" accessibilityElementsHidden>
      {stamping.kind === "scan" ? (
        <ScanCanvas
          ref={stampRef}
          uri={stamping.uri}
          width={stamping.width}
          height={stamping.height}
        />
      ) : (
        <WatermarkCanvas
          // A fresh surface per photo, so one render can never pick up the
          // previous photo's image before its own has loaded.
          key={stamping.uri}
          ref={stampRef}
          uri={stamping.uri}
          width={stamping.width}
          height={stamping.height}
          tag={stamping.tag}
        />
      )}
    </View>
  ) : null;

  if (!permission) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View
        style={[styles.centered, { backgroundColor: theme.colors.background, gap: spacing.md }]}
      >
        <Text style={[typography.heading, { color: theme.colors.foreground }]}>
          Camera access needed
        </Text>
        <Text
          style={[
            typography.body,
            { color: theme.colors.mutedForeground, textAlign: "center", paddingHorizontal: 24 },
          ]}
        >
          Everlumen uses the camera to attach job-site photos to this project.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={[styles.primaryButton, { backgroundColor: theme.colors.primary }]}
          onPress={() => void requestPermission()}
        >
          <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
            Grant access
          </Text>
        </Pressable>
      </View>
    );
  }

  /*
   * One saved shot, full screen: web's post-capture tools (annotate, measure,
   * crop, tags, description, and PDF for a scan). Every change goes to that
   * shot's queued photo; Retake takes it back if it has not gone yet.
   */
  const editingShot = editingId ? recent.find((shot) => shot.id === editingId) : undefined;
  if (editingShot && projectId) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        {/* A pill can still be burning in the background. */}
        {offscreenSurface}
        <ShotEditor
          shot={{
            uri: editingShot.source,
            width: editingShot.width,
            height: editingShot.height,
            scan: editingShot.scan,
            caption: editingShot.caption,
            tags: editingShot.tags,
          }}
          projectId={projectId}
          userId={user?.id ?? null}
          existingTags={existingTags}
          canMeasure={canMeasure}
          onChange={(patch: ShotPatch) =>
            editShot(editingShot.id, {
              ...(patch.uri !== undefined ? { source: patch.uri } : null),
              ...(patch.width !== undefined ? { width: patch.width } : null),
              ...(patch.height !== undefined ? { height: patch.height } : null),
              ...(patch.caption !== undefined ? { caption: patch.caption } : null),
              ...(patch.tags !== undefined ? { tags: patch.tags } : null),
            })
          }
          onRetake={() => {
            setEditingId(null);
            void removeShot(editingShot.id);
          }}
          onClose={() => setEditingId(null)}
        />
      </>
    );
  }

  const lastShot = recent[0] ?? null;
  const projectLabel = project
    ? (formatAddress(project) ?? projectDisplayName(project))
    : "Loading job";
  const noteActive = noteIsActive(note);
  const noteLabel = noteSummary(note);
  const anyFailed = recent.some((shot) => shot.failed);

  /** The mic: a spoken note for the photo just taken, or for the next ones. */
  function openVoiceNote() {
    if (lastShot) setPanel({ kind: "shot", id: lastShot.id, start: "voice" });
    else setPanel({ kind: "next", start: "voice" });
  }

  /*
   * The bottom-left slot. On an empty camera it is web's gallery button. Once
   * this visit has saved something it shows the last shot with the count of
   * what has been saved, and opens that one photo's note editor: its
   * Before/None/After, its voice note and caption, its tags. One photo, not a
   * strip of this visit's photos: several photos side by side is the
   * walkthrough's screen, where the AI reads them together (Jon, 2026-09-29).
   */
  const leftSlot = lastShot ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${savedCount} saved. Open the last photo to add a voice note or retag it`}
      style={styles.squareButton}
      onPress={() => setPanel({ kind: "shot", id: lastShot.id })}
    >
      <Image
        source={{ uri: lastShot.thumb ?? lastShot.source }}
        style={styles.lastShotImage}
        allowDownscaling
        transition={0}
      />
      <View
        style={[styles.countBadge, anyFailed ? styles.failedBadge : styles.savedBadge]}
        pointerEvents="none"
      >
        <Text style={[styles.countText, { color: "#fff" }]}>{anyFailed ? "!" : savedCount}</Text>
      </View>
    </Pressable>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add from gallery"
      style={styles.squareButton}
      onPress={() => void pickFromLibrary()}
    >
      <Icon icon={ImageIcon} size="lg" color={CHROME_FG} />
    </Pressable>
  );

  /*
   * The camera's own note controls: the caption and tags the next shots take
   * (filled when set, so nobody shoots a run under a note they forgot was
   * on), and the mic for a spoken note on the photo just taken. On a phone
   * they sit with the job pill; on a tablet, on the right-hand rail.
   */
  const notePill = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        noteActive ? `Note for next photos: ${noteLabel}. Change` : "Add a note and tags"
      }
      accessibilityHint="Sets a caption and tags for the photos you take next"
      onPress={() => setPanel({ kind: "next" })}
      hitSlop={4}
      style={[
        styles.smallPill,
        styles.notePill,
        noteActive && { backgroundColor: theme.colors.primary },
      ]}
    >
      <Icon icon={StickyNote} size="xs" color={CHROME_FG} />
      <Text style={styles.smallPillText} numberOfLines={1}>
        {noteLabel ?? "Note"}
      </Text>
    </Pressable>
  );
  const micButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={lastShot ? "Voice note for the last photo" : "Voice note"}
      onPress={openVoiceNote}
      hitSlop={4}
      style={styles.smallRound}
    >
      <Icon icon={Mic} size="sm" color={CHROME_FG} />
    </Pressable>
  );
  const libraryButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add from library"
      onPress={() => void pickFromLibrary()}
      hitSlop={4}
      style={styles.roundButton}
    >
      <Icon icon={ImageIcon} size="md" color={CHROME_FG} />
    </Pressable>
  );

  /*
   * Before / None / After, as web draws it: its own small dark toggle between
   * the mode bar and the shutter row, only in Before/After mode. Each shot
   * takes whichever side is selected when its shutter fires (`phaseAtShutter`),
   * so a Before, a flip, then an After are saved as one of each. Tapping the
   * chosen side again goes back to None, as on web.
   */
  const phaseSelector =
    mode === "before-after" ? (
      <View style={styles.phaseRow} accessibilityRole="radiogroup">
        {PHASE_TOGGLE.map((option) => {
          const active = phase === option.id;
          const isNone = option.id === "untagged";
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={isNone ? "No before or after tag" : `${option.label} photos`}
              onPress={() => setPhase(active && !isNone ? "untagged" : option.id)}
              hitSlop={4}
              style={[
                styles.phasePill,
                active &&
                  (isNone
                    ? styles.phaseNoneActive
                    : option.id === "after"
                      ? { backgroundColor: theme.colors.primary }
                      : styles.phasePillActive),
              ]}
            >
              <Text
                style={[
                  isNone ? styles.phaseNoneText : styles.phaseText,
                  active &&
                    !isNone &&
                    (option.id === "after"
                      ? { color: theme.colors.primaryForeground }
                      : styles.phaseTextActive),
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    ) : null;

  /*
   * Untagged is web's tag picker in the mode bar: once tags are picked the
   * mode shows the tag, or how many, so nobody shoots a run under a tag they
   * forgot was on. The same tags as the note pill: the next photos' tags.
   */
  const modeLabels: Partial<Record<CameraMode, string>> =
    note.tags.length === 1
      ? { untagged: note.tags[0] }
      : note.tags.length > 1
        ? { untagged: `${note.tags.length} tags` }
        : {};

  /*
   * The note editor. For the next photos: the sticky caption and tags. For a
   * saved photo: that photo, its own Before/None/After, voice note, caption
   * and tags. Each change is that photo's alone, and saves as it is made.
   */
  const panelInsets = {
    top: insets.top,
    bottom: insets.bottom,
    left: insets.left,
    right: insets.right,
  };
  const panelShot =
    panel?.kind === "shot" ? recent.find((shot) => shot.id === panel.id) : undefined;
  const closePanel = () => setPanel(null);
  let panelView: React.ReactNode = null;
  if (panel?.kind === "next") {
    panelView = (
      <PhotoNoteEditor
        key="next"
        title="Note for the next photos"
        caption={note.caption}
        onCaptionChange={(caption) => setNote((current) => ({ ...current, caption }))}
        placeholder="What these photos show. Stays on until cleared."
        tags={note.tags}
        onEditTags={() => setTagsFor("next")}
        actions={
          noteActive
            ? [{ id: "clear", label: "Clear note", icon: X, onPress: () => setNote(EMPTY_NOTE) }]
            : []
        }
        startWith={panel.start}
        wide={wide}
        insets={panelInsets}
        onDone={closePanel}
        onClose={closePanel}
      />
    );
  } else if (panel?.kind === "shot" && panelShot) {
    const shotId = panelShot.id;
    const actions: NoteEditorAction[] = [
      ...(panelShot.failed
        ? [
            {
              id: "retry",
              label: "Try saving again",
              icon: RefreshCw,
              onPress: () => {
                setError(null);
                void storeShot(shotId);
              },
            },
          ]
        : []),
      {
        id: "edit",
        label: "Annotate",
        icon: Crop,
        onPress: () => {
          setPanel(null);
          setEditingId(shotId);
        },
      },
    ];
    panelView = (
      <PhotoNoteEditor
        key={`shot-${shotId}`}
        title="Last photo"
        photoUri={panelShot.thumb ?? panelShot.source}
        caption={panelShot.caption}
        onCaptionChange={(caption) => editShot(shotId, { caption })}
        placeholder="Type a note, or tap Add voice note"
        tags={panelShot.tags}
        onEditTags={() => setTagsFor(shotId)}
        phase={panelShot.scan ? undefined : panelShot.phase}
        onPhaseChange={(next) => editShot(shotId, { phase: next })}
        actions={actions}
        message={panelShot.failed ? "Not saved on this device yet." : null}
        startWith={panel.start}
        wide={wide}
        insets={panelInsets}
        onDone={closePanel}
        onClose={closePanel}
      />
    );
  }
  const tagShot =
    tagsFor && tagsFor !== "next" ? recent.find((shot) => shot.id === tagsFor) : undefined;

  /*
   * One layout on every phone and tablet, in either orientation, as web's
   * camera: the live view fills the screen edge to edge and every control
   * floats on it, translucent. No column or panel ever takes a strip of the
   * screen away from the picture.
   */
  return (
    <View style={styles.cameraRoot}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        flash={flash}
        animateShutter
      />

      {/*
        Rule-of-thirds grid. Hairlines only, and not touchable: it is there to
        square a wall up in the frame, not to be noticed.
      */}
      {gridOn ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={[styles.gridLine, styles.gridV, { left: "33.333%" }]} />
          <View style={[styles.gridLine, styles.gridV, { left: "66.666%" }]} />
          <View style={[styles.gridLine, styles.gridH, { top: "33.333%" }]} />
          <View style={[styles.gridLine, styles.gridH, { top: "66.666%" }]} />
        </View>
      ) : null}

      {/*
        Scan mode frames the page, the way document scanners do, and says what
        will happen to the shot so the greyscale result is not a surprise.
      */}
      {mode === "scan" ? (
        <View
          style={styles.scanOverlay}
          pointerEvents="none"
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            scanView.current = { width, height };
          }}
        >
          {/*
            Paper shaped (US Letter), and measured: after the shot the corner
            step starts its four handles where this frame was, which is where
            the page was lined up.
          */}
          <View
            style={styles.scanFrame}
            onLayout={(event) => {
              scanGuide.current = event.nativeEvent.layout;
            }}
          >
            <View style={[styles.scanCorner, styles.scanCornerTL]} />
            <View style={[styles.scanCorner, styles.scanCornerTR]} />
            <View style={[styles.scanCorner, styles.scanCornerBR]} />
            <View style={[styles.scanCorner, styles.scanCornerBL]} />
          </View>
          <Text style={styles.scanHint}>Fit the page inside the frame</Text>
        </View>
      ) : null}

      {/*
        Measure mode, as on web: a thin reticle in the middle of the view. The
        PRO MEASURE pill sits under the top buttons and the distance advice
        just above the mode bar. The shot opens in the Measure tool the moment
        it is taken.
      */}
      {mode === "measure" ? (
        <View style={styles.scanOverlay} pointerEvents="none">
          <View style={[styles.reticle, { borderColor: theme.colors.primary }]} />
        </View>
      ) : null}

      <View
        style={[
          styles.topArea,
          {
            top: insets.top + spacing.sm,
            left: insets.left + spacing.lg,
            right: insets.right + spacing.lg,
          },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.topBar} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close camera"
            style={styles.roundButton}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <Icon icon={X} size="md" color={CHROME_FG} />
          </Pressable>

          <View style={styles.topRight}>
            {wide ? null : libraryButton}
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: gridOn }}
              accessibilityLabel="Grid"
              onPress={() => setGridOn((on) => !on)}
              hitSlop={4}
              style={[styles.roundButton, gridOn && { backgroundColor: theme.colors.primary }]}
            >
              <Icon icon={Grid3x3} size="md" color={CHROME_FG} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.roundButton}
              hitSlop={4}
              accessibilityLabel={`Flash ${flash}. Tap to change`}
              onPress={() => setFlash(flash === "off" ? "auto" : flash === "auto" ? "on" : "off")}
            >
              <FlashGlyph mode={flash} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.roundButton}
              hitSlop={4}
              accessibilityLabel="Switch camera"
              onPress={() => setFacing(facing === "back" ? "front" : "back")}
            >
              <Icon icon={SwitchCamera} size="md" color={CHROME_FG} />
            </Pressable>
          </View>
        </View>

        {/*
          Small pills under the top bar, never a panel. Which job these photos
          land on, so nobody shoots a whole run into the wrong project (the
          street address when there is one, because that is what a crew calls
          a job), and tapping it switches job. Not offered when the camera was
          opened for a checklist or workflow item, whose evidence has to land
          on this job. Beside it on a phone, the note for the next photos and
          the mic.
        */}
        <View style={styles.pillRow} pointerEvents="box-none">
          {canSwitchJob ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Job: ${projectLabel}. Change job`}
              accessibilityHint="Pick a different project for these photos"
              onPress={switchJob}
              hitSlop={4}
              style={styles.smallPill}
            >
              <Icon icon={MapPin} size="xs" color={CHROME_FG} />
              <Text style={styles.smallPillText} numberOfLines={1}>
                {projectLabel}
              </Text>
              <Icon icon={ChevronDown} size="xs" color={CHROME_FG} />
            </Pressable>
          ) : (
            <View style={styles.smallPill} accessibilityRole="text">
              <Icon icon={MapPin} size="xs" color={CHROME_FG} />
              <Text style={styles.smallPillText} numberOfLines={1}>
                {projectLabel}
              </Text>
            </View>
          )}
          {wide ? null : (
            <>
              {notePill}
              {micButton}
            </>
          )}
        </View>

        {mode === "measure" ? (
          <View
            style={[styles.proMeasure, { backgroundColor: theme.colors.primary }]}
            pointerEvents="none"
            accessibilityRole="text"
            accessibilityLabel="Pro measure"
          >
            <Icon icon={Ruler} size="sm" color={CHROME_FG} />
            <Text style={styles.proMeasureText}>PRO MEASURE</Text>
            <View style={styles.proMeasureDot} />
          </View>
        ) : null}
      </View>

      {savedFlash ? (
        <View style={[styles.savedFlash, { top: insets.top + 110 }]} pointerEvents="none">
          <Text style={styles.savedFlashText}>Saved</Text>
        </View>
      ) : null}

      {offscreenSurface}

      {/*
        The bottom controls, top to bottom as web stacks them: the mode bar,
        the Before/After toggle when that mode is on, then gallery, shutter
        and level. Centred and capped in width, so a tablet or a phone on its
        side gets the same controls rather than a bar stretched across it.
      */}
      <View
        style={[
          styles.bottomArea,
          {
            bottom: insets.bottom + spacing.lg,
            left: insets.left + spacing.lg,
            right: insets.right + spacing.lg,
          },
        ]}
        pointerEvents="box-none"
      >
        {error || notice ? (
          <Text style={[styles.cameraToast, error ? styles.cameraError : null]}>
            {error ?? notice}
          </Text>
        ) : null}

        {mode === "measure" ? (
          <View style={styles.helperCard} accessibilityRole="text">
            <Text style={styles.helperTitle}>MEASURE MODE</Text>
            <Text style={styles.helperBody}>
              Stand approximately <Text style={styles.helperStrong}>3-6 feet</Text> away. Keep phone{" "}
              <Text style={styles.helperStrong}>steady and parallel</Text> to the surface for best
              accuracy.
            </Text>
          </View>
        ) : null}

        <CameraModeRow
          modes={cameraModes(canMeasure)}
          value={mode}
          onChange={(next) => void changeMode(next)}
          disabled={busy}
          labels={modeLabels}
          collapsed={!modeBarOpen}
          onExpand={() => setModeBarOpen(true)}
        />

        {phaseSelector}

        <View style={styles.bottomBar}>
          {leftSlot}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mode === "scan" ? "Scan document" : "Take photo"}
            disabled={busy}
            accessibilityHint="Saves the photo to this job straight away"
            style={[styles.shutter, busy && { opacity: 0.6 }]}
            onPress={() => void takeShot()}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <LevelIndicator size={SQUARE} />
        </View>
      </View>

      {/*
        On a tablet, the note, voice and library controls on the right-hand
        side, where the hand holding it reaches.
      */}
      {wide ? (
        <View style={[styles.rail, { right: insets.right + spacing.lg }]} pointerEvents="box-none">
          {notePill}
          {micButton}
          {libraryButton}
        </View>
      ) : null}

      {panelView}

      <TagPickerSheet
        visible={tagsFor !== null}
        title={tagsFor === "next" ? "Tag the next photos" : "Tag this photo"}
        existing={existingTags}
        selected={tagsFor === "next" ? note.tags : (tagShot?.tags ?? [])}
        userId={user?.id ?? null}
        onChange={(next) => {
          if (tagsFor === "next") setNote((current) => ({ ...current, tags: next }));
          else if (tagShot) editShot(tagShot.id, { tags: next });
        }}
        onClose={() => setTagsFor(null)}
      />

      {scanPending ? (
        <ScanCropper
          visible
          uri={scanPending.asset.uri}
          initialQuad={scanPending.quad}
          enhance
          cancelLabel="Retake"
          onCancel={() => setScanPending(null)}
          onApply={({ uri, width, height, note }) => {
            const { asset } = scanPending;
            setScanPending(null);
            afterCapture(
              { ...asset, uri, width, height, mimeType: "image/jpeg" },
              true,
              "untagged",
            );
            if (note) setError(note);
          }}
        />
      ) : null}

      {measuring ? (
        <ShotAnnotator
          visible
          uri={measuring.asset.uri}
          width={measuring.asset.width}
          height={measuring.asset.height}
          canMeasure={canMeasure}
          initialTool="measure"
          onCancel={() => {
            // Saved all the same: a photo is never lost to a closed tool.
            const { asset, phase: shotPhaseAtShutter } = measuring;
            setMeasuring(null);
            saveShot(asset, false, shotPhaseAtShutter);
          }}
          onDone={({ uri, width, height }) => {
            const { asset, phase: shotPhaseAtShutter } = measuring;
            setMeasuring(null);
            saveShot({ ...asset, uri, width, height }, false, shotPhaseAtShutter);
          }}
        />
      ) : null}
    </View>
  );
}

/** A retag's word when the photo had already gone up with its old picture. */
const ALREADY_SENT =
  "Already uploaded. Its tags and note are updated; the picture stays as it was.";

/** What a retag compares: the parts of a shot written to its photo row. */
function metaKey(shot: { phase: PhotoPhase; caption: string; tags: string[] }): string {
  return JSON.stringify([shot.phase, shot.caption.trim(), shot.tags]);
}

/**
 * The flash button's glyph: a bolt, struck through when off, with a small "A"
 * beside it on auto.
 *
 * Drawn here rather than taken from `@/ui/icons` because the registry has no
 * bolt. The path is lucide's `zap`, so it sits beside the lucide glyphs on the
 * other buttons without looking borrowed.
 */
function FlashGlyph({ mode }: { mode: FlashMode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
        <Path
          d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
          stroke={CHROME_FG}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={mode === "on" ? CHROME_FG : "none"}
        />
        {mode === "off" ? (
          <Path d="M3 3l18 18" stroke={CHROME_FG} strokeWidth={2} strokeLinecap="round" />
        ) : null}
      </Svg>
      {mode === "auto" ? <Text style={styles.flashAuto}>A</Text> : null}
    </View>
  );
}

/** Gallery and level: web's rounded squares either side of the shutter. */
const SQUARE = 56;

/*
 * Camera chrome is always dark, whatever the app's scheme: it sits on a live
 * picture, and a light pill over a bright sky would vanish. So these are fixed
 * rather than read from the palette, and the orange primary is kept for the
 * one thing that is ours (the note pill when it is on).
 */
const CHROME_FG = "#ffffff";
const CHROME_FILL = "rgba(24, 20, 16, 0.55)";
const CHROME_DEEP = "rgba(10, 8, 6, 0.72)";
const SELECTED_FILL = "#ece8e3";
const SELECTED_FG = "#18130d";

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  cameraRoot: { flex: 1, backgroundColor: "#000" },
  gridLine: { position: "absolute", backgroundColor: "rgba(255,255,255,0.28)" },
  gridV: { top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridH: { left: 0, right: 0, height: StyleSheet.hairlineWidth },
  topArea: { position: "absolute", gap: spacing.sm },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  topRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  roundButton: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    borderRadius: HIT_TARGET / 2,
    backgroundColor: CHROME_FILL,
    alignItems: "center",
    justifyContent: "center",
  },
  pillRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  smallPill: {
    flexShrink: 1,
    maxWidth: 280,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: CHROME_FILL,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    minHeight: 30,
  },
  notePill: { maxWidth: 190 },
  smallRound: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: CHROME_FILL,
    alignItems: "center",
    justifyContent: "center",
  },
  rail: {
    position: "absolute",
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  smallPillText: {
    color: CHROME_FG,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  proMeasure: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 34,
  },
  proMeasureText: { color: CHROME_FG, fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  proMeasureDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#34d399" },
  helperCard: {
    alignSelf: "stretch",
    backgroundColor: CHROME_DEEP,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  helperTitle: {
    color: CHROME_FG,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textAlign: "center",
  },
  helperBody: { color: CHROME_FG, fontSize: 13, lineHeight: 18, textAlign: "center" },
  helperStrong: { fontWeight: "800" },
  reticle: { width: 110, height: 110, borderRadius: 55, borderWidth: 1.5 },
  savedFlash: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: "rgba(16, 150, 96, 0.95)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  savedFlashText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  scanOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  scanFrame: {
    width: "78%",
    aspectRatio: 8.5 / 11,
    maxHeight: "58%",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.45)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  scanCorner: { position: "absolute", width: 28, height: 28, borderColor: "#fff" },
  scanCornerTL: { left: -2, top: -2, borderLeftWidth: 4, borderTopWidth: 4 },
  scanCornerTR: { right: -2, top: -2, borderRightWidth: 4, borderTopWidth: 4 },
  scanCornerBR: { right: -2, bottom: -2, borderRightWidth: 4, borderBottomWidth: 4 },
  scanCornerBL: { left: -2, bottom: -2, borderLeftWidth: 4, borderBottomWidth: 4 },
  scanHint: {
    color: CHROME_FG,
    fontSize: 12,
    fontWeight: "700",
    backgroundColor: CHROME_FILL,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  phaseRow: {
    flexDirection: "row",
    alignSelf: "center",
    alignItems: "center",
    gap: spacing.xs,
    padding: 4,
    backgroundColor: CHROME_DEEP,
    borderRadius: radius.pill,
  },
  phasePill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  phasePillActive: { backgroundColor: SELECTED_FILL },
  phaseNoneActive: { backgroundColor: "rgba(255,255,255,0.15)" },
  phaseText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  phaseNoneText: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontWeight: "600" },
  phaseTextActive: { color: SELECTED_FG },
  flashAuto: { color: CHROME_FG, fontSize: 10, fontWeight: "800", marginLeft: -2 },
  cameraToast: {
    alignSelf: "center",
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    backgroundColor: CHROME_DEEP,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  cameraError: { backgroundColor: "rgba(180,35,24,0.9)" },
  bottomArea: {
    position: "absolute",
    alignItems: "center",
    gap: spacing.md,
  },
  bottomBar: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
  },
  squareButton: {
    width: SQUARE,
    height: SQUARE,
    borderRadius: 16,
    backgroundColor: CHROME_FILL,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  lastShotImage: {
    width: "100%",
    height: "100%",
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.85)",
    backgroundColor: "#222",
  },
  countBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  savedBadge: { backgroundColor: "rgba(16, 150, 96, 0.95)" },
  failedBadge: { backgroundColor: "rgba(180,35,24,0.95)" },
  countText: { fontSize: 12, fontWeight: "800" },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 5,
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#fff" },
  /*
   * Off-screen, not invisible. `opacity: 0` would still lay out, but a future
   * reader reaching for `display: none` would silently break the rasteriser,
   * so the offset says the view has to genuinely exist.
   */
  stampSurface: { position: "absolute", left: -10000, top: 0 },
  primaryButton: {
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    minHeight: HIT_TARGET,
    justifyContent: "center",
  },
});
