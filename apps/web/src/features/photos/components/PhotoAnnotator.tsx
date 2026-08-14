import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Type,
  Undo2,
  Redo2,
  Trash2,
  Save,
  X,
  Loader2,
  Copy,
  Clock,
  RotateCw,
  Sliders,
  Smile,
  Circle as CircleIcon,
  Square as SquareIcon,
  Palette,
  Check,
  Ruler,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Tool =
  | "select"
  | "pen"
  | "polyline"
  | "arrow"
  | "ellipse"
  | "rect"
  | "text"
  | "timestamp"
  | "sticker"
  | "rotate"
  | "crop"
  | "adjust"
  | "measure";

type Point = { x: number; y: number };

type ShapeBase = { id: string };
type Shape =
  | (ShapeBase & { kind: "pen"; color: string; width: number; points: Point[] })
  | (ShapeBase & { kind: "polyline"; color: string; width: number; points: Point[] })
  | (ShapeBase & { kind: "arrow"; color: string; width: number; from: Point; to: Point })
  | (ShapeBase & { kind: "rect"; color: string; width: number; from: Point; to: Point })
  | (ShapeBase & { kind: "ellipse"; color: string; width: number; from: Point; to: Point })
  | (ShapeBase & { kind: "measure"; color: string; width: number; from: Point; to: Point })
  | (ShapeBase & { kind: "text"; color: string; size: number; pos: Point; text: string })
  | (ShapeBase & { kind: "sticker"; glyph: string; size: number; pos: Point });

const COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#22c55e",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#ffffff",
  "#000000",
];

const STICKER_GROUPS: { label: string; glyphs: string[] }[] = [
  { label: "Status", glyphs: ["✅", "❌", "⚠️", "❗", "❓", "ℹ️", "🛑", "⛔", "🚫", "✔️", "✖️"] },
  { label: "Marks", glyphs: ["⭐", "🔥", "💯", "👍", "👎", "👌", "🙌", "👏", "💪", "🤝"] },
  {
    label: "Trades",
    glyphs: ["🔧", "🔨", "🪛", "🧰", "⚙️", "🪚", "🪜", "🧱", "🧯", "⚡", "💧", "🌡️"],
  },
  { label: "Pins", glyphs: ["📍", "📌", "🚩", "🏁", "🎯", "📷", "🔍", "⏰", "📝", "💡"] },
  { label: "Numbers", glyphs: ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"] },
];

let _id = 0;
const nextId = () => `s_${Date.now().toString(36)}_${(_id++).toString(36)}`;

interface Props {
  open: boolean;
  imageUrl: string;
  onClose: () => void;
  onSave: (blob: Blob) => Promise<void> | void;
  /** Enables the Pro/Team Measurement tool. Starter users don't see it. */
  canMeasure?: boolean;
  /** Tool to auto-select when the annotator opens (e.g. "measure" from camera). */
  initialTool?: Tool;
}

type HandleHit =
  | { kind: "body" }
  | { kind: "from" }
  | { kind: "to" }
  | { kind: "tl" }
  | { kind: "tr" }
  | { kind: "bl" }
  | { kind: "br" }
  | { kind: "vertex"; index: number };

// Custom SVG icons for annotation tools ---------------------------------------
const PolylineIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="18" r="2" />
    <circle cx="12" cy="5" r="2" />
    <path d="M7.5 16.5 11 8" />
    <path d="M16.5 16.5 13 8" />
  </svg>
);
const ArrowToolIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M19 5 6 18" />
    <path d="M10 18H6v-4" />
  </svg>
);
const SquigglyIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M3 15c2-4 4-4 6 0s4 4 6 0 4-4 6 0" />
  </svg>
);
const CropOverlapIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect x="4" y="4" width="12" height="12" rx="1.5" />
    <rect x="8" y="8" width="12" height="12" rx="1.5" />
  </svg>
);

