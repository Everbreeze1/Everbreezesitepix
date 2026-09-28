import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions, type CameraType, type FlashMode } from "expo-camera";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useQuery } from "@tanstack/react-query";
import { listProjectPhotos, type CapturedAsset, type PhotoPhase } from "@/api/photos";
import { getMyTeam } from "@/api/team";
import { tagForPhase, type WatermarkTag } from "@/api/watermark";
import { renderWatermarked } from "@/api/watermark-render";
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
import { useTagLibrary } from "@/components/photo-viewer/TagPill";
import { formatAddress, getProject, projectCoords } from "@/api/projects";
import { projectDisplayName } from "@everlumen/shared";
import { useAuth } from "@/lib/auth";
import { deviceSupportsMeasure } from "@/lib/measure-support";
import { persistCapture } from "@/offline/media";
import { enqueue, newOutboxId } from "@/offline/outbox";
import { recordSessionPhoto } from "@/offline/capture-session";
import { refreshQueue, requestSync } from "@/offline/sync";
import type { PhotoUploadPayload } from "@/offline/handlers";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";
import { Icon } from "@/ui";
import { ChevronDown, Grid3x3, ImageIcon, MapPin, Ruler, SwitchCamera, X } from "@/ui/icons";

/**
 * `scan` marks a shot taken in Scan mode. Its file already has the document
 * look applied, and on Save it queues with a `scan` tag and never gets a
 * before/after pill, whatever the batch phase says.
 */
type Shot = CapturedAsset & {
  key: string;
  scan?: boolean;
  /** This shot's own description, from its preview. Wins over the batch caption. */
  caption?: string;
  /** This shot's own tags, from its preview. Added to the batch tags. */
  tags?: string[];
};

/** The tag a Scan mode capture is filed under, so scans can be found later. */
const SCAN_TAG = "scan";

