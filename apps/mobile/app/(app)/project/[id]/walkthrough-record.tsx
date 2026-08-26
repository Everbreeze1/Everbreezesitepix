import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraType,
} from "expo-camera";
import * as Location from "expo-location";
import { useQuery } from "@tanstack/react-query";
import { getProject, projectCoords } from "@/api/projects";
import type { CapturedAsset } from "@/api/photos";
import {
  createWalkthroughSession,
  finishWalkthroughSession,
  saveWalkthroughPhoto,
  transcribeWalkthrough,
  updateWalkthroughVideoPath,
  uploadWalkthroughVideo,
  walkthroughVideoPath,
} from "@/api/walkthroughs";
import { useAuth } from "@/lib/auth";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

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

type PendingShot = CapturedAsset & { offsetSeconds: number };

export default function WalkthroughRecordScreen() {
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { user } = useAuth();

  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);

  const [facing] = useState<CameraType>("back");
  const [stage, setStage] = useState<Stage>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [shots, setShots] = useState<PendingShot[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);

  const startedAt = useRef<number | null>(null);

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

  const snap = useCallback(async () => {
    if (!cameraRef.current || stage !== "recording") return;
    const offsetSeconds = startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0;
    try {
      const picture = await cameraRef.current.takePictureAsync({ exif: true, quality: 1 });
      if (picture) {
        setShots((prev) => [
          ...prev,
          {
            uri: picture.uri,
            width: picture.width,
            height: picture.height,
            exif: picture.exif ?? null,
            offsetSeconds,
          },
        ]);
      }
    } catch {
      // A failed snap must not end the recording. The walk continues.
      setError("That photo did not save. Recording is still running.");
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
    setShots([]);
    setStage("recording");

    try {
      /*
       * `recordAsync` resolves when `stopRecording` is called, so this promise
       * is the recording. It is awaited here rather than stored, and the stop
       * button resolves it.
       */
      const recording = await cameraRef.current?.recordAsync({
        maxDuration: MAX_DURATION_SECONDS,
      });
      const durationSeconds = startedAt.current ? (Date.now() - startedAt.current) / 1000 : elapsed;

      if (!recording?.uri) {
        setStage("idle");
        setError("The recording did not save");
        return;
      }

      await persist(recording.uri, durationSeconds);
    } catch (e) {
      setStage("idle");
      setError(e instanceof Error ? e.message : "Recording failed");
    }
  }

  function stop() {
    if (stage !== "recording") return;
    setStage("saving");
    cameraRef.current?.stopRecording();
  }

  /**
   * Everything that happens after the stop button.
   *
   * Deliberately sequential and deliberately not in the offline outbox. A
   * walkthrough is a session on the server: the id has to exist before its
   * photos can reference it, and the video path before the session is finished.
   * Queuing the steps independently would let them arrive in an order the API
   * cannot accept.
   */
  async function persist(videoUri: string, durationSeconds: number) {
    if (!projectId || !user) return;
    setStage("saving");

    try {
      setStatus("Creating session");
      const title = `Walkthrough ${new Date().toLocaleString()}`;
      const session = await createWalkthroughSession(projectId, title);

      const coords = projectCoords(project ?? null);

      for (let index = 0; index < shots.length; index += 1) {
        setStatus(`Saving photo ${index + 1} of ${shots.length}`);
        await saveWalkthroughPhoto({
          userId: user.id,
          projectId,
          walkthroughId: session.id,
          asset: shots[index],
          offsetSeconds: shots[index].offsetSeconds,
          position: index,
          deviceCoords,
          projectCoords: coords,
        });
      }

      const path = walkthroughVideoPath(user.id, projectId, session.id, "mp4");
      setStatus("Uploading video 0%");
      await uploadWalkthroughVideo({
        localUri: videoUri,
        storagePath: path,
        mimeType: "video/mp4",
        onProgress: (percent) => setStatus(`Uploading video ${percent}%`),
      });

      setStatus("Finishing up");
      await updateWalkthroughVideoPath(session.id, path, "video/mp4");
      await finishWalkthroughSession(session.id, durationSeconds);

      /*
       * Last, and allowed to fail. The recording and its photos are saved by
       * this point, so a refused transcription costs nothing that cannot be
       * recovered from the web app. Long recordings are refused by design: the
       * transcription endpoint takes inline data with a size ceiling, and the
       * server says so in a sentence worth showing.
       */
      setStatus("Transcribing");
      const transcription = await transcribeWalkthrough(session.id, path, "video/mp4");

      router.replace(`/project/${projectId}/walkthroughs`);
      if (!transcription.ok && transcription.message) {
        setError(transcription.message);
      }
    } catch (e) {
      setStage("idle");
      setStatus(null);
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

  if (stage === "saving") {
    return (
      <View
        style={[styles.centered, { backgroundColor: theme.colors.background, gap: spacing.md }]}
      >
        <Stack.Screen options={{ title: "Saving walkthrough" }} />
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
        {error ? (
          <Text style={[typography.caption, { color: theme.colors.destructive }]}>{error}</Text>
        ) : null}
      </View>
    );
  }

  const minutes = Math.floor(elapsed / 60);
  const seconds = Math.floor(elapsed % 60);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} mode="video" />

      <View style={styles.topBar}>
        <Pressable style={styles.chip} onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.chipText}>Close</Text>
        </Pressable>
        {stage === "recording" ? (
          <View style={[styles.chip, styles.recordingChip]}>
            <Text style={styles.chipText}>
              {minutes}:{String(seconds).padStart(2, "0")}
            </Text>
          </View>
        ) : null}
        {shots.length > 0 ? (
          <View style={styles.chip}>
            <Text style={styles.chipText}>{shots.length} photos</Text>
          </View>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.bottomBar}>
        <Pressable
          style={styles.sideAction}
          disabled={stage !== "recording"}
          onPress={() => void snap()}
        >
          <Text style={[styles.chipText, stage !== "recording" && { opacity: 0.4 }]}>
            Snap photo
          </Text>
        </Pressable>

        {stage === "recording" ? (
          <Pressable style={styles.stopButton} onPress={stop}>
            <View style={styles.stopInner} />
          </Pressable>
        ) : (
          <Pressable style={styles.recordButton} onPress={() => void start()}>
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
    top: 48,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
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
  bottomBar: {
    position: "absolute",
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
  },
  sideAction: { minWidth: 96, minHeight: HIT_TARGET, justifyContent: "center" },
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
