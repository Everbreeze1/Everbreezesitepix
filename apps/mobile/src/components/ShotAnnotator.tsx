import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import type Svg from "react-native-svg";
import {
  ANNOTATION_COLORS,
  annotationCanvasSize,
  beginShape,
  extendShape,
  isMeaningful,
  normalise,
  timestampText,
  withText,
  type AnnotationTool,
  type Point,
  type Shape,
} from "@/api/annotation";
import { renderWatermarked } from "@/api/watermark-render";
import { AnnotationCanvas, type MeasureLine } from "@/components/AnnotationCanvas";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";

export type ShotAnnotatorTool = AnnotationTool | "measure";

const BASE_TOOLS: { id: ShotAnnotatorTool; label: string }[] = [
  { id: "pen", label: "Draw" },
  { id: "arrow", label: "Arrow" },
  { id: "rect", label: "Box" },
  { id: "ellipse", label: "Circle" },
  { id: "text", label: "Text" },
];

/** A measurement shorter than this (normalised) is a tap, not a line. */
const MIN_MEASURE = 0.02;

/**
 * Mark up a shot before it is saved, the camera's version of web's Annotate
 * step, with the Measure tool for Pro and Team.
 *
 * Same drawing rules as the lightbox annotator (`annotation.ts`, points kept
 * normalised), but the result replaces the shot in the batch instead of filing
 * a copy: on web the camera's annotator edits the preview in place, and the
 * shot has not been saved yet, so there is no original to protect.
 *
 * The flattened file is rendered at the photo's own pixel size off screen, not
 * from the on-screen canvas, so markup does not cost the photo its resolution.
 */