export function PhotoAnnotator({
  open,
  imageUrl,
  onClose,
  onSave,
  canMeasure = false,
  initialTool,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [baseSize, setBaseSize] = useState({ w: 0, h: 0 }); // logical (post-rotate/crop)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });

  // Image transforms
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);

  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(8);
  const [stickerGlyph, setStickerGlyph] = useState<string>("✅");
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [textMode, setTextMode] = useState<"plain" | "imperial" | "metric">("plain");
  const [polyHover, setPolyHover] = useState<Point | null>(null);
  // Measurement calibration: pixels per real-world inch. Null = auto-estimate
  // from image width assuming a typical ~4 ft (48 in) field of view.
  const [pxPerInch, setPxPerInch] = useState<number | null>(null);
  const [calibrate, setCalibrate] = useState<{
    shapeId: string;
    value: string;
    unit: "in" | "ft" | "cm" | "m";
  } | null>(null);

  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [polyDraft, setPolyDraft] = useState<{ id: string; points: Point[] } | null>(null);
  const [cropDraft, setCropDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textPrompt, setTextPrompt] = useState<{
    pos: Point;
    value: string;
    editingId?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const textWidthRef = useRef<Map<string, number>>(new Map());

  const dragRef = useRef<null | {
    shapeId: string;
    handle: HandleHit;
    startPointer: Point;
    original: Shape;
    prevShapes: Shape[];
    moved: boolean;
  }>(null);

  const pastRef = useRef<Shape[][]>([]);
  const futureRef = useRef<Shape[][]>([]);
  const [, setHistoryTick] = useState(0);
  const bumpHistory = () => setHistoryTick((t) => t + 1);
  const pushHistory = (prev: Shape[]) => {
    pastRef.current.push(prev);
    if (pastRef.current.length > 100) pastRef.current.shift();
    futureRef.current = [];
    bumpHistory();
  };

  useEffect(() => {
    if (!open) return;
    // Reset state and load the image ONCE per open. Do not re-fire when the
    // parent re-renders with a refreshed signed URL for the same photo - that
    // would wipe in-progress annotations mid-edit.
    setImgReady(false);
    setShapes([]);
    setDraft(null);
    setPolyDraft(null);
    setCropDraft(null);
    setTextPrompt(null);
    setSelectedId(null);
    setTool(initialTool && (initialTool !== "measure" || canMeasure) ? initialTool : "select");
    setPxPerInch(null);
    setCalibrate(null);
    setRotation(0);
    setCropRect(null);
    setBrightness(100);
    setContrast(100);
    setSaturation(100);
    pastRef.current = [];
    futureRef.current = [];
    bumpHistory();
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      setBaseSize({ w: img.naturalWidth, h: img.naturalHeight });
      setImgReady(true);
    };
    img.src = imageUrl;
    // Intentionally exclude imageUrl: we snapshot it at open time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Logical canvas size after rotation/crop
  const canvasSize = useMemo(() => {
    let w = baseSize.w;
    let h = baseSize.h;
    if (cropRect) {
      w = cropRect.w;
      h = cropRect.h;
    }
    if (rotation === 90 || rotation === 270) return { w: h, h: w };
    return { w, h };
  }, [baseSize, cropRect, rotation]);

  useEffect(() => {
    if (!imgReady || !containerRef.current) return;
    const measure = () => {
      const el = containerRef.current!;
      const maxW = el.clientWidth - 108; // reserve room for the right toolbar
      const maxH = Math.max(240, el.clientHeight - 8);
      const ratio = canvasSize.w / canvasSize.h;
      let w = maxW;
      let h = w / ratio;
      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }
      setDisplaySize({ w: Math.round(w), h: Math.round(h) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [imgReady, canvasSize]);

  useEffect(() => {
    if (!imgReady || !canvasRef.current || !imgRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = canvasSize.w;
    canvas.height = canvasSize.h;
    const ctx = canvas.getContext("2d")!;
    ctx.save();
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
    // draw transformed image
    ctx.translate(canvasSize.w / 2, canvasSize.h / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    const sourceW = cropRect ? cropRect.w : baseSize.w;
    const sourceH = cropRect ? cropRect.h : baseSize.h;
    const sx = cropRect ? cropRect.x : 0;
    const sy = cropRect ? cropRect.y : 0;
    ctx.drawImage(
      imgRef.current,
      sx,
      sy,
      sourceW,
      sourceH,
      -sourceW / 2,
      -sourceH / 2,
      sourceW,
      sourceH,
    );
    ctx.restore();

    // Cache text widths
    const all: Shape[] = draft ? [...shapes, draft] : shapes;
    for (const s of all) {
      if (s.kind === "text") {
        ctx.save();
        ctx.font = `600 ${s.size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
        const m = ctx.measureText(s.text || " ");
        textWidthRef.current.set(s.id, Math.max(40, m.width));
        ctx.restore();
      }
    }
    // Default scale assumes subject is ~4 ft (48") away with a typical ~65° horizontal
    // FOV, so the frame width ≈ 60". Users can Calibrate on any measurement to lock
    // in a precise scale for all lines.
    const scale = pxPerInch ?? Math.max(1, canvasSize.w / 60);
    for (const s of all) drawShape(ctx, s, scale, canvasSize);
    if (polyDraft && polyDraft.points.length > 0) {
      drawShape(
        ctx,
        { id: polyDraft.id, kind: "polyline", color, width, points: polyDraft.points },
        scale,
        canvasSize,
      );
    }
  }, [
    imgReady,
    canvasSize,
    shapes,
    draft,
    polyDraft,
    rotation,
    cropRect,
    brightness,
    contrast,
    saturation,
    baseSize,
    color,
    width,
    pxPerInch,
  ]);

  const selected = useMemo(
    () => shapes.find((s) => s.id === selectedId) ?? null,
    [shapes, selectedId],
  );

  const toCanvasCoords = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvasSize.w,
      y: ((e.clientY - rect.top) / rect.height) * canvasSize.h,
    };
  };

  const getTextWidth = (s: Shape): number => {
    if (s.kind !== "text") return 0;
    return textWidthRef.current.get(s.id) ?? Math.max(40, s.text.length * s.size * 0.55);
  };

  const hitTest = (p: Point): { shape: Shape; handle: HandleHit } | null => {
    const tol = Math.max(12, canvasSize.w * 0.012);
    if (selected) {
      const handles = getHandles(selected, getTextWidth(selected));
      for (const h of handles) {
        if (dist(p, h.pos) <= tol)
          return {
            shape: selected,
            handle:
              h.kind === "vertex"
                ? { kind: "vertex", index: h.index! }
                : ({ kind: h.kind } as HandleHit),
          };
      }
    }
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (shapeContains(s, p, tol, s.kind === "text" ? getTextWidth(s) : 0)) {
        return { shape: s, handle: { kind: "body" } };
      }
    }
    return null;
  };

  const cropCornerRef = useRef<null | "tl" | "tr" | "bl" | "br" | "new">(null);

  const cropHandleAt = (p: Point): "tl" | "tr" | "bl" | "br" | null => {
    if (!cropDraft) return null;
    const tol = Math.max(14, canvasSize.w * 0.02);
    const corners: Record<"tl" | "tr" | "bl" | "br", Point> = {
      tl: { x: cropDraft.x, y: cropDraft.y },
      tr: { x: cropDraft.x + cropDraft.w, y: cropDraft.y },
      bl: { x: cropDraft.x, y: cropDraft.y + cropDraft.h },
      br: { x: cropDraft.x + cropDraft.w, y: cropDraft.y + cropDraft.h },
    };
    for (const k of Object.keys(corners) as (keyof typeof corners)[]) {
      if (dist(p, corners[k]) <= tol) return k;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!imgReady) return;
    if (textPrompt) return;
    const p = toCanvasCoords(e);

    if (tool === "crop") {
      canvasRef.current?.setPointerCapture(e.pointerId);
      const corner = cropHandleAt(p);
      if (corner) {
        cropCornerRef.current = corner;
      } else {
        cropCornerRef.current = "new";
        setCropDraft({ x: p.x, y: p.y, w: 0, h: 0 });
      }
      return;
    }

    if (tool === "polyline") {
      setPolyHover(p);
      if (!polyDraft) {
        setPolyDraft({ id: nextId(), points: [p] });
      } else {
        // Place the new point and immediately prompt for a label/measurement for this segment.
        const newPoints = [...polyDraft.points, p];
        setPolyDraft({ ...polyDraft, points: newPoints });
        setTextPrompt({ pos: { x: p.x, y: Math.max(0, p.y - 10) }, value: "" });
      }
      return;
    }

    if (tool === "select") {
      const hit = hitTest(p);
      if (hit) {
        setSelectedId(hit.shape.id);
        dragRef.current = {
          shapeId: hit.shape.id,
          handle: hit.handle,
          startPointer: p,
          original: hit.shape,
          prevShapes: shapes,
          moved: false,
        };
        canvasRef.current?.setPointerCapture(e.pointerId);
      } else {
        setSelectedId(null);
      }
      return;
    }

    if (tool === "text") {
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (s.kind === "text" && shapeContains(s, p, 12, textWidthRef.current.get(s.id))) {
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
      const now = new Date();
      const stamp = now.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const size = Math.max(20, Math.round(canvasSize.h / 32));
      pushHistory(shapes);
      const id = nextId();
      setShapes((s) => [...s, { id, kind: "text", color, size, pos: p, text: stamp }]);
      setSelectedId(id);
      setTool("select");
      return;
    }

    if (tool === "sticker") {
      const id = nextId();
      const size = Math.max(48, Math.round(canvasSize.h / 10));
      pushHistory(shapes);
      const newSticker: Shape = {
        id,
        kind: "sticker",
        glyph: stickerGlyph,
        size,
        pos: { x: p.x - size / 2, y: p.y - size / 2 },
      };
      setShapes((s) => [...s, newSticker]);
      setSelectedId(id);
      setTool("select");
      return;
    }

    setSelectedId(null);
    canvasRef.current?.setPointerCapture(e.pointerId);
    const id = nextId();
    if (tool === "pen") setDraft({ id, kind: "pen", color, width, points: [p] });
    else if (tool === "arrow") setDraft({ id, kind: "arrow", color, width, from: p, to: p });
    else if (tool === "measure")
      setDraft({ id, kind: "measure", color, width: Math.max(width, 8), from: p, to: p });
    else if (tool === "rect") setDraft({ id, kind: "rect", color, width, from: p, to: p });
    else if (tool === "ellipse") setDraft({ id, kind: "ellipse", color, width, from: p, to: p });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!imgReady) return;

    if (tool === "polyline" || tool === "measure") {
      setPolyHover(toCanvasCoords(e));
    }

    if (tool === "crop" && cropCornerRef.current) {
      const p = toCanvasCoords(e);
      const c = cropCornerRef.current;
      if (c === "new" && cropDraft) {
        setCropDraft({
          x: Math.min(cropDraft.x, p.x),
          y: Math.min(cropDraft.y, p.y),
          w: Math.abs(p.x - cropDraft.x),
          h: Math.abs(p.y - cropDraft.y),
        });
      } else if (cropDraft) {
        let x1 = cropDraft.x,
          y1 = cropDraft.y,
          x2 = cropDraft.x + cropDraft.w,
          y2 = cropDraft.y + cropDraft.h;
        if (c === "tl") {
          x1 = p.x;
          y1 = p.y;
        }
        if (c === "tr") {
          x2 = p.x;
          y1 = p.y;
        }
        if (c === "bl") {
          x1 = p.x;
          y2 = p.y;
        }
        if (c === "br") {
          x2 = p.x;
          y2 = p.y;
        }
        setCropDraft({
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          w: Math.abs(x2 - x1),
          h: Math.abs(y2 - y1),
        });
      }
      return;
    }

    if (dragRef.current) {
      const p = toCanvasCoords(e);
      const { shapeId, handle, startPointer, original } = dragRef.current;
      const dx = p.x - startPointer.x;
      const dy = p.y - startPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) dragRef.current.moved = true;
      setShapes((arr) =>
        arr.map((s) => (s.id === shapeId ? transformShape(original, handle, dx, dy, p) : s)),
      );
      return;
    }

    const p = toCanvasCoords(e);
    if (!draft) return;
    if (draft.kind === "pen") setDraft({ ...draft, points: [...draft.points, p] });
    else if (
      draft.kind === "arrow" ||
      draft.kind === "rect" ||
      draft.kind === "ellipse" ||
      draft.kind === "measure"
    )
      setDraft({ ...draft, to: p });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (tool === "crop" && cropCornerRef.current) {
      canvasRef.current?.releasePointerCapture?.(e.pointerId);
      cropCornerRef.current = null;
      if (cropDraft && (cropDraft.w < 20 || cropDraft.h < 20)) {
        setCropDraft(null);
      }
      // Do NOT auto-apply; user confirms via Apply button.
      return;
    }

    if (dragRef.current) {
      const { moved, prevShapes } = dragRef.current;
      if (moved) {
        pastRef.current.push(prevShapes);
        if (pastRef.current.length > 100) pastRef.current.shift();
        bumpHistory();
      }
      dragRef.current = null;
      canvasRef.current?.releasePointerCapture?.(e.pointerId);
      return;
    }
    if (!draft) return;
    if (
      (draft.kind === "arrow" ||
        draft.kind === "rect" ||
        draft.kind === "ellipse" ||
        draft.kind === "measure") &&
      dist(draft.from, draft.to) < 4
    ) {
      setDraft(null);
      return;
    }
    pushHistory(shapes);
    const finished = draft;
    setShapes((s) => [...s, finished]);
    setSelectedId(finished.id);
    setDraft(null);
    setTool("select");
    // Auto-prompt calibration on the first measurement so techs get accurate numbers.
    if (finished.kind === "measure" && pxPerInch === null) {
      setCalibrate({ shapeId: finished.id, value: "", unit: "ft" });
    }
  };

  const finishPolyline = () => {
    if (!polyDraft || polyDraft.points.length < 2) {
      setPolyDraft(null);
      return;
    }
    pushHistory(shapes);
    const shape: Shape = {
      id: polyDraft.id,
      kind: "polyline",
      color,
      width,
      points: polyDraft.points,
    };
    setShapes((s) => [...s, shape]);
    setSelectedId(polyDraft.id);
    setPolyDraft(null);
    setTool("select");
  };

  const applyCrop = (rect: { x: number; y: number; w: number; h: number }) => {
    // Translate rect (in current canvas coords) back to base-image coords considering rotation & existing crop.
    // Simple path: only allow crop when rotation is 0 and no existing crop (common case); otherwise, apply on current canvas.
    if (rotation === 0 && !cropRect) {
      setCropRect({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.w),
        h: Math.round(rect.h),
      });
      // shift annotations
      setShapes((arr) => arr.map((s) => translateShape(s, -rect.x, -rect.y)));
    } else {
      // Fallback: bake current canvas to a bitmap and reset.
      const c = canvasRef.current!;
      const off = document.createElement("canvas");
      off.width = Math.round(rect.w);
      off.height = Math.round(rect.h);
      off
        .getContext("2d")!
        .drawImage(c, rect.x, rect.y, rect.w, rect.h, 0, 0, off.width, off.height);
      const dataUrl = off.toDataURL("image/png");
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        setBaseSize({ w: img.naturalWidth, h: img.naturalHeight });
        setRotation(0);
        setCropRect(null);
        setShapes([]);
        setSelectedId(null);
      };
      img.src = dataUrl;
    }
  };

  const doRotate = () => {
    // Rotate 90° CW around canvas center; transform all annotations.
    const { w, h } = canvasSize;
    const rotatePt = (p: Point): Point => ({ x: h - p.y, y: p.x });
    setShapes((arr) => arr.map((s) => mapShapePoints(s, rotatePt)));
    setRotation(((rotation + 90) % 360) as 0 | 90 | 180 | 270);
  };

  const commitText = () => {
    if (!textPrompt) return;
    const value = textPrompt.value.trim();
    if (!value) {
      setTextPrompt(null);
      return;
    }
    const size = Math.max(20, Math.round((canvasSize.h / 28) * (width / 4)));
    if (textPrompt.editingId) {
      const id = textPrompt.editingId;
      const target = shapes.find((sh) => sh.id === id);
      if (target && target.kind === "text" && target.text === value) {
        setTextPrompt(null);
        setTool("select");
        return;
      }
      pushHistory(shapes);
      setShapes((s) =>
        s.map((sh) => (sh.id === id && sh.kind === "text" ? { ...sh, text: value } : sh)),
      );
    } else {
      pushHistory(shapes);
      const id = nextId();
      setShapes((s) => [...s, { id, kind: "text", color, size, pos: textPrompt.pos, text: value }]);
      setSelectedId(id);
    }
    setTextPrompt(null);
    setTool("select");
  };

  const appendUnit = (unit: string) => {
    if (!textPrompt) return;
    setTextPrompt({ ...textPrompt, value: (textPrompt.value + unit).trimStart() });
  };

  const undo = () => {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(shapes);
    setShapes(prev);
    setSelectedId(null);
    bumpHistory();
  };

  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(shapes);
    setShapes(next);
    setSelectedId(null);
    bumpHistory();
  };

  const clearAll = () => {
    if (!shapes.length) return;
    pushHistory(shapes);
    setShapes([]);
    setSelectedId(null);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    pushHistory(shapes);
    setShapes((s) => s.filter((sh) => sh.id !== selectedId));
    setSelectedId(null);
  };

  const copySelected = () => {
    if (!selected) return;
    pushHistory(shapes);
    const id = nextId();
    const offset = Math.max(20, canvasSize.w * 0.03);
    const clone = translateShape({ ...(selected as Shape), id }, offset, offset);
    setShapes((s) => [...s, clone]);
    setSelectedId(id);
  };

  const addLabelToSelected = () => {
    if (!selected) return;
    const b = getBoundingBox(
      selected as Shape,
      selected.kind === "text" ? getTextWidth(selected as Shape) : undefined,
    );
    setTextPrompt({ pos: { x: b.x, y: Math.max(0, b.y - 8) }, value: "" });
  };

  const updateSelectedColor = (c: string) => {
    setColor(c);
    if (!selectedId) return;
    const target = shapes.find((sh) => sh.id === selectedId);
    if (!target || target.kind === "sticker") return;
    pushHistory(shapes);
    setShapes((s) =>
      s.map((sh) =>
        sh.id === selectedId && sh.kind !== "sticker" ? ({ ...sh, color: c } as Shape) : sh,
      ),
    );
  };

  const updateSelectedWidth = (w: number) => {
    setWidth(w);
    if (!selectedId) return;
    const target = shapes.find((sh) => sh.id === selectedId);
    if (!target || target.kind === "text" || target.kind === "sticker") return;
    setShapes((s) =>
      s.map((sh) =>
        sh.id === selectedId && sh.kind !== "text" && sh.kind !== "sticker"
          ? ({ ...sh, width: w } as Shape)
          : sh,
      ),
    );
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !textPrompt) {
        e.preventDefault();
        deleteSelected();
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        setTextPrompt(null);
        setPolyDraft(null);
      }
      if (e.key === "Enter" && polyDraft) {
        e.preventDefault();
        finishPolyline();
      }
      const meta = e.metaKey || e.ctrlKey;
      if (meta && !textPrompt && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (meta && !textPrompt && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedId, textPrompt, polyDraft, shapes]);

  const startEditText = (s: Shape) => {
    if (s.kind !== "text") return;
    setTextPrompt({ pos: s.pos, value: s.text, editingId: s.id });
  };

  const onCanvasDoubleClick = () => {
    if (polyDraft) {
      finishPolyline();
      return;
    }
    if (!selected) return;
    if (selected.kind === "text") startEditText(selected as Shape);
  };

  const save = async () => {
    if (!canvasRef.current || saving) return;
    // Commit any in-progress drawings so they aren't lost on save.
    const extra: Shape[] = [];
    if (draft) {
      const ok =
        draft.kind === "arrow" ||
        draft.kind === "rect" ||
        draft.kind === "ellipse" ||
        draft.kind === "measure"
          ? dist(draft.from, draft.to) >= 4
          : true;
      if (ok) extra.push(draft);
    }
    if (polyDraft && polyDraft.points.length >= 2) {
      extra.push({ id: polyDraft.id, kind: "polyline", color, width, points: polyDraft.points });
    }
    if (extra.length) {
      pushHistory(shapes);
      setShapes((s) => [...s, ...extra]);
    }
    setSelectedId(null);
    setDraft(null);
    setPolyDraft(null);
    setTextPrompt(null);
    // Let one paint flush so overlays are baked and selection outlines are gone.
    await new Promise((r) => setTimeout(r, 60));
    setSaving(true);
    const savingToast = toast.loading("Saving photo…");
    try {
      const canvas = canvasRef.current;
      let blob: Blob | null = null;
      // Primary: toBlob (may return null or throw on tainted canvas)
      try {
        blob = await new Promise<Blob | null>((resolve) => {
          try {
            canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92);
          } catch {
            resolve(null);
          }
        });
      } catch {
        blob = null;
      }
      // Fallback: dataURL → blob
      if (!blob) {
        try {
          const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
          const res = await fetch(dataUrl);
          blob = await res.blob();
        } catch {
          throw new Error("Couldn't export the annotated image. The photo may be blocked by CORS.");
        }
      }
      if (!blob) throw new Error("Failed to render annotated image.");
      await onSave(blob);
      toast.success("Saved", { id: savingToast });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save annotated photo", { id: savingToast });
    } finally {
      setSaving(false);
    }
  };

  const toCss = (p: Point) => ({
    left: (p.x / canvasSize.w) * displaySize.w,
    top: (p.y / canvasSize.h) * displaySize.h,
  });

  const selectionHandles =
    selected && tool === "select"
      ? getHandles(
          selected as Shape,
          selected.kind === "text" ? getTextWidth(selected as Shape) : undefined,
        )
      : [];
  const selectionBox = selected
    ? getBoundingBox(
        selected as Shape,
        selected.kind === "text" ? getTextWidth(selected as Shape) : undefined,
      )
    : null;

  const tools: { key: Tool; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: "pen", label: "Freehand", icon: SquigglyIcon },
    { key: "polyline", label: "Line", icon: PolylineIcon },
    { key: "arrow", label: "Arrow", icon: ArrowToolIcon },
    ...(canMeasure ? [{ key: "measure" as Tool, label: "Measure (Pro)", icon: Ruler }] : []),
    { key: "ellipse", label: "Circle", icon: CircleIcon },
    { key: "rect", label: "Rectangle", icon: SquareIcon },
    { key: "text", label: "Text", icon: Type },
    { key: "timestamp", label: "Timestamp", icon: Clock },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className="max-w-none w-screen h-[100dvh] p-0 gap-0 overflow-hidden border-0 rounded-none bg-neutral-950 text-white sm:rounded-none z-[120] [&>button[aria-label='Close']]:hidden"
        style={{ zIndex: 120 }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Annotate photo</DialogTitle>
        </DialogHeader>

        <div className="relative flex h-full w-full flex-col bg-neutral-950">
          {/* Top bar */}
          <div className="flex items-center justify-between px-3 py-2.5 bg-neutral-950/95 backdrop-blur border-b border-white/5 z-30">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-white/90 hover:bg-white/10 active:bg-white/15 transition"
            >
              <X className="h-5 w-5" />
              <span className="hidden sm:inline">Cancel</span>
            </button>

            <div className="text-xs text-white/50">
              {polyDraft
                ? `Line: ${polyDraft.points.length} pts - tap to add & label, double-tap to finish`
                : "Annotate"}
            </div>

            <button
              type="button"
              onClick={save}
              disabled={saving || !imgReady}
              className="flex h-10 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow hover:brightness-110 active:brightness-95 disabled:opacity-50 transition"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {/* Canvas stage */}
          <div
            ref={containerRef}
            className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden bg-black"
          >
            {!imgReady ? (
              <div className="flex items-center justify-center text-white/60">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className="relative" style={{ width: displaySize.w, height: displaySize.h }}>
                <canvas
                  ref={canvasRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerLeave={() => {
                    if (tool === "polyline" || tool === "measure") setPolyHover(null);
                  }}
                  onDoubleClick={onCanvasDoubleClick}
                  style={{
                    width: displaySize.w,
                    height: displaySize.h,
                    touchAction: "none",
                    cursor:
                      tool === "select" ? "default" : tool === "polyline" ? "zoom-in" : "crosshair",
                  }}
                />

                {/* Crop overlay with visible corner handles */}
                {tool === "crop" && !cropDraft && (
                  <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-3">
                    <div className="rounded-full bg-primary/90 px-3 py-1 text-[11px] font-medium text-primary-foreground shadow">
                      Drag on the photo to crop
                    </div>
                  </div>
                )}
                {cropDraft &&
                  (() => {
                    const l = (cropDraft.x / canvasSize.w) * displaySize.w;
                    const t = (cropDraft.y / canvasSize.h) * displaySize.h;
                    const w = (cropDraft.w / canvasSize.w) * displaySize.w;
                    const h = (cropDraft.h / canvasSize.h) * displaySize.h;
                    const corner =
                      "pointer-events-none absolute h-5 w-5 rounded-sm border-2 border-primary bg-white shadow-lg";
                    return (
                      <>
                        {/* Dim outside area */}
                        <div
                          className="pointer-events-none absolute inset-0"
                          style={{
                            boxShadow: `0 0 0 9999px rgba(0,0,0,0.55) inset`,
                            clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l}px ${t}px, ${l}px ${t + h}px, ${l + w}px ${t + h}px, ${l + w}px ${t}px, ${l}px ${t}px)`,
                          }}
                        />
                        <div
                          className="pointer-events-none absolute border-2 border-primary shadow-[0_0_0_1px_rgba(255,255,255,0.5)]"
                          style={{ left: l, top: t, width: w, height: h }}
                        >
                          {/* Grid lines */}
                          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-40">
                            {Array.from({ length: 9 }).map((_, i) => (
                              <div key={i} className="border border-white/40" />
                            ))}
                          </div>
                        </div>
                        <div className={corner} style={{ left: l - 10, top: t - 10 }} />
                        <div className={corner} style={{ left: l + w - 10, top: t - 10 }} />
                        <div className={corner} style={{ left: l - 10, top: t + h - 10 }} />
                        <div className={corner} style={{ left: l + w - 10, top: t + h - 10 }} />
                      </>
                    );
                  })()}
                {cropDraft && cropDraft.w >= 20 && cropDraft.h >= 20 && (
                  <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCropDraft(null)}
                      className="flex h-9 items-center gap-1 rounded-full bg-neutral-900/95 px-3 text-xs font-semibold text-white shadow border border-white/10 hover:bg-neutral-800"
                    >
                      <X className="h-3.5 w-3.5" /> Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        applyCrop(cropDraft);
                        setCropDraft(null);
                        setTool("select");
                      }}
                      className="flex h-9 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground shadow hover:brightness-110"
                    >
                      <Check className="h-3.5 w-3.5" /> Apply crop
                    </button>
                  </div>
                )}

                {/* Polyline placement hint */}
                {tool === "polyline" && (
                  <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                    <div className="rounded-full bg-black/70 px-3 py-1 text-[11px] font-medium text-white shadow">
                      {polyDraft
                        ? `Tap to add · Tap a point to label · Double-tap to finish (${polyDraft.points.length})`
                        : "Tap on the photo to place the first point"}
                    </div>
                  </div>
                )}

                {/* Precision magnifier loupe – polyline & measure */}
                {(tool === "polyline" || tool === "measure") && polyHover && canvasRef.current && (
                  <PolyLoupe
                    sourceCanvas={canvasRef.current}
                    point={polyHover}
                    canvasSize={canvasSize}
                    displaySize={displaySize}
                  />
                )}

                {selectionBox && tool === "select" && (
                  <div
                    className="pointer-events-none absolute border border-primary/80 border-dashed"
                    style={{
                      left: (selectionBox.x / canvasSize.w) * displaySize.w - 3,
                      top: (selectionBox.y / canvasSize.h) * displaySize.h - 3,
                      width: (selectionBox.w / canvasSize.w) * displaySize.w + 6,
                      height: (selectionBox.h / canvasSize.h) * displaySize.h + 6,
                    }}
                  />
                )}

                {selectionHandles.map((h, i) => {
                  const css = toCss(h.pos);
                  return (
                    <div
                      key={`${h.kind}-${i}`}
                      className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-primary bg-white shadow"
                      style={{ left: css.left, top: css.top }}
                    />
                  );
                })}

                {/* Per-element floating actions */}
                {selected && selectionBox && tool === "select" && (
                  <div
                    className="absolute z-20 flex items-center gap-0.5 rounded-full border border-white/10 bg-neutral-900/95 px-1 py-0.5 shadow-lg backdrop-blur"
                    style={{
                      left: Math.max(
                        4,
                        Math.min(
                          ((selectionBox.x + selectionBox.w) / canvasSize.w) * displaySize.w - 4,
                          Math.max(0, displaySize.w - 180),
                        ),
                      ),
                      top: Math.max(4, (selectionBox.y / canvasSize.h) * displaySize.h - 40),
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {selected.kind === "text" ? (
                      <button
                        type="button"
                        onClick={() => startEditText(selected as Shape)}
                        className="flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-white hover:bg-white/10"
                      >
                        <Type className="h-3.5 w-3.5" />
                        Edit
                      </button>
                    ) : selected.kind !== "sticker" ? (
                      <button
                        type="button"
                        onClick={addLabelToSelected}
                        className="flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-white hover:bg-white/10"
                      >
                        <Type className="h-3.5 w-3.5" />
                        Label
                      </button>
                    ) : null}
                    {selected.kind === "measure" && (
                      <button
                        type="button"
                        onClick={() =>
                          setCalibrate({ shapeId: selected.id, value: "", unit: "in" })
                        }
                        className="flex h-8 items-center gap-1 rounded-full bg-primary/20 px-2.5 text-xs text-primary hover:bg-primary/30"
                        title="Set the real-world length of this segment to calibrate the scale"
                      >
                        <Ruler className="h-3.5 w-3.5" />
                        Calibrate
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={copySelected}
                      className="flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-white hover:bg-white/10"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={deleteSelected}
                      className="flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-red-400 hover:bg-red-500/15"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                )}

                {textPrompt && (
                  <div
                    className="absolute z-30 rounded-lg border border-white/10 bg-neutral-900/95 p-2 shadow-xl backdrop-blur"
                    style={{
                      left: Math.max(
                        4,
                        Math.min(
                          (textPrompt.pos.x / canvasSize.w) * displaySize.w + 8,
                          Math.max(0, displaySize.w - 300),
                        ),
                      ),
                      top: Math.max(
                        4,
                        Math.min(
                          (textPrompt.pos.y / canvasSize.h) * displaySize.h + 8,
                          Math.max(0, displaySize.h - 130),
                        ),
                      ),
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div className="mb-1.5 flex gap-1">
                      {(["plain", "imperial", "metric"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setTextMode(m)}
                          className={cn(
                            "h-7 flex-1 rounded-lg px-2 text-[11px] font-semibold capitalize transition",
                            textMode === m
                              ? "bg-primary text-primary-foreground"
                              : "bg-white/10 text-white/70 hover:bg-white/15",
                          )}
                        >
                          {m === "plain" ? "Text" : m === "imperial" ? "Imperial" : "Metric"}
                        </button>
                      ))}
                    </div>
                    <Input
                      autoFocus
                      value={textPrompt.value}
                      onChange={(e) => setTextPrompt({ ...textPrompt, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitText();
                        if (e.key === "Escape") setTextPrompt(null);
                      }}
                      inputMode={textMode === "plain" ? "text" : "decimal"}
                      placeholder={
                        textMode === "plain"
                          ? "Type label…"
                          : textMode === "imperial"
                            ? "e.g. 12.5"
                            : "e.g. 3.8"
                      }
                      className="h-9 w-64 text-sm bg-neutral-800 border-white/10 text-white placeholder:text-white/40"
                    />
                    {textMode !== "plain" && (
                      <div className="mt-1.5 flex gap-1">
                        {(textMode === "imperial"
                          ? [" in", " ft", " yd"]
                          : [" mm", " cm", " m"]
                        ).map((u) => (
                          <button
                            key={u}
                            type="button"
                            onClick={() => appendUnit(u)}
                            className="h-7 flex-1 rounded-lg bg-white/10 px-2 text-[11px] font-semibold text-white/85 transition-colors hover:bg-white/20"
                          >
                            {u.trim()}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-1.5 flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-white hover:bg-white/10"
                        onClick={() => setTextPrompt(null)}
                      >
                        Cancel
                      </Button>
                      <Button size="sm" className="h-8 px-3" onClick={commitText}>
                        {textPrompt.editingId ? "Update" : "Add"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Measurement calibration prompt */}
                {calibrate &&
                  (() => {
                    const shape = shapes.find((s) => s.id === calibrate.shapeId);
                    if (!shape || shape.kind !== "measure") return null;
                    const pxLen = dist(shape.from, shape.to);
                    const mid = {
                      x: (shape.from.x + shape.to.x) / 2,
                      y: (shape.from.y + shape.to.y) / 2,
                    };
                    const commit = () => {
                      const v = parseFloat(calibrate.value);
                      if (!Number.isFinite(v) || v <= 0) {
                        setCalibrate(null);
                        return;
                      }
                      let inches = v;
                      if (calibrate.unit === "ft") inches = v * 12;
                      if (calibrate.unit === "cm") inches = v / 2.54;
                      if (calibrate.unit === "m") inches = (v * 100) / 2.54;
                      setPxPerInch(pxLen / inches);
                      setCalibrate(null);
                      toast.success("Scale calibrated - all measurements updated");
                    };
                    return (
                      <div
                        className="absolute z-30 rounded-lg border border-white/10 bg-neutral-900/95 p-2 shadow-xl backdrop-blur"
                        style={{
                          left: Math.max(
                            4,
                            Math.min(
                              (mid.x / canvasSize.w) * displaySize.w - 130,
                              Math.max(0, displaySize.w - 280),
                            ),
                          ),
                          top: Math.max(
                            4,
                            Math.min(
                              (mid.y / canvasSize.h) * displaySize.h + 8,
                              Math.max(0, displaySize.h - 130),
                            ),
                          ),
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <div className="mb-1.5 text-[11px] text-white/70">
                          Enter this segment's real length to calibrate scale
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Input
                            autoFocus
                            value={calibrate.value}
                            onChange={(e) => setCalibrate({ ...calibrate, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commit();
                              if (e.key === "Escape") setCalibrate(null);
                            }}
                            inputMode="decimal"
                            placeholder="Length"
                            className="h-9 w-24 text-sm bg-neutral-800 border-white/10 text-white placeholder:text-white/40"
                          />
                          <div className="flex gap-0.5 rounded-lg bg-white/10 p-0.5">
                            {(["in", "ft", "cm", "m"] as const).map((u) => (
                              <button
                                key={u}
                                type="button"
                                onClick={() => setCalibrate({ ...calibrate, unit: u })}
                                className={cn(
                                  "h-7 rounded px-2 text-[11px] font-semibold transition",
                                  calibrate.unit === u
                                    ? "bg-primary text-primary-foreground"
                                    : "text-white/70 hover:bg-white/10",
                                )}
                              >
                                {u}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-white hover:bg-white/10"
                            onClick={() => setCalibrate(null)}
                          >
                            Cancel
                          </Button>
                          <Button size="sm" className="h-8 px-3" onClick={commit}>
                            Set scale
                          </Button>
                        </div>
                      </div>
                    );
                  })()}

                {/* Measure tool hint */}
                {tool === "measure" && !draft && (
                  <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                    <div className="rounded-full bg-primary/90 px-3 py-1 text-[11px] font-medium text-primary-foreground shadow">
                      {pxPerInch
                        ? "Tap and drag to measure"
                        : "Tap and drag · then tap Calibrate on the line to set scale"}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Right vertical toolbar - premium glass panel, grouped */}
            <div className="pointer-events-none absolute inset-y-0 right-0 z-20 flex items-center pr-2 sm:pr-3">
              <div className="pointer-events-auto flex max-h-[calc(100dvh-100px)] w-[68px] flex-col items-stretch gap-3 overflow-y-auto rounded-[26px] border border-white/10 bg-gradient-to-b from-white/[0.09] to-white/[0.04] px-2 py-3 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden animate-in fade-in slide-in-from-right-2 duration-200">
                {/* History group - pinned at top for prominence */}
                <ToolGroup label="History">
                  <ToolBtn label="Undo" disabled={!pastRef.current.length} onClick={undo}>
                    <Undo2 className="h-5 w-5" />
                  </ToolBtn>
                  <ToolBtn label="Redo" disabled={!futureRef.current.length} onClick={redo}>
                    <Redo2 className="h-5 w-5" />
                  </ToolBtn>
                </ToolGroup>

                {/* Draw group */}
                <ToolGroup label="Draw">
                  {tools
                    .filter((t) => ["pen", "polyline", "arrow", "measure"].includes(t.key))
                    .map((t) => {
                      const Icon = t.icon;
                      return (
                        <ToolBtn
                          key={t.key}
                          label={t.label}
                          active={tool === t.key}
                          activeColor={color}
                          onClick={() => {
                            setTool(t.key);
                            setSelectedId(null);
                            setDraft(null);
                            setPolyDraft(null);
                          }}
                        >
                          <Icon className="h-5 w-5" />
                        </ToolBtn>
                      );
                    })}
                </ToolGroup>

                {/* Shapes group */}
                <ToolGroup label="Shapes">
                  {tools
                    .filter((t) => ["ellipse", "rect"].includes(t.key))
                    .map((t) => {
                      const Icon = t.icon;
                      return (
                        <ToolBtn
                          key={t.key}
                          label={t.label}
                          active={tool === t.key}
                          activeColor={color}
                          onClick={() => {
                            setTool(t.key);
                            setSelectedId(null);
                            setDraft(null);
                            setPolyDraft(null);
                          }}
                        >
                          <Icon className="h-5 w-5" />
                        </ToolBtn>
                      );
                    })}
                </ToolGroup>

                {/* Text & stickers */}
                <ToolGroup label="Mark">
                  {tools
                    .filter((t) => ["text", "timestamp"].includes(t.key))
                    .map((t) => {
                      const Icon = t.icon;
                      return (
                        <ToolBtn
                          key={t.key}
                          label={t.label}
                          active={tool === t.key}
                          activeColor={color}
                          onClick={() => {
                            setTool(t.key);
                            setSelectedId(null);
                            setDraft(null);
                            setPolyDraft(null);
                          }}
                        >
                          <Icon className="h-5 w-5" />
                        </ToolBtn>
                      );
                    })}

                  {/* Sticker picker */}
                  <Popover
                    modal={false}
                    open={stickerPickerOpen}
                    onOpenChange={(o) => {
                      setStickerPickerOpen(o);
                      if (o) {
                        setTool("sticker");
                        setSelectedId(null);
                        setDraft(null);
                        setPolyDraft(null);
                      }
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        title="Stickers"
                        aria-label="Stickers"
                        className={cn(
                          "group relative mx-auto flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200 will-change-transform",
                          tool === "sticker"
                            ? "scale-105 bg-primary text-primary-foreground shadow-[0_8px_24px_-6px_rgba(59,130,246,0.55)]"
                            : "text-white/85 hover:scale-105 hover:bg-white/10",
                        )}
                      >
                        <Smile className="h-5 w-5" />
                        <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 rounded-full bg-neutral-900/90 px-0.5 text-[11px] leading-none shadow">
                          {stickerGlyph}
                        </span>
                        <span className="pointer-events-none absolute right-full mr-3 whitespace-nowrap rounded-lg bg-neutral-900/95 px-2.5 py-1.5 text-[11px] font-semibold text-white opacity-0 shadow-xl ring-1 ring-white/10 transition-opacity duration-150 group-hover:opacity-100">
                          Stickers
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="left"
                      align="center"
                      sideOffset={12}
                      onOpenAutoFocus={(e) => e.preventDefault()}
                      className="z-[140] w-72 p-2 bg-neutral-900 border-white/10 text-white"
                    >
                      <div className="mb-1 px-1 text-xs text-white/60">
                        Pick a sticker, then tap the photo.
                      </div>
                      <div className="max-h-80 overflow-y-auto space-y-2">
                        {STICKER_GROUPS.map((g) => (
                          <div key={g.label}>
                            <div className="px-1 py-1 text-[11px] font-medium uppercase tracking-wide text-white/50">
                              {g.label}
                            </div>
                            <div className="grid grid-cols-6 gap-1">
                              {g.glyphs.map((glyph) => (
                                <button
                                  key={glyph}
                                  type="button"
                                  onClick={() => {
                                    setStickerGlyph(glyph);
                                    setTool("sticker");
                                    setStickerPickerOpen(false);
                                  }}
                                  className={cn(
                                    "flex h-9 w-9 items-center justify-center rounded-lg border text-xl leading-none transition",
                                    stickerGlyph === glyph
                                      ? "border-primary bg-primary/20"
                                      : "border-white/10 bg-neutral-800 hover:bg-neutral-700",
                                  )}
                                  title={glyph}
                                >
                                  {glyph}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </ToolGroup>

                {/* Style / adjust group */}
                <ToolGroup label="Style">
                  {/* Color + thickness picker */}
                  <Popover modal={false} open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        title="Color & thickness"
                        aria-label="Color & thickness"
                        className="group relative mx-auto flex h-11 w-11 items-center justify-center rounded-2xl text-white/85 transition-all duration-200 hover:scale-105 hover:bg-white/10"
                      >
                        <Palette className="h-5 w-5" />
                        <span
                          className="pointer-events-none absolute bottom-1 right-1 h-3 w-3 rounded-full border-2 border-white/80 shadow-md"
                          style={{ backgroundColor: color }}
                        />
                        <span className="pointer-events-none absolute right-full mr-3 whitespace-nowrap rounded-lg bg-neutral-900/95 px-2.5 py-1.5 text-[11px] font-semibold text-white opacity-0 shadow-xl ring-1 ring-white/10 transition-opacity duration-150 group-hover:opacity-100">
                          Color · {width}px
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="left"
                      align="center"
                      sideOffset={12}
                      onOpenAutoFocus={(e) => e.preventDefault()}
                      className="z-[140] w-64 bg-neutral-900 border-white/10 text-white p-3"
                    >
                      <div className="mb-2 text-xs text-white/60">Pick a color</div>
                      <div className="grid grid-cols-7 gap-1.5">
                        {COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => updateSelectedColor(c)}
                            aria-label={`Color ${c}`}
                            className={cn(
                              "h-7 w-7 rounded-full border-2 transition",
                              color === c
                                ? "border-white scale-110 ring-2 ring-white/40"
                                : "border-white/20 hover:border-white/60",
                            )}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="color"
                          value={color}
                          onChange={(e) => updateSelectedColor(e.target.value)}
                          className="h-9 w-14 cursor-pointer rounded bg-transparent"
                          aria-label="Color wheel"
                        />
                        <div className="flex-1 text-[11px] text-white/60">Full color wheel</div>
                      </div>
                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-white/60">
                          <span>Thickness</span>
                          <span className="tabular-nums">{width}px</span>
                        </div>
                        <Slider
                          value={[width]}
                          min={2}
                          max={40}
                          step={1}
                          onValueChange={(v) => updateSelectedWidth(v[0])}
                        />
                        <div className="mt-2 flex justify-between gap-1">
                          {[4, 8, 14, 22, 32].map((w) => (
                            <button
                              key={w}
                              type="button"
                              onClick={() => updateSelectedWidth(w)}
                              className={cn(
                                "flex-1 rounded-lg py-1 text-[11px] font-semibold transition-colors",
                                width === w
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-white/10 text-white/70 hover:bg-white/15",
                              )}
                            >
                              {w}
                            </button>
                          ))}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Popover modal={false} open={adjustOpen} onOpenChange={setAdjustOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        title="Adjust image"
                        aria-label="Adjust image"
                        className="group relative mx-auto flex h-11 w-11 items-center justify-center rounded-2xl text-white/85 transition-all duration-200 hover:scale-105 hover:bg-white/10"
                      >
                        <Sliders className="h-5 w-5" />
                        <span className="pointer-events-none absolute right-full mr-3 whitespace-nowrap rounded-lg bg-neutral-900/95 px-2.5 py-1.5 text-[11px] font-semibold text-white opacity-0 shadow-xl ring-1 ring-white/10 transition-opacity duration-150 group-hover:opacity-100">
                          Adjust
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="left"
                      align="center"
                      sideOffset={12}
                      onOpenAutoFocus={(e) => e.preventDefault()}
                      className="z-[140] w-64 bg-neutral-900 border-white/10 text-white p-3 space-y-3"
                    >
                      <AdjustRow label="Brightness" value={brightness} onChange={setBrightness} />
                      <AdjustRow label="Contrast" value={contrast} onChange={setContrast} />
                      <AdjustRow label="Saturation" value={saturation} onChange={setSaturation} />
                      <button
                        type="button"
                        onClick={() => {
                          setBrightness(100);
                          setContrast(100);
                          setSaturation(100);
                        }}
                        className="w-full rounded-lg bg-white/10 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/15"
                      >
                        Reset
                      </button>
                    </PopoverContent>
                  </Popover>

                  <ToolBtn label="Rotate 90°" onClick={doRotate}>
                    <RotateCw className="h-5 w-5" />
                  </ToolBtn>
                  <ToolBtn
                    label="Crop"
                    active={tool === "crop"}
                    onClick={() => {
                      setTool("crop");
                      setSelectedId(null);
                      setDraft(null);
                      setPolyDraft(null);
                    }}
                  >
                    <CropOverlapIcon className="h-5 w-5" />
                  </ToolBtn>
                </ToolGroup>

                {/* Actions */}
                <ToolGroup label="Actions">
                  <ToolBtn label="Clear all" disabled={!shapes.length} onClick={clearAll} danger>
                    <Trash2 className="h-5 w-5" />
                  </ToolBtn>
                </ToolGroup>

                {/* Done - mini save button pinned at the bottom of the panel */}
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !imgReady}
                  className="group relative mx-auto mt-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_10px_28px_-8px_rgba(59,130,246,0.7)] transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50"
                  aria-label="Done"
                  title="Done"
                >
                  {saving ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Check className="h-5 w-5" strokeWidth={3} />
                  )}
                  <span className="pointer-events-none absolute right-full mr-3 whitespace-nowrap rounded-lg bg-neutral-900/95 px-2.5 py-1.5 text-[11px] font-semibold text-white opacity-0 shadow-xl ring-1 ring-white/10 transition-opacity duration-150 group-hover:opacity-100">
                    Done & Save
                  </span>
                </button>
              </div>
            </div>

            {/* Polyline finish button */}
            {polyDraft && polyDraft.points.length >= 2 && (
              <button
                type="button"
                onClick={finishPolyline}
                className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg"
              >
                Finish line ({polyDraft.points.length} pts)
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Small helpers ----------
function ToolGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-stretch gap-1">
      <div className="px-1 text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-white/40">
        {label}
      </div>
      <div className="flex flex-col items-stretch gap-1">{children}</div>
    </div>
  );
}

function ToolBtn({
  children,
  label,
  active,
  disabled,
  danger,
  activeColor,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** When provided and `active`, tints the active pill with the user's current draw color. */
  activeColor?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={active && activeColor ? { boxShadow: `0 8px 24px -6px ${activeColor}80` } : undefined}
      className={cn(
        "group relative mx-auto flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200 will-change-transform",
        active
          ? "scale-105 bg-primary text-primary-foreground"
          : danger
            ? "text-red-300 hover:scale-105 hover:bg-red-500/15"
            : "text-white/85 hover:scale-105 hover:bg-white/10 active:bg-white/15",
        disabled && "pointer-events-none opacity-30",
      )}
    >
      {children}
      {active && activeColor && (
        <span
          className="pointer-events-none absolute -bottom-0.5 left-1/2 h-1 w-5 -translate-x-1/2 rounded-full"
          style={{ backgroundColor: activeColor }}
        />
      )}
      <span className="pointer-events-none absolute right-full mr-3 z-10 whitespace-nowrap rounded-lg bg-neutral-900/95 px-2.5 py-1.5 text-[11px] font-semibold text-white opacity-0 shadow-xl ring-1 ring-white/10 transition-opacity duration-150 group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}

function AdjustRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-white/60">
        <span>{label}</span>
        <span className="tabular-nums">{value}%</span>
      </div>
      <Slider value={[value]} min={0} max={200} step={1} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}

// ---------- Geometry + drawing helpers ----------
function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getBoundingBox(
  s: Shape,
  textWidth?: number,
): { x: number; y: number; w: number; h: number } {
  if (s.kind === "pen" || s.kind === "polyline") {
    const xs = s.points.map((p) => p.x),
      ys = s.points.map((p) => p.y);
    const x = Math.min(...xs),
      y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (s.kind === "text") {
    const w = textWidth ?? Math.max(40, s.text.length * s.size * 0.55);
    return { x: s.pos.x, y: s.pos.y, w, h: s.size * 1.2 };
  }
  if (s.kind === "sticker") {
    return { x: s.pos.x, y: s.pos.y, w: s.size, h: s.size };
  }
  const x = Math.min(s.from.x, s.to.x);
  const y = Math.min(s.from.y, s.to.y);
  return { x, y, w: Math.abs(s.to.x - s.from.x), h: Math.abs(s.to.y - s.from.y) };
}

function getHandles(
  s: Shape,
  textWidth?: number,
): { kind: HandleHit["kind"]; pos: Point; index?: number }[] {
  if (s.kind === "arrow" || s.kind === "measure") {
    return [
      { kind: "from", pos: s.from },
      { kind: "to", pos: s.to },
    ];
  }
  if (s.kind === "polyline") {
    return s.points.map((p, i) => ({ kind: "vertex" as const, pos: p, index: i }));
  }
  if (s.kind === "rect" || s.kind === "ellipse") {
    const b = getBoundingBox(s);
    return [
      { kind: "tl", pos: { x: b.x, y: b.y } },
      { kind: "tr", pos: { x: b.x + b.w, y: b.y } },
      { kind: "bl", pos: { x: b.x, y: b.y + b.h } },
      { kind: "br", pos: { x: b.x + b.w, y: b.y + b.h } },
    ];
  }
  if (s.kind === "text") {
    const b = getBoundingBox(s, textWidth);
    return [{ kind: "br", pos: { x: b.x + b.w, y: b.y + b.h } }];
  }
  if (s.kind === "sticker") {
    const b = getBoundingBox(s);
    return [{ kind: "br", pos: { x: b.x + b.w, y: b.y + b.h } }];
  }
  return [];
}

function shapeContains(s: Shape, p: Point, tol: number, textWidth?: number): boolean {
  if (s.kind === "pen") return s.points.some((q) => dist(q, p) <= tol);
  if (s.kind === "polyline") {
    for (let i = 0; i < s.points.length - 1; i++) {
      if (pointToSegmentDist(p, s.points[i], s.points[i + 1]) <= tol) return true;
    }
    return false;
  }
  if (s.kind === "text" || s.kind === "sticker") {
    const b = getBoundingBox(s, textWidth);
    return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
  }
  if (s.kind === "arrow" || s.kind === "measure") return pointToSegmentDist(p, s.from, s.to) <= tol;
  if (s.kind === "rect" || s.kind === "ellipse") {
    const b = getBoundingBox(s);
    return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
  }
  return false;
}

function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

function translateShape(s: Shape, dx: number, dy: number): Shape {
  return mapShapePoints(s, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

function mapShapePoints(s: Shape, f: (p: Point) => Point): Shape {
  if (s.kind === "pen" || s.kind === "polyline") return { ...s, points: s.points.map(f) };
  if (s.kind === "text" || s.kind === "sticker") return { ...s, pos: f(s.pos) };
  return { ...s, from: f(s.from), to: f(s.to) };
}

function transformShape(
  orig: Shape,
  handle: HandleHit,
  dx: number,
  dy: number,
  pointer: Point,
): Shape {
  if (handle.kind === "body") return translateShape(orig, dx, dy);
  if (orig.kind === "polyline" && handle.kind === "vertex") {
    const idx = handle.index;
    return { ...orig, points: orig.points.map((p, i) => (i === idx ? pointer : p)) };
  }
  if (orig.kind === "text" && handle.kind === "br") {
    const newH = Math.max(12, pointer.y - orig.pos.y);
    return { ...orig, size: Math.round(newH / 1.2) };
  }
  if (orig.kind === "sticker" && handle.kind === "br") {
    const newSize = Math.max(16, Math.max(pointer.x - orig.pos.x, pointer.y - orig.pos.y));
    return { ...orig, size: Math.round(newSize) };
  }
  if (
    (orig.kind === "arrow" || orig.kind === "measure") &&
    (handle.kind === "from" || handle.kind === "to")
  ) {
    return { ...orig, [handle.kind]: pointer } as Shape;
  }
  if (orig.kind === "rect" || orig.kind === "ellipse") {
    const b = getBoundingBox(orig);
    let x1 = b.x,
      y1 = b.y,
      x2 = b.x + b.w,
      y2 = b.y + b.h;
    if (handle.kind === "tl") {
      x1 = pointer.x;
      y1 = pointer.y;
    }
    if (handle.kind === "tr") {
      x2 = pointer.x;
      y1 = pointer.y;
    }
    if (handle.kind === "bl") {
      x1 = pointer.x;
      y2 = pointer.y;
    }
    if (handle.kind === "br") {
      x2 = pointer.x;
      y2 = pointer.y;
    }
    return { ...orig, from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
  }
  return orig;
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  s: Shape,
  pxPerInch: number = 96,
  canvasSize?: { w: number; h: number },
) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.kind !== "sticker") ctx.strokeStyle = (s as any).color;
  if (s.kind !== "text" && s.kind !== "sticker") ctx.lineWidth = (s as any).width;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 2;

  if (s.kind === "pen") {
    ctx.beginPath();
    s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  } else if (s.kind === "polyline") {
    ctx.beginPath();
    s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    // Large, high-contrast vertex dots for precision placement
    const r = Math.max(8, s.width * 1.4);
    s.points.forEach((p, i) => {
      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = s.color;
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (i === 0) {
        ctx.beginPath();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  } else if (s.kind === "rect") {
    ctx.beginPath();
    ctx.rect(s.from.x, s.from.y, s.to.x - s.from.x, s.to.y - s.from.y);
    ctx.stroke();
  } else if (s.kind === "ellipse") {
    const cx = (s.from.x + s.to.x) / 2;
    const cy = (s.from.y + s.to.y) / 2;
    const rx = Math.abs(s.to.x - s.from.x) / 2;
    const ry = Math.abs(s.to.y - s.from.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.kind === "arrow") {
    drawTaperedArrow(ctx, s.from, s.to, s.width, s.color);
  } else if (s.kind === "measure") {
    drawMeasure(ctx, s.from, s.to, s.width, s.color, pxPerInch, canvasSize);
  } else if (s.kind === "text") {
    ctx.shadowBlur = 4;
    ctx.font = `600 ${s.size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillStyle = s.color;
    ctx.lineWidth = Math.max(2, s.size / 14);
    ctx.strokeStyle = readableOutline(s.color);
    ctx.strokeText(s.text, s.pos.x, s.pos.y);
    ctx.fillText(s.text, s.pos.x, s.pos.y);
  } else if (s.kind === "sticker") {
    ctx.shadowBlur = 6;
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.font = `${s.size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(s.glyph, s.pos.x, s.pos.y);
  }
  ctx.restore();
}

/** Tapered arrow: starts skinny at `from`, grows to `width` at `to`, with filled arrowhead. */
function drawTaperedArrow(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  width: number,
  color: string,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const angle = Math.atan2(dy, dx);
  const startW = Math.max(1, width * 0.25);
  const endW = Math.max(2, width);
  const headLen = Math.max(12, width * 3.5);
  const shaftLen = Math.max(0, len - headLen);
  // Shaft as filled quad tapering from startW to endW.
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const sx = from.x,
    sy = from.y;
  const ex = from.x + Math.cos(angle) * shaftLen;
  const ey = from.y + Math.sin(angle) * shaftLen;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(sx + (nx * startW) / 2, sy + (ny * startW) / 2);
  ctx.lineTo(ex + (nx * endW) / 2, ey + (ny * endW) / 2);
  ctx.lineTo(ex - (nx * endW) / 2, ey - (ny * endW) / 2);
  ctx.lineTo(sx - (nx * startW) / 2, sy - (ny * startW) / 2);
  ctx.closePath();
  ctx.fill();
  // Arrowhead
  const headBaseW = endW * 2.2;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(ex + (nx * headBaseW) / 2, ey + (ny * headBaseW) / 2);
  ctx.lineTo(ex - (nx * headBaseW) / 2, ey - (ny * headBaseW) / 2);
  ctx.closePath();
  ctx.fill();
}

function readableOutline(color: string) {
  if (color === "#ffffff" || color === "#f59e0b" || color === "#10b981" || color === "#eab308")
    return "rgba(0,0,0,0.85)";
  return "rgba(255,255,255,0.9)";
}

/** Format pixel length as dual-unit string, e.g. `2' 6" · 76 cm`. */
export function formatMeasure(px: number, pxPerInch: number): string {
  const inches = px / Math.max(1, pxPerInch);
  const totalIn = inches;
  const feet = Math.floor(totalIn / 12);
  const remIn = totalIn - feet * 12;
  const imp =
    feet > 0
      ? `${feet}' ${remIn.toFixed(remIn >= 10 ? 0 : 1)}"`
      : `${totalIn.toFixed(totalIn >= 10 ? 0 : 1)}"`;
  const cm = inches * 2.54;
  const met = cm >= 100 ? `${(cm / 100).toFixed(2)} m` : `${cm.toFixed(1)} cm`;
  return `${imp}  ·  ${met}`;
}

/** Draw a measurement line: tick marks at each end + dual-unit label above midpoint. */
function drawMeasure(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  width: number,
  color: string,
  pxPerInch: number,
  canvasSize?: { w: number; h: number },
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const angle = Math.atan2(dy, dx);
  // Bold, highly visible line - techs need to see this clearly at a distance.
  const w = Math.max(8, width);

  // White halo behind the main stroke for contrast on any background
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = w + 4;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  // Main line
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  // Perpendicular end caps
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const capLen = Math.max(14, w * 3);
  const cap = (p: Point) => {
    ctx.beginPath();
    ctx.moveTo(p.x + nx * capLen, p.y + ny * capLen);
    ctx.lineTo(p.x - nx * capLen, p.y - ny * capLen);
    ctx.stroke();
  };
  cap(from);
  cap(to);
  // Label - large, bold, easy to read at a glance
  const label = formatMeasure(len, pxPerInch);
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const shortSide = canvasSize ? Math.min(canvasSize.w, canvasSize.h) : 800;
  const fontSize = Math.max(32, Math.round(shortSide / 22), w * 3);

  ctx.save();
  ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const padX = fontSize * 0.5;
  const padY = fontSize * 0.28;
  const m = ctx.measureText(label);
  const bw = m.width + padX * 2;
  const bh = fontSize + padY * 2;
  // Position label offset perpendicular from the line
  const offset = capLen + bh * 0.8;
  const lx = mx + nx * offset;
  const ly = my + ny * offset;
  ctx.translate(lx, ly);
  // Keep label upright
  let rot = angle;
  if (rot > Math.PI / 2) rot -= Math.PI;
  if (rot < -Math.PI / 2) rot += Math.PI;
  ctx.rotate(rot);
  // Chip background
  ctx.shadowBlur = 4;
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.fillStyle = "rgba(15,23,42,0.92)";
  const r = bh / 2;
  ctx.beginPath();
  ctx.moveTo(-bw / 2 + r, -bh / 2);
  ctx.lineTo(bw / 2 - r, -bh / 2);
  ctx.arcTo(bw / 2, -bh / 2, bw / 2, -bh / 2 + r, r);
  ctx.lineTo(bw / 2, bh / 2 - r);
  ctx.arcTo(bw / 2, bh / 2, bw / 2 - r, bh / 2, r);
  ctx.lineTo(-bw / 2 + r, bh / 2);
  ctx.arcTo(-bw / 2, bh / 2, -bw / 2, bh / 2 - r, r);
  ctx.lineTo(-bw / 2, -bh / 2 + r);
  ctx.arcTo(-bw / 2, -bh / 2, -bw / 2 + r, -bh / 2, r);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, 0, 1);
  ctx.restore();
}

// Polyline magnifier loupe – shows a zoomed-in region for precision point placement
function PolyLoupe({
  sourceCanvas,
  point,
  canvasSize,
  displaySize,
}: {
  sourceCanvas: HTMLCanvasElement;
  point: Point;
  canvasSize: { w: number; h: number };
  displaySize: { w: number; h: number };
}) {
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const SIZE = 140;
  const ZOOM = 3;
  useEffect(() => {
    const c = loupeRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const sample = SIZE / ZOOM;
    const sx = point.x - sample / 2;
    const sy = point.y - sample / 2;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sourceCanvas, sx, sy, sample, sample, 0, 0, SIZE, SIZE);
    // Crosshair
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(SIZE / 2, SIZE / 2 - 10);
    ctx.lineTo(SIZE / 2, SIZE / 2 + 10);
    ctx.moveTo(SIZE / 2 - 10, SIZE / 2);
    ctx.lineTo(SIZE / 2 + 10, SIZE / 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(59,130,246,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }, [sourceCanvas, point.x, point.y, canvasSize.w, canvasSize.h]);

  // Position loupe near pointer but keep on-screen
  const px = (point.x / canvasSize.w) * displaySize.w;
  const py = (point.y / canvasSize.h) * displaySize.h;
  const offset = 24;
  // Flip to left/above if too close to edges
  const showRight = px + offset + SIZE < displaySize.w;
  const showBelow = py + offset + SIZE < displaySize.h;
  const left = showRight ? px + offset : px - offset - SIZE;
  const top = showBelow ? py + offset : py - offset - SIZE;

  return (
    <div
      className="pointer-events-none absolute rounded-full border-2 border-white/80 shadow-2xl overflow-hidden bg-black"
      style={{
        left: Math.max(4, Math.min(left, displaySize.w - SIZE - 4)),
        top: Math.max(4, Math.min(top, displaySize.h - SIZE - 4)),
        width: SIZE,
        height: SIZE,
      }}
    >
      <canvas ref={loupeRef} width={SIZE} height={SIZE} style={{ width: SIZE, height: SIZE }} />
    </div>
  );
}
