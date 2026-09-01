/**
 * The annotation document: what was drawn on a photo, independent of how big
 * the screen showing it happens to be.
 *
 * Import-free so the rules can be tested directly, and because the one thing
 * that reliably goes wrong here is arithmetic. The editor draws at whatever
 * size the phone gives it; the saved image is rendered at the photo's real
 * pixel size, which is usually four times larger. Anything stored in screen
 * coordinates comes out offset, and it comes out offset *only in the saved
 * copy*, so it looks right until someone opens it on the web.
 *
 * So every point is stored normalised to 0..1 of the image box, and converted
 * once at render time.
 */

export type AnnotationTool = "pen" | "arrow" | "rect" | "ellipse" | "text";

export type Point = { x: number; y: number };

export type Shape =
  | { id: string; tool: "pen"; color: string; width: number; points: Point[] }
  | { id: string; tool: "arrow"; color: string; width: number; from: Point; to: Point }
  | { id: string; tool: "rect"; color: string; width: number; from: Point; to: Point }
  | { id: string; tool: "ellipse"; color: string; width: number; from: Point; to: Point }
  /*
   * A stamp: words placed on the photo at one point.
   *
   * Unlike every other shape this is anchored rather than dragged between two
   * corners, because a label is placed, not swept. `size` is normalised like
   * the stroke widths, so a stamp that looked right in the editor is the same
   * proportion of the saved image.
   */
  | { id: string; tool: "text"; color: string; at: Point; text: string; size: number };

export type AnnotationState = {
  shapes: Shape[];
  /** Popped shapes, newest last. Cleared by any new drawing. */
  redo: Shape[];
};

export const EMPTY_ANNOTATION: AnnotationState = { shapes: [], redo: [] };

/**
 * Colours offered in the editor.
 *
 * Red first because that is what a defect gets marked with, and it is the
 * reason someone opens this screen. All four are picked to stay legible against
 * the grey and beige a construction photo is mostly made of.
 */
export const ANNOTATION_COLORS = ["#df2225", "#f9a300", "#00599c", "#ffffff"] as const;

/** Stroke width in normalised units, so it scales with the rendered image. */
export const STROKE_WIDTH = 0.006;

/**
 * Stamp height as a fraction of the image height.
 *
 * Large enough to read on a phone showing the whole photo, which is the only
 * place anyone checks whether their markup makes sense before saving it.
 */
export const STAMP_SIZE = 0.045;

/** Clamp to the image box. A finger leaving the photo should stop at its edge. */
export function clampPoint(point: Point): Point {
  return {
    x: Math.min(1, Math.max(0, point.x)),
    y: Math.min(1, Math.max(0, point.y)),
  };
}

/** Screen coordinates within a laid-out image box, as a fraction of it. */
export function normalise(x: number, y: number, width: number, height: number): Point {
  if (width <= 0 || height <= 0) return { x: 0, y: 0 };
  return clampPoint({ x: x / width, y: y / height });
}

export function beginShape(tool: AnnotationTool, color: string, at: Point, id: string): Shape {
  const point = clampPoint(at);
  if (tool === "pen") {
    return { id, tool, color, width: STROKE_WIDTH, points: [point] };
  }
  if (tool === "text") {
    // Placed empty and filled in afterwards. The caller opens an input and
    // replaces the text before committing, so an abandoned stamp is one with
    // no words, which `isMeaningful` then drops.
    return { id, tool, color, at: point, text: "", size: STAMP_SIZE };
  }
  return { id, tool, color, width: STROKE_WIDTH, from: point, to: point };
}

/** A stamp with its words set. */
export function withText(shape: Shape, text: string): Shape {
  return shape.tool === "text" ? { ...shape, text } : shape;
}

/**
 * The wording a timestamp stamp carries.
 *
 * Local time, not UTC, and no seconds. This goes onto a photograph that will be
 * read by someone standing on the site it was taken at, so it has to match the
 * clock on their own wrist rather than a server's.
 */
