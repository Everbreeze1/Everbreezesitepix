import { describe, it, expect } from "vitest";
import {
  adjustMatrix,
  COLORS,
  cropShapes,
  defaultPxPerInch,
  dragCrop,
  EMPTY_HISTORY,
  fitSize,
  formatMeasure,
  formatStamp,
  getHandles,
  hitTest,
  isMeaningful,
  NO_ADJUST,
  normaliseCrop,
  parseShapes,
  pushHistory,
  pxPerInchFromCalibration,
  redoHistory,
  rotateShapesCW,
  serializeShapes,
  stageToImage,
  STICKER_GROUPS,
  stampDate,
  taperedArrowPath,
  textSizeFor,
  transformShape,
  undoHistory,
  type Shape,
  type Snapshot,
} from "../apps/mobile/src/components/annotator/model";

/*
 * The mobile annotator's rules, which are web's (PhotoAnnotator.tsx) ported.
 * The numbers asserted here are the ones web computes, so a drift between the
 * two shows up as a failing test rather than as a photo that looks different
 * depending on which app marked it up.
 */

const img = { w: 1200, h: 900 };
const arrow: Shape = {
  id: "a",
  kind: "arrow",
  color: "#ef4444",
  width: 8,
  from: { x: 100, y: 100 },
  to: { x: 500, y: 100 },
};
const rect: Shape = {
  id: "r",
  kind: "rect",
  color: "#ef4444",
  width: 8,
  from: { x: 600, y: 600 },
  to: { x: 800, y: 700 },
};
const text: Shape = {
  id: "t",
  kind: "text",
  color: "#ffffff",
  size: 40,
  pos: { x: 50, y: 400 },
  text: "Crack",
};

describe("web parity", () => {
  it("has web's palette, defaults and sticker groups", () => {
    expect(COLORS).toHaveLength(13);
    expect(COLORS[0]).toBe("#ef4444");
    expect(STICKER_GROUPS.map((g) => g.label)).toEqual([
      "Status",
      "Marks",
      "Trades",
      "Pins",
      "Numbers",
    ]);
    expect(textSizeFor(img, 8)).toBe(Math.max(20, Math.round((900 / 28) * 2)));
  });
});

describe("hit testing", () => {
  it("finds the topmost shape near a line, and nothing far away", () => {
    expect(hitTest([arrow, rect], null, { x: 300, y: 108 }, 12)?.shape.id).toBe("a");
    expect(hitTest([arrow, rect], null, { x: 300, y: 140 }, 12)).toBeNull();
    expect(hitTest([arrow, rect], null, { x: 700, y: 650 }, 12)?.shape.id).toBe("r");
  });

  it("grabs a handle of the selected shape before any body", () => {
    const hit = hitTest([arrow, rect], rect, { x: 802, y: 702 }, 12);
    expect(hit?.handle).toEqual({ kind: "br" });
    expect(getHandles(text)).toHaveLength(1);
  });

  it("moves and resizes as web does", () => {
    const moved = transformShape(arrow, { kind: "body" }, 10, 20, { x: 0, y: 0 });
    expect(moved).toMatchObject({ from: { x: 110, y: 120 }, to: { x: 510, y: 120 } });
    const bigger = transformShape(text, { kind: "br" }, 0, 0, { x: 0, y: 400 + 60 });
    expect(bigger).toMatchObject({ size: 50 });
  });

  it("drops a tap that was not a drawing", () => {
    expect(isMeaningful({ ...arrow, to: { x: 102, y: 101 } })).toBe(false);
    expect(isMeaningful(arrow)).toBe(true);
  });
});