const PHASES: { id: PhotoPhase; label: string }[] = [
  { id: "before", label: "Before" },
  { id: "untagged", label: "Untagged" },
  { id: "after", label: "After" },
];

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
  const { user } = useAuth();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [facing, setFacing] = useState<CameraType>("back");
  const [flash, setFlash] = useState<FlashMode>("auto");
  const [shots, setShots] = useState<Shot[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A passing word on the viewfinder, such as Dual being on its way. */
  const [notice, setNotice] = useState<string | null>(null);

  const [phase, setPhase] = useState<PhotoPhase>("untagged");
  const [mode, setMode] = useState<CameraMode>("photo");
  const [caption, setCaption] = useState("");
  const [tagText, setTagText] = useState("");
  const [batchTagsOpen, setBatchTagsOpen] = useState(false);

  /** Rule-of-thirds grid, on by default as on web. */
  const [gridOn, setGridOn] = useState(true);
  /**
   * Quick capture, web's autoSave: every shot is queued the moment it is
   * taken, with the current phase, instead of collecting into a batch.
   */
  const [quick, setQuick] = useState(false);
  /** Thumbnails of what quick capture has queued this visit, newest first. */
  const [quickSaved, setQuickSaved] = useState<string[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);
  /** The shot open in the per-shot preview (annotate, crop, tags, description). */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  /** The shot Measure mode has just taken, open in the annotator's Measure tool. */
  const [measuringKey, setMeasuringKey] = useState<string | null>(null);
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

  const keyCounter = useRef(0);

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

  /** A shot for the batch, with a key that is known before it is added. */
  const makeShot = useCallback((asset: CapturedAsset, scan = false): Shot => {
    keyCounter.current += 1;
    return { ...asset, scan, key: `${asset.uri}-${keyCounter.current}` };
  }, []);

  const addShot = useCallback(
    (asset: CapturedAsset, scan = false) => {
      const shot = makeShot(asset, scan);
      setShots((prev) => [...prev, shot]);
      return shot;
    },
    [makeShot],
  );

  function patchShot(key: string, patch: ShotPatch) {
    setShots((prev) => prev.map((shot) => (shot.key === key ? { ...shot, ...patch } : shot)));
  }

  /*
   * The job switch on the viewfinder. Only for a plain capture: one opened
   * for a checklist or workflow item files its evidence against this job.
   */
  const canSwitchJob = !checklistItemId && !workflowItemId;

  /**
   * Pick another job. `replace`, so the picker takes this camera's place and
   * opens the new job's camera in its own place in turn: backing out lands
   * where the person started, not on a second camera. An unsaved batch has to
   * be saved first, because its photos belong to the job they were shot for.
   */
  function switchJob() {
    if (busy) return;
    if (shots.length > 0) {
      setError("Save this batch first, then change job.");
      return;
    }
    router.replace("/capture-start");
  }

  /**
   * Switch camera mode from the row under the shutter.
   *
   * Mirrors web: Video and Walkthrough hand off to a recorder rather than
   * becoming a mode here, since the photo queue has no video path. Video is a
   * plain site video saved to the project's videos, as web's "Record a site
   * video"; Walkthrough is the narrated walk with photos pinned to it. Leaving
   * Before/After clears the phase, as web clears its tag, so a Photo or Scan
   * run never inherits a pill picked for a different job.
   */
  function changeMode(next: CameraMode) {
    if (next === "video" || next === "walkthrough") {
      if (!projectId) return;
      if (shots.length > 0) {
        setError("Save or review this batch first, then switch to video.");
        return;
      }
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
    if (next !== "before-after") setPhase("untagged");
    // Untagged is where tags are picked, as web's tag picker: it opens the
    // picker every time it is tapped, and the bar then shows what was picked.
    if (next === "untagged") setBatchTagsOpen(true);
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

  /**
   * Where a new shot goes, by mode.
   *
   * Measure opens it straight in the annotator's Measure tool, as web does.
   * Quick capture queues it at once. Everything else joins the batch.
   */
  function afterCapture(asset: CapturedAsset, scan: boolean, allowMeasure = true) {
    if (allowMeasure && mode === "measure" && canMeasure) {
      const shot = addShot(asset, scan);
      setMeasuringKey(shot.key);
      return;
    }
    if (quick) {
      void quickSave(makeShot(asset, scan));
      return;
    }
    addShot(asset, scan);
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
           * than into the batch as a photo of a desk with a page on it. The
           * page is straightened and given its look there, before the strip
           * shows it, so it looks the way it will be filed.
           */
          setScanPending({ asset, quad: guideQuad(asset) });
        } else {
          afterCapture(asset, false);
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
        // measured from the review step instead.
        if (scan) {
          // The document look is a new JPEG, so the picker's mime no longer applies.
          afterCapture(
            { ...picked, ...(await scanLook(picked)), mimeType: "image/jpeg" },
            true,
            false,
          );
        } else {
          afterCapture(picked, false, false);
        }
      }
    } finally {
      if (scan) setBusy(false);
    }
  }

  function removeShot(key: string) {
    setShots((prev) => prev.filter((shot) => shot.key !== key));
  }

  /*
   * Jobs for the one off-screen surface, run strictly one after another. Quick
   * capture can be stamping one shot while Scan mode is rendering the next,
   * and two jobs on one surface would each resolve with the other's picture.
   */
  const surfaceQueue = useRef<Promise<unknown>>(Promise.resolve());

  /** Mount the off-screen surface, flatten it, and hand back the file. */
  const renderOffscreen = useCallback((job: NonNullable<typeof stamping>) => {
    const now = async (): Promise<string> => {
      try {
        const rendered = await new Promise<string>((resolve, reject) => {
          stampResolve.current = resolve;
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
        setStamping(null);
      }
    };
    const run = surfaceQueue.current.then(now);
    surfaceQueue.current = run.catch(() => undefined);
    return run;
  }, []);

  /**
   * Burn the before/after pill into one shot.
   *
   * **Fails open, always.** Any problem here returns the original photo rather
   * than throwing, and the capture queues unwatermarked. Losing a pill is a
   * cosmetic difference from a web-captured photo; losing the photo is the
   * thing the whole offline queue exists to prevent, and this is the last
   * screen where that could still happen.
   *
   * `untagged` gets nothing, matching web. See `tagForPhase`.
   */
  const stamp = useCallback(
    async (shot: Shot, currentPhase: PhotoPhase): Promise<string> => {
      const tag = tagForPhase(currentPhase);
      // No pill wanted, or the picker gave us no dimensions to size one against.
      if (!tag || !shot.width || !shot.height) return shot.uri;
      return renderOffscreen({
        kind: "watermark",
        uri: shot.uri,
        width: shot.width,
        height: shot.height,
        tag,
      });
    },
    [renderOffscreen],
  );

  /**
   * Give one imported page the document look, without the corner step (a run
   * of library imports should not open one after another; each can be
   * straightened from its preview's Crop).
   *
   * Upright and resized first, so the look is drawn at the picture's real
   * orientation and size. Fails open like `stamp`: a scan that keeps its
   * colour is still a scan.
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

  /**
   * Hand the batch to the outbox and get out of the way.
   *
   * Nothing is uploaded here. Each shot is copied into app storage and written
   * to the queue, which takes milliseconds and cannot fail for lack of signal,
   * then the drain delivers it whenever the network allows. The alternative,
   * uploading inline, means a progress bar the user has to stand still and
   * watch on the one connection least likely to hold: a phone on a job site.
   */
  /**
   * Queue one shot: stamp, copy into app storage, enqueue. Throws when the
   * device could not store it, so the caller can keep the shot on screen.
   *
   * The shot's own description wins over the batch caption, and its own tags
   * are added to the batch tags, so the per-shot preview and the batch fields
   * both work and neither silently discards the other.
   */
  async function queueShot(
    shot: Shot,
    batch: { sessionId: string; tzOffsetMinutes: number; tags: string[]; caption: string },
  ) {
    if (!projectId || !user) throw new Error("Not ready");
    // The id is minted first: the durable copy is named after it, and it
    // becomes the idempotency key for the upload itself.
    const id = newOutboxId();
    // A scan never carries a before/after pill, whatever the batch says.
    const shotPhase: PhotoPhase = shot.scan ? "untagged" : phase;
    const shotTags = Array.from(
      new Set([...batch.tags, ...(shot.tags ?? []), ...(shot.scan ? [SCAN_TAG] : [])]),
    );
    const shotCaption = shot.caption?.trim() || batch.caption.trim() || undefined;
    // Watermark first, then persist, so the durable copy the queue owns is
    // the one with the pill already in it. Persisting first and stamping
    // after would leave the outbox pointing at the unstamped file.
    const stamped = await stamp(shot, shotPhase);
    const localUri = persistCapture(stamped, id);

    const payload: PhotoUploadPayload = {
      userId: user.id,
      projectId,
      captureSessionId: batch.sessionId,
      attachToChecklistItemId: checklistItemId ?? null,
      attachToWorkflowItemId: workflowItemId ?? null,
      width: shot.width,
      height: shot.height,
      exif: shot.exif,
      phase: shotPhase,
      tags: shotTags,
      caption: shotCaption,
      deviceCoords,
      projectCoords: projectCoords(project ?? null),
    };

    await enqueue({ id, kind: "photo_upload", projectId, localUri, payload });
    // After the enqueue, so a session row can never point at a photo that
    // was never queued. A failure here costs the log, not the photograph.
    await recordSessionPhoto({
      outboxId: id,
      sessionId: batch.sessionId,
      projectId,
      source: "camera",
      tzOffsetMinutes: batch.tzOffsetMinutes,
    }).catch(() => {});
  }

  /*
   * Quick capture's one session: every shot queued while it is on is one trip
   * as far as the Daily Log is concerned, the way one Save is.
   */
  const quickSession = useRef<{ sessionId: string; tzOffsetMinutes: number } | null>(null);

  /**
   * Quick capture: queue this shot now. If the device cannot store it, it
   * drops into the batch instead, so it is on screen and can be saved again.
   */
  async function quickSave(shot: Shot) {
    if (!quickSession.current) {
      quickSession.current = {
        sessionId: newOutboxId(),
        tzOffsetMinutes: new Date().getTimezoneOffset(),
      };
    }
    const tags = tagText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    try {
      await queueShot(shot, { ...quickSession.current, tags, caption });
      setQuickSaved((prev) => [shot.uri, ...prev].slice(0, 8));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 700);
      await refreshQueue();
      requestSync();
    } catch {
      setShots((prev) => [...prev, shot]);
      setError("Could not save that one to this device. It is in the batch below.");
    }
  }

  async function save() {
    if (!projectId || !user || shots.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: shots.length });

    const tags = tagText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    const failed: Shot[] = [];

    /*
     * One session per Save, which is what the Daily Log is written against.
     *
     * A technician makes several trips to the van and back; each trip is a
     * session and gets its own timestamped section in today's log. The id is
     * minted here rather than server-side because the photos it covers have no
     * ids yet: they are queued, and each gets one only when its upload lands.
     *
     * The offset is read from THIS device, on purpose. "Daily" has to mean the
     * technician's day: the API runs in UTC, so a 6:30pm job in California is
     * already tomorrow to the server, and grouping on the server's clock filed
     * an evening's photos into the next day's log.
     */
    const sessionId = newOutboxId();
    const tzOffsetMinutes = new Date().getTimezoneOffset();

    for (let i = 0; i < shots.length; i += 1) {
      const shot = shots[i];
      try {
        await queueShot(shot, { sessionId, tzOffsetMinutes, tags, caption });
      } catch {
        failed.push(shot);
      }
      setProgress({ done: i + 1, total: shots.length });
    }

    await refreshQueue();
    requestSync();

    setBusy(false);
    setProgress(null);

    if (failed.length) {
      /*
       * Queueing failed, which means local storage, not the network. Keep the
       * shots on screen: their files are still only in the camera cache, and
       * dropping them here loses the photo for good.
       */
      setShots(failed);
      setError(`${failed.length} could not be saved to this device. Still here, try again.`);
      return;
    }

    /*
     * Success. The batch is queued and the durable copies are in app storage,so
     * there is nothing left on screen that has to be uploaded. Reset the form and
     * flip back to the viewfinder so the next photo can be taken immediately
     * without re-opening the camera. Phase is deliberately kept: a technician
     * shooting a run of "before" (or "after") photos across several saves should
     * not have to re-pick the segment every time; the per-batch caption and tags
     * are cleared so one batch's notes don't leak into the next.
     */
    setShots([]);
    setCaption("");
    setTagText("");
    setReviewing(false);
  }

  /*
   * The off-screen surface, shared by both views: Scan mode renders its
   * document look from the viewfinder, the watermark is burnt in from review.
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
   * One shot's preview: web's post-capture step (retake, annotate, measure,
   * crop, tags, description, and PDF for a scan). Opened from a review tile.
   */
  const editingShot = editingKey ? shots.find((shot) => shot.key === editingKey) : undefined;
  if (editingShot && projectId) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        {/* A quick-capture save can still be stamping in the background. */}
        {offscreenSurface}
        <ShotEditor
          shot={editingShot}
          projectId={projectId}
          userId={user?.id ?? null}
          existingTags={existingTags}
          canMeasure={canMeasure}
          onChange={(patch) => patchShot(editingShot.key, patch)}
          onRetake={() => {
            removeShot(editingShot.key);
            setEditingKey(null);
            setReviewing(false);
          }}
          onClose={() => setEditingKey(null)}
        />
      </>
    );
  }

  if (reviewing) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: theme.colors.background }}
      >
        <Stack.Screen options={{ title: `Review ${shots.length}`, headerShown: true }} />

        {/*
          The watermark surface, mounted off-screen while a shot is being
          stamped and unmounted immediately after.

          Positioned far off the left edge rather than hidden with
          `opacity: 0` or `display: none`: the rasteriser needs a real, laid
          out native view, and a view the layout engine has skipped produces a
          blank image rather than an error.
        */}
        {offscreenSurface}

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
          <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
            Tap a photo to annotate, measure, crop, tag or describe it.
          </Text>
          <View style={styles.reviewGrid}>
            {shots.map((shot) => (
              <View key={shot.key} style={styles.reviewTile}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open this photo to annotate, crop, tag or describe it"
                  onPress={() => setEditingKey(shot.key)}
                  style={StyleSheet.absoluteFill}
                >
                  <Image source={{ uri: shot.uri }} style={styles.reviewImage} contentFit="cover" />
                </Pressable>
                {shot.scan || shot.caption?.trim() || shot.tags?.length ? (
                  <View style={styles.tileMarks} pointerEvents="none">
                    {shot.scan ? <Text style={styles.tileMark}>SCAN</Text> : null}
                    {shot.tags?.length ? (
                      <Text style={styles.tileMark}>{shot.tags.length} TAG</Text>
                    ) : null}
                    {shot.caption?.trim() ? <Text style={styles.tileMark}>NOTE</Text> : null}
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  style={styles.removeBadge}
                  hitSlop={8}
                  onPress={() => removeShot(shot.key)}
                >
                  <Text style={styles.removeBadgeText}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>

          {/*
            The same `phase` the pills on the viewfinder set, repeated here as a
            last look before Save burns it in, and so it can still be corrected
            if the batch was shot under the wrong pill.
          */}
          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.overline, { color: theme.colors.mutedForeground }]}>
              PHASE
            </Text>
            <View style={styles.segmented}>
              {PHASES.map((option) => {
                const active = phase === option.id;
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={option.id}
                    onPress={() => setPhase(option.id)}
                    style={[
                      styles.segment,
                      {
                        backgroundColor: active ? theme.colors.primary : theme.colors.card,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        typography.bodyStrong,
                        {
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
            </View>
          </View>

          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.overline, { color: theme.colors.mutedForeground }]}>
              CAPTION
            </Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Optional, applied to every photo"
              placeholderTextColor={theme.colors.mutedForeground}
              style={[
                styles.input,
                {
                  backgroundColor: theme.colors.card,
                  borderColor: theme.colors.border,
                  color: theme.colors.foreground,
                },
              ]}
            />
          </View>

          <View style={{ gap: spacing.sm }}>
            <View style={styles.labelRow}>
              <Text style={[typography.overline, { color: theme.colors.mutedForeground }]}>
                TAGS
              </Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setBatchTagsOpen(true)}
              >
                <Text style={[typography.bodyStrong, { color: theme.colors.primary }]}>
                  Pick tags
                </Text>
              </Pressable>
            </View>
            <TextInput
              value={tagText}
              onChangeText={setTagText}
              autoCapitalize="none"
              placeholder="Comma separated, for example: roof, framing"
              placeholderTextColor={theme.colors.mutedForeground}
              style={[
                styles.input,
                {
                  backgroundColor: theme.colors.card,
                  borderColor: theme.colors.border,
                  color: theme.colors.foreground,
                },
              ]}
            />
          </View>

          {error ? (
            <Text style={[typography.caption, { color: theme.colors.destructive }]}>{error}</Text>
          ) : null}

          <View style={{ gap: spacing.sm }}>
            <Pressable
              accessibilityRole="button"
              disabled={busy || shots.length === 0}
              style={[
                styles.primaryButton,
                { backgroundColor: theme.colors.primary, opacity: busy ? 0.7 : 1 },
              ]}
              onPress={() => void save()}
            >
              {busy ? (
                <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
                  Saving {progress ? `${progress.done} of ${progress.total}` : ""}
                </Text>
              ) : (
                <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
                  Save {shots.length} photo{shots.length === 1 ? "" : "s"}
                </Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              style={[styles.secondaryButton, { borderColor: theme.colors.border }]}
              onPress={() => void pickFromLibrary()}
            >
              <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                Add from library
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              style={[styles.secondaryButton, { borderColor: theme.colors.border }]}
              onPress={() => setReviewing(false)}
            >
              <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                Back to camera
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        <TagPickerSheet
          visible={batchTagsOpen}
          title="Tag every photo"
          existing={existingTags}
          selected={splitTags(tagText)}
          userId={user?.id ?? null}
          onChange={(next) => setTagText(next.join(", "))}
          onClose={() => setBatchTagsOpen(false)}
        />
      </KeyboardAvoidingView>
    );
  }

  const lastShot = shots.length > 0 ? shots[shots.length - 1] : null;
  const measuringShot = measuringKey ? shots.find((shot) => shot.key === measuringKey) : undefined;
  const projectLabel = project
    ? (formatAddress(project) ?? projectDisplayName(project))
    : "Loading job";
  const pickedTags = splitTags(tagText);

  /*
   * The bottom-left slot. On an empty camera it is web's gallery button. Once
   * a batch is building it becomes the last shot with the batch count on it,
   * which opens review, where the batch gets its caption, tags, a last look at
   * the phase and more photos from the library before Save.
   */
  const leftSlot = lastShot ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Review ${shots.length} photo${shots.length === 1 ? "" : "s"}`}
      style={styles.squareButton}
      onPress={() => setReviewing(true)}
    >
      <Image source={{ uri: lastShot.uri }} style={styles.lastShotImage} />
      <View style={[styles.countBadge, { backgroundColor: theme.colors.primary }]}>
        <Text style={[styles.countText, { color: theme.colors.primaryForeground }]}>
          {shots.length}
        </Text>
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
      {quick && quickSaved.length > 0 ? (
        <View
          style={[styles.countBadge, styles.savedBadge]}
          accessibilityLabel={`${quickSaved.length} saved this session`}
        >
          <Text style={[styles.countText, { color: "#fff" }]}>{quickSaved.length}</Text>
        </View>
      ) : null}
    </Pressable>
  );

  /*
   * Before / None / After, as web draws it: its own small dark toggle between
   * the mode bar and the shutter row, only in Before/After mode. The same
   * `phase` state is what the review step shows and what `stamp` burns in on
   * Save, and it applies to the whole batch. Tapping the chosen side again
   * goes back to None, as on web.
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
   * forgot was on.
   */
  const modeLabels: Partial<Record<CameraMode, string>> =
    pickedTags.length === 1
      ? { untagged: pickedTags[0] }
      : pickedTags.length > 1
        ? { untagged: `${pickedTags.length} tags` }
        : {};

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
          on this job. Beside it, Quick capture (web's autoSave).
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
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: quick }}
            accessibilityLabel="Quick capture"
            accessibilityHint="Saves each photo as soon as it is taken"
            onPress={() => {
              if (quick) quickSession.current = null;
              setQuick((on) => !on);
            }}
            hitSlop={4}
            style={[styles.smallPill, quick && { backgroundColor: theme.colors.primary }]}
          >
            <Text style={styles.smallPillText}>QUICK</Text>
          </Pressable>
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
          onChange={changeMode}
          disabled={busy}
          labels={modeLabels}
        />

        {phaseSelector}

        <View style={styles.bottomBar}>
          {leftSlot}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mode === "scan" ? "Scan document" : "Take photo"}
            disabled={busy}
            accessibilityHint={
              quick
                ? "Saves the photo straight away"
                : "Adds a photo to this batch without leaving the camera"
            }
            style={[styles.shutter, busy && { opacity: 0.6 }]}
            onPress={() => void takeShot()}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <LevelIndicator size={SQUARE} />
        </View>
      </View>

      <TagPickerSheet
        visible={batchTagsOpen}
        title="Tag this batch"
        existing={existingTags}
        selected={pickedTags}
        userId={user?.id ?? null}
        onChange={(next) => setTagText(next.join(", "))}
        onClose={() => setBatchTagsOpen(false)}
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
            afterCapture({ ...asset, uri, width, height, mimeType: "image/jpeg" }, true);
            if (note) setError(note);
          }}
        />
      ) : null}

      {measuringShot ? (
        <ShotAnnotator
          visible
          uri={measuringShot.uri}
          width={measuringShot.width}
          height={measuringShot.height}
          canMeasure={canMeasure}
          initialTool="measure"
          onCancel={() => setMeasuringKey(null)}
          onDone={({ uri, width, height }) => {
            const shot = { ...measuringShot, uri, width, height };
            setMeasuringKey(null);
            if (quick) {
              removeShot(shot.key);
              void quickSave(shot);
            } else {
              patchShot(shot.key, { uri, width, height });
            }
          }}
        />
      ) : null}
    </View>
  );
}

/** "roof, framing" to ["roof", "framing"]. */
function splitTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
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
 * one thing that is ours (the batch count).
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
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tileMarks: {
    position: "absolute",
    left: 4,
    bottom: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3,
  },
  tileMark: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
    backgroundColor: "rgba(10, 8, 6, 0.8)",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: "hidden",
  },
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
  reviewGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  reviewTile: { width: "31%", aspectRatio: 1 },
  reviewImage: { width: "100%", height: "100%", borderRadius: radius.md, backgroundColor: "#ddd" },
  removeBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  removeBadgeText: { color: "#fff", fontSize: 16, lineHeight: 18, fontWeight: "700" },
  segmented: { flexDirection: "row", gap: spacing.sm },
  segment: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    minHeight: HIT_TARGET,
    justifyContent: "center",
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    minHeight: HIT_TARGET,
  },
  primaryButton: {
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    minHeight: HIT_TARGET,
    justifyContent: "center",
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    minHeight: HIT_TARGET,
    justifyContent: "center",
  },
});