export function ShotAnnotator({
  visible,
  uri,
  width,
  height,
  canMeasure,
  initialTool = "pen",
  onCancel,
  onDone,
}: {
  visible: boolean;
  uri: string;
  width?: number | null;
  height?: number | null;
  canMeasure: boolean;
  initialTool?: ShotAnnotatorTool;
  onCancel: () => void;
  onDone: (result: { uri: string }) => void;
}) {
  const theme = useTheme();
  const window = useWindowDimensions();

  const [tool, setTool] = useState<ShotAnnotatorTool>(initialTool);
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [measures, setMeasures] = useState<MeasureLine[]>([]);
  /** Ids in the order they were added, so Undo takes back the newest of either kind. */
  const [order, setOrder] = useState<string[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [draftMeasure, setDraftMeasure] = useState<MeasureLine | null>(null);
  /** A text stamp or measurement waiting for its words. */
  const [pending, setPending] = useState<
    { kind: "text"; shape: Shape } | { kind: "measure"; line: MeasureLine } | null
  >(null);
  const [pendingText, setPendingText] = useState("");
  const [flattening, setFlattening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTool(initialTool === "measure" && !canMeasure ? "pen" : initialTool);
    setShapes([]);
    setMeasures([]);
    setOrder([]);
    setDraft(null);
    setDraftMeasure(null);
    setPending(null);
    setFlattening(false);
    setError(null);
  }, [visible, uri, initialTool, canMeasure]);

  const tools = canMeasure
    ? [...BASE_TOOLS, { id: "measure" as const, label: "Measure" }]
    : BASE_TOOLS;

  const aspect = width && height ? width / height : 4 / 3;
  const surface = annotationCanvasSize(window, aspect);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const boxRef = useRef({ width: 0, height: 0 });
  const draftRef = useRef<Shape | null>(null);
  const measureRef = useRef<MeasureLine | null>(null);

  /** Keep a shape only if it is visible, as the lightbox annotator does. */
  const addShape = useCallback((shape: Shape) => {
    if (!isMeaningful(shape)) return;
    setShapes((current) => [...current, shape]);
    setOrder((current) => [...current, shape.id]);
  }, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          const at = normalise(locationX, locationY, boxRef.current.width, boxRef.current.height);
          const id = `${Date.now()}-${Math.round(locationX)}`;
          if (toolRef.current === "measure") {
            const line = { id, color: colorRef.current, from: at, to: at, label: "" };
            measureRef.current = line;
            setDraftMeasure(line);
            return;
          }
          const shape = beginShape(toolRef.current, colorRef.current, at, id);
          draftRef.current = shape;
          setDraft(shape);
        },
        onPanResponderMove: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          const at = normalise(locationX, locationY, boxRef.current.width, boxRef.current.height);
          if (measureRef.current) {
            const line = { ...measureRef.current, to: at };
            measureRef.current = line;
            setDraftMeasure(line);
            return;
          }
          if (!draftRef.current) return;
          const next = extendShape(draftRef.current, at);
          draftRef.current = next;
          setDraft(next);
        },
        onPanResponderRelease: () => {
          const line = measureRef.current;
          measureRef.current = null;
          setDraftMeasure(null);
          if (line) {
            if (distance(line.from, line.to) < MIN_MEASURE) return;
            // Drawn first, then labelled, as on web: the prompt opens at once.
            setPending({ kind: "measure", line });
            setPendingText("");
            return;
          }
          const shape = draftRef.current;
          draftRef.current = null;
          setDraft(null);
          if (!shape) return;
          if (shape.tool === "text") {
            // Words come after placement. A Time tap has already filled them in.
            setPending({ kind: "text", shape });
            return;
          }
          addShape(shape);
        },
        onPanResponderTerminate: () => {
          draftRef.current = null;
          measureRef.current = null;
          setDraft(null);
          setDraftMeasure(null);
        },
      }),
    [addShape],
  );

  function commitPending() {
    const job = pending;
    setPending(null);
    if (!job) return;
    if (job.kind === "text") {
      addShape(withText(job.shape, pendingText));
    } else {
      setMeasures((current) => [...current, { ...job.line, label: pendingText.trim() }]);
      setOrder((o) => [...o, job.line.id]);
    }
    setPendingText("");
  }

  function undoLast() {
    const last = order[order.length - 1];
    if (!last) return;
    setOrder((o) => o.slice(0, -1));
    setShapes((current) => current.filter((s) => s.id !== last));
    setMeasures((current) => current.filter((m) => m.id !== last));
  }

  function clearAll() {
    setShapes([]);
    setMeasures([]);
    setOrder([]);
  }

  /*
   * Flatten at full size. The off-screen canvas mounts when `flattening` is
   * set, and this effect waits a beat for it to lay out before rasterising,
   * the same way the capture screen burns in the watermark.
   */
  const fullRef = useRef<Svg>(null);
  useEffect(() => {
    if (!flattening) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const out = await renderWatermarked(fullRef.current);
          if (!cancelled) onDone({ uri: out });
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : "Could not save the markup");
            setFlattening(false);
          }
        }
      })();
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flattening]);

  function done() {
    if (order.length === 0) {
      onCancel();
      return;
    }
    setError(null);
    setFlattening(true);
  }

  const fullWidth = width || Math.round(surface.width * 3);
  const fullHeight = height || Math.round(surface.height * 3);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.root, { backgroundColor: theme.colors.chrome }]}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={onCancel}
            disabled={flattening}
          >
            <Text style={styles.chromeText}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>{tool === "measure" ? "Measure" : "Annotate"}</Text>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={done} disabled={flattening}>
            {flattening ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[styles.chromeText, { color: theme.colors.primaryGlow }]}>Done</Text>
            )}
          </Pressable>
        </View>

        <View
          style={{ width: surface.width, height: surface.height, alignSelf: "center" }}
          onLayout={(event) => {
            boxRef.current = {
              width: event.nativeEvent.layout.width,
              height: event.nativeEvent.layout.height,
            };
          }}
          {...responder.panHandlers}
        >
          <AnnotationCanvas
            uri={uri}
            width={surface.width}
            height={surface.height}
            shapes={shapes}
            draft={draft}
            measures={measures}
            draftMeasure={draftMeasure}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.tools}>
          {tool === "measure" ? (
            <Text style={styles.hint}>
              Drag along the edge you are measuring, then type its length. Stand 3 to 6 feet away
              and keep the phone parallel to the surface.
            </Text>
          ) : null}
          <View style={styles.row}>
            {tools.map((option) => {
              const active = tool === option.id;
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setTool(option.id)}
                  style={[styles.tool, active && { backgroundColor: theme.colors.primary }]}
                >
                  <Text style={styles.chromeText}>{option.label}</Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stamp the current time"
              onPress={() => {
                setTool("text");
                setPendingText(timestampText());
              }}
              style={styles.tool}
            >
              <Text style={styles.chromeText}>Time</Text>
            </Pressable>
          </View>
          <View style={styles.row}>
            {ANNOTATION_COLORS.map((swatch) => (
              <Pressable
                key={swatch}
                accessibilityRole="button"
                accessibilityLabel={`Colour ${swatch}`}
                accessibilityState={{ selected: color === swatch }}
                onPress={() => setColor(swatch)}
                style={[
                  styles.swatch,
                  { backgroundColor: swatch },
                  color === swatch && styles.swatchActive,
                ]}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              disabled={order.length === 0}
              onPress={undoLast}
              style={[styles.tool, order.length === 0 && styles.disabled]}
            >
              <Text style={styles.chromeText}>Undo</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={order.length === 0}
              onPress={clearAll}
              style={[styles.tool, order.length === 0 && styles.disabled]}
            >
              <Text style={styles.chromeText}>Clear</Text>
            </Pressable>
          </View>
        </View>

        {/*
          The words for a stamp or a measurement, as an overlay inside this
          modal rather than a second Modal: iOS will not present a modal over
          a modal that is already presenting.
        */}
        {pending ? (
          <View style={styles.promptBackdrop}>
            <View style={[styles.promptCard, { backgroundColor: theme.colors.chrome }]}>
              <Text style={styles.title}>{pending.kind === "measure" ? "Length" : "Label"}</Text>
              <TextInput
                value={pendingText}
                onChangeText={setPendingText}
                autoFocus
                placeholder={
                  pending.kind === "measure" ? "For example 36 in or 1.2 m" : "What is this?"
                }
                placeholderTextColor="rgba(255,255,255,0.45)"
                style={styles.promptInput}
                onSubmitEditing={commitPending}
                returnKeyType="done"
              />
              <View style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setPending(null);
                    setPendingText("");
                  }}
                  style={styles.tool}
                >
                  <Text style={styles.chromeText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={commitPending}
                  style={[styles.tool, { backgroundColor: theme.colors.primary }]}
                >
                  <Text style={styles.chromeText}>Add</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        {flattening ? (
          <View style={styles.offscreen} pointerEvents="none" accessibilityElementsHidden>
            <AnnotationCanvas
              ref={fullRef}
              uri={uri}
              width={fullWidth}
              height={fullHeight}
              shapes={shapes}
              measures={measures}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
  tools: { padding: spacing.lg, paddingBottom: spacing.xl + spacing.lg, gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  tool: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: "rgba(255,255,255,0.12)",
    minHeight: HIT_TARGET,
    justifyContent: "center",
  },
  disabled: { opacity: 0.35 },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: "#fff" },
  hint: { color: "rgba(255,255,255,0.75)", fontSize: 13 },
  error: {
    color: "#fff",
    backgroundColor: "rgba(180,35,24,0.9)",
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  promptBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  promptCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  promptInput: {
    color: "#fff",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: HIT_TARGET,
  },
  offscreen: { position: "absolute", left: -10000, top: 0 },
});
