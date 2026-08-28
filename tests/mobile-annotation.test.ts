import { describe, expect, it } from "vitest";
import {
  annotatedCaption,
  arrowHead,
  beginShape,
  boxOf,
  clampPoint,
  clear,
  commitShape,
  EMPTY_ANNOTATION,
  extendShape,
  isMeaningful,
  normalise,
  penPath,
  redoLast,
  STAMP_SIZE,
  timestampText,
  undo,
  withText,
  type Shape,
} from "../apps/mobile/src/api/annotation";

/*
 * The annotation document.
 *
 * Everything here is arithmetic, and the arithmetic is what goes wrong. The
 * editor draws at whatever size the phone gives it while the saved image is
 * rendered at the photo's real pixel size, usually four times larger, so
 * anything stored in screen coordinates comes out offset in the saved copy
 * only. It looks correct right up until someone opens it on the web.
 */

const pen = (points: { x: number; y: number }[]): Shape => ({
  id: "s1",
  tool: "pen",
  color: "#df2225",
  width: 0.006,
  points,
});

describe("normalise", () => {
  it("expresses a touch as a fraction of the image box", () => {
    expect(normalise(50, 100, 200, 400)).toEqual({ x: 0.25, y: 0.25 });
  });

  it("clamps a finger that left the photo to its edge", () => {
    expect(normalise(-20, 900, 200, 400)).toEqual({ x: 0, y: 1 });
  });

  it("survives being called before layout has run", () => {
    // Width and height are zero on the first render pass, and dividing by them
    // would put NaN into the document, which renders as nothing forever after.
    expect(normalise(10, 10, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe("clampPoint", () => {
  it("keeps points inside the image", () => {
    expect(clampPoint({ x: 1.4, y: -0.2 })).toEqual({ x: 1, y: 0 });
  });
});

describe("drawing", () => {
  it("a pen stroke accumulates points", () => {
    let shape = beginShape("pen", "#df2225", { x: 0.1, y: 0.1 }, "s1");
    shape = extendShape(shape, { x: 0.2, y: 0.2 });
    shape = extendShape(shape, { x: 0.3, y: 0.3 });

    expect(shape.tool).toBe("pen");
    if (shape.tool === "pen") expect(shape.points).toHaveLength(3);
  });

  it("a shape tool moves its end point rather than accumulating", () => {
    let shape = beginShape("arrow", "#df2225", { x: 0.1, y: 0.1 }, "s1");
    shape = extendShape(shape, { x: 0.5, y: 0.5 });
    shape = extendShape(shape, { x: 0.8, y: 0.2 });

    if (shape.tool === "arrow") {
      expect(shape.from).toEqual({ x: 0.1, y: 0.1 });
      expect(shape.to).toEqual({ x: 0.8, y: 0.2 });
    }
  });
});

describe("isMeaningful", () => {
  it("rejects a tap that left a dot", () => {
    /*
     * A tap meant to dismiss something leaves a zero-length stroke. Keeping it
     * means an undo that appears to do nothing, because what it removed was
     * invisible.
     */
    expect(isMeaningful(pen([{ x: 0.5, y: 0.5 }]))).toBe(false);
    expect(
      isMeaningful(
        pen([
          { x: 0.5, y: 0.5 },
          { x: 0.5005, y: 0.5005 },
        ]),
      ),
    ).toBe(false);
  });

  it("keeps a real stroke", () => {
    expect(
      isMeaningful(
        pen([
          { x: 0.1, y: 0.1 },
          { x: 0.4, y: 0.4 },
        ]),
      ),
    ).toBe(true);
  });

  it("rejects a box with no area", () => {
    const shape = beginShape("rect", "#df2225", { x: 0.5, y: 0.5 }, "s1");
    expect(isMeaningful(shape)).toBe(false);
  });
});

describe("undo and redo", () => {
  const stroke = pen([
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
  ]);

  it("commits, undoes and redoes", () => {
    let state = commitShape(EMPTY_ANNOTATION, stroke);
    expect(state.shapes).toHaveLength(1);

    state = undo(state);
    expect(state.shapes).toHaveLength(0);
    expect(state.redo).toHaveLength(1);

    state = redoLast(state);
    expect(state.shapes).toHaveLength(1);
    expect(state.redo).toHaveLength(0);
  });

  it("drawing after an undo discards the redo stack", () => {
    // What every editor does, and what anyone expects. Keeping it would let a
    // redo resurrect a shape from a branch the user abandoned.
    let state = commitShape(EMPTY_ANNOTATION, stroke);
    state = undo(state);
    state = commitShape(state, { ...stroke, id: "s2" });

    expect(state.redo).toHaveLength(0);
    expect(state.shapes).toHaveLength(1);
  });

  it("does nothing at either end rather than throwing", () => {
    expect(undo(EMPTY_ANNOTATION).shapes).toHaveLength(0);
    expect(redoLast(EMPTY_ANNOTATION).shapes).toHaveLength(0);
  });

  it("never commits a meaningless shape", () => {
    expect(commitShape(EMPTY_ANNOTATION, pen([{ x: 0.5, y: 0.5 }])).shapes).toHaveLength(0);
  });

  it("clear is undoable", () => {
    // The one action that destroys everything. A mis-tap on it should not cost
    // the whole markup.
    let state = commitShape(EMPTY_ANNOTATION, stroke);
    state = clear(state);
    expect(state.shapes).toHaveLength(0);

    state = redoLast(state);
    expect(state.shapes).toHaveLength(1);
  });
});

describe("rendering into a box", () => {
  it("scales a stroke to the render size", () => {
    /*
     * The point of normalising. The same document renders at editor size and
     * again at the photo's real size, and both have to land in the same place.
     */
    const shape = pen([
      { x: 0, y: 0 },
      { x: 0.5, y: 1 },
    ]);
    expect(penPath(shape, 100, 200)).toBe("M0.00 0.00 L50.00 200.00");
    expect(penPath(shape, 400, 800)).toBe("M0.00 0.00 L200.00 800.00");
  });

  it("normalises a box dragged right to left", () => {
    // SVG renders nothing at all for a negative width, so a rectangle dragged
    // backwards would simply not appear.
    const shape = beginShape("rect", "#df2225", { x: 0.8, y: 0.9 }, "s1");
    const dragged = extendShape(shape, { x: 0.2, y: 0.1 });

    if (dragged.tool === "rect") {
      const box = boxOf(dragged, 100, 100);
      expect(box).toEqual({ x: 20, y: 10, width: 60, height: 80 });
    }
  });

  it("points the arrow head along the shaft", () => {
    const shape = beginShape("arrow", "#df2225", { x: 0, y: 0.5 }, "s1");
    const dragged = extendShape(shape, { x: 1, y: 0.5 });
    if (dragged.tool !== "arrow") throw new Error("expected an arrow");

    const path = arrowHead(dragged, 200, 100);
    // Both barbs sit behind the tip on a left-to-right arrow.
    const xs = [...path.matchAll(/M?([\d.]+) [\d.]+/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeCloseTo(200, 0);
  });

  it("keeps the arrow head sane at both extremes", () => {
    const tiny = extendShape(beginShape("arrow", "#df2225", { x: 0.5, y: 0.5 }, "s1"), {
      x: 0.52,
      y: 0.5,
    });
    const huge = extendShape(beginShape("arrow", "#df2225", { x: 0, y: 0 }, "s2"), { x: 1, y: 1 });
    if (tiny.tool !== "arrow" || huge.tool !== "arrow") throw new Error("expected arrows");

    // A head bigger than its own shaft looks like a blob; one that never grows
    // is invisible on a photo drawn across at full size.
    expect(arrowHead(tiny, 1000, 1000)).toBeTruthy();
    expect(arrowHead(huge, 1000, 1000)).toBeTruthy();
  });
});

describe("annotatedCaption", () => {
  it("prefixes once", () => {
    expect(annotatedCaption("Roof flashing")).toBe("Annotated: Roof flashing");
  });

  it("does not stack prefixes when annotating an annotated photo", () => {
    // Which is normal: mark it up, then mark up the marked-up copy.
    expect(annotatedCaption("Annotated: Roof flashing")).toBe("Annotated: Roof flashing");
  });

  it("has something to say about a photo with no caption", () => {
    expect(annotatedCaption(null)).toBe("Annotated: Photo");
    expect(annotatedCaption("   ")).toBe("Annotated: Photo");
  });
});

describe("text stamps", () => {
  /*
   * Stamps were added after the drawing tools, and they break two assumptions
   * the originals baked in: every shape has a stroke width, and every shape is
   * dragged between two points. Both are pinned here.
   */

  it("places a stamp where it was tapped and leaves it there", () => {
    // A label marks a specific thing. If dragging moved it, the caret would
    // walk away from whatever it was pointing at.
    const placed = beginShape("text", "#df2225", { x: 0.4, y: 0.6 }, "s1");
    const dragged = extendShape(placed, { x: 0.9, y: 0.9 });
    expect(dragged).toEqual(placed);
  });

  it("drops a stamp with no words", () => {
    // Same rule as a zero-length stroke: keeping it gives an undo that appears
    // to do nothing, because what it removed was invisible.
    const empty = beginShape("text", "#df2225", { x: 0.4, y: 0.6 }, "s1");
    expect(isMeaningful(empty)).toBe(false);
    expect(isMeaningful(withText(empty, "   "))).toBe(false);
    expect(isMeaningful(withText(empty, "cracked lintel"))).toBe(true);
  });

  it("does not commit an empty stamp", () => {
    const empty = beginShape("text", "#df2225", { x: 0.4, y: 0.6 }, "s1");
    expect(commitShape(EMPTY_ANNOTATION, empty).shapes).toHaveLength(0);
    expect(commitShape(EMPTY_ANNOTATION, withText(empty, "note")).shapes).toHaveLength(1);
  });

  it("clamps a stamp placed outside the photo", () => {
    const outside = beginShape("text", "#df2225", { x: 1.4, y: -0.2 }, "s1");
    expect(outside.tool === "text" && outside.at).toEqual({ x: 1, y: 0 });
  });

  it("stores size normalised so the saved copy matches the editor", () => {
    /*
     * The editor draws at screen size and the saved image renders at the
     * photo's real pixels, usually four times larger. A stamp stored in points
     * would come out tiny in the saved file only, which looks correct until
     * someone opens it on the web.
     */
    const stamp = beginShape("text", "#df2225", { x: 0.5, y: 0.5 }, "s1");
    expect(stamp.tool === "text" && stamp.size).toBe(STAMP_SIZE);
    expect(STAMP_SIZE).toBeGreaterThan(0);
    expect(STAMP_SIZE).toBeLessThan(1);
  });
});

describe("timestampText", () => {
  it("reads local time, not UTC", () => {
    /*
     * This goes onto a photograph read by someone standing on the site it was
     * taken at, so it has to match the clock on their wrist. A UTC stamp would
     * be hours off and unexplainable.
     */
    const at = () => new Date(2026, 7, 29, 14, 5);
    expect(timestampText(at)).toBe("2026-08-29 14:05");
  });

  it("pads every field", () => {
    const at = () => new Date(2026, 0, 4, 9, 7);
    expect(timestampText(at)).toBe("2026-01-04 09:07");
  });

  it("carries no seconds", () => {
    // Precision nobody reads, taking width from a photo.
    expect(timestampText(() => new Date(2026, 7, 29, 14, 5, 33))).toBe("2026-08-29 14:05");
  });
});
