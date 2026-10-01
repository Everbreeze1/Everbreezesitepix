import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useNavigation } from "expo-router";
import NetInfo from "@react-native-community/netinfo";
import { goBack } from "@/lib/navigation";
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraType,
} from "expo-camera";
import * as Location from "expo-location";
import { useQuery } from "@tanstack/react-query";
import { getProject, projectCoords } from "@/api/projects";
import { videoMaxSeconds } from "@/api/project-videos";
import { getMyTeam } from "@/api/team";
import {
  calibrateSnapOffsets,
  captureSnapStill,
  countMissingFrames,
  encoderDelaySeconds,
  extractSnapFrames,
  missingFramesNotice,
  newWalkthroughSnap,
  queueWalkthroughSnaps,
  readVideoDuration,
  type WalkthroughSnap,
} from "@/api/walkthrough-snaps";
import { SnapStrip } from "@/components/walkthrough/SnapStrip";
import {
  createWalkthroughSession,
  deleteWalkthrough,
  walkthroughMaxSeconds,
} from "@/api/walkthroughs";
import { useAuth } from "@/lib/auth";
import { leaveCaptureNotice } from "@/lib/capture-notice";
import { useKeepAwakeWhile } from "@/lib/keep-awake";
import type { VideoUploadPayload, WalkthroughVideoPayload } from "@/offline/handlers";
import { discardRecording, persistRecording } from "@/offline/media";
import { enqueue, finishHeld, newOutboxId, updateQueuedPayload } from "@/offline/outbox";
import { requestSync } from "@/offline/sync";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";
import { Icon } from "@/ui";
import { Settings, X } from "@/ui/icons";

type Stage = "idle" | "recording" | "saving";

/**
 * How a recording is encoded.
 *
 * 720p at about 2.5 Mbit/s is roughly 19 MB a minute. Left to itself Android
 * records 1080p at 15 to 20 Mbit/s, and a single upload of that passed
 * Storage's 50 MB limit about 25 seconds into a walk. Not lower than 720p:
 * Android's snaps are frames taken from this video, so its resolution is the
 * photos' resolution.
 */
const VIDEO_QUALITY = "720p" as const;
const VIDEO_BITRATE = 2_500_000;

/**
 * How long a stopped site video on Android waits for its file to close
 * before the recorder goes back to the camera anyway. Android keeps the
 * recording's promise alive when the view goes, so the clip is still queued
 * when it lands; this only gives the file its usual moment to finish. iOS
 * waits for the file, because unmounting there drops the recording.
 */
const SITE_VIDEO_LEAVE_MS = 600;

/** Past this with no `onCameraReady`, Record may try anyway, as on the camera. */
const CAMERA_READY_FALLBACK_MS = 2500;

/**
 * The longest a queued walkthrough is held back while its snaps are taken
 * from the video and queued. Released as soon as that is done; this ceiling
 * only matters if the app is killed part way, and then the video still goes.
 */
const WALKTHROUGH_HOLD_MS = 5 * 60_000;

/** How long a notice over the camera stays up. */
const NOTICE_MS = 4000;

/** Width of the tablet's right-hand control column, record button included. */
const RAIL_WIDTH = 120;

const BACKGROUND_STOP_NOTICE =
  "Recording stopped because the screen turned off or the app left the screen";

/** One recording, as it was when Stop was pressed. */
type Take = {
  title: string;
  startedAt: string;
  /** The walkthrough made at Record, or null when there was no signal for it. */
  session: Promise<string | null>;
};

/**
 * A Close or Back waiting for the recording to finish: the navigation action
 * it was (Back, a swipe), or null for the Close button.
 */
type PendingExit = { action: unknown };

