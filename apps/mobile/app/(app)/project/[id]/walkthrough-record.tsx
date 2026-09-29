import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack, useLocalSearchParams } from "expo-router";
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
  captureSnapStill,
  extractSnapFrames,
  newWalkthroughSnap,
  queueWalkthroughSnaps,
  type WalkthroughSnap,
} from "@/api/walkthrough-snaps";
import { SnapStrip } from "@/components/walkthrough/SnapStrip";
import {
  createWalkthroughSession,
  finishWalkthroughSession,
  transcribeWalkthrough,
  updateWalkthroughVideoPath,
  uploadWalkthroughVideo,
  walkthroughVideoPath,
} from "@/api/walkthroughs";
import { useAuth } from "@/lib/auth";
import { leaveCaptureNotice } from "@/lib/capture-notice";
import type { VideoUploadPayload } from "@/offline/handlers";
import { persistRecording } from "@/offline/media";
import { enqueue, newOutboxId } from "@/offline/outbox";
import { requestSync } from "@/offline/sync";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";
import { Icon } from "@/ui";
import { X } from "@/ui/icons";

/**
 * Cap on one recording.
 *
 * Ten minutes of video is already a large upload from a job site, and the
 * product intends per-tier limits (product-roadmap section 2.2) that are not
 * enforced anywhere yet. This is a floor to stop a phone filling its storage
 * with a recording nobody stopped, not the tier rule.
 */
const MAX_DURATION_SECONDS = 10 * 60;

type Stage = "idle" | "recording" | "saving";

/**
 * How long a stopped site video on Android waits for its file to close
 * before the recorder goes back to the camera anyway. Android keeps the
 * recording's promise alive when the view goes, so the clip is still queued
 * when it lands; this only gives the file its usual moment to finish. iOS
 * waits for the file, because unmounting there drops the recording.
 */
const SITE_VIDEO_LEAVE_MS = 600;