export function timestampText(now: () => Date = () => new Date()): string {
  const at = now();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** Extend the shape being drawn to follow the finger. */
export function extendShape(shape: Shape, at: Point): Shape {
  const point = clampPoint(at);
  if (shape.tool === "pen") {
    return { ...shape, points: [...shape.points, point] };
  }
  // A stamp is anchored where it was placed. Dragging after a tap must not
  // move it, or the caret walks away from the thing it was labelling.
  if (shape.tool === "text") return shape;
  return { ...shape, to: point };
}

/**
 * Whether a finished shape is worth keeping.
 *
 * A tap that was meant to select something leaves a zero-length stroke behind.
 * Keeping those means an "undo" that appears to do nothing, because the shape
 * it removed was invisible.
 */
export function isMeaningful(shape: Shape): boolean {
  if (shape.tool === "text") {
    // A stamp with no words is an invisible mark. Keeping it gives the same
    // do-nothing undo a zero-length stroke does.
    return shape.text.trim().length > 0;
  }
  if (shape.tool === "pen") {
    if (shape.points.length < 2) return false;
    const first = shape.points[0];
    return shape.points.some(
      (point) => Math.abs(point.x - first.x) > 0.002 || Math.abs(point.y - first.y) > 0.002,
    );
  }
  return Math.abs(shape.to.x - shape.from.x) > 0.01 || Math.abs(shape.to.y - shape.from.y) > 0.01;
}

export function commitShape(state: AnnotationState, shape: Shape): AnnotationState {
  if (!isMeaningful(shape)) return state;
  // Drawing after undoing discards the redo stack, which is what every editor
  // does and what anyone expects.
  return { shapes: [...state.shapes, shape], redo: [] };
}

export function undo(state: AnnotationState): AnnotationState {
  if (state.shapes.length === 0) return state;
  const shapes = state.shapes.slice(0, -1);
  const popped = state.shapes[state.shapes.length - 1];
  return { shapes, redo: [...state.redo, popped] };
}

export function redoLast(state: AnnotationState): AnnotationState {
  if (state.redo.length === 0) return state;
  const restored = state.redo[state.redo.length - 1];
  return { shapes: [...state.shapes, restored], redo: state.redo.slice(0, -1) };
}

export function clear(state: AnnotationState): AnnotationState {
  if (state.shapes.length === 0) return state;
  // Clearing is undoable: it is the one action that destroys everything, and a
  // mis-tap on it should not cost the whole markup.
  return { shapes: [], redo: [...state.redo, ...state.shapes] };
}

/** An SVG path `d` for a freehand stroke, scaled into a box of `width`x`height`. */
export function penPath(shape: Extract<Shape, { tool: "pen" }>, width: number, height: number) {
  return shape.points
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${(point.x * width).toFixed(2)} ${(point.y * height).toFixed(2)}`;
    })
    .join(" ");
}

/**
 * The two lines of an arrow head, scaled into the render box.
 *
 * Sized from the shaft rather than fixed, so an arrow drawn across the whole
 * photo does not get the same head as one marking a single screw, and computed
 * from the angle so it points along the shaft at any rotation.
 */
export function arrowHead(
  shape: Extract<Shape, { tool: "arrow" }>,
  width: number,
  height: number,
): string {
  const x1 = shape.from.x * width;
  const y1 = shape.from.y * height;
  const x2 = shape.to.x * width;
  const y2 = shape.to.y * height;

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const length = Math.hypot(x2 - x1, y2 - y1);
  const head = Math.max(8, Math.min(length * 0.28, 44));
  const spread = Math.PI / 7;

  const leftX = x2 - head * Math.cos(angle - spread);
  const leftY = y2 - head * Math.sin(angle - spread);
  const rightX = x2 - head * Math.cos(angle + spread);
  const rightY = y2 - head * Math.sin(angle + spread);

  return `M${leftX.toFixed(2)} ${leftY.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)} L${rightX.toFixed(2)} ${rightY.toFixed(2)}`;
}

/** Top-left corner and size of a box shape, in render coordinates. */
export function boxOf(
  shape: Extract<Shape, { tool: "rect" | "ellipse" }>,
  width: number,
  height: number,
) {
  const x1 = shape.from.x * width;
  const y1 = shape.from.y * height;
  const x2 = shape.to.x * width;
  const y2 = shape.to.y * height;
  return {
    // Dragged right-to-left or bottom-to-top is normal, and a negative width
    // renders nothing at all in SVG.
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * The caption for the saved copy.
 *
 * Annotating an annotated photo is normal, and the naive version produces
 * "Annotated: Annotated: Annotated: Roof flashing". Matches web's rule.
 */
export function annotatedCaption(original: string | null | undefined): string {
  const base = original?.trim() || "Photo";
  return base.startsWith("Annotated:") ? base : `Annotated: ${base}`;
}

/**
 * How big the drawing surface is, given the screen and the photograph.
 *
 * The surface must match the photograph's aspect EXACTLY, and that is not a
 * nicety. `AnnotationCanvas` renders the photo into an `<Svg>` and the save
 * rasterises that same surface, so whatever the canvas does to the picture is
 * what gets written to the new file.
 *
 * The old sizing took the full screen width and then clamped the height:
 *
 *     const canvasWidth = window.width;
 *     const canvasHeight = Math.min(window.height * 0.62, canvasWidth / aspect);
 *
 * For a landscape photo those agree. For a PORTRAIT one they do not: the clamp
 * shortens the box without narrowing it, so the surface ends up wider than the
 * photograph's aspect, and `preserveAspectRatio="... slice"` fills that box by
 * cropping the top and bottom away. On a 9:16 photograph roughly a quarter of
 * the height disappeared - out of the editor, so it could not be marked up, and
 * out of the saved copy, permanently.
 *
 * So the height leads and the width follows. The surface is then letterboxed by
 * the screen's own dark ground, which is the right thing to letterbox with.
 */
export function annotationCanvasSize(
  screen: { width: number; height: number },
  aspect: number,
  /** Share of the screen height the surface may take, leaving room for tools. */
  heightShare = 0.62,
): { width: number; height: number } {
  // A nonsense aspect (a zero dimension, a missing one) must not produce a
  // zero-sized canvas: the photo would be invisible and unmarkable.
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
  const maxHeight = screen.height * heightShare;
  const width = Math.min(screen.width, maxHeight * safeAspect);
  return { width, height: width / safeAspect };
}