describe("measurement", () => {
  it("defaults to a 60 inch frame and formats both units", () => {
    expect(defaultPxPerInch(img)).toBe(20);
    expect(formatMeasure(600, 20)).toBe(`2' 6.0"  ·  76.2 cm`);
    expect(formatMeasure(100, 20)).toBe(`5.0"  ·  12.7 cm`);
  });

  it("calibrates from a known length in any unit", () => {
    expect(pxPerInchFromCalibration(240, 1, "ft")).toBe(20);
    expect(pxPerInchFromCalibration(254, 10, "cm")).toBeCloseTo(64.516, 3);
    expect(pxPerInchFromCalibration(240, 0, "in")).toBeNull();
    expect(pxPerInchFromCalibration(240, Number.NaN, "in")).toBeNull();
  });
});

describe("rotate and crop carry the marks", () => {
  it("rotates points 90 degrees clockwise", () => {
    const [r] = rotateShapesCW([arrow], img);
    expect(r).toMatchObject({ from: { x: 800, y: 100 }, to: { x: 800, y: 500 } });
  });

  it("crops by translating, and normalises a dragged box", () => {
    const [c] = cropShapes([arrow], { x: 50, y: 50, w: 500, h: 500 });
    expect(c).toMatchObject({ from: { x: 50, y: 50 } });
    expect(normaliseCrop({ x: 1300, y: 10, w: -400, h: 100.4 }, img)).toEqual({
      x: 900,
      y: 10,
      w: 300,
      h: 100,
    });
    expect(dragCrop({ x: 0, y: 0, w: 0, h: 0 }, "new", { x: 10, y: 5 }, { x: 50, y: 60 })).toEqual({
      x: 10,
      y: 5,
      w: 40,
      h: 55,
    });
  });
});

describe("history", () => {
  it("undoes and redoes whole snapshots, image included", () => {
    const a: Snapshot = { shapes: [], image: { uri: "a", ...img } };
    const b: Snapshot = { shapes: [arrow], image: { uri: "b", w: 900, h: 1200 } };
    const h = pushHistory(EMPTY_HISTORY, a);
    const u = undoHistory(h, b)!;
    expect(u.snapshot).toBe(a);
    const r = redoHistory(u.history, u.snapshot)!;
    expect(r.snapshot).toBe(b);
    expect(undoHistory(EMPTY_HISTORY, a)).toBeNull();
  });
});

describe("serialisation", () => {
  it("round-trips shapes and rejects junk", () => {
    const json = serializeShapes([arrow, rect, text]);
    expect(parseShapes(json)).toEqual([arrow, rect, text]);
    expect(parseShapes("not json")).toEqual([]);
    expect(
      parseShapes(JSON.stringify({ shapes: [{ id: "x", kind: "arrow", from: { x: 1 } }] })),
    ).toEqual([]);
  });

  it("draws web's tapered arrow as one filled path", () => {
    const d = taperedArrowPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 8);
    expect(d.startsWith("M0.00 1.00")).toBe(true);
    expect(d).toContain("M100.00 0.00");
    expect(taperedArrowPath({ x: 0, y: 0 }, { x: 0, y: 0 }, 8)).toBe("");
  });
});

describe("zoom, fit, stamp, adjust", () => {
  it("maps a stage point back to the image through pan and zoom", () => {
    const stage = { w: 400, h: 400 };
    const display = { w: 400, h: 300 };
    expect(stageToImage(200, 200, stage, display, img, { scale: 1, tx: 0, ty: 0 })).toEqual({
      x: 600,
      y: 450,
    });
    const p = stageToImage(300, 200, stage, display, img, { scale: 2, tx: 0, ty: 0 });
    expect(p).toEqual({ x: 750, y: 450 });
    expect(fitSize({ w: 400, h: 400 }, 4 / 3)).toEqual({ w: 400, h: 300 });
  });

  it("stamps the capture time when there is one", () => {
    const d = stampDate("2026-03-04T15:07:00", () => new Date(0));
    expect(formatStamp(d)).toBe("Mar 04, 2026, 03:07 PM");
    expect(stampDate("garbage", () => new Date(5)).getTime()).toBe(5);
  });

  it("an unadjusted photo gets the identity matrix", () => {
    expect(adjustMatrix(NO_ADJUST)).toEqual([
      1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
    ]);
  });
});
