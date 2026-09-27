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
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions, type CameraType, type FlashMode } from "expo-camera";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useQuery } from "@tanstack/react-query";
import { type CapturedAsset, type PhotoPhase } from "@/api/photos";
import { tagForPhase, type WatermarkTag } from "@/api/watermark";
import { renderWatermarked } from "@/api/watermark-render";
import { WatermarkCanvas } from "@/components/WatermarkCanvas";
import { formatAddress, getProject, projectCoords } from "@/api/projects";
import { projectDisplayName } from "@everlumen/shared";
import { useAuth } from "@/lib/auth";
import { persistCapture } from "@/offline/media";
import { enqueue, newOutboxId } from "@/offline/outbox";
import { recordSessionPhoto } from "@/offline/capture-session";
import { refreshQueue, requestSync } from "@/offline/sync";
import type { PhotoUploadPayload } from "@/offline/handlers";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";
import { Icon } from "@/ui";
import { Images, MapPin, RefreshCw, X } from "@/ui/icons";

type Shot = CapturedAsset & { key: string };

const PHASES: { id: PhotoPhase; label: string }[] = [
  { id: "before", label: "Before" },
  { id: "untagged", label: "Untagged" },
  { id: "after", label: "After" },
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

  const [phase, setPhase] = useState<PhotoPhase>("untagged");
  const [caption, setCaption] = useState("");
  const [tagText, setTagText] = useState("");

  /*
   * The off-screen surface the before/after pill is burnt in on.
   *
   * One shot at a time rather than mounting a canvas per photo: a burst of
   * twenty at 2048px would be twenty full-resolution images held at once, and
   * the phone that just took them is the one least able to afford it.
   */
  const stampRef = useRef<Svg>(null);
  const [stamping, setStamping] = useState<{
    uri: string;
    width: number;
    height: number;
    tag: WatermarkTag;
  } | null>(null);
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
  const stamp = useCallback(async (shot: Shot, currentPhase: PhotoPhase): Promise<string> => {
    const tag = tagForPhase(currentPhase);
    // No pill wanted, or the picker gave us no dimensions to size one against.
    if (!tag || !shot.width || !shot.height) return shot.uri;

    try {
      const rendered = await new Promise<string>((resolve, reject) => {
        stampResolve.current = resolve;
        setStamping({ uri: shot.uri, width: shot.width!, height: shot.height!, tag });
        // The canvas has to mount and lay out before it can rasterise. This is
        // the outer bound on that, separate from the rasteriser's own timeout.
        setTimeout(() => reject(new Error("Watermark surface never became ready")), 20_000);
      });
      return rendered;
    } catch {
      return shot.uri;
    } finally {
      stampResolve.current = null;
      setStamping(null);
    }
  }, []);

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
        // The id is minted first: the durable copy is named after it, and it
        // becomes the idempotency key for the upload itself.
        const id = newOutboxId();
        // Watermark first, then persist, so the durable copy the queue owns is
        // the one with the pill already in it. Persisting first and stamping
        // after would leave the outbox pointing at the unstamped file.
        const stamped = await stamp(shot, phase);
        const localUri = persistCapture(stamped, id);

        const payload: PhotoUploadPayload = {
          userId: user.id,
          projectId,
          captureSessionId: sessionId,
          attachToChecklistItemId: checklistItemId ?? null,
          attachToWorkflowItemId: workflowItemId ?? null,
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
        // After the enqueue, so a session row can never point at a photo that
        // was never queued. A failure here costs the log, not the photograph.
        await recordSessionPhoto({
          outboxId: id,
          sessionId,
          projectId,
          source: "camera",
          tzOffsetMinutes,
        }).catch(() => {});
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
        {stamping ? (
          <View style={styles.stampSurface} pointerEvents="none" accessibilityElementsHidden>
            <WatermarkCanvas
              ref={stampRef}
              uri={stamping.uri}
              width={stamping.width}
              height={stamping.height}
              tag={stamping.tag}
            />
          </View>
        ) : null}

        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
          <View style={styles.reviewGrid}>
            {shots.map((shot) => (
              <View key={shot.key} style={styles.reviewTile}>
                <Image source={{ uri: shot.uri }} style={styles.reviewImage} contentFit="cover" />
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

  /*
   * The recent-shots strip shows at most four tiles. With more than that in the
   * batch the fourth becomes a "+N" tile for the rest, which opens review, so
   * the strip never scrolls under a thumb that is trying to reach the shutter.
   */
  const lastShot = shots.length > 0 ? shots[shots.length - 1] : null;
  const stripShots = shots.length > STRIP_MAX ? shots.slice(-(STRIP_MAX - 1)) : shots;
  const hiddenCount = shots.length - stripShots.length;
  const projectLabel = project
    ? (formatAddress(project) ?? projectDisplayName(project))
    : "Loading job";

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
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={[styles.gridLine, styles.gridV, { left: "33.333%" }]} />
        <View style={[styles.gridLine, styles.gridV, { left: "66.666%" }]} />
        <View style={[styles.gridLine, styles.gridH, { top: "33.333%" }]} />
        <View style={[styles.gridLine, styles.gridH, { top: "66.666%" }]} />
      </View>

      <View style={[styles.topArea, { top: insets.top + spacing.sm }]}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close camera"
            style={styles.roundButton}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <Icon icon={X} size="lg" color={CHROME_FG} />
          </Pressable>

          {/*
            Which job these photos land on, so nobody shoots a whole run into
            the wrong project. The street address when there is one, because
            that is what a crew calls a job; the project name otherwise.
          */}
          <View style={styles.locationPill} accessibilityRole="text">
            <Icon icon={MapPin} size="sm" color={CHROME_FG} />
            <Text style={styles.locationText} numberOfLines={1}>
              {projectLabel}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            style={styles.roundButton}
            hitSlop={8}
            accessibilityLabel={`Flash ${flash}. Tap to change`}
            onPress={() => setFlash(flash === "off" ? "auto" : flash === "auto" ? "on" : "off")}
          >
            <FlashGlyph mode={flash} />
          </Pressable>
        </View>

        {/*
          Before / Untagged / After, on the viewfinder.

          This used to live only on the review step, after the shutter, and on
          the live camera it looked as though before/after had gone from the
          app. The phase is a decision made before the shot ("I am about to
          document the before"), so it is picked here, and the same `phase`
          state is what the review step shows and what `stamp` burns in on
          Save. It still applies to the whole batch, not per photo: a run of
          befores is shot as one batch and saved, then the pill is flipped.
        */}
        <View style={styles.phaseRow} accessibilityRole="radiogroup">
          {PHASES.map((option) => {
            const active = phase === option.id;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${option.label} photos`}
                onPress={() => setPhase(option.id)}
                hitSlop={4}
                style={[styles.phasePill, active && styles.phasePillActive]}
              >
                <Text style={[styles.phaseText, active && styles.phaseTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error ? (
        <Text style={[styles.cameraError, { bottom: insets.bottom + 212 }]}>{error}</Text>
      ) : null}

      <View style={[styles.bottomArea, { bottom: insets.bottom + spacing.lg }]}>
        {/*
          Recent shots in this batch, newest last. The library tile rides at
          the end of the strip once there is a batch, because the bottom-left
          slot it had on an empty camera is now the last shot.
        */}
        {shots.length > 0 ? (
          <View style={styles.strip}>
            {stripShots.map((shot) => (
              <Image key={shot.key} source={{ uri: shot.uri }} style={styles.stripThumb} />
            ))}
            {hiddenCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${hiddenCount} more. Review all ${shots.length}`}
                style={[styles.stripThumb, styles.stripMore]}
                onPress={() => setReviewing(true)}
              >
                <Text style={styles.stripMoreText}>+{hiddenCount}</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add from photo library"
              style={[styles.stripThumb, styles.stripMore]}
              onPress={() => void pickFromLibrary()}
            >
              <Icon icon={Images} size="md" color={CHROME_FG} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.bottomBar}>
          {lastShot ? (
            /*
             * The last shot opens review, where the batch gets its caption,
             * tags and a last look at the phase before Save. The count on it is
             * the old "Review N" label, kept so nobody loses track of a burst.
             */
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Review ${shots.length} photo${shots.length === 1 ? "" : "s"}`}
              style={styles.lastShot}
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
              accessibilityLabel="Add from photo library"
              style={[styles.lastShot, styles.libraryButton]}
              onPress={() => void pickFromLibrary()}
            >
              <Icon icon={Images} size="lg" color={CHROME_FG} />
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            accessibilityHint="Adds a photo to this batch without leaving the camera"
            style={styles.shutter}
            onPress={() => void takeShot()}
          >
            <View style={styles.shutterInner} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            style={styles.flipButton}
            hitSlop={8}
            accessibilityLabel="Switch camera"
            onPress={() => setFacing(facing === "back" ? "front" : "back")}
          >
            <Icon icon={RefreshCw} size="lg" color={CHROME_FG} />
          </Pressable>
        </View>
      </View>
    </View>
  );
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

/** Tiles in the recent-shots strip before the rest collapse into "+N". */
const STRIP_MAX = 4;

/*
 * Camera chrome is always dark, whatever the app's scheme: it sits on a live
 * picture, and a light pill over a bright sky would vanish. So these are fixed
 * rather than read from the palette, and the orange primary is kept for the
 * one thing that is ours (the batch count).
 */
const CHROME_FG = "#ffffff";
const CHROME_FILL = "rgba(40, 36, 32, 0.72)";
const CHROME_DEEP = "rgba(10, 8, 6, 0.82)";
const SELECTED_FILL = "#ece8e3";
const SELECTED_FG = "#18130d";

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  cameraRoot: { flex: 1, backgroundColor: "#000" },
  gridLine: { position: "absolute", backgroundColor: "rgba(255,255,255,0.22)" },
  gridV: { top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridH: { left: 0, right: 0, height: StyleSheet.hairlineWidth },
  topArea: { position: "absolute", left: 0, right: 0, gap: spacing.md },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  roundButton: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    borderRadius: HIT_TARGET / 2,
    backgroundColor: CHROME_FILL,
    alignItems: "center",
    justifyContent: "center",
  },
  locationPill: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: CHROME_DEEP,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 36,
  },
  locationText: { color: CHROME_FG, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  phaseRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg },
  phasePill: {
    backgroundColor: CHROME_FILL,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 36,
    justifyContent: "center",
  },
  phasePillActive: { backgroundColor: SELECTED_FILL },
  phaseText: { color: CHROME_FG, fontSize: 15, fontWeight: "700" },
  phaseTextActive: { color: SELECTED_FG },
  flashAuto: { color: CHROME_FG, fontSize: 10, fontWeight: "800", marginLeft: -2 },
  cameraError: {
    position: "absolute",
    alignSelf: "center",
    color: "#fff",
    backgroundColor: "rgba(180,35,24,0.9)",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  bottomArea: { position: "absolute", left: 0, right: 0, gap: spacing.lg },
  strip: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.xl },
  stripThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.7)",
    backgroundColor: "#222",
  },
  stripMore: {
    borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.45)",
    backgroundColor: CHROME_FILL,
    alignItems: "center",
    justifyContent: "center",
  },
  stripMoreText: { color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: "700" },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
  },
  lastShot: { width: 56, height: 56 },
  lastShotImage: {
    width: "100%",
    height: "100%",
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.85)",
    backgroundColor: "#222",
  },
  libraryButton: {
    borderRadius: radius.md,
    backgroundColor: CHROME_FILL,
    alignItems: "center",
    justifyContent: "center",
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
  countText: { fontSize: 12, fontWeight: "800" },
  flipButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: CHROME_FILL,
    alignItems: "center",
    justifyContent: "center",
  },
  shutter: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: "#fff" },
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
