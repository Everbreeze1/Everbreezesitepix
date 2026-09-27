import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image as RNImage,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { G, Circle as SvgCircle, Line, Path, Rect as SvgRect } from "react-native-svg";
import type Svg from "react-native-svg";
import { randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { AnnotationCanvas } from "@/components/AnnotationCanvas";
import { ToolIcon, type IconName } from "./icons";
import {
  cropCornerAt,
  cropShapes,
  DEFAULT_COLOR,
  DEFAULT_STICKER,
  DEFAULT_WIDTH,
  defaultPxPerInch,
  dist,
  dragCrop,
  EMPTY_HISTORY,
  fitSize,
  formatStamp,
  getBoundingBox,
  getHandles,
  hitTest,
  isAdjusted,
  isMeaningful,
  MAX_ZOOM,
  measureWidth,
  MIN_CROP,
  NO_ADJUST,
  NO_ZOOM,
  nextId,
  normaliseCrop,
  pushHistory,
  pxPerInchFromCalibration,
  redoHistory,
  rotatedSize,
  rotateShapesCW,
  shapeContains,
  stageToImage,
  stampDate,
  stickerSizeFor,
  textSizeFor,
  timestampSizeFor,
  transformShape,
  translateShape,
  undoHistory,
  type Adjust,
  type CalibrationUnit,
  type HandleHit,
  type History,
  type Point,
  type Rect,
  type Shape,
  type Size,
  type Snapshot,
  type Tool,
  type WorkingImage,
} from "./model";
import {
  ACCENT,
  AdjustPanel,
  CalibrateCard,
  Panel,
  StickerPanel,
  StylePanel,
  TextPromptCard,
} from "./panels";

/**
 * The mobile photo annotator: web's `PhotoAnnotator`, touch-first.
 *
 * Same tools, same defaults, same drawing (see `model.ts` and
 * `AnnotationCanvas`), same result: the photo flattened with its markup into
 * one JPEG at the photo's own pixel size. What changes is the input:
 *
 * - One finger draws, places or drags; two fingers pinch and pan the photo.
 *   Handled as raw touches on one Manual gesture so the switch from drawing to
 *   zooming is decided here, the moment a second finger lands, instead of by
 *   two recognisers racing each other.
 * - The tool rail sits on the right, as on web, whenever it fits (tablets,
 *   landscape). A portrait phone gets the same buttons as a bottom bar, where
 *   a thumb reaches them.
 * - Hover does not exist, so the precision loupe shows while a finger is down.
 */

export type AnnotatorSaveOutput = {
  /** The off-screen full-size surface to rasterise. */
  canvas: Svg | null;
  width: number;
  height: number;
  /** False when nothing was drawn, rotated, cropped or adjusted. */
  dirty: boolean;
};

export type PhotoAnnotatorHandle = {
  /** Android back / modal dismiss: backs out one level, then asks before discarding. */
  back: () => void;
};

type Props = {
  uri: string;
  /** Size hints; the real size is read from the file. */
  width?: number | null;
  height?: number | null;
  /** Pro/Team: shows the Measure tool. */
  canMeasure: boolean;
  initialTool?: Tool;
  /** The photo's capture time, stamped by the Timestamp tool. */
  capturedAt?: string | null;
  title?: string;
  onCancel: () => void;
  onSave: (out: AnnotatorSaveOutput) => Promise<void>;
};

type TextPrompt = { pos: Point; value: string; editingId?: string; isLabel?: boolean };
type CalibratePrompt = { shapeId: string; value: string; unit: CalibrationUnit };
type PanelKind = "style" | "sticker" | "adjust" | null;
type Drag = {
  shapeId: string;
  handle: HandleHit;
  start: Point;
  original: Shape;
  prev: Snapshot;
  moved: boolean;
};

const BG = "#0a0a0a";
const RAIL_WIDTH = 76;
const BUTTON = 48;

function isRemote(uri: string) {
  return /^https?:\/\//i.test(uri);
}

/** The photo as a local file: manipulator and rasteriser both want one. */
async function localCopy(uri: string): Promise<string> {
  if (!isRemote(uri)) return uri;
  const target = new File(Paths.cache, `annotate-src-${randomUUID()}.jpg`);
  const file = await File.downloadFileAsync(uri, target);
  return file.uri;
}

function imageSize(uri: string): Promise<Size> {
  return new Promise((resolve, reject) => {
    RNImage.getSize(
      uri,
      (w, h) => resolve({ w, h }),
      (e) => reject(e instanceof Error ? e : new Error("Could not read the photo")),
    );
  });
}

export const PhotoAnnotator = forwardRef<PhotoAnnotatorHandle, Props>(function PhotoAnnotator(
  {
    uri,
    width: hintW,
    height: hintH,
    canMeasure,
    initialTool,
    capturedAt,
    title = "Annotate",
    onCancel,
    onSave,
  },
  ref,
) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // ---- document ---------------------------------------------------------
  const [doc, setDocState] = useState<Snapshot | null>(null);
  const docRef = useRef<Snapshot | null>(null);
  docRef.current = doc;
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [originalImage, setOriginalImage] = useState<WorkingImage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const setDoc = (next: Snapshot) => {
    docRef.current = next;
    setDocState(next);
  };
  /** An undoable change. */
  const change = (fn: (d: Snapshot) => Snapshot) => {
    const cur = docRef.current;
    if (!cur) return;
    setHistory((h) => pushHistory(h, cur));
    setDoc(fn(cur));
  };
  const changeShapes = (fn: (s: Shape[]) => Shape[]) =>
    change((d) => ({ ...d, shapes: fn(d.shapes) }));

  // ---- tool state (web's defaults) --------------------------------------
  const startTool: Tool =
    initialTool && (initialTool !== "measure" || canMeasure) ? initialTool : "select";
  const [tool, setToolState] = useState<Tool>(startTool);
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_WIDTH);
  const [sticker, setSticker] = useState(DEFAULT_STICKER);
  const [adjust, setAdjust] = useState<Adjust>(NO_ADJUST);
  const [pxPerInch, setPxPerInch] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [polyDraft, setPolyDraft] = useState<{ id: string; points: Point[] } | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [textPrompt, setTextPrompt] = useState<TextPrompt | null>(null);
  const [calibrate, setCalibrate] = useState<CalibratePrompt | null>(null);
  const [panel, setPanel] = useState<PanelKind>(null);
  const [loupe, setLoupe] = useState<Point | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draftRef = useRef<Shape | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const cropRef = useRef<{ corner: "tl" | "tr" | "bl" | "br" | "new"; anchor: Point } | null>(null);
  const cropDraftRef = useRef<Rect | null>(null);
  cropDraftRef.current = cropDraft;
  const touchLive = useRef(false);
  const lastTapRef = useRef<{ at: number; p: Point } | null>(null);

  const image = doc?.image ?? null;
  const shapes = doc?.shapes ?? [];
  const selected = shapes.find((s) => s.id === selectedId) ?? null;
  const scale = image ? (pxPerInch ?? defaultPxPerInch(image)) : 1;

  const setTool = (t: Tool) => {
    setToolState(t);
    setSelectedId(null);
    setDraft(null);
    draftRef.current = null;
    setPolyDraft(null);
    if (t !== "crop") setCropDraft(null);
  };

  // ---- load --------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    void (async () => {
      let local = uri;
      try {
        local = await localCopy(uri);
      } catch {
        // Offline with only a cached signed URL: draw from it anyway. Rotate
        // and crop then fail with a message rather than the whole editor.
        local = uri;
      }
      let size: Size | null = null;
      try {
        size = await imageSize(local);
      } catch {
        size = hintW && hintH ? { w: hintW, h: hintH } : null;
      }
      if (cancelled) return;
      if (!size || !(size.w > 0) || !(size.h > 0)) {
        setLoadError("This photo could not be opened for markup.");
        return;
      }
      const img = { uri: local, w: size.w, h: size.h };
      setOriginalImage(img);
      setDoc({ shapes: [], image: img });
      setHistory(EMPTY_HISTORY);
    })();
    return () => {
      cancelled = true;
    };
    // Loaded once per photo. A refreshed signed URL for the same photo must
    // not wipe markup in progress, which is web's rule too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- layout ------------------------------------------------------------
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 });
  const landscape = window.width > window.height;
  const tablet = Math.min(window.width, window.height) >= 600;
  const useRail = landscape || tablet;
  const display: Size =
    image && stage.w > 0
      ? fitSize({ w: stage.w - 8, h: stage.h - 8 }, image.w / image.h)
      : { w: 1, h: 1 };

  // ---- zoom --------------------------------------------------------------
  const zs = useSharedValue(1);
  const ztx = useSharedValue(0);
  const zty = useSharedValue(0);
  const zoomRef = useRef(NO_ZOOM);
  const [zoomScale, setZoomScale] = useState(1);
  const applyZoom = (z: typeof NO_ZOOM) => {
    zoomRef.current = z;
    zs.value = z.scale;
    ztx.value = z.tx;
    zty.value = z.ty;
  };
  const resetZoom = () => {
    applyZoom(NO_ZOOM);
    setZoomScale(1);
  };
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: ztx.value }, { translateY: zty.value }, { scale: zs.value }],
  }));

  /** Image pixels per screen point at the current zoom. */
  const k = image ? image.w / (display.w * zoomScale) : 1;

  const toImage = (x: number, y: number): Point =>
    image ? stageToImage(x, y, stage, display, image, zoomRef.current) : { x: 0, y: 0 };

  // ---- pointer logic (web's, per tool) -----------------------------------
  const pushPrev = (prev: Snapshot) => setHistory((h) => pushHistory(h, prev));

  const onDown = (p: Point) => {
    const cur = docRef.current;
    // A touch that starts while a box is open, or while the photo is being
    // rotated or saved, does nothing at all: not on the way down, not on the
    // way up (a polyline point is placed on release).
    touchLive.current = false;
    if (!cur || textPrompt || calibrate || busy || exporting) return;
    touchLive.current = true;
    setPanel(null);
    const img = cur.image;
    const tapK = img.w / (display.w * zoomRef.current.scale);

    if (tool === "crop") {
      const tol = Math.max(14, img.w * 0.02, 26 * tapK);
      const corner = cropCornerAt(cropDraftRef.current, p, tol);
      if (corner) {
        cropRef.current = { corner, anchor: p };
      } else {
        cropRef.current = { corner: "new", anchor: p };
        setCropDraft({ x: p.x, y: p.y, w: 0, h: 0 });
      }
      setLoupe(p);
      return;
    }

    if (tool === "polyline") {
      setLoupe(p);
      return; // placed on release, so the loupe can aim it
    }

    if (tool === "select") {
      const tol = Math.max(12, img.w * 0.012, 22 * tapK);
      const hit = hitTest(cur.shapes, selected, p, tol);
      if (hit) {
        setSelectedId(hit.shape.id);
        dragRef.current = {
          shapeId: hit.shape.id,
          handle: hit.handle,
          start: p,
          original: hit.shape,
          prev: cur,
          moved: false,
        };
      } else {
        setSelectedId(null);
      }
      return;
    }

    if (tool === "text") {
      const tol = Math.max(12, 16 * tapK);
      for (let i = cur.shapes.length - 1; i >= 0; i--) {
        const s = cur.shapes[i];
        if (s.kind === "text" && shapeContains(s, p, tol)) {
          setSelectedId(s.id);
          setTextPrompt({ pos: s.pos, value: s.text, editingId: s.id });
          return;
        }
      }
      setSelectedId(null);
      setTextPrompt({ pos: p, value: "" });
      return;
    }

    if (tool === "timestamp") {
      const id = nextId();
      const text = formatStamp(stampDate(capturedAt));
      const size = timestampSizeFor(img);
      changeShapes((s) => [...s, { id, kind: "text", color, size, pos: p, text }]);
      setSelectedId(id);
      setToolState("select");
      return;
    }

    if (tool === "sticker") {
      const id = nextId();
      const size = stickerSizeFor(img);
      changeShapes((s) => [
        ...s,
        {
          id,
          kind: "sticker",
          glyph: sticker,
          size,
          pos: { x: p.x - size / 2, y: p.y - size / 2 },
        },
      ]);
      setSelectedId(id);
      setToolState("select");
      return;
    }

    setSelectedId(null);
    const id = nextId();
    let d: Shape | null = null;
    if (tool === "pen") d = { id, kind: "pen", color, width: strokeWidth, points: [p] };
    else if (tool === "arrow") d = { id, kind: "arrow", color, width: strokeWidth, from: p, to: p };
    else if (tool === "measure")
      d = { id, kind: "measure", color, width: measureWidth(strokeWidth), from: p, to: p };
    else if (tool === "rect") d = { id, kind: "rect", color, width: strokeWidth, from: p, to: p };
    else if (tool === "ellipse")
      d = { id, kind: "ellipse", color, width: strokeWidth, from: p, to: p };
    draftRef.current = d;
    setDraft(d);
    if (tool === "measure") setLoupe(p);
  };

  const onMove = (p: Point) => {
    if (!touchLive.current) return;
    if (tool === "polyline" || tool === "measure" || tool === "crop") setLoupe(p);

    if (tool === "crop" && cropRef.current) {
      const c = cropRef.current;
      const base = cropDraftRef.current ?? { x: p.x, y: p.y, w: 0, h: 0 };
      const next = dragCrop(base, c.corner, p, c.anchor);
      cropDraftRef.current = next;
      setCropDraft(next);
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;
      const cur = docRef.current;
      if (!cur) return;
      const next = transformShape(drag.original, drag.handle, dx, dy, p);
      setDoc({ ...cur, shapes: cur.shapes.map((s) => (s.id === drag.shapeId ? next : s)) });
      return;
    }

    const d = draftRef.current;
    if (!d) return;
    let next: Shape = d;
    if (d.kind === "pen") next = { ...d, points: [...d.points, p] };
    else if (
      d.kind === "arrow" ||
      d.kind === "rect" ||
      d.kind === "ellipse" ||
      d.kind === "measure"
    )
      next = { ...d, to: p };
    draftRef.current = next;
    setDraft(next);
  };

  const onUp = (p: Point | null) => {
    if (!touchLive.current) return;
    touchLive.current = false;
    setLoupe(null);

    if (tool === "crop" && cropRef.current) {
      cropRef.current = null;
      const c = cropDraftRef.current;
      if (c && (c.w < MIN_CROP || c.h < MIN_CROP)) setCropDraft(null);
      return;
    }

    if (tool === "polyline" && p) {
      const now = Date.now();
      const last = lastTapRef.current;
      const tapK = image ? image.w / (display.w * zoomRef.current.scale) : 1;
      if (polyDraft && last && now - last.at < 320 && dist(last.p, p) < 30 * tapK) {
        // Double tap: web's double-click to finish. The second tap is not a point.
        lastTapRef.current = null;
        finishPolyline();
        return;
      }
      lastTapRef.current = { at: now, p };
      if (!polyDraft) {
        setPolyDraft({ id: nextId(), points: [p] });
      } else {
        setPolyDraft({ ...polyDraft, points: [...polyDraft.points, p] });
        // Web prompts for a label for each new segment. Skip leaves it bare.
        setTextPrompt({ pos: { x: p.x, y: Math.max(0, p.y - 10) }, value: "", isLabel: true });
      }
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      dragRef.current = null;
      if (drag.moved) pushPrev(drag.prev);
      return;
    }

    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!d) return;
    if (!isMeaningful(d)) return;
    changeShapes((s) => [...s, d]);
    setSelectedId(d.id);
    setToolState("select");
    // First measurement: ask for its real length, so the numbers are real.
    if (d.kind === "measure" && pxPerInch === null) {
      setCalibrate({ shapeId: d.id, value: "", unit: "ft" });
    }
  };

  const cancelTouch = () => {
    touchLive.current = false;
    setLoupe(null);
    draftRef.current = null;
    setDraft(null);
    cropRef.current = null;
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) setDoc(drag.prev);
  };

  // ---- gestures ----------------------------------------------------------
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const mode = useRef<"none" | "draw" | "zoom">("none");
  const pinch = useRef<{ d0: number; q: Point; s0: number } | null>(null);
  const lastPoint = useRef<Point | null>(null);

  const beginPinch = () => {
    const pts = [...touches.current.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const z = zoomRef.current;
    const cx = stage.w / 2 + z.tx;
    const cy = stage.h / 2 + z.ty;
    pinch.current = {
      d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      q: { x: (mid.x - cx) / z.scale, y: (mid.y - cy) / z.scale },
      s0: z.scale,
    };
  };

  const gesture = Gesture.Manual()
    .runOnJS(true)
    .onTouchesDown((e, manager) => {
      manager.activate();
      for (const t of e.changedTouches) touches.current.set(t.id, { x: t.x, y: t.y });
      if (touches.current.size === 1 && mode.current === "none") {
        mode.current = "draw";
        const p = toImage(e.changedTouches[0].x, e.changedTouches[0].y);
        lastPoint.current = p;
        onDown(p);
      } else if (touches.current.size >= 2) {
        if (mode.current === "draw") cancelTouch();
        mode.current = "zoom";
        beginPinch();
      }
    })
    .onTouchesMove((e) => {
      for (const t of e.changedTouches) {
        if (touches.current.has(t.id)) touches.current.set(t.id, { x: t.x, y: t.y });
      }
      if (mode.current === "draw" && touches.current.size === 1) {
        const t = e.changedTouches[0];
        if (!t) return;
        const p = toImage(t.x, t.y);
        lastPoint.current = p;
        onMove(p);
        return;
      }
      if (mode.current === "zoom" && touches.current.size >= 2 && pinch.current) {
        const [a, b] = [...touches.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const s = Math.max(1, Math.min(MAX_ZOOM, pinch.current.s0 * (d / pinch.current.d0)));
        let tx = mid.x - stage.w / 2 - s * pinch.current.q.x;
        let ty = mid.y - stage.h / 2 - s * pinch.current.q.y;
        // Keep some of the photo on screen whatever the fingers do.
        const lx = (display.w * s) / 2;
        const ly = (display.h * s) / 2;
        tx = Math.max(-lx, Math.min(lx, tx));
        ty = Math.max(-ly, Math.min(ly, ty));
        applyZoom({ scale: s, tx, ty });
      }
    })
    .onTouchesUp((e, manager) => {
      for (const t of e.changedTouches) touches.current.delete(t.id);
      if (mode.current === "zoom") {
        if (touches.current.size >= 2) beginPinch();
        else pinch.current = null;
        setZoomScale(zoomRef.current.scale);
        if (zoomRef.current.scale <= 1.01) resetZoom();
      }
      if (touches.current.size === 0) {
        if (mode.current === "draw") {
          const t = e.changedTouches[0];
          onUp(t ? toImage(t.x, t.y) : lastPoint.current);
        }
        mode.current = "none";
        manager.end();
      }
    })
    .onTouchesCancelled((_e, manager) => {
      touches.current.clear();
      if (mode.current === "draw") cancelTouch();
      mode.current = "none";
      pinch.current = null;
      manager.end();
    });

  // ---- actions -----------------------------------------------------------
  const finishPolyline = () => {
    if (!polyDraft || polyDraft.points.length < 2) {
      setPolyDraft(null);
      return;
    }
    const shape: Shape = {
      id: polyDraft.id,
      kind: "polyline",
      color,
      width: strokeWidth,
      points: polyDraft.points,
    };
    changeShapes((s) => [...s, shape]);
    setSelectedId(shape.id);
    setPolyDraft(null);
    setToolState("select");
  };

  const commitText = () => {
    const prompt = textPrompt;
    if (!prompt) return;
    const value = prompt.value.trim();
    setTextPrompt(null);
    if (!value || !image) return;
    if (prompt.editingId) {
      const id = prompt.editingId;
      const target = shapes.find((s) => s.id === id);
      if (!(target && target.kind === "text" && target.text === value)) {
        changeShapes((s) =>
          s.map((sh) => (sh.id === id && sh.kind === "text" ? { ...sh, text: value } : sh)),
        );
      }
    } else {
      const id = nextId();
      const size = textSizeFor(image, strokeWidth);
      changeShapes((s) => [...s, { id, kind: "text", color, size, pos: prompt.pos, text: value }]);
      if (!prompt.isLabel) setSelectedId(id);
    }
    // A segment label keeps the line going; any other text returns to Select, as on web.
    if (!prompt.isLabel) setToolState("select");
  };

  const commitCalibrate = () => {
    const c = calibrate;
    setCalibrate(null);
    if (!c) return;
    const shape = shapes.find((s) => s.id === c.shapeId);
    if (!shape || shape.kind !== "measure") return;
    const next = pxPerInchFromCalibration(dist(shape.from, shape.to), parseFloat(c.value), c.unit);
    if (next) setPxPerInch(next);
  };

  const undo = () => {
    const cur = docRef.current;
    if (!cur) return;
    const r = undoHistory(history, cur);
    if (!r) return;
    setHistory(r.history);
    setDoc(r.snapshot);
    setSelectedId(null);
  };
  const redo = () => {
    const cur = docRef.current;
    if (!cur) return;
    const r = redoHistory(history, cur);
    if (!r) return;
    setHistory(r.history);
    setDoc(r.snapshot);
    setSelectedId(null);
  };

  const clearAll = () => {
    if (!shapes.length) return;
    changeShapes(() => []);
    setSelectedId(null);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    const id = selectedId;
    changeShapes((s) => s.filter((sh) => sh.id !== id));
    setSelectedId(null);
  };

  const copySelected = () => {
    if (!selected || !image) return;
    const id = nextId();
    const offset = Math.max(20, image.w * 0.03);
    const clone = translateShape({ ...selected, id }, offset, offset);
    changeShapes((s) => [...s, clone]);
    setSelectedId(id);
  };

  const addLabelToSelected = () => {
    if (!selected) return;
    const b = getBoundingBox(selected);
    setTextPrompt({ pos: { x: b.x, y: Math.max(0, b.y - 8) }, value: "" });
  };

  const updateColor = (c: string) => {
    setColor(c);
    if (!selected || selected.kind === "sticker") return;
    const id = selected.id;
    changeShapes((s) =>
      s.map((sh) => (sh.id === id && sh.kind !== "sticker" ? { ...sh, color: c } : sh)),
    );
  };

  const updateWidth = (w: number) => {
    setStrokeWidth(w);
    const cur = docRef.current;
    if (!cur || !selected || selected.kind === "text" || selected.kind === "sticker") return;
    const id = selected.id;
    // Not an undo step per notch of the slider, which is web's rule too.
    setDoc({
      ...cur,
      shapes: cur.shapes.map((sh) =>
        sh.id === id && sh.kind !== "text" && sh.kind !== "sticker" ? { ...sh, width: w } : sh,
      ),
    });
  };

  const runImageOp = async (label: string, op: (d: Snapshot) => Promise<Snapshot>) => {
    const cur = docRef.current;
    if (!cur || busy) return;
    setBusy(label);
    setError(null);
    try {
      const next = await op(cur);
      pushPrev(cur);
      setDoc(next);
      setSelectedId(null);
      resetZoom();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${label.toLowerCase()} the photo`);
    } finally {
      setBusy(null);
    }
  };

  const rotate = () =>
    runImageOp("Rotate", async (d) => {
      const rendered = await ImageManipulator.manipulate(d.image.uri).rotate(90).renderAsync();
      const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 1 });
      const expected = rotatedSize(d.image);
      const sx = out.width / expected.w;
      const sy = out.height / expected.h;
      const turned = rotateShapesCW(d.shapes, d.image).map((s) =>
        sx === 1 && sy === 1 ? s : scaleShape(s, sx, sy),
      );
      return { shapes: turned, image: { uri: out.uri, w: out.width, h: out.height } };
    });

  const applyCrop = (rect: Rect) =>
    runImageOp("Crop", async (d) => {
      const r = normaliseCrop(rect, d.image);
      if (r.w < MIN_CROP || r.h < MIN_CROP) return d;
      const rendered = await ImageManipulator.manipulate(d.image.uri)
        .crop({ originX: r.x, originY: r.y, width: r.w, height: r.h })
        .renderAsync();
      const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 1 });
      return {
        shapes: cropShapes(d.shapes, r),
        image: { uri: out.uri, w: out.width, h: out.height },
      };
    });

  // ---- close / back ------------------------------------------------------
  const isDirty =
    shapes.length > 0 ||
    !!draft ||
    (!!polyDraft && polyDraft.points.length > 0) ||
    (!!image && !!originalImage && image.uri !== originalImage.uri) ||
    isAdjusted(adjust);

  /** Web's Escape, stage one: back out of the innermost thing in progress. */
  const cancelInProgress = (): boolean => {
    if (panel) return (setPanel(null), true);
    if (textPrompt) return (setTextPrompt(null), true);
    if (calibrate) return (setCalibrate(null), true);
    if (cropDraft) return (setCropDraft(null), true);
    if (polyDraft) return (setPolyDraft(null), true);
    if (draft) return (cancelTouch(), true);
    if (selectedId) return (setSelectedId(null), true);
    return false;
  };

  const requestClose = () => {
    if (exporting) return;
    if (!isDirty) {
      onCancel();
      return;
    }
    Alert.alert(
      "Discard your annotations?",
      "This photo has mark-up that has not been saved yet. Closing now throws it away.",
      [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: onCancel },
      ],
    );
  };

  const back = () => {
    if (!cancelInProgress()) requestClose();
  };
  const backRef = useRef(back);
  backRef.current = back;
  useImperativeHandle(ref, () => ({ back: () => backRef.current() }), []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      backRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  // ---- save --------------------------------------------------------------
  const save = () => {
    const cur = docRef.current;
    if (!cur || exporting || busy) return;
    // Commit anything half-drawn so it is not lost, as web does.
    const extra: Shape[] = [];
    const d = draftRef.current;
    if (d && isMeaningful(d)) extra.push(d);
    if (polyDraft && polyDraft.points.length >= 2) {
      extra.push({
        id: polyDraft.id,
        kind: "polyline",
        color,
        width: strokeWidth,
        points: polyDraft.points,
      });
    }
    if (extra.length) changeShapes((s) => [...s, ...extra]);
    draftRef.current = null;
    setDraft(null);
    setPolyDraft(null);
    setSelectedId(null);
    setTextPrompt(null);
    setCalibrate(null);
    setPanel(null);
    setError(null);
    setExporting(true);
  };

  const exportRef = useRef<Svg>(null);
  const saveJob = useRef<() => Promise<void>>(async () => {});
  saveJob.current = async () => {
    const cur = docRef.current;
    if (!cur) return;
    await onSave({
      canvas: exportRef.current,
      width: cur.image.w,
      height: cur.image.h,
      dirty: isDirty || cur.shapes.length > 0,
    });
  };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!exporting) return;
    // A beat for the off-screen full-size surface to lay out and load the photo.
    const timer = setTimeout(() => {
      saveJob
        .current()
        .catch((e: unknown) => {
          if (mounted.current)
            setError(e instanceof Error ? e.message : "Could not save the annotated photo");
        })
        .finally(() => {
          if (mounted.current) setExporting(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [exporting]);

  // ---- overlay (editor-only, in image pixels) ----------------------------
  const renderShapes: Shape[] = [...shapes];
  if (draft) renderShapes.push(draft);
  if (polyDraft && polyDraft.points.length > 0) {
    renderShapes.push({
      id: polyDraft.id,
      kind: "polyline",
      color,
      width: strokeWidth,
      points: polyDraft.points,
    });
  }

  let overlay: ReactNode = null;
  if (image) {
    const parts: ReactNode[] = [];
    if (selected && tool === "select") {
      const b = getBoundingBox(selected);
      const pad = 4 * k;
      parts.push(
        <SvgRect
          key="sel"
          x={b.x - pad}
          y={b.y - pad}
          width={b.w + pad * 2}
          height={b.h + pad * 2}
          stroke={ACCENT}
          strokeWidth={1.5 * k}
          strokeDasharray={`${6 * k} ${4 * k}`}
          fill="none"
        />,
      );
      getHandles(selected).forEach((h, i) =>
        parts.push(
          <SvgRect
            key={`h${i}`}
            x={h.pos.x - 9 * k}
            y={h.pos.y - 9 * k}
            width={18 * k}
            height={18 * k}
            rx={3 * k}
            fill="#ffffff"
            stroke={ACCENT}
            strokeWidth={2.5 * k}
          />,
        ),
      );
    }
    if (cropDraft) {
      const c = cropDraft;
      const W = image.w;
      const H = image.h;
      parts.push(
        <G key="crop">
          <Path
            d={`M0 0H${W}V${H}H0Z M${c.x} ${c.y}V${c.y + c.h}H${c.x + c.w}V${c.y}Z`}
            fill="rgba(0,0,0,0.55)"
            fillRule="evenodd"
          />
          <SvgRect
            x={c.x}
            y={c.y}
            width={c.w}
            height={c.h}
            stroke={ACCENT}
            strokeWidth={2.5 * k}
            fill="none"
          />
          {[1, 2].map((i) => (
            <G key={i}>
              <Line
                x1={c.x + (c.w * i) / 3}
                y1={c.y}
                x2={c.x + (c.w * i) / 3}
                y2={c.y + c.h}
                stroke="rgba(255,255,255,0.4)"
                strokeWidth={k}
              />
              <Line
                x1={c.x}
                y1={c.y + (c.h * i) / 3}
                x2={c.x + c.w}
                y2={c.y + (c.h * i) / 3}
                stroke="rgba(255,255,255,0.4)"
                strokeWidth={k}
              />
            </G>
          ))}
          {[
            [c.x, c.y],
            [c.x + c.w, c.y],
            [c.x, c.y + c.h],
            [c.x + c.w, c.y + c.h],
          ].map(([x, y], i) => (
            <SvgRect
              key={`c${i}`}
              x={x - 11 * k}
              y={y - 11 * k}
              width={22 * k}
              height={22 * k}
              rx={3 * k}
              fill="#ffffff"
              stroke={ACCENT}
              strokeWidth={2.5 * k}
            />
          ))}
        </G>,
      );
    }
    overlay = parts.length ? <G>{parts}</G> : null;
  }

  // ---- hint --------------------------------------------------------------
  let hint: string | null = null;
  if (tool === "crop" && !cropDraft) hint = "Drag on the photo to crop";
  else if (tool === "polyline")
    hint = polyDraft
      ? `Tap to add · Double-tap to finish (${polyDraft.points.length})`
      : "Tap on the photo to place the first point";
  else if (tool === "measure" && !draft)
    hint = pxPerInch ? "Drag to measure" : "Drag to measure · then Calibrate to set scale";
  else if (tool === "sticker") hint = "Tap the photo to place the sticker";
  else if (tool === "text") hint = "Tap the photo to add text";
  else if (tool === "timestamp") hint = "Tap the photo to stamp the capture time";

  // ---- buttons -----------------------------------------------------------
  type Btn = {
    key: string;
    label: string;
    icon: IconName;
    onPress: () => void;
    active?: boolean;
    disabled?: boolean;
    danger?: boolean;
    badge?: ReactNode;
  };
  const toolBtn = (t: Tool, label: string, icon: IconName): Btn => ({
    key: t,
    label,
    icon,
    active: tool === t,
    onPress: () => {
      setPanel(null);
      setTool(t);
    },
  });
  const groups: { label: string; items: Btn[] }[] = [
    {
      label: "History",
      items: [
        {
          key: "undo",
          label: "Undo",
          icon: "undo",
          onPress: undo,
          disabled: history.past.length === 0,
        },
        {
          key: "redo",
          label: "Redo",
          icon: "redo",
          onPress: redo,
          disabled: history.future.length === 0,
        },
      ],
    },
    {
      label: "Draw",
      items: [
        toolBtn("select", "Select", "select"),
        toolBtn("pen", "Freehand", "pen"),
        toolBtn("polyline", "Line", "polyline"),
        toolBtn("arrow", "Arrow", "arrow"),
        ...(canMeasure ? [toolBtn("measure", "Measure (Pro)", "measure")] : []),
      ],
    },
    {
      label: "Shapes",
      items: [toolBtn("ellipse", "Circle", "ellipse"), toolBtn("rect", "Rectangle", "rect")],
    },
    {
      label: "Mark",
      items: [
        toolBtn("text", "Text", "text"),
        toolBtn("timestamp", "Timestamp", "timestamp"),
        {
          key: "sticker",
          label: "Stickers",
          icon: "sticker",
          active: tool === "sticker",
          onPress: () => {
            setTool("sticker");
            setPanel(panel === "sticker" ? null : "sticker");
          },
          badge: <Text style={styles.badgeGlyph}>{sticker}</Text>,
        },
      ],
    },
    {
      label: "Style",
      items: [
        {
          key: "style",
          label: `Color and thickness, ${strokeWidth}px`,
          icon: "palette",
          active: panel === "style",
          onPress: () => setPanel(panel === "style" ? null : "style"),
          badge: <View style={[styles.badgeDot, { backgroundColor: color }]} />,
        },
        {
          key: "adjust",
          label: "Adjust image",
          icon: "adjust",
          active: panel === "adjust",
          onPress: () => setPanel(panel === "adjust" ? null : "adjust"),
        },
        {
          key: "rotate",
          label: "Rotate 90 degrees",
          icon: "rotate",
          onPress: () => void rotate(),
          disabled: !!busy,
        },
        toolBtn("crop", "Crop", "crop"),
      ],
    },
    {
      label: "Actions",
      items: [
        {
          key: "clear",
          label: "Clear all",
          icon: "trash",
          onPress: clearAll,
          disabled: !shapes.length,
          danger: true,
        },
      ],
    },
  ];

  const renderBtn = (b: Btn) => (
    <Pressable
      key={b.key}
      accessibilityRole="button"
      accessibilityLabel={b.label}
      accessibilityState={{ selected: !!b.active, disabled: !!b.disabled }}
      disabled={b.disabled}
      onPress={b.onPress}
      style={[
        styles.toolBtn,
        b.active ? { backgroundColor: ACCENT } : null,
        b.disabled ? { opacity: 0.3 } : null,
      ]}
    >
      <ToolIcon name={b.icon} color={b.danger ? "#fca5a5" : "#fff"} />
      {b.badge ? <View style={styles.badge}>{b.badge}</View> : null}
      {b.active && b.key !== "style" && b.key !== "adjust" ? (
        <View style={[styles.activeBar, { backgroundColor: color }]} />
      ) : null}
    </Pressable>
  );

  const saveButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Save"
      onPress={save}
      disabled={exporting || !image || !!busy}
      style={[styles.saveBtn, exporting || !image ? { opacity: 0.6 } : null]}
    >
      {exporting ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
    </Pressable>
  );

  const panelBody =
    panel === "style" ? (
      <StylePanel color={color} width={strokeWidth} onColor={updateColor} onWidth={updateWidth} />
    ) : panel === "sticker" ? (
      <StickerPanel
        glyph={sticker}
        onPick={(g) => {
          setSticker(g);
          setToolState("sticker");
          setPanel(null);
        }}
      />
    ) : panel === "adjust" ? (
      <AdjustPanel adjust={adjust} onChange={setAdjust} />
    ) : null;

  // Loupe: the region under the finger at 3x, parked in the corner away from it.
  const LOUPE = 140;
  let loupeView: ReactNode = null;
  if (loupe && image) {
    const sample = (LOUPE / 3) * k;
    const vb = `${loupe.x - sample / 2} ${loupe.y - sample / 2} ${sample} ${sample}`;
    const screenX =
      stage.w / 2 +
      zoomRef.current.tx +
      zoomRef.current.scale * ((loupe.x / image.w) * display.w - display.w / 2);
    const leftSide = screenX > stage.w / 2;
    loupeView = (
      <View
        pointerEvents="none"
        style={[
          styles.loupe,
          { width: LOUPE, height: LOUPE },
          leftSide ? { left: 12 } : { right: 12 },
        ]}
      >
        <AnnotationCanvas
          uri={image.uri}
          width={LOUPE}
          height={LOUPE}
          image={image}
          shapes={renderShapes}
          pxPerInch={scale}
          adjust={adjust}
          viewBox={vb}
          overlay={
            <G>
              <Line
                x1={loupe.x}
                y1={loupe.y - sample * 0.07}
                x2={loupe.x}
                y2={loupe.y + sample * 0.07}
                stroke="#fff"
                strokeWidth={sample / 140}
              />
              <Line
                x1={loupe.x - sample * 0.07}
                y1={loupe.y}
                x2={loupe.x + sample * 0.07}
                y2={loupe.y}
                stroke="#fff"
                strokeWidth={sample / 140}
              />
              <SvgCircle
                cx={loupe.x}
                cy={loupe.y}
                r={sample * 0.03}
                stroke={ACCENT}
                strokeWidth={sample / 70}
                fill="none"
              />
            </G>
          }
        />
      </View>
    );
  }

  const selectionBar =
    selected && tool === "select" && !textPrompt && !calibrate ? (
      <View style={styles.selectionBar}>
        {selected.kind === "text" ? (
          <BarButton
            icon="text"
            label="Edit"
            onPress={() =>
              setTextPrompt({ pos: selected.pos, value: selected.text, editingId: selected.id })
            }
          />
        ) : selected.kind !== "sticker" ? (
          <BarButton icon="label" label="Label" onPress={addLabelToSelected} />
        ) : null}
        {selected.kind === "measure" ? (
          <BarButton
            icon="measure"
            label="Calibrate"
            accent
            onPress={() => setCalibrate({ shapeId: selected.id, value: "", unit: "in" })}
          />
        ) : null}
        <BarButton icon="copy" label="Copy" onPress={copySelected} />
        <BarButton icon="trash" label="Delete" danger onPress={deleteSelected} />
      </View>
    ) : null;

  const stageView = (
    <View
      style={styles.stage}
      onLayout={(e) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {!image ? (
        <View style={styles.center}>
          {loadError ? (
            <Text style={styles.errorText}>{loadError}</Text>
          ) : (
            <ActivityIndicator color="#fff" />
          )}
        </View>
      ) : (
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            <Animated.View
              style={[
                {
                  position: "absolute",
                  left: (stage.w - display.w) / 2,
                  top: (stage.h - display.h) / 2,
                  width: display.w,
                  height: display.h,
                },
                zoomStyle,
              ]}
            >
              <AnnotationCanvas
                uri={image.uri}
                width={display.w}
                height={display.h}
                image={image}
                shapes={renderShapes}
                pxPerInch={scale}
                adjust={adjust}
                overlay={overlay}
              />
            </Animated.View>
          </View>
        </GestureDetector>
      )}

      {hint && !textPrompt && !calibrate && !cropDraft ? (
        <View pointerEvents="none" style={styles.hintWrap}>
          <Text style={styles.hint}>{hint}</Text>
        </View>
      ) : null}

      {selectionBar}

      {cropDraft && cropDraft.w >= MIN_CROP && cropDraft.h >= MIN_CROP && !cropRef.current ? (
        <View style={styles.selectionBar}>
          <BarButton icon="close" label="Cancel" onPress={() => setCropDraft(null)} />
          <BarButton
            icon="check"
            label="Apply crop"
            accent
            onPress={() => {
              const rect = cropDraft;
              setCropDraft(null);
              setToolState("select");
              void applyCrop(rect);
            }}
          />
        </View>
      ) : null}

      {zoomScale > 1.01 ? (
        <Pressable accessibilityRole="button" onPress={resetZoom} style={styles.fitBtn}>
          <Text style={styles.fitText}>Fit</Text>
        </Pressable>
      ) : null}

      {polyDraft && polyDraft.points.length >= 2 && !textPrompt ? (
        <Pressable accessibilityRole="button" onPress={finishPolyline} style={styles.finishBtn}>
          <Text style={styles.saveText}>Finish line ({polyDraft.points.length} pts)</Text>
        </Pressable>
      ) : null}

      {loupeView}

      {textPrompt ? (
        <View style={styles.cardWrap}>
          <TextPromptCard
            value={textPrompt.value}
            editing={!!textPrompt.editingId}
            isLabel={textPrompt.isLabel}
            onChange={(value) => setTextPrompt({ ...textPrompt, value })}
            onCancel={() => setTextPrompt(null)}
            onCommit={commitText}
          />
        </View>
      ) : null}

      {calibrate ? (
        <View style={styles.cardWrap}>
          <CalibrateCard
            value={calibrate.value}
            unit={calibrate.unit}
            onValue={(value) => setCalibrate({ ...calibrate, value })}
            onUnit={(unit) => setCalibrate({ ...calibrate, unit })}
            onCancel={() => setCalibrate(null)}
            onCommit={commitCalibrate}
          />
        </View>
      ) : null}

      {panelBody ? (
        <Panel style={useRail ? styles.panelRail : styles.panelBottom}>{panelBody}</Panel>
      ) : null}

      {busy ? (
        <View style={styles.busy} pointerEvents="none">
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}

      {error ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setError(null)}
          style={styles.errorWrap}
        >
          <Text style={styles.errorText}>{error}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: BG }}>
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + 8,
            paddingLeft: insets.left + 12,
            paddingRight: insets.right + 12,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={requestClose}
          disabled={exporting}
          style={styles.cancelBtn}
        >
          <ToolIcon name="close" />
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {polyDraft ? `Line: ${polyDraft.points.length} pts` : title}
        </Text>
        {saveButton}
      </View>

      <View style={{ flex: 1, flexDirection: useRail ? "row" : "column" }}>
        {stageView}
        {useRail ? (
          <View
            style={[
              styles.rail,
              { marginRight: insets.right + 8, marginBottom: insets.bottom + 8 },
            ]}
          >
            <ScrollView
              contentContainerStyle={styles.railContent}
              showsVerticalScrollIndicator={false}
            >
              {groups.map((g) => (
                <View key={g.label} style={styles.group}>
                  <Text style={styles.groupLabel}>{g.label.toUpperCase()}</Text>
                  {g.items.map(renderBtn)}
                </View>
              ))}
            </ScrollView>
          </View>
        ) : (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 6 }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.bottomContent}
            >
              {groups.map((g, gi) => (
                <View key={g.label} style={styles.bottomGroup}>
                  {gi > 0 ? <View style={styles.divider} /> : null}
                  {g.items.map(renderBtn)}
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {exporting && image ? (
        <View style={styles.offscreen} pointerEvents="none" accessibilityElementsHidden>
          <AnnotationCanvas
            ref={exportRef}
            uri={image.uri}
            width={image.w}
            height={image.h}
            image={image}
            shapes={shapes}
            pxPerInch={scale}
            adjust={adjust}
          />
        </View>
      ) : null}
    </GestureHandlerRootView>
  );
});

function scaleShape(s: Shape, sx: number, sy: number): Shape {
  const f = (p: Point) => ({ x: p.x * sx, y: p.y * sy });
  if (s.kind === "pen" || s.kind === "polyline") return { ...s, points: s.points.map(f) };
  if (s.kind === "text" || s.kind === "sticker") return { ...s, pos: f(s.pos) };
  return { ...s, from: f(s.from), to: f(s.to) };
}

function BarButton({
  icon,
  label,
  onPress,
  danger,
  accent,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  accent?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.barBtn, accent ? { backgroundColor: ACCENT } : null]}
    >
      <ToolIcon name={icon} size={18} color={danger ? "#f87171" : "#fff"} />
      <Text style={[styles.barText, danger ? { color: "#f87171" } : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 8,
    backgroundColor: "rgba(10,10,10,0.95)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
    gap: 8,
  },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 22,
  },
  cancelText: { color: "rgba(255,255,255,0.9)", fontSize: 15 },
  title: { flex: 1, textAlign: "center", color: "rgba(255,255,255,0.6)", fontSize: 13 },
  saveBtn: {
    minHeight: 44,
    minWidth: 84,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  stage: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  rail: {
    width: RAIL_WIDTH,
    marginVertical: 8,
    marginLeft: 8,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  railContent: { paddingVertical: 12, gap: 12, alignItems: "center" },
  group: { alignItems: "center", gap: 4 },
  groupLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  bottomBar: {
    backgroundColor: "rgba(10,10,10,0.97)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingTop: 6,
  },
  bottomContent: { paddingHorizontal: 8, alignItems: "center" },
  bottomGroup: { flexDirection: "row", alignItems: "center", gap: 2 },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginHorizontal: 6,
  },
  toolBtn: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  activeBar: {
    position: "absolute",
    bottom: 3,
    width: 20,
    height: 3,
    borderRadius: 2,
  },
  badge: { position: "absolute", right: 3, bottom: 3 },
  badgeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.85)",
  },
  badgeGlyph: { fontSize: 11 },
  hintWrap: { position: "absolute", top: 12, left: 0, right: 0, alignItems: "center" },
  hint: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    overflow: "hidden",
  },
  selectionBar: {
    position: "absolute",
    top: 48,
    alignSelf: "center",
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: 26,
    backgroundColor: "rgba(23,23,23,0.95)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  barBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
  },
  barText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  fitBtn: {
    position: "absolute",
    left: 12,
    bottom: 12,
    minHeight: 44,
    minWidth: 56,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: "rgba(23,23,23,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  fitText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  finishBtn: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  loupe: {
    position: "absolute",
    top: 12,
    borderRadius: 70,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.8)",
    backgroundColor: "#000",
  },
  cardWrap: { position: "absolute", top: 8, left: 8, right: 8 },
  panelRail: { position: "absolute", right: 8, top: 8, width: 300, maxHeight: "96%" },
  panelBottom: { position: "absolute", left: 8, right: 8, bottom: 8, maxHeight: "80%" },
  busy: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  errorWrap: {
    position: "absolute",
    bottom: 64,
    alignSelf: "center",
    backgroundColor: "rgba(180,35,24,0.92)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    maxWidth: "90%",
  },
  errorText: { color: "#fff", fontSize: 13, textAlign: "center" },
  offscreen: { position: "absolute", left: -100000, top: 0 },
});