export default function WalkthroughRecordScreen() {
  /*
   * `kind=video` is the camera's Video mode: a plain site video saved to the
   * project's videos, as web's "Record a site video". It records the same
   * way; it just has no photo snapping and no walkthrough session behind it.
   */
  const { id: projectId, kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const siteVideo = kind === "video";
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user } = useAuth();
  /*
   * A tablet, either way up, keeps the walkthrough's controls in a column on
   * the right where the hand holding it reaches, like the camera; the snaps
   * then run along the bottom beside it. A phone keeps them along the bottom.
   */
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const rail = !siteVideo && Math.min(winWidth, winHeight) >= 600;

  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);

  /*
   * Record waits for the camera to say it is ready, as the photo camera's
   * shutter does: a recording started before then fails on some Androids. A
   * camera that fails to start is remade with a new `key`.
   */
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const cameraFailed = useRef(false);

  const [facing] = useState<CameraType>("back");
  const [stage, setStage] = useState<Stage>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [shots, setShots] = useState<WalkthroughSnap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The microphone was refused for good: only Settings can turn it back on. */
  const [micBlocked, setMicBlocked] = useState(false);
  /** Close or Back pressed while recording: Save or Discard is being asked. */
  const [askLeave, setAskLeave] = useState(false);
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);

  const startedAt = useRef<number | null>(null);
  const stoppedAt = useRef<number | null>(null);
  /** The stage as of now, for listeners that outlive the render they were made in. */
  const stageRef = useRef<Stage>("idle");
  stageRef.current = stage;
  /** Gone from the screen: nothing after this may set state or navigate. */
  const mounted = useRef(true);
  /** A site video's recorder has already gone back to the camera. */
  const left = useRef(false);
  /** The recording being stopped is to be thrown away, not saved. */
  const discarding = useRef(false);
  /** Where to go once the recording that is stopping has been saved or dropped. */
  const pendingExit = useRef<PendingExit | null>(null);
  /** Lets the exit through the `beforeRemove` guard once it is decided. */
  const leaving = useRef(false);
  /** The app went to the background mid-recording; said when it comes back. */
  const interrupted = useRef(false);
  const take = useRef<Take | null>(null);
  /*
   * The snaps as they are taken. `start` awaits the whole recording, so the
   * `shots` it closed over is the empty list from before the first snap, and
   * saving from that dropped every photo taken during the walk.
   */
  const shotsRef = useRef<WalkthroughSnap[]>([]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /* The screen stays on from Record until Stop. */
  useKeepAwakeWhile(stage === "recording");

  /* The web recorder's per-plan ceiling on one take. */
  const { data: team } = useQuery({
    queryKey: ["my-team"],
    queryFn: getMyTeam,
    staleTime: 10 * 60_000,
  });
  const maxSeconds = siteVideo
    ? videoMaxSeconds(team?.plan)
    : walkthroughMaxSeconds(team?.plan, team?.isInternal);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

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

  /*
   * `onCameraReady` has not arrived on every device every time. Past this
   * Record is allowed to try; a failure remakes the camera.
   */
  useEffect(() => {
    if (cameraReady) return;
    const timer = setTimeout(() => setCameraReady(true), CAMERA_READY_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [cameraReady, cameraKey]);

  const restartCamera = useCallback(() => {
    cameraFailed.current = false;
    setCameraReady(false);
    setCameraKey((key) => key + 1);
  }, []);

  /** A short line over the camera, or on the camera behind if this has closed. */
  const showNotice = useCallback((text: string) => {
    if (mounted.current) setNotice(text);
    else leaveCaptureNotice(text);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // Drives the on-screen timer. The authoritative duration is measured from
  // wall-clock at stop, not counted up here, so a dropped tick cannot shorten
  // the recording that gets reported.
  useEffect(() => {
    if (stage !== "recording") return;
    const timer = setInterval(() => {
      if (startedAt.current) setElapsed((Date.now() - startedAt.current) / 1000);
    }, 500);
    return () => clearInterval(timer);
  }, [stage]);

  /*
   * The screen going off, or the app being left, ends the recording on
   * Android whatever is done here. So it is stopped and saved cleanly at that
   * moment, and the person is told why when they come back, rather than
   * finding a walk that ended halfway round with no explanation.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" && stageRef.current === "recording") {
        interrupted.current = true;
        stop();
      }
      if (next === "active" && interrupted.current) {
        interrupted.current = false;
        if (mounted.current) setError(BACKGROUND_STOP_NOTICE);
      }
    });
    return () => sub.remove();
    // `stop` reads only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Close, Android's Back, or a swipe while recording asks first: Save keeps
   * the walk, Discard throws it away. While a stopped recording's file is
   * still landing, leaving waits for it, since unmounting the camera then can
   * drop the recording on iOS.
   */
  useEffect(() => {
    return navigation.addListener("beforeRemove", (event) => {
      if (leaving.current) return;
      if (stageRef.current === "recording") {
        event.preventDefault();
        pendingExit.current = { action: event.data.action };
        setAskLeave(true);
        return;
      }
      if (stageRef.current === "saving" && !siteVideo) {
        event.preventDefault();
        pendingExit.current = { action: event.data.action };
      }
    });
  }, [navigation, siteVideo]);

  /** Carry out a Close or Back that was waiting on the recording, once. */
  function finishExit() {
    const exit = pendingExit.current;
    pendingExit.current = null;
    if (!exit || !mounted.current) return;
    leaving.current = true;
    if (exit.action) navigation.dispatch(exit.action as never);
    else goBack(`/project/${projectId}`);
  }

  function requestClose() {
    if (stageRef.current === "recording") {
      pendingExit.current = { action: null };
      setAskLeave(true);
      return;
    }
    goBack(`/project/${projectId}`);
  }

  function answerLeave(choice: "save" | "discard" | "stay") {
    setAskLeave(false);
    if (choice === "stay") {
      pendingExit.current = null;
      return;
    }
    // The take hit its time limit while this was being asked: it is saved.
    if (stageRef.current !== "recording") {
      finishExit();
      return;
    }
    discarding.current = choice === "discard";
    stop();
  }

  /*
   * A snap lands in the strip the instant it is pressed, then gets its
   * picture: a still where the camera can take one while recording (iOS), or
   * the frame at that moment of the recording, taken at Stop (Android always;
   * iOS if the still fails). See `walkthrough-snaps.ts`.
   *
   * This used to await `takePictureAsync` and keep only what it returned. On
   * Android that call cannot succeed in video mode, so every snap failed, none
   * was saved, and nothing showed that the button had done anything.
   */
  const snap = useCallback(async () => {
    if (!cameraRef.current || stage !== "recording") return;
    const offsetSeconds = startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0;
    const pending = newWalkthroughSnap(offsetSeconds);
    shotsRef.current = [...shotsRef.current, pending];
    setShots(shotsRef.current);

    const taken = await captureSnapStill(cameraRef.current, pending);
    if (taken !== pending) {
      shotsRef.current = shotsRef.current.map((s) => (s.id === taken.id ? taken : s));
      setShots(shotsRef.current);
    }
  }, [stage]);

  /**
   * Make the walkthrough row at Record, as web does (`ensureWalkthroughRow`),
   * so it starts when the walk did. With no signal it is left to the queue,
   * which makes it later with this start time.
   */
  async function startSession(title: string, startedAtIso: string): Promise<string | null> {
    if (!projectId) return null;
    const net = await NetInfo.fetch().catch(() => null);
    if (net && (!net.isConnected || net.isInternetReachable === false)) return null;
    try {
      const created = await createWalkthroughSession(projectId, title, { startedAt: startedAtIso });
      return created.id;
    } catch {
      return null;
    }
  }

  async function start() {
    if (!projectId || !user || stage !== "idle") return;
    setError(null);

    if (cameraFailed.current) {
      restartCamera();
      return;
    }
    if (!cameraReady) return;

    if (!micPermission?.granted) {
      if (micPermission && !micPermission.canAskAgain) {
        setMicBlocked(true);
        setError("Microphone access is off. Turn it on in Settings to record narration.");
        return;
      }
      const granted = await requestMic();
      if (!granted.granted) {
        setMicBlocked(!granted.canAskAgain);
        setError("Microphone access is needed to record narration");
        return;
      }
    }
    setMicBlocked(false);

    const now = Date.now();
    startedAt.current = now;
    stoppedAt.current = null;
    discarding.current = false;
    setElapsed(0);
    shotsRef.current = [];
    setShots([]);
    if (!siteVideo) {
      const startedAtIso = new Date(now).toISOString();
      const title = `${project?.name ?? "Walkthrough"} - ${new Date(now).toLocaleDateString(
        undefined,
        { month: "short", day: "numeric", year: "numeric" },
      )}`;
      take.current = { title, startedAt: startedAtIso, session: startSession(title, startedAtIso) };
    }
    setStage("recording");

    try {
      /*
       * `recordAsync` resolves when `stopRecording` is called, so this promise
       * is the recording. It is awaited here rather than stored, and the stop
       * button resolves it.
       */
      const recording = await cameraRef.current?.recordAsync({
        maxDuration: maxSeconds,
      });
      const endedAt = stoppedAt.current ?? Date.now();
      const durationSeconds = startedAt.current ? (endedAt - startedAt.current) / 1000 : elapsed;
      const thisTake = take.current;
      const snaps = shotsRef.current;

      if (discarding.current) {
        discarding.current = false;
        discardRecording(recording?.uri);
        // A walkthrough made at Record for a walk that is not being kept.
        if (thisTake) {
          void thisTake.session
            .then((id) => (id ? deleteWalkthrough(id) : undefined))
            .catch(() => {});
        }
        if (mounted.current) setStage("idle");
        finishExit();
        return;
      }

      if (!recording?.uri) {
        if (left.current) leaveCaptureNotice("The video did not save. Try recording it again.");
        if (mounted.current) {
          setStage("idle");
          setError("The recording did not save");
        }
        finishExit();
        return;
      }

      if (siteVideo) {
        persist(recording.uri, durationSeconds);
        return;
      }

      /*
       * The camera is ready again at once: the walk is saved in the background
       * from here, and Record can start the next one straight away without
       * touching it.
       */
      if (mounted.current) setStage("idle");
      if (thisTake) void saveWalkthrough(recording.uri, durationSeconds, thisTake, snaps);
      finishExit();
    } catch (e) {
      // Already back on the camera: say it there, where it can be seen.
      if (left.current) leaveCaptureNotice("The video did not save. Try recording it again.");
      if (mounted.current) {
        setStage("idle");
        setError(e instanceof Error ? e.message : "Recording failed");
      }
      finishExit();
    }
  }

  function stop() {
    if (stageRef.current !== "recording") return;
    stoppedAt.current = Date.now();
    stageRef.current = "saving";
    if (mounted.current) setStage("saving");
    cameraRef.current?.stopRecording();
    /*
     * A site video goes back to the camera as soon as it is stopped, with no
     * spinner, chip or page in between (Jon, 2026-09-29: "The circling thing
     * is still happening when i save a video"). On Android that is at once, or
     * as soon as the file closes if that is sooner; the clip is queued in the
     * background when it lands.
     */
    if (siteVideo && Platform.OS === "android" && !discarding.current) {
      setTimeout(leaveForCamera, SITE_VIDEO_LEAVE_MS);
    }
  }

  /** Back to the camera (or the project), once, however many paths ask. */
  function leaveForCamera() {
    if (left.current || !mounted.current) return;
    left.current = true;
    leaving.current = true;
    goBack(`/project/${projectId}`);
  }

  /**
   * A stopped site video: to the offline outbox, and back to the camera.
   *
   * Queued, not uploaded. The clip is moved into app storage and handed to the
   * outbox, which is a rename and one row: instant, and it needs no signal.
   * The drain sends it in the background with the queue banner showing it,
   * the way photos go, and the camera is back at once.
   *
   * This used to upload inline behind a full-screen "Uploading video 42%"
   * that held the phone for as long as the upload took (Jon, 2026-09-29: "the
   * whole screen was doing a count down on saving the video").
   */
  function persist(videoUri: string, durationSeconds: number) {
    if (!projectId || !user) return;
    const userId = user.id;
    leaveForCamera();
    /*
     * The move and the queue write run after the navigation has started,
     * so neither can hold the screen. A failure is said on the camera, in
     * its small notice pill.
     */
    setTimeout(() => {
      void (async () => {
        try {
          const id = newOutboxId();
          const localUri = persistRecording(videoUri, id);
          const payload: VideoUploadPayload = {
            userId,
            projectId,
            durationSeconds,
            recordedAt: new Date().toISOString(),
          };
          await enqueue({ id, kind: "video_upload", projectId, localUri, payload });
          requestSync();
          leaveCaptureNotice("Video saved. Uploading in the background.");
        } catch (e) {
          leaveCaptureNotice(
            e instanceof Error ? `Video not saved: ${e.message}` : "Could not save the video",
          );
        }
      })();
    }, 0);
  }

  /**
   * A stopped walkthrough: into the offline outbox at once, then its snaps.
   *
   * The clip is moved into the outbox the moment it lands and queued as one
   * `walkthrough_video` row, which then makes the walkthrough if Record could
   * not, uploads the video, finishes the session, transcribes it and writes
   * the report, in web's order, whenever there is signal (see
   * `offline/walkthrough-video.ts`). It used to do all of that here, inline,
   * with a React ref as the only record of how far it got: closing the app
   * part way lost the walk.
   *
   * The row is held while the snaps are taken from the video and queued, so
   * the report it writes has them; it is let go as soon as they are. Every
   * value here belongs to this take, so a new recording started meanwhile
   * cannot touch it.
   */
  async function saveWalkthrough(
    videoUri: string,
    wallSeconds: number,
    thisTake: Take,
    snaps: WalkthroughSnap[],
  ) {
    if (!projectId || !user) return;
    const userId = user.id;
    const id = newOutboxId();
    let localUri: string;
    try {
      localUri = persistRecording(videoUri, id);
      const payload: WalkthroughVideoPayload = {
        userId,
        projectId,
        title: thisTake.title,
        startedAt: thisTake.startedAt,
        durationSeconds: wallSeconds,
        mimeType: "video/mp4",
        sessionId: null,
      };
      await enqueue({
        id,
        kind: "walkthrough_video",
        projectId,
        localUri,
        payload,
        holdUntil: Date.now() + WALKTHROUGH_HOLD_MS,
      });
    } catch (e) {
      showNotice(
        e instanceof Error
          ? `Walkthrough not saved: ${e.message}`
          : "Could not save the walkthrough",
      );
      return;
    }
    showNotice("Saving walkthrough in the background");

    try {
      /*
       * Each snap was timed from the Record press, and the video began a
       * moment later, so every offset is moved back by that delay before its
       * frame is taken and before it is captioned from the transcript.
       */
      const videoSeconds = await readVideoDuration(localUri);
      const delay = encoderDelaySeconds(wallSeconds, videoSeconds);
      let ready = calibrateSnapOffsets(snaps, delay);
      if (ready.some((s) => !s.uri)) {
        ready = await extractSnapFrames(localUri, ready, videoSeconds ?? wallSeconds);
      }
      const missing = missingFramesNotice(countMissingFrames(ready));

      const sessionId = await thisTake.session;
      await queueWalkthroughSnaps({
        userId,
        projectId,
        walkthroughId: sessionId,
        videoRowId: id,
        snaps: ready,
        deviceCoords,
        projectCoords: projectCoords(project ?? null),
      });
      await updateQueuedPayload(id, {
        sessionId,
        durationSeconds: videoSeconds ?? wallSeconds,
      });
      if (missing) showNotice(missing);
    } catch {
      // The video still goes; only snaps not yet queued are lost with this.
    } finally {
      await finishHeld(id).catch(() => false);
      requestSync();
    }
  }

  const needsPermission = !cameraPermission?.granted;

  if (!cameraPermission) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (needsPermission) {
    return (
      <View
        style={[styles.centered, { backgroundColor: theme.colors.background, gap: spacing.md }]}
      >
        <Text style={[typography.heading, { color: theme.colors.foreground }]}>
          Camera access needed
        </Text>
        <Pressable
          accessibilityRole="button"
          style={[styles.primary, { backgroundColor: theme.colors.primary }]}
          onPress={() => {
            if (cameraPermission.canAskAgain) void requestCamera();
            else void Linking.openSettings();
          }}
        >
          <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
            {cameraPermission.canAskAgain ? "Grant access" : "Open Settings"}
          </Text>
        </Pressable>
      </View>
    );
  }

  const minutes = Math.floor(elapsed / 60);
  const seconds = Math.floor(elapsed % 60);
  const recordDisabled = stage === "saving" || (!cameraReady && !cameraFailed.current);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView
        key={cameraKey}
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode="video"
        videoQuality={VIDEO_QUALITY}
        videoBitrate={VIDEO_BITRATE}
        onCameraReady={() => {
          cameraFailed.current = false;
          setCameraReady(true);
        }}
        onMountError={() => {
          cameraFailed.current = true;
          setCameraReady(false);
          setError("The camera did not start. Tap Record to try again.");
        }}
      />

      <View
        style={[
          styles.topBar,
          {
            top: insets.top + spacing.sm,
            left: insets.left + spacing.lg,
            right: insets.right + spacing.lg,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.roundButton}
          onPress={requestClose}
          hitSlop={8}
        >
          <Icon icon={X} size="md" color="#fff" />
        </Pressable>
        {stage === "recording" ? (
          <View style={[styles.chip, styles.recordingChip]}>
            <Text style={styles.chipText}>
              {minutes}:{String(seconds).padStart(2, "0")}
            </Text>
          </View>
        ) : null}
        {stage === "idle" ? (
          <View style={styles.chip}>
            <Text style={styles.chipText}>
              {siteVideo ? "Site video" : "Walkthrough"}, up to {Math.round(maxSeconds / 60)}{" "}
              minutes
            </Text>
          </View>
        ) : null}
        {shots.length > 0 ? (
          <View style={styles.chip}>
            <Text style={styles.chipText}>{shots.length} photos</Text>
          </View>
        ) : null}
      </View>

      {notice ? (
        <View
          style={[styles.notice, { top: insets.top + spacing.sm + HIT_TARGET + spacing.md }]}
          pointerEvents="none"
        >
          <Text style={styles.chipText}>{notice}</Text>
        </View>
      ) : null}

      {error ? (
        <View
          style={[
            styles.errorBox,
            { left: insets.left + spacing.lg, right: insets.right + spacing.lg },
            !siteVideo && shots.length > 0 && !rail && { bottom: 220 },
          ]}
        >
          <Text style={styles.error}>{error}</Text>
          {micBlocked ? (
            <Pressable
              accessibilityRole="button"
              style={[styles.chip, styles.settingsChip]}
              onPress={() => void Linking.openSettings()}
            >
              <Icon icon={Settings} size="sm" color="#fff" />
              <Text style={styles.chipText}>Open Settings</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/*
        Close or Back while recording: keep the walk or throw it away. Drawn
        over the camera rather than as an alert, so the recording carries on
        underneath until one is chosen.
      */}
      {askLeave ? (
        <View style={styles.askScrim}>
          <View style={styles.askCard}>
            <Text style={[styles.chipText, styles.askTitle]}>Stop recording?</Text>
            <View style={styles.askActions}>
              <Pressable
                accessibilityRole="button"
                style={[styles.chip, styles.askButton]}
                onPress={() => answerLeave("stay")}
              >
                <Text style={styles.chipText}>Keep recording</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={[styles.chip, styles.askButton, styles.discardButton]}
                onPress={() => answerLeave("discard")}
              >
                <Text style={styles.chipText}>Discard</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={[styles.chip, styles.askButton, styles.saveButton]}
                onPress={() => answerLeave("save")}
              >
                <Text style={styles.chipText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {/*
        What has been snapped so far, across the bottom of the live view with
        the newest at the end: above the shutter on a phone, beside the
        right-hand controls on a tablet.
      */}
      {!siteVideo && shots.length > 0 ? (
        <View
          style={[
            styles.strip,
            rail
              ? {
                  bottom: insets.bottom + spacing.lg,
                  left: insets.left + spacing.md,
                  right: insets.right + RAIL_WIDTH + spacing.lg,
                }
              : {
                  bottom: insets.bottom + 40 + 78 + spacing.md,
                  left: insets.left + spacing.md,
                  right: insets.right + spacing.md,
                },
          ]}
          pointerEvents="box-none"
        >
          <SnapStrip snaps={shots} />
        </View>
      ) : null}

      {/*
        On a phone, in either orientation, the same place as the camera's
        shutter: floating at the bottom centre of the live view. On a tablet
        a walkthrough's controls stand in a column on the right instead, the
        way the camera's do, with the snaps along the bottom beside them.
      */}
      <View
        style={
          rail
            ? [
                styles.rightRail,
                {
                  top: insets.top,
                  bottom: insets.bottom,
                  right: insets.right + spacing.lg,
                  width: RAIL_WIDTH,
                },
              ]
            : [
                styles.bottomBar,
                {
                  bottom: insets.bottom + 40,
                  left: insets.left,
                  right: insets.right,
                },
              ]
        }
      >
        {/* A site video has no stills, so the snap control gives way to a spacer. */}
        {siteVideo ? (
          <View style={styles.sideAction} />
        ) : (
          <Pressable
            accessibilityRole="button"
            /*
              On the same dark pill the other controls sit on.

              This was white text straight onto the camera preview while Close,
              the timer and the photo count all had `chip` behind them. Against a
              bright subject - a sunlit wall, a white ceiling, a snow-covered
              roof, all of them ordinary on a jobsite - white on the scene is
              invisible, and this is the control that captures the still somebody
              walked over to take.
            */
            style={[styles.chip, styles.sideAction]}
            disabled={stage !== "recording"}
            onPress={() => void snap()}
          >
            <Text style={[styles.chipText, stage !== "recording" && { opacity: 0.4 }]}>
              Snap photo
            </Text>
          </Pressable>
        )}

        {stage === "recording" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop recording"
            style={styles.stopButton}
            onPress={stop}
          >
            <View style={styles.stopInner} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start recording"
            style={[styles.recordButton, recordDisabled && { opacity: 0.5 }]}
            disabled={recordDisabled}
            onPress={() => void start()}
          >
            <View style={styles.recordInner} />
          </Pressable>
        )}

        <View style={styles.sideAction} />
      </View>
    </View>
  );
}

type Coordinates = { latitude: number; longitude: number };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  roundButton: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    borderRadius: HIT_TARGET / 2,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 36,
    justifyContent: "center",
  },
  recordingChip: { backgroundColor: "rgba(223,34,37,0.85)" },
  chipText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  errorBox: {
    position: "absolute",
    bottom: 200,
    alignItems: "center",
    gap: spacing.sm,
  },
  error: {
    color: "#fff",
    backgroundColor: "rgba(180,35,24,0.9)",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
    textAlign: "center",
  },
  settingsChip: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  notice: {
    position: "absolute",
    alignSelf: "center",
    maxWidth: "90%",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  askScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  askCard: {
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    maxWidth: 440,
    width: "100%",
  },
  askTitle: { fontSize: 17, textAlign: "center" },
  askActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm },
  askButton: { minHeight: HIT_TARGET, alignItems: "center" },
  discardButton: { backgroundColor: "rgba(180,35,24,0.9)" },
  saveButton: { backgroundColor: "rgba(255,255,255,0.2)" },
  strip: { position: "absolute", height: 64 },
  rightRail: {
    position: "absolute",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  bottomBar: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
  },
  sideAction: {
    minWidth: 96,
    minHeight: HIT_TARGET,
    justifyContent: "center",
    alignItems: "center",
  },
  recordButton: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  recordInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#df2225" },
  stopButton: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: "#df2225",
    alignItems: "center",
    justifyContent: "center",
  },
  stopInner: { width: 34, height: 34, borderRadius: 6, backgroundColor: "#df2225" },
  primary: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: HIT_TARGET,
    justifyContent: "center",
  },
});
