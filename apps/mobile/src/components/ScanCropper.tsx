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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polygon } from "react-native-svg";
import { Image } from "expo-image";
import { annotationCanvasSize } from "@/api/annotation";
import { prepareScanSource, useScanSurface, type ScanImage } from "@/components/ScanSurface";
import { DEFAULT_QUAD, isConvexQuad, type Quad } from "@/components/scan-warp";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { Icon } from "@/ui";
import { RotateCcw, X } from "@/ui/icons";

/** How close to a corner (in points) a touch has to land to grab it. */
const GRAB = 48;
const HANDLE = 28;

function clamp(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Scan mode's corner step, web's `ScanCrop`: four handles, one per corner of
 * the page, dragged independently onto the paper's edges. Apply straightens
 * the page from those four corners (a true perspective correction, see
 * `scan-warp.ts`) and gives it the document look.
 *
 * Opened straight after a Scan mode shot, with the corners starting on the
 * viewfinder's paper guide, which is where the page was framed. Also reachable
 * from a scan's preview as Crop, on a page that already has its look.
 *
 * Primary action at the lower right, where the thumb is.
 */
export function ScanCropper({
  visible,
  uri,
  initialQuad,
  enhance,
  cancelLabel = "Cancel",
  onCancel,
  onApply,
}: {
  visible: boolean;
  uri: string;
  /** Normalised 0..1 corners to start from; web's 8% inset otherwise. */
  initialQuad?: Quad | null;
  /** Apply the document look after straightening. False for a page that has it already. */
  enhance: boolean;
  cancelLabel?: string;
  onCancel: () => void;
  onApply: (result: ScanImage & { note: string | null }) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { surface: offscreen, process } = useScanSurface();
  const [src, setSrc] = useState<ScanImage | null>(null);
  const [quad, setQuad] = useState<Quad>(initialQuad ?? DEFAULT_QUAD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setSrc(null);
    setError(null);
    setQuad(initialQuad ?? DEFAULT_QUAD);
    prepareScanSource(uri)
      .then((prepared) => {
        if (!cancelled) setSrc(prepared);
      })
      .catch(() => {
        if (!cancelled) setError("Could not open this page");
      });
    return () => {
      cancelled = true;
    };
    // `initialQuad` is read once per opening, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, uri]);

  const aspect = src ? src.width / src.height : 3 / 4;
  const box = annotationCanvasSize(
    { width: window.width - spacing.lg * 2, height: window.height },
    aspect,
    0.66,
  );

  const quadRef = useRef(quad);
  quadRef.current = quad;
  const boxRef = useRef(box);
  boxRef.current = box;
  const drag = useRef<{ corner: number; start: Quad } | null>(null);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          const { width: w, height: h } = boxRef.current;
          let best = -1;
          let bestDist = GRAB;
          quadRef.current.forEach((p, i) => {
            const d = Math.hypot(p.x * w - locationX, p.y * h - locationY);
            if (d < bestDist) {
              best = i;
              bestDist = d;
            }
          });
          drag.current = best >= 0 ? { corner: best, start: quadRef.current } : null;
        },
        onPanResponderMove: (_event, gesture) => {
          const d = drag.current;
          if (!d) return;
          const { width: w, height: h } = boxRef.current;
          const start = d.start[d.corner];
          const moved = {
            x: clamp(start.x + gesture.dx / w, 0, 1),
            y: clamp(start.y + gesture.dy / h, 0, 1),
          };
          setQuad((prev) => prev.map((p, i) => (i === d.corner ? moved : p)) as Quad);
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

  const valid = isConvexQuad(quad);

  async function apply(useCorners: boolean) {
    if (!src || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await process(src, useCorners ? quad : null, enhance);
      onApply({
        uri: result.uri,
        width: result.width,
        height: result.height,
        note:
          useCorners && result.straightened === "box"
            ? "Cropped to the corners, but the page could not be straightened on this phone"
            : null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not process this page");
    } finally {
      setBusy(false);
    }
  }

  const points = quad.map((p) => ({ x: p.x * box.width, y: p.y * box.height }));

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.root, { backgroundColor: theme.colors.chrome }]}>
        {offscreen}
        <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
            hitSlop={8}
            onPress={onCancel}
            disabled={busy}
            style={styles.roundButton}
          >
            <Icon icon={X} size="md" color="#fff" />
          </Pressable>
          <Text style={styles.title}>Adjust document corners</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset corners"
            hitSlop={8}
            onPress={() => setQuad(initialQuad ?? DEFAULT_QUAD)}
            disabled={busy}
            style={styles.roundButton}
          >
            <Icon icon={RotateCcw} size="md" color="#fff" />
          </Pressable>
        </View>

        <View style={styles.middle}>
          {src ? (
            <View
              style={{ width: box.width, height: box.height }}
              {...responder.panHandlers}
              accessibilityLabel="Page corners. Drag each corner onto the edge of the page"
            >
              <Image source={{ uri: src.uri }} style={StyleSheet.absoluteFill} contentFit="fill" />
              <Svg
                width={box.width}
                height={box.height}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              >
                <Polygon
                  points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="rgba(255,255,255,0.12)"
                  stroke={valid ? theme.colors.primary : "#e5484d"}
                  strokeWidth={2.5}
                />
              </Svg>
              {points.map((p, i) => (
                <View
                  key={i}
                  pointerEvents="none"
                  style={[
                    styles.handle,
                    {
                      left: p.x - HANDLE / 2,
                      top: p.y - HANDLE / 2,
                      backgroundColor: theme.colors.primary,
                    },
                  ]}
                />
              ))}
            </View>
          ) : error ? null : (
            <ActivityIndicator color="#fff" />
          )}
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.hint}>
            {valid
              ? "Drag the corners onto the edges of the page."
              : "The corners cross over. Move them back to the page's corners."}
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy || !src}
              onPress={() => void apply(false)}
              style={[styles.secondary, (busy || !src) && styles.dim]}
            >
              <Text style={styles.secondaryText}>Whole photo</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Straightens the page from its corners and makes it readable"
              disabled={busy || !src || !valid}
              onPress={() => void apply(true)}
              style={[
                styles.primary,
                { backgroundColor: theme.colors.primary },
                (busy || !src || !valid) && styles.dim,
              ]}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.primaryForeground} />
              ) : (
                <Text style={[styles.primaryText, { color: theme.colors.primaryForeground }]}>
                  Apply crop
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  roundButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: "#fff", fontSize: 16, fontWeight: "700" },
  middle: { flex: 1, alignItems: "center", justifyContent: "center" },
  handle: {
    position: "absolute",
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    borderWidth: 3,
    borderColor: "#fff",
  },
  bottom: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  hint: { color: "rgba(255,255,255,0.72)", fontSize: 13, textAlign: "center" },
  actions: { flexDirection: "row", gap: spacing.md, justifyContent: "flex-end" },
  secondary: {
    flex: 1,
    minHeight: HIT_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  primary: {
    flex: 1.4,
    minHeight: HIT_TARGET,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontSize: 16, fontWeight: "700" },
  dim: { opacity: 0.5 },
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
