import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { annotationCanvasSize } from "@/api/annotation";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";

/** Normalised 0..1 crop box, so it survives any display size. */
type Box = { x: number; y: number; w: number; h: number };

const START: Box = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
/** Smallest box, so a slip of the thumb cannot crop the page to a sliver. */
const MIN = 0.08;
/** How close to a corner (in points) a touch has to land to grab it. */
const GRAB = 36;
/** Matches the rest of the capture pipeline. */
const JPEG_QUALITY = 0.9;

type Drag = { kind: "corner"; corner: 0 | 1 | 2 | 3; start: Box } | { kind: "move"; start: Box };

function clamp(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Crop one shot: drag the corners of a box over the photo, or drag inside it
 * to move it, then Apply. Web's Scan mode has the same step (ScanCrop).
 *
 * Web warps a four-corner quad through a homography. `expo-image-manipulator`
 * only crops rectangles and nothing else installed can warp, so this is the
 * axis-aligned version: square the phone up to the page with the level and
 * the frame guide, then trim.
 *
 * The crop is computed against the size the manipulator actually loads, not
 * the size the camera reported, so an EXIF-rotated file is cut where the
 * person drew rather than across the wrong axis.
 */
export function ShotCropper({
  visible,
  uri,
  width,
  height,
  onCancel,
  onApply,
}: {
  visible: boolean;
  uri: string;
  width?: number | null;
  height?: number | null;
  onCancel: () => void;
  onApply: (result: { uri: string; width: number; height: number }) => void;
}) {
  const theme = useTheme();
  const window = useWindowDimensions();
  const [box, setBox] = useState<Box>(START);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setBox(START);
      setError(null);
    }
  }, [visible, uri]);

  const aspect = width && height ? width / height : 3 / 4;
  const surface = annotationCanvasSize(window, aspect, 0.7);

  const boxRef = useRef(box);
  boxRef.current = box;
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const drag = useRef<Drag | null>(null);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          const { width: sw, height: sh } = surfaceRef.current;
          const b = boxRef.current;
          const corners = [
            [b.x, b.y],
            [b.x + b.w, b.y],
            [b.x + b.w, b.y + b.h],
            [b.x, b.y + b.h],
          ];
          let best = -1;
          let bestDist = GRAB;
          corners.forEach(([cx, cy], i) => {
            const d = Math.hypot(cx * sw - locationX, cy * sh - locationY);
            if (d < bestDist) {
              best = i;
              bestDist = d;
            }
          });
          if (best >= 0) {
            drag.current = { kind: "corner", corner: best as 0 | 1 | 2 | 3, start: b };
            return;
          }
          const nx = locationX / sw;
          const ny = locationY / sh;
          drag.current =
            nx >= b.x && nx <= b.x + b.w && ny >= b.y && ny <= b.y + b.h
              ? { kind: "move", start: b }
              : null;
        },
        onPanResponderMove: (_event, gesture) => {
          const d = drag.current;
          if (!d) return;
          const { width: sw, height: sh } = surfaceRef.current;
          const dx = gesture.dx / sw;
          const dy = gesture.dy / sh;
          const s = d.start;
          if (d.kind === "move") {
            setBox({
              ...s,
              x: clamp(s.x + dx, 0, 1 - s.w),
              y: clamp(s.y + dy, 0, 1 - s.h),
            });
            return;
          }
          let left = s.x;
          let top = s.y;
          let right = s.x + s.w;
          let bottom = s.y + s.h;
          if (d.corner === 0 || d.corner === 3) left = clamp(s.x + dx, 0, right - MIN);
          if (d.corner === 1 || d.corner === 2) right = clamp(s.x + s.w + dx, left + MIN, 1);
          if (d.corner === 0 || d.corner === 1) top = clamp(s.y + dy, 0, bottom - MIN);
          if (d.corner === 2 || d.corner === 3) bottom = clamp(s.y + s.h + dy, top + MIN, 1);
          setBox({ x: left, y: top, w: right - left, h: bottom - top });
        },
        onPanResponderRelease: () => {
          drag.current = null;
        },
        onPanResponderTerminate: () => {
          drag.current = null;
        },
      }),
    [],
  );

  async function apply() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const loaded = await ImageManipulator.manipulate(uri).renderAsync();
      const iw = loaded.width;
      const ih = loaded.height;
      const originX = Math.round(box.x * iw);
      const originY = Math.round(box.y * ih);
      const rect = {
        originX,
        originY,
        width: Math.max(1, Math.min(iw - originX, Math.round(box.w * iw))),
        height: Math.max(1, Math.min(ih - originY, Math.round(box.h * ih))),
      };
      const cropped = await ImageManipulator.manipulate(uri).crop(rect).renderAsync();
      const saved = await cropped.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
      onApply({ uri: saved.uri, width: saved.width, height: saved.height });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not crop this photo");
    } finally {
      setBusy(false);
    }
  }

  const px = {
    left: box.x * surface.width,
    top: box.y * surface.height,
    width: box.w * surface.width,
    height: box.h * surface.height,
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.root, { backgroundColor: theme.colors.chrome }]}>
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onCancel} disabled={busy}>
            <Text style={styles.chromeText}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Crop</Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setBox({ x: 0, y: 0, w: 1, h: 1 })}
            disabled={busy}
          >
            <Text style={styles.chromeText}>Reset</Text>
          </Pressable>
        </View>

        <View
          style={{ width: surface.width, height: surface.height, alignSelf: "center" }}
          {...responder.panHandlers}
        >
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
          {/* Shade outside the box, as four bands so the box itself stays clear. */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={[styles.shade, { left: 0, right: 0, top: 0, height: px.top }]} />
            <View
              style={[styles.shade, { left: 0, right: 0, top: px.top + px.height, bottom: 0 }]}
            />
            <View
              style={[styles.shade, { left: 0, width: px.left, top: px.top, height: px.height }]}
            />
            <View
              style={[
                styles.shade,
                { left: px.left + px.width, right: 0, top: px.top, height: px.height },
              ]}
            />
            <View style={[styles.frame, { borderColor: theme.colors.primary }, px]} />
            {[
              [px.left, px.top],
              [px.left + px.width, px.top],
              [px.left + px.width, px.top + px.height],
              [px.left, px.top + px.height],
            ].map(([x, y], i) => (
              <View
                key={i}
                style={[
                  styles.handle,
                  { left: x - 11, top: y - 11, backgroundColor: theme.colors.primary },
                ]}
              />
            ))}
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.bottom}>
          <Text style={styles.hint}>Drag the corners to the edges of the page.</Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void apply()}
            style={[styles.apply, { backgroundColor: theme.colors.primary }]}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.primaryForeground} />
            ) : (
              <Text style={[styles.applyText, { color: theme.colors.primaryForeground }]}>
                Apply crop
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "space-between" },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: 52,
    paddingBottom: spacing.md,
  },
  title: { color: "#fff", fontSize: 17, fontWeight: "700" },
  chromeText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  shade: { position: "absolute", backgroundColor: "rgba(0,0,0,0.55)" },
  frame: { position: "absolute", borderWidth: 2 },
  handle: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#fff",
  },
  bottom: { padding: spacing.lg, paddingBottom: spacing.xl + spacing.lg, gap: spacing.md },
  hint: { color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center" },
  apply: {
    borderRadius: radius.md,
    minHeight: HIT_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  applyText: { fontSize: 16, fontWeight: "700" },
  error: {
    color: "#fff",
    backgroundColor: "rgba(180,35,24,0.9)",
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
  },
});
