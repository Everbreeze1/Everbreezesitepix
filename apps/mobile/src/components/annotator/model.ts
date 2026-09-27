/**
 * The photo annotator's document and rules, ported from the web annotator
 * (`apps/web/src/features/photos/components/PhotoAnnotator.tsx`).
 *
 * Import-free on purpose: every rule here is arithmetic, and arithmetic is the
 * thing that goes wrong in an annotator. Keeping it pure means the tests import
 * it directly, and it means the phone and the web can be compared number for
 * number.
 *
 * Points are in the working image's own pixels, exactly as on web, where the
 * canvas is the photo's natural size. That is what makes the web's defaults
 * (an 8px stroke, text at a 28th of the height, a sticker at a tenth) mean the
 * same thing here: a mark placed on the phone lands on the saved file the same
 * size it would have if it had been placed in a browser.
 */

export type Point = { x: number; y: number };
export type Size = { w: number; h: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Tool =
  | "select"
  | "pen"
  | "polyline"
  | "arrow"
  | "ellipse"
  | "rect"
  | "text"
  | "timestamp"
  | "sticker"
  | "crop"
  | "measure";

type ShapeBase = { id: string };
export type Shape =
  | (ShapeBase & { kind: "pen"; color: string; width: number; points: Point[] })
  | (ShapeBase & { kind: "polyline"; color: string; width: number; points: Point[] })
  | (ShapeBase & { kind: "arrow"; color: string; width: number; from: Point; to: Point })
  | (ShapeBase & { kind: "rect"; color: string; width: number; from: Point; to: Point })
  | (ShapeBase & { kind: "ellipse"; color: string; width: number; from: Point; to: Point })
  | (ShapeBase & { kind: "measure"; color: string; width: number; from: Point; to: Point })
  | (ShapeBase & { kind: "text"; color: string; size: number; pos: Point; text: string })
  | (ShapeBase & { kind: "sticker"; glyph: string; size: number; pos: Point });

export type SpanShape = Extract<Shape, { from: Point }>;

/** Web's palette, in web's order. Red first: it is what a defect gets. */
export const COLORS = [
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
] as const;

/** Web's defaults: red, 8px, a green tick. */
export const DEFAULT_COLOR = COLORS[0];
export const DEFAULT_WIDTH = 8;
export const WIDTH_MIN = 2;
export const WIDTH_MAX = 40;
export const WIDTH_PRESETS = [4, 8, 14, 22, 32] as const;
export const DEFAULT_STICKER = "✅";

/** Web's sticker groups, glyph for glyph. */
export const STICKER_GROUPS: { label: string; glyphs: string[] }[] = [
  { label: "Status", glyphs: ["✅", "❌", "⚠️", "❗", "❓", "ℹ️", "🛑", "⛔", "🚫", "✔️", "✖️"] },
  { label: "Marks", glyphs: ["⭐", "🔥", "💯", "👍", "👎", "👌", "🙌", "👏", "💪", "🤝"] },
  {
    label: "Trades",
    glyphs: ["🔧", "🔨", "🪛", "🧰", "⚙️", "🪚", "🪜", "🧱", "🧯", "⚡", "💧", "🌡️"],
  },
  { label: "Pins", glyphs: ["📍", "📌", "🚩", "🏁", "🎯", "📷", "🔍", "⏰", "📝", "💡"] },
  { label: "Numbers", glyphs: ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"] },
];

let seq = 0;
export const nextId = () => `s_${Date.now().toString(36)}_${(seq++).toString(36)}`;

// ---------------------------------------------------------------------------
// Sizes, as web computes them
// ---------------------------------------------------------------------------

/** Typed text: a 28th of the height, scaled by the stroke width (web's rule). */
export function textSizeFor(canvas: Size, width: number): number {
  return Math.max(20, Math.round((canvas.h / 28) * (width / 4)));
}

export function timestampSizeFor(canvas: Size): number {
  return Math.max(20, Math.round(canvas.h / 32));
}

export function stickerSizeFor(canvas: Size): number {
  return Math.max(48, Math.round(canvas.h / 10));
}

/** Web never draws a measurement thinner than 8px. */
export function measureWidth(width: number): number {
  return Math.max(width, 8);
}

/** Width of a line of text, estimated as web does when it has not measured one. */
export function textWidth(s: Extract<Shape, { kind: "text" }>): number {
  return Math.max(40, s.text.length * s.size * 0.55);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

export function clampPoint(p: Point, canvas: Size): Point {
  return { x: Math.min(canvas.w, Math.max(0, p.x)), y: Math.min(canvas.h, Math.max(0, p.y)) };
}

export function getBoundingBox(s: Shape): Rect {
  if (s.kind === "pen" || s.kind === "polyline") {
    const xs = s.points.map((p) => p.x);
    const ys = s.points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (s.kind === "text") return { x: s.pos.x, y: s.pos.y, w: textWidth(s), h: s.size * 1.2 };
  if (s.kind === "sticker") return { x: s.pos.x, y: s.pos.y, w: s.size, h: s.size };
  const x = Math.min(s.from.x, s.to.x);
  const y = Math.min(s.from.y, s.to.y);
  return { x, y, w: Math.abs(s.to.x - s.from.x), h: Math.abs(s.to.y - s.from.y) };
}

export type HandleKind = "body" | "from" | "to" | "tl" | "tr" | "bl" | "br" | "vertex";
export type HandleHit = { kind: Exclude<HandleKind, "vertex"> } | { kind: "vertex"; index: number };
export type Handle = { hit: HandleHit; pos: Point };

/** The grab points a selected shape offers, as on web. */
export function getHandles(s: Shape): Handle[] {
  if (s.kind === "arrow" || s.kind === "measure") {
    return [
      { hit: { kind: "from" }, pos: s.from },
      { hit: { kind: "to" }, pos: s.to },
    ];
  }
  if (s.kind === "polyline") {
    return s.points.map((p, index) => ({ hit: { kind: "vertex" as const, index }, pos: p }));
  }
  const b = getBoundingBox(s);
  if (s.kind === "rect" || s.kind === "ellipse") {
    return [
      { hit: { kind: "tl" }, pos: { x: b.x, y: b.y } },
      { hit: { kind: "tr" }, pos: { x: b.x + b.w, y: b.y } },
      { hit: { kind: "bl" }, pos: { x: b.x, y: b.y + b.h } },
      { hit: { kind: "br" }, pos: { x: b.x + b.w, y: b.y + b.h } },
    ];
  }
  if (s.kind === "text" || s.kind === "sticker") {
    return [{ hit: { kind: "br" }, pos: { x: b.x + b.w, y: b.y + b.h } }];
  }
  return [];
}

export function shapeContains(s: Shape, p: Point, tol: number): boolean {
  if (s.kind === "pen") {
    if (s.points.some((q) => dist(q, p) <= tol)) return true;
    for (let i = 0; i < s.points.length - 1; i++) {
      if (pointToSegmentDist(p, s.points[i], s.points[i + 1]) <= tol) return true;
    }
    return false;
  }
  if (s.kind === "polyline") {
    for (let i = 0; i < s.points.length - 1; i++) {
      if (pointToSegmentDist(p, s.points[i], s.points[i + 1]) <= tol) return true;
    }
    return s.points.length === 1 && dist(s.points[0], p) <= tol;
  }
  if (s.kind === "arrow" || s.kind === "measure") return pointToSegmentDist(p, s.from, s.to) <= tol;
  const b = getBoundingBox(s);
  return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
}

/**
 * What a finger landed on: a handle of the selected shape first, then the
 * topmost shape under it. Same order as web, so a handle sitting over another
 * shape still grabs the handle.
 */
export function hitTest(
  shapes: Shape[],
  selected: Shape | null,
  p: Point,
  tol: number,
): { shape: Shape; handle: HandleHit } | null {
  if (selected) {
    for (const h of getHandles(selected)) {
      if (dist(p, h.pos) <= tol) return { shape: selected, handle: h.hit };
    }
  }
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (shapeContains(shapes[i], p, tol)) return { shape: shapes[i], handle: { kind: "body" } };
  }
  return null;
}

export function mapShapePoints(s: Shape, f: (p: Point) => Point): Shape {
  if (s.kind === "pen" || s.kind === "polyline") return { ...s, points: s.points.map(f) };
  if (s.kind === "text" || s.kind === "sticker") return { ...s, pos: f(s.pos) };
  return { ...s, from: f(s.from), to: f(s.to) };
}

export function translateShape(s: Shape, dx: number, dy: number): Shape {
  return mapShapePoints(s, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Drag a handle (or the body) of `orig` by the pointer. Web's rules. */
export function transformShape(
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
    return { ...orig, [handle.kind]: pointer };
  }
  if (orig.kind === "rect" || orig.kind === "ellipse") {
    const b = getBoundingBox(orig);
    let x1 = b.x;
    let y1 = b.y;
    let x2 = b.x + b.w;
    let y2 = b.y + b.h;
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

/** A two-point shape shorter than this is a tap, not a drawing (web: 4px). */
export const MIN_SPAN = 4;

export function isMeaningful(s: Shape): boolean {
  if (s.kind === "arrow" || s.kind === "rect" || s.kind === "ellipse" || s.kind === "measure") {
    return dist(s.from, s.to) >= MIN_SPAN;
  }
  if (s.kind === "pen") return s.points.length >= 1;
  if (s.kind === "polyline") return s.points.length >= 2;
  if (s.kind === "text") return s.text.trim().length > 0;
  return true;
}

// ---------------------------------------------------------------------------
// Rotate and crop
// ---------------------------------------------------------------------------

/** 90 degrees clockwise: the marks follow the photo. `canvas` is the size before. */
export function rotateShapesCW(shapes: Shape[], canvas: Size): Shape[] {
  return shapes.map((s) => mapShapePoints(s, (p) => ({ x: canvas.h - p.y, y: p.x })));
}

export function rotatedSize(canvas: Size): Size {
  return { w: canvas.h, h: canvas.w };
}

/** Normalise a dragged rectangle and clamp it to the image, rounded to whole pixels. */
export function normaliseCrop(r: Rect, canvas: Size): Rect {
  const x1 = Math.max(0, Math.min(r.x, r.x + r.w));
  const y1 = Math.max(0, Math.min(r.y, r.y + r.h));
  const x2 = Math.min(canvas.w, Math.max(r.x, r.x + r.w));
  const y2 = Math.min(canvas.h, Math.max(r.y, r.y + r.h));
  return {
    x: Math.round(x1),
    y: Math.round(y1),
    w: Math.max(0, Math.round(x2 - x1)),
    h: Math.max(0, Math.round(y2 - y1)),
  };
}

/** Web discards a crop smaller than 20px either way. */
export const MIN_CROP = 20;

export function cropShapes(shapes: Shape[], rect: Rect): Shape[] {
  return shapes.map((s) => translateShape(s, -rect.x, -rect.y));
}

/** Drag a crop corner, or sweep a new rectangle from `anchor`. */
export function dragCrop(
  crop: Rect,
  corner: "tl" | "tr" | "bl" | "br" | "new",
  p: Point,
  anchor: Point,
): Rect {
  if (corner === "new") {
    return {
      x: Math.min(anchor.x, p.x),
      y: Math.min(anchor.y, p.y),
      w: Math.abs(p.x - anchor.x),
      h: Math.abs(p.y - anchor.y),
    };
  }
  let x1 = crop.x;
  let y1 = crop.y;
  let x2 = crop.x + crop.w;
  let y2 = crop.y + crop.h;
  if (corner === "tl") {
    x1 = p.x;
    y1 = p.y;
  } else if (corner === "tr") {
    x2 = p.x;
    y1 = p.y;
  } else if (corner === "bl") {
    x1 = p.x;
    y2 = p.y;
  } else {
    x2 = p.x;
    y2 = p.y;
  }
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

export function cropCornerAt(crop: Rect | null, p: Point, tol: number) {
  if (!crop) return null;
  const corners = {
    tl: { x: crop.x, y: crop.y },
    tr: { x: crop.x + crop.w, y: crop.y },
    bl: { x: crop.x, y: crop.y + crop.h },
    br: { x: crop.x + crop.w, y: crop.y + crop.h },
  } as const;
  for (const k of ["tl", "tr", "bl", "br"] as const) {
    if (dist(p, corners[k]) <= tol) return k;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Web's uncalibrated scale: the frame is assumed to be about 60 inches wide
 * (a subject some 4 ft away at a typical field of view). Calibrating any
 * measurement replaces it for every line on the photo.
 */
export function defaultPxPerInch(canvas: Size): number {
  return Math.max(1, canvas.w / 60);
}

export type CalibrationUnit = "in" | "ft" | "cm" | "m";

/** Pixels per inch from a line of `pxLength` that is really `value` `unit` long. */
export function pxPerInchFromCalibration(
  pxLength: number,
  value: number,
  unit: CalibrationUnit,
): number | null {
  if (!Number.isFinite(value) || value <= 0 || !(pxLength > 0)) return null;
  let inches = value;
  if (unit === "ft") inches = value * 12;
  if (unit === "cm") inches = value / 2.54;
  if (unit === "m") inches = (value * 100) / 2.54;
  return pxLength / inches;
}

/** Dual-unit label, identical to web's: `2' 6.0"  ·  76.2 cm`. */
export function formatMeasure(px: number, pxPerInch: number): string {
  const inches = px / Math.max(1, pxPerInch);
  const feet = Math.floor(inches / 12);
  const remIn = inches - feet * 12;
  const imp =
    feet > 0
      ? `${feet}' ${remIn.toFixed(remIn >= 10 ? 0 : 1)}"`
      : `${inches.toFixed(inches >= 10 ? 0 : 1)}"`;
  const cm = inches * 2.54;
  const met = cm >= 100 ? `${(cm / 100).toFixed(2)} m` : `${cm.toFixed(1)} cm`;
  return `${imp}  ·  ${met}`;
}

/**
 * The ruler end under a finger, on any measurement, selected or not: once a
 * line is down both of its ends stay grabbable, so a tech can nudge either one
 * onto the edge it should sit on. The nearest end wins when two are close.
 */
export function measureEndpointAt(
  shapes: Shape[],
  p: Point,
  tol: number,
): { shape: Extract<Shape, { kind: "measure" }>; end: "from" | "to" } | null {
  let best: { shape: Extract<Shape, { kind: "measure" }>; end: "from" | "to" } | null = null;
  let bestD = Infinity;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.kind !== "measure") continue;
    for (const end of ["from", "to"] as const) {
      const d = dist(s[end], p);
      if (d <= tol && d < bestD) {
        best = { shape: s, end };
        bestD = d;
      }
    }
  }
  return best;
}

/** Where web draws a measurement's end caps and label, in image pixels. */
export function measureLayout(from: Point, to: Point, width: number, canvas: Size) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const w = Math.max(8, width);
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const capLen = Math.max(14, w * 3);
  const shortSide = Math.min(canvas.w, canvas.h);
  const fontSize = Math.max(32, Math.round(shortSide / 22), w * 3);
  const padY = fontSize * 0.28;
  const bh = fontSize + padY * 2;
  const offset = capLen + bh * 0.8;
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  // Keep the label upright whichever way the line was drawn.
  let rot = angle;
  if (rot > Math.PI / 2) rot -= Math.PI;
  if (rot < -Math.PI / 2) rot += Math.PI;
  return {
    len,
    w,
    nx,
    ny,
    capLen,
    fontSize,
    padX: fontSize * 0.5,
    bh,
    labelAt: { x: mx + nx * offset, y: my + ny * offset },
    labelRotationDeg: (rot * 180) / Math.PI,
  };
}

// ---------------------------------------------------------------------------
// SVG geometry
// ---------------------------------------------------------------------------

const f2 = (n: number) => n.toFixed(2);

export function polylinePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${f2(p.x)} ${f2(p.y)}`).join(" ");
}

/**
 * Web's tapered arrow as one filled SVG path: a shaft that grows from a
 * quarter of the width at the tail to the full width, and a solid head.
 * Empty when the arrow has no length.
 */
export function taperedArrowPath(from: Point, to: Point, width: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return "";
  const angle = Math.atan2(dy, dx);
  const startW = Math.max(1, width * 0.25);
  const endW = Math.max(2, width);
  const headLen = Math.max(12, width * 3.5);
  const shaftLen = Math.max(0, len - headLen);
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const ex = from.x + Math.cos(angle) * shaftLen;
  const ey = from.y + Math.sin(angle) * shaftLen;
  const headBaseW = endW * 2.2;
  const shaft =
    `M${f2(from.x + (nx * startW) / 2)} ${f2(from.y + (ny * startW) / 2)} ` +
    `L${f2(ex + (nx * endW) / 2)} ${f2(ey + (ny * endW) / 2)} ` +
    `L${f2(ex - (nx * endW) / 2)} ${f2(ey - (ny * endW) / 2)} ` +
    `L${f2(from.x - (nx * startW) / 2)} ${f2(from.y - (ny * startW) / 2)} Z`;
  const head =
    `M${f2(to.x)} ${f2(to.y)} ` +
    `L${f2(ex + (nx * headBaseW) / 2)} ${f2(ey + (ny * headBaseW) / 2)} ` +
    `L${f2(ex - (nx * headBaseW) / 2)} ${f2(ey - (ny * headBaseW) / 2)} Z`;
  return `${shaft} ${head}`;
}

/** Web's text outline: dark behind light colours, light behind the rest. */
export function readableOutline(color: string): string {
  if (color === "#ffffff" || color === "#f59e0b" || color === "#10b981" || color === "#eab308") {
    return "rgba(0,0,0,0.85)";
  }
  return "rgba(255,255,255,0.9)";
}

// ---------------------------------------------------------------------------
// Adjust (brightness, contrast, saturation)
// ---------------------------------------------------------------------------

export type Adjust = { brightness: number; contrast: number; saturation: number };
export const NO_ADJUST: Adjust = { brightness: 100, contrast: 100, saturation: 100 };

export function isAdjusted(a: Adjust): boolean {
  return a.brightness !== 100 || a.contrast !== 100 || a.saturation !== 100;
}

type M = number[]; // 4x5, row major

function compose(a: M, b: M): M {
  // Apply b first, then a.
  const out: number[] = new Array(20).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let v = c === 4 ? a[r * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) v += a[r * 5 + k] * b[k * 5 + c];
      out[r * 5 + c] = v;
    }
  }
  return out;
}

/**
 * One `feColorMatrix` equal to CSS `brightness() contrast() saturate()` in
 * that order, which is the filter web draws the photo with.
 */
export function adjustMatrix(a: Adjust): number[] {
  const b = a.brightness / 100;
  const c = a.contrast / 100;
  const s = a.saturation / 100;
  const bright: M = [b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
  const o = 0.5 * (1 - c);
  const contrast: M = [c, 0, 0, 0, o, 0, c, 0, 0, o, 0, 0, c, 0, o, 0, 0, 0, 1, 0];
  const sat: M = [
    0.213 + 0.787 * s,
    0.715 - 0.715 * s,
    0.072 - 0.072 * s,
    0,
    0,
    0.213 - 0.213 * s,
    0.715 + 0.285 * s,
    0.072 - 0.072 * s,
    0,
    0,
    0.213 - 0.213 * s,
    0.715 - 0.715 * s,
    0.072 + 0.928 * s,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
  return compose(sat, compose(contrast, bright)).map((v) => Math.round(v * 10000) / 10000 || 0);
}

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The stamp text. Web formats with `toLocaleString` (short month, 2-digit day
 * and time); this is the same fields in a fixed en-US shape so it does not
 * depend on the device's Intl data: `Sep 27, 2026, 02:05 PM`.
 */
export function formatStamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = at.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${MONTHS[at.getMonth()]} ${pad(at.getDate())}, ${at.getFullYear()}, ${pad(h12)}:${pad(at.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

/** Capture time when it is a real date, otherwise now. */
export function stampDate(
  capturedAt: string | null | undefined,
  now: () => Date = () => new Date(),
) {
  if (capturedAt) {
    const d = new Date(capturedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return now();
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** The image being annotated. Rotate and crop replace it with a new file. */
export type WorkingImage = { uri: string; w: number; h: number };
export type Snapshot = { shapes: Shape[]; image: WorkingImage };
export type History = { past: Snapshot[]; future: Snapshot[] };

export const EMPTY_HISTORY: History = { past: [], future: [] };
const HISTORY_LIMIT = 100;

/** Record `prev` as undoable before a change. Clears redo, as every editor does. */
export function pushHistory(h: History, prev: Snapshot): History {
  const past = [...h.past, prev];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, future: [] };
}

export function undoHistory(
  h: History,
  current: Snapshot,
): { history: History; snapshot: Snapshot } | null {
  if (h.past.length === 0) return null;
  const snapshot = h.past[h.past.length - 1];
  return { history: { past: h.past.slice(0, -1), future: [...h.future, current] }, snapshot };
}

export function redoHistory(
  h: History,
  current: Snapshot,
): { history: History; snapshot: Snapshot } | null {
  if (h.future.length === 0) return null;
  const snapshot = h.future[h.future.length - 1];
  return { history: { past: [...h.past, current], future: h.future.slice(0, -1) }, snapshot };
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/**
 * The markup as JSON. Web does not store it (the saved result is the flattened
 * JPEG and nothing else), so this exists to round-trip a document in memory
 * and in tests, and it validates what it reads rather than trusting it.
 */
export function serializeShapes(shapes: Shape[]): string {
  return JSON.stringify({ v: 1, shapes });
}

function isPoint(v: unknown): v is Point {
  return (
    !!v &&
    typeof (v as Point).x === "number" &&
    typeof (v as Point).y === "number" &&
    Number.isFinite((v as Point).x) &&
    Number.isFinite((v as Point).y)
  );
}

export function parseShapes(json: string): Shape[] {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return [];
  }
  const list = (doc as { shapes?: unknown })?.shapes;
  if (!Array.isArray(list)) return [];
  return list.filter((s): s is Shape => {
    if (!s || typeof s !== "object" || typeof s.id !== "string") return false;
    switch (s.kind) {
      case "pen":
      case "polyline":
        return Array.isArray(s.points) && s.points.every(isPoint) && typeof s.width === "number";
      case "arrow":
      case "rect":
      case "ellipse":
      case "measure":
        return isPoint(s.from) && isPoint(s.to) && typeof s.width === "number";
      case "text":
        return isPoint(s.pos) && typeof s.text === "string" && typeof s.size === "number";
      case "sticker":
        return isPoint(s.pos) && typeof s.glyph === "string" && typeof s.size === "number";
      default:
        return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

export type Zoom = { scale: number; tx: number; ty: number };
export const NO_ZOOM: Zoom = { scale: 1, tx: 0, ty: 0 };
export const MAX_ZOOM = 6;

/**
 * A point on the stage to a point on the image.
 *
 * The photo is laid out at `display` size centred in `stage`, then scaled
 * about its own centre and translated. This undoes that.
 */
export function stageToImage(
  x: number,
  y: number,
  stage: Size,
  display: Size,
  image: Size,
  zoom: Zoom,
): Point {
  const cx = stage.w / 2 + zoom.tx;
  const cy = stage.h / 2 + zoom.ty;
  const u = (x - cx) / zoom.scale + display.w / 2;
  const v = (y - cy) / zoom.scale + display.h / 2;
  return { x: (u / display.w) * image.w, y: (v / display.h) * image.h };
}

/** The largest box of `aspect` that fits in `area`. */
export function fitSize(area: Size, aspect: number): Size {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
  let w = Math.max(1, area.w);
  let h = w / a;
  if (h > area.h) {
    h = Math.max(1, area.h);
    w = h * a;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

// ---------------------------------------------------------------------------
// The tool rail
// ---------------------------------------------------------------------------

export type RailKey =
  | "undo"
  | "redo"
  | "pen"
  | "polyline"
  | "arrow"
  | "measure"
  | "ellipse"
  | "rect"
  | "text"
  | "timestamp"
  | "sticker"
  | "style"
  | "adjust"
  | "rotate"
  | "crop"
  | "clear";

/**
 * Web's right-hand toolbar, group for group and button for button, in web's
 * order. The labels are web's tooltips, which on the phone are the
 * accessibility labels (the buttons show icons only, as on web). Done and Save
 * sits under the last group, outside any group, as on web.
 */
export function railGroups(
  canMeasure: boolean,
): { label: string; items: { key: RailKey; label: string }[] }[] {
  return [
    {
      label: "History",
      items: [
        { key: "undo", label: "Undo" },
        { key: "redo", label: "Redo" },
      ],
    },
    {
      label: "Draw",
      items: [
        { key: "pen", label: "Freehand" },
        { key: "polyline", label: "Line" },
        { key: "arrow", label: "Arrow" },
        ...(canMeasure ? [{ key: "measure" as const, label: "Measure (Pro)" }] : []),
      ],
    },
    {
      label: "Shapes",
      items: [
        { key: "ellipse", label: "Circle" },
        { key: "rect", label: "Rectangle" },
      ],
    },
    {
      label: "Mark",
      items: [
        { key: "text", label: "Text" },
        { key: "timestamp", label: "Timestamp" },
        { key: "sticker", label: "Stickers" },
      ],
    },
    {
      label: "Style",
      items: [
        { key: "style", label: "Color and thickness" },
        { key: "adjust", label: "Adjust image" },
        { key: "rotate", label: "Rotate 90 degrees" },
        { key: "crop", label: "Crop" },
      ],
    },
    { label: "Actions", items: [{ key: "clear", label: "Clear all" }] },
  ];
}
