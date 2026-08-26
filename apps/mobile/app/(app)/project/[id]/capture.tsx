import { useCallback, useEffect, useRef, useState } from "react";
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
import { router, Stack, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions, type CameraType, type FlashMode } from "expo-camera";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useQuery } from "@tanstack/react-query";
import { type CapturedAsset, type PhotoPhase } from "@/api/photos";
import { getProject, projectCoords } from "@/api/projects";
import { useAuth } from "@/lib/auth";
import { persistCapture } from "@/offline/media";
import { enqueue, newOutboxId } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import type { PhotoUploadPayload } from "@/offline/handlers";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

type Shot = CapturedAsset & { key: string };

const PHASES: { id: PhotoPhase; label: string }[] = [
  { id: "before", label: "Before" },
  { id: "untagged", label: "Untagged" },
  { id: "after", label: "After" },
];

export default function CaptureScreen() {
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
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

  const [phase, setPhase] = useState<PhotoPhase>("untagged");
  const [caption, setCaption] = useState("");
  const [tagText, setTagText] = useState("");

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

  const addShot = useCallback((asset: CapturedAsset) => {
    setShots((prev) => [...prev, { ...asset, key: `${asset.uri}-${prev.length}` }]);
  }, []);

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
        addShot({
          uri: picture.uri,
          width: picture.width,
          height: picture.height,
          exif: picture.exif ?? null,
        });
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
    for (const asset of result.assets) {
      addShot({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType,
        exif: (asset.exif as Record<string, unknown> | null) ?? null,
      });
    }
  }

  function removeShot(key: string) {
    setShots((prev) => prev.filter((shot) => shot.key !== key));
  }

  /**
   * Hand the batch to the outbox and get out of the way.
   *
   * Nothing is uploaded here. Each shot is copied into app storage and written
   * to the queue, which takes milliseconds and cannot fail for lack of signal,
   * then the drain delivers it whenever the network allows. The alternative,
   * uploading inline, means a progress bar the user has to stand still and
   * watch on the one connection least likely to hold: a phone on a job site.
   */
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

    for (let i = 0; i < shots.length; i += 1) {
      const shot = shots[i];
      try {
        // The id is minted first: the durable copy is named after it, and it
        // becomes the idempotency key for the upload itself.
        const id = newOutboxId();
        const localUri = persistCapture(shot.uri, id);

        const payload: PhotoUploadPayload = {
          userId: user.id,
          projectId,
          width: shot.width,
          height: shot.height,
          exif: shot.exif,
          phase,
          tags,
          caption: caption.trim() || undefined,
          deviceCoords,
          projectCoords: projectCoords(project ?? null),
        };

        await enqueue({ id, kind: "photo_upload", projectId, localUri, payload });
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

    router.back();
  }

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

  if (reviewing) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: theme.colors.background }}
      >
        <Stack.Screen options={{ title: `Review ${shots.length}`, headerShown: true }} />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
          <View style={styles.reviewGrid}>
            {shots.map((shot) => (
              <View key={shot.key} style={styles.reviewTile}>
                <Image source={{ uri: shot.uri }} style={styles.reviewImage} contentFit="cover" />
                <Pressable
                  style={styles.removeBadge}
                  hitSlop={8}
                  onPress={() => removeShot(shot.key)}
                >
                  <Text style={styles.removeBadgeText}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>

          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.overline, { color: theme.colors.mutedForeground }]}>
              PHASE
            </Text>
            <View style={styles.segmented}>
              {PHASES.map((option) => {
                const active = phase === option.id;
                return (
                  <Pressable
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
            <Text style={[typography.overline, { color: theme.colors.mutedForeground }]}>TAGS</Text>
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
      </KeyboardAvoidingView>
    );
  }

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

      <View style={styles.topBar}>
        <Pressable style={styles.chip} onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.chipText}>Close</Text>
        </Pressable>
        <Pressable
          style={styles.chip}
          hitSlop={8}
          onPress={() => setFlash(flash === "off" ? "auto" : flash === "auto" ? "on" : "off")}
        >
          <Text style={styles.chipText}>Flash {flash}</Text>
        </Pressable>
        <Pressable
          style={styles.chip}
          hitSlop={8}
          onPress={() => setFacing(facing === "back" ? "front" : "back")}
        >
          <Text style={styles.chipText}>Flip</Text>
        </Pressable>
      </View>

      {shots.length > 0 ? (
        <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.stripContent}>
          {shots.map((shot) => (
            <Image key={shot.key} source={{ uri: shot.uri }} style={styles.stripThumb} />
          ))}
        </ScrollView>
      ) : null}

      {error ? <Text style={styles.cameraError}>{error}</Text> : null}

      <View style={styles.bottomBar}>
        <Pressable style={styles.sideAction} onPress={() => void pickFromLibrary()}>
          <Text style={styles.chipText}>Library</Text>
        </Pressable>

        <Pressable style={styles.shutter} onPress={() => void takeShot()}>
          <View style={styles.shutterInner} />
        </Pressable>

        <Pressable
          style={styles.sideAction}
          disabled={shots.length === 0}
          onPress={() => setReviewing(true)}
        >
          <Text style={[styles.chipText, shots.length === 0 && { opacity: 0.4 }]}>
            {shots.length > 0 ? `Review ${shots.length}` : "Review"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  cameraRoot: { flex: 1, backgroundColor: "#000" },
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
  chipText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  strip: { position: "absolute", bottom: 148, left: 0, right: 0, maxHeight: 72 },
  stripContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  stripThumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: "#222" },
  cameraError: {
    position: "absolute",
    bottom: 232,
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
  sideAction: { minWidth: 88, minHeight: HIT_TARGET, justifyContent: "center" },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#fff" },
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
