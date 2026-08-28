import { useCallback, useMemo, useRef, useState } from "react";
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
import { router, Stack, useLocalSearchParams } from "expo-router";
import type Svg from "react-native-svg";
import { useQueryClient } from "@tanstack/react-query";
import {
  ANNOTATION_COLORS,
  annotatedCaption,
  beginShape,
  clear,
  commitShape,
  EMPTY_ANNOTATION,
  extendShape,
  normalise,
  redoLast,
  timestampText,
  undo,
  withText,
  type AnnotationState,
  type AnnotationTool,
  type Shape,
} from "@/api/annotation";
import { saveAnnotatedPhoto } from "@/api/photo-annotations";
import { AnnotationCanvas } from "@/components/AnnotationCanvas";
import { useAuth } from "@/lib/auth";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

const TOOLS: { id: AnnotationTool; label: string }[] = [
  { id: "pen", label: "Draw" },
  { id: "arrow", label: "Arrow" },
  { id: "rect", label: "Box" },
  { id: "ellipse", label: "Circle" },
  { id: "text", label: "Text" },
];

export default function AnnotateScreen() {
  const { uri, projectId, caption, phase, width, height } = useLocalSearchParams<{
    /** In the path so the route reads sensibly; the save writes a new row. */
    id: string;
    uri: string;
    projectId: string;
    caption?: string;
    phase?: string;
    width?: string;
    height?: string;
  }>();

  const theme = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const window = useWindowDimensions();

  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [state, setState] = useState<AnnotationState>(EMPTY_ANNOTATION);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * A stamp waiting for its words.
   *
   * Placed on the photo already, but held out of `state` until it has text: an
   * empty stamp is dropped on commit, so putting it in the document first
   * would draw a caret that vanishes the moment the person cancels.
   */
  const [pendingStamp, setPendingStamp] = useState<Shape | null>(null);
  const [stampText, setStampText] = useState("");

  /**
   * Put the pending stamp into the document with its words.
   *
   * `commitShape` drops an empty one, so cancelling and confirming with a blank
   * field land in the same place, which is what someone who changed their mind
   * expects either way.
   */
  const commitStamp = useCallback(() => {
    const shape = pendingStamp;
    setPendingStamp(null);
    if (!shape) return;
    setState((current) => commitShape(current, withText(shape, stampText)));
    setStampText("");
  }, [pendingStamp, stampText]);

  const canvasRef = useRef<Svg>(null);
  const box = useRef({ width: 0, height: 0 });

  /*
   * The drawing surface, sized to the photo's aspect so the markup sits on the
   * picture rather than on letterboxing beside it.
   */
  const aspect = useMemo(() => {
    const w = Number(width) || 4;
    const h = Number(height) || 3;
    return w / h;
  }, [width, height]);

  const canvasWidth = window.width;
  const canvasHeight = Math.min(window.height * 0.62, canvasWidth / aspect);

  /*
   * Held in refs as well as state. PanResponder captures its handlers once, so
   * a handler reading `tool` or `draft` from state would keep seeing whatever
   * they were on the render that created it.
   */
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const draftRef = useRef<Shape | null>(null);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          const point = normalise(locationX, locationY, box.current.width, box.current.height);
          const shape = beginShape(
            toolRef.current,
            colorRef.current,
            point,
            `${Date.now()}-${Math.round(locationX)}`,
          );
          draftRef.current = shape;
          setDraft(shape);
        },
        onPanResponderMove: (event) => {
          if (!draftRef.current) return;
          const { locationX, locationY } = event.nativeEvent;
          const point = normalise(locationX, locationY, box.current.width, box.current.height);
          const next = extendShape(draftRef.current, point);
          draftRef.current = next;
          setDraft(next);
        },
        onPanResponderRelease: () => {
          const shape = draftRef.current;
          draftRef.current = null;
          setDraft(null);
          if (!shape) return;
          if (shape.tool === "text") {
            /*
             * Held rather than committed. An empty stamp is dropped by
             * `isMeaningful`, so it has to collect its words first, and asking
             * after the placement means the caret is already where the person
             * pointed.
             */
            setPendingStamp(shape);
            setStampText("");
            return;
          }
          setState((current) => commitShape(current, shape));
        },
        onPanResponderTerminate: () => {
          draftRef.current = null;
          setDraft(null);
        },
      }),
    [],
  );

  const save = useCallback(async () => {
    if (!user || !projectId || !uri || busy) return;
    if (state.shapes.length === 0) {
      setError("Draw something first, or close without saving.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveAnnotatedPhoto({
        canvas: canvasRef.current,
        userId: user.id,
        projectId,
        caption: annotatedCaption(caption),
        phase: phase ?? "untagged",
      });
      await queryClient.invalidateQueries({ queryKey: ["project-photos", projectId] });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the annotated photo");
    } finally {
      setBusy(false);
    }
  }, [busy, caption, phase, projectId, queryClient, state.shapes.length, uri, user]);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.chrome }]}>
      <Stack.Screen options={{ title: "Annotate", headerShown: false }} />

      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close without saving"
          hitSlop={8}
          onPress={() => router.back()}
        >
          <Text style={styles.chromeText}>Close</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save annotated copy"
          hitSlop={8}
          disabled={busy}
          onPress={() => void save()}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.chromeText, { color: theme.colors.primaryGlow }]}>Save copy</Text>
          )}
        </Pressable>
      </View>

      <View
        style={{ width: canvasWidth, height: canvasHeight }}
        onLayout={(event) => {
          box.current = {
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height,
          };
        }}
        {...responder.panHandlers}
      >
        {uri ? (
          <AnnotationCanvas
            ref={canvasRef}
            uri={uri}
            width={canvasWidth}
            height={canvasHeight}
            shapes={state.shapes}
            draft={draft}
          />
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.tools}>
        <View style={styles.row}>
          {TOOLS.map((option) => {
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

          {/*
            One tap, no typing. The time is the single most common thing anyone
            writes on a site photo, and making them type it while wearing gloves
            is the reason nobody would.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stamp the current time"
            onPress={() => {
              setTool("text");
              setStampText(timestampText());
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
            accessibilityLabel="Undo"
            disabled={state.shapes.length === 0}
            onPress={() => setState(undo)}
            style={[styles.tool, state.shapes.length === 0 && styles.disabled]}
          >
            <Text style={styles.chromeText}>Undo</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Redo"
            disabled={state.redo.length === 0}
            onPress={() => setState(redoLast)}
            style={[styles.tool, state.redo.length === 0 && styles.disabled]}
          >
            <Text style={styles.chromeText}>Redo</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear all markup"
            disabled={state.shapes.length === 0}
            onPress={() => setState(clear)}
            style={[styles.tool, state.shapes.length === 0 && styles.disabled]}
          >
            <Text style={styles.chromeText}>Clear</Text>
          </Pressable>
        </View>

        <Text style={styles.hint}>Saved as a new photo. The original is left as it was.</Text>
      </View>

      {/*
        Collects the words for a stamp that has already been placed.

        Deliberately not the kit's Sheet: this screen is a full-bleed dark
        surface with its own chrome, and dropping a light card onto it would
        read as a different app. It is also the one screen the design system
        does not govern, for the same reason the camera is not governed.
      */}
      <Modal
        visible={pendingStamp !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingStamp(null)}
      >
        <View style={styles.stampBackdrop}>
          <View style={[styles.stampCard, { backgroundColor: theme.colors.chrome }]}>
            <Text style={[typography.heading, { color: "#fff" }]}>Label</Text>
            <TextInput
              value={stampText}
              onChangeText={setStampText}
              autoFocus
              placeholder="What is this?"
              placeholderTextColor="rgba(255,255,255,0.45)"
              accessibilityLabel="Stamp text"
              style={[styles.stampInput, typography.body]}
              onSubmitEditing={() => commitStamp()}
              returnKeyType="done"
            />
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPendingStamp(null)}
                style={styles.tool}
              >
                <Text style={styles.chromeText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => commitStamp()}
                style={[styles.tool, { backgroundColor: theme.colors.primary }]}
              >
                <Text style={styles.chromeText}>Add</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  stampBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  stampCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  stampInput: {
    color: "#fff",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: HIT_TARGET,
  },
  root: { flex: 1, justifyContent: "space-between" },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingTop: 52,
    paddingBottom: spacing.md,
  },
  chromeText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  tools: { padding: spacing.lg, gap: spacing.md },
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
  hint: { ...typography.caption, color: "rgba(255,255,255,0.7)" },
  error: {
    ...typography.caption,
    color: "#fff",
    backgroundColor: "rgba(223,34,37,0.9)",
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
  },
});