/** Width of the tablet's right-hand control column, record button included. */
const RAIL_WIDTH = 120;

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

  const [facing] = useState<CameraType>("back");
  const [stage, setStage] = useState<Stage>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [shots, setShots] = useState<WalkthroughSnap[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);

  const startedAt = useRef<number | null>(null);
  /** A site video's recorder has already gone back to the camera. */
  const left = useRef(false);
  /*
   * The snaps as they are taken. `start` awaits the whole recording, so the
   * `shots` it closed over is the empty list from before the first snap, and
   * saving from that dropped every photo taken during the walk.
   */
  const shotsRef = useRef<WalkthroughSnap[]>([]);
  /*
   * A walkthrough whose save failed part way, kept so "Try again" resumes it
   * rather than the recording being lost: the file, its length, and how far
   * the save got (the session it made, whether its photos are queued).
   */
  const unsaved = useRef<{
    videoUri: string;
    durationSeconds: number;
    sessionId: string | null;
    photosQueued: boolean;
  } | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  /* The web recorder's per-plan ceiling on one take. */
  const { data: team } = useQuery({
    queryKey: ["my-team"],
    queryFn: getMyTeam,
    staleTime: 10 * 60_000,
  });
  const maxSeconds = siteVideo ? videoMaxSeconds(team?.plan) : MAX_DURATION_SECONDS;

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

  async function start() {
    if (!projectId || !user || stage !== "idle") return;
    setError(null);

    if (!micPermission?.granted) {
      const granted = await requestMic();
      if (!granted.granted) {
        setError("Microphone access is needed to record narration");
        return;
      }
    }

    startedAt.current = Date.now();
    setElapsed(0);
    shotsRef.current = [];
    setShots([]);
    unsaved.current = null;
    setCanRetry(false);
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
      const durationSeconds = startedAt.current ? (Date.now() - startedAt.current) / 1000 : elapsed;

      if (!recording?.uri) {
        if (left.current) leaveCaptureNotice("The video did not save. Try recording it again.");
        setStage("idle");
        setError("The recording did not save");
        return;
      }

      await persist(recording.uri, durationSeconds);
    } catch (e) {
      // Already back on the camera: say it there, where it can be seen.
      if (left.current) leaveCaptureNotice("The video did not save. Try recording it again.");
      setStage("idle");
      setError(e instanceof Error ? e.message : "Recording failed");
    }
  }

  function stop() {
    if (stage !== "recording") return;
    setStage("saving");
    cameraRef.current?.stopRecording();
    /*
     * A site video goes back to the camera as soon as it is stopped, with no
     * spinner, chip or page in between (Jon, 2026-09-29: "The circling thing
     * is still happening when i save a video"). On Android that is at once, or
     * as soon as the file closes if that is sooner; the clip is queued in the
     * background when it lands.
     */
    if (siteVideo && Platform.OS === "android") {
      setTimeout(leaveForCamera, SITE_VIDEO_LEAVE_MS);
    }
  }

  /** Back to the camera (or the project), once, however many paths ask. */
  function leaveForCamera() {
    if (left.current) return;
    left.current = true;
    goBack(`/project/${projectId}`);
  }

  /**
   * Everything that happens after the stop button.
   *
   * A site video goes to the offline outbox and returns at once. A walkthrough
   * is a session on the server, so its session and video steps stay
   * sequential here: the id has to exist before its photos can reference it,
   * and the video path before the session is finished. Its photos, once the
   * id exists, go to the outbox (see `saveWalkthrough`).
   */
  async function persist(videoUri: string, durationSeconds: number) {
    if (!projectId || !user) return;
    setStage("saving");

    if (siteVideo) {
      /*
       * Queued, not uploaded. The clip is moved into app storage and handed to
       * the outbox, which is a rename and one row: instant, and it needs no
       * signal. The drain sends it in the background with the queue banner
       * showing it, the way photos go, and the camera is back at once.
       *
       * This used to upload inline behind a full-screen "Uploading video 42%"
       * that held the phone for as long as the upload took (Jon, 2026-09-29:
       * "the whole screen was doing a count down on saving the video").
       */
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
      return;
    }

    await saveWalkthrough(videoUri, durationSeconds);
  }

  /**
   * Save a finished walkthrough: its snaps, the recording, the transcript.
   *
   * Resumable. Each step that succeeds is remembered in `unsaved`, so when a
   * later one fails (no signal at the upload, say) "Try again" carries on
   * from there with the same session instead of losing the walk or making a
   * second one.
   */
  async function saveWalkthrough(videoUri: string, durationSeconds: number) {
    if (!projectId || !user) return;
    const progress = unsaved.current ?? {
      videoUri,
      durationSeconds,
      sessionId: null,
      photosQueued: false,
    };
    unsaved.current = progress;
    setCanRetry(false);
    setStage("saving");
    setStatus("Saving");
    setError(null);

    try {
      /*
       * Snaps still waiting for their picture take it from the recording now,
       * on the phone, before anything needs the network.
       */
      if (!progress.photosQueued && shotsRef.current.some((s) => !s.uri)) {
        setStatus("Taking photos from the video");
        shotsRef.current = await extractSnapFrames(videoUri, shotsRef.current, durationSeconds);
        setShots(shotsRef.current);
      }

      if (!progress.sessionId) {
        setStatus("Creating session");
        const title = `Walkthrough ${new Date().toLocaleString()}`;
        const session = await createWalkthroughSession(projectId, title);
        progress.sessionId = session.id;
      }
      const sessionId = progress.sessionId;

      /*
       * Queued, not uploaded here: each snap goes to the offline outbox
       * linked to this walkthrough at its offset, and the queue sends it in
       * the background like any photo. It used to be uploaded inline, one
       * after another, where one failure lost every snap of the walk.
       */
      if (!progress.photosQueued) {
        setStatus("Saving photos");
        await queueWalkthroughSnaps({
          userId: user.id,
          projectId,
          walkthroughId: sessionId,
          snaps: shotsRef.current,
          deviceCoords,
          projectCoords: projectCoords(project ?? null),
        });
        progress.photosQueued = true;
        requestSync();
      }

      const path = walkthroughVideoPath(user.id, projectId, sessionId, "mp4");
      setStatus("Uploading video 0%");
      await uploadWalkthroughVideo({
        localUri: videoUri,
        storagePath: path,
        mimeType: "video/mp4",
        onProgress: (percent) => setStatus(`Uploading video ${percent}%`),
      });

      setStatus("Finishing up");
      await updateWalkthroughVideoPath(sessionId, path, "video/mp4");
      await finishWalkthroughSession(sessionId, durationSeconds);
      unsaved.current = null;

      /*
       * Last, and allowed to fail. The recording and its photos are saved by
       * this point, so a refused transcription costs nothing that cannot be
       * recovered from the web app. The server reads only the recording's
       * sound track and captions each snap from what was said around it; a
       * snap still in the queue is captioned when it lands.
       */
      setStatus("Transcribing");
      const transcription = await transcribeWalkthrough(sessionId, path, "video/mp4");

      router.replace(`/project/${projectId}/walkthroughs`);
      if (!transcription.ok && transcription.message) {
        setError(transcription.message);
      }
    } catch (e) {
      setStage("idle");
      setStatus(null);
      setCanRetry(true);
      setError(e instanceof Error ? e.message : "Could not save the walkthrough");
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
          onPress={() => void requestCamera()}
        >
          <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
            Grant access
          </Text>
        </Pressable>
      </View>
    );
  }

  /*
   * A site video never gets this screen: it is queued in a moment and the
   * recorder closes, so the live view stays up, with nothing drawn over it,
   * for that moment rather than a page telling someone to wait.
   */
  /*
   * Only once the recording's file has landed (`status` is set by
   * `saveWalkthrough`), so the camera stays mounted while it finishes
   * writing: unmounting it first can drop the recording on iOS.
   */
  if (stage === "saving" && !siteVideo) {
    if (status !== null) {
      return (
        <View
          style={[styles.centered, { backgroundColor: theme.colors.background, gap: spacing.md }]}
        >
          <Stack.Screen options={{ title: siteVideo ? "Saving video" : "Saving walkthrough" }} />
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[typography.body, { color: theme.colors.foreground }]}>
            {status ?? "Saving"}
          </Text>
          <Text
            style={[
              typography.caption,
              { color: theme.colors.mutedForeground, textAlign: "center", paddingHorizontal: 32 },
            ]}
          >
            Keep the app open until this finishes. The recording is on this phone until it uploads.
          </Text>
          {shots.length > 0 ? (
            <View style={styles.savingStrip}>
              <SnapStrip snaps={shots} />
            </View>
          ) : null}
          {error ? (
            <Text style={[typography.caption, { color: theme.colors.destructive }]}>{error}</Text>
          ) : null}
        </View>
      );
    }
  }

  const minutes = Math.floor(elapsed / 60);
  const seconds = Math.floor(elapsed % 60);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} mode="video" />

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
          onPress={() => goBack(`/project/${projectId}`)}
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
        {siteVideo && stage === "idle" ? (
          <View style={styles.chip}>
            <Text style={styles.chipText}>
              Site video, up to {Math.round(maxSeconds / 60)} minutes
            </Text>
          </View>
        ) : null}
        {shots.length > 0 ? (
          <View style={styles.chip}>
            <Text style={styles.chipText}>{shots.length} photos</Text>
          </View>
        ) : null}
      </View>

      {error ? (
        <Text style={[styles.error, !siteVideo && shots.length > 0 && !rail && { bottom: 220 }]}>
          {error}
        </Text>
      ) : null}

      {/*
        A walkthrough that failed to save is still on the phone; this carries
        the save on from where it stopped rather than losing the walk.
      */}
      {!siteVideo && canRetry && stage === "idle" ? (
        <Pressable
          accessibilityRole="button"
          style={[
            styles.chip,
            styles.retry,
            { top: insets.top + spacing.sm + HIT_TARGET + spacing.md },
          ]}
          onPress={() => {
            const pending = unsaved.current;
            if (pending) void saveWalkthrough(pending.videoUri, pending.durationSeconds);
          }}
        >
          <Text style={styles.chipText}>Try saving the walkthrough again</Text>
        </Pressable>
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
            style={[styles.recordButton, stage === "saving" && !siteVideo && { opacity: 0.5 }]}
            disabled={stage === "saving"}
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
  error: {
    position: "absolute",
    bottom: 200,
    alignSelf: "center",
    color: "#fff",
    backgroundColor: "rgba(180,35,24,0.9)",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  strip: { position: "absolute", height: 64 },
  savingStrip: { height: 64, alignSelf: "stretch", marginTop: spacing.md },
  retry: { position: "absolute", alignSelf: "center" },
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
