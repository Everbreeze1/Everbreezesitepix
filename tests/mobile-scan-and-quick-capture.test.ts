import { describe, expect, it } from "vitest";
import {
  affineFromTriangles,
  applyHomography,
  computeHomography,
  guideToImageQuad,
  isConvexQuad,
  quadBounds,
  scanOutputSize,
  warpPatches,
  type Affine,
  type Pt,
  type Quad,
} from "../apps/mobile/src/components/scan-warp";
import { NEAR_JOB_METRES, pickCaptureJob } from "../apps/mobile/src/lib/capture-job";

const applyAffine = ([a, b, c, d, e, f]: Affine, p: Pt): Pt => ({
  x: a * p.x + c * p.y + e,
  y: b * p.x + d * p.y + f,
});

/** A page shot at an angle: the top edge narrower than the bottom. */
const TILTED: Quad = [
  { x: 400, y: 300 },
  { x: 1600, y: 280 },
  { x: 1800, y: 2500 },
  { x: 200, y: 2520 },
];

describe("scan perspective warp", () => {
  it("maps the four corners exactly", () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 130 },
      { x: 0, y: 130 },
    ];
    const h = computeHomography(rect, TILTED)!;
    rect.forEach((p, i) => {
      const q = applyHomography(h, p);
      expect(q.x).toBeCloseTo(TILTED[i].x, 6);
      expect(q.y).toBeCloseTo(TILTED[i].y, 6);
    });
  });

  it("finds the affine map between two triangles", () => {
    const from: [Pt, Pt, Pt] = [
      { x: 10, y: 10 },
      { x: 50, y: 12 },
      { x: 14, y: 70 },
    ];
    const to: [Pt, Pt, Pt] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 0, y: 40 },
    ];
    const m = affineFromTriangles(from, to)!;
    from.forEach((p, i) => {
      const q = applyAffine(m, p);
      expect(q.x).toBeCloseTo(to[i].x, 6);
      expect(q.y).toBeCloseTo(to[i].y, 6);
    });
    expect(affineFromTriangles([from[0], from[0], from[1]], to)).toBeNull();
  });

  it("covers the whole output with patches that agree with the true warp", () => {
    const size = scanOutputSize(TILTED);
    const patches = warpPatches(TILTED, size.width, size.height);
    expect(patches).toHaveLength(12 * 12 * 2);
    const rect = [
      { x: 0, y: 0 },
      { x: size.width, y: 0 },
      { x: size.width, y: size.height },
      { x: 0, y: size.height },
    ];
    const toOutput = computeHomography(TILTED, rect)!;
    // Inside every patch the affine stand-in stays within about a pixel of the
    // true warp, on a page shot a quarter narrower at the top than the bottom.
    for (const patch of patches) {
      const centre = {
        x: (patch.clip[0].x + patch.clip[1].x + patch.clip[2].x) / 3,
        y: (patch.clip[0].y + patch.clip[1].y + patch.clip[2].y) / 3,
      };
      const source = applyHomography(computeHomography(rect, TILTED)!, centre);
      const viaPatch = applyAffine(patch.matrix, source);
      const viaTrue = applyHomography(toOutput, source);
      expect(Math.hypot(viaPatch.x - viaTrue.x, viaPatch.y - viaTrue.y)).toBeLessThan(1.5);
    }
  });

  it("caps the page size and refuses a crossed quad", () => {
    const size = scanOutputSize(TILTED, 1000);
    expect(Math.max(size.width, size.height)).toBe(1000);
    expect(isConvexQuad(TILTED)).toBe(true);
    const crossed: Quad = [TILTED[0], TILTED[2], TILTED[1], TILTED[3]];
    expect(isConvexQuad(crossed)).toBe(false);
  });

  it("falls back to the corners' bounding box inside the image", () => {
    expect(quadBounds(TILTED, 2000, 2400)).toEqual({
      originX: 200,
      originY: 280,
      width: 1600,
      height: 2120,
    });
  });

  it("maps the viewfinder guide onto a photo cropped by cover", () => {
    // A 3:4 photo shown in a taller 390x844 view: cover scales to the height.
    const quad = guideToImageQuad(
      { x: 45, y: 200, width: 300, height: 388 },
      { width: 390, height: 844 },
      { width: 3000, height: 4000 },
    );
    const shownW = 3000 * (844 / 4000);
    const offX = (shownW - 390) / 2;
    expect(quad[0].x).toBeCloseTo((45 + offX) / shownW, 6);
    expect(quad[0].y).toBeCloseTo(200 / 844, 6);
    expect(quad[2].x).toBeCloseTo((345 + offX) / shownW, 6);
  });
});

describe("camera button job choice", () => {
  const here = { latitude: 38.678, longitude: -121.176 };
  const rows = [
    { id: "recent", status: "active", archived: false, latitude: 40, longitude: -120 },
    { id: "near", status: "active", archived: false, latitude: 38.6785, longitude: -121.176 },
    {
      id: "done-here",
      status: "completed",
      archived: false,
      latitude: 38.678,
      longitude: -121.176,
    },
  ];

  it("opens on the open job the phone is standing at", () => {
    expect(pickCaptureJob(rows, here)?.id).toBe("near");
  });

  it("opens on the last worked on job without a fix or with none nearby", () => {
    expect(pickCaptureJob(rows, null)?.id).toBe("recent");
    const far = { latitude: 0, longitude: 0 };
    expect(pickCaptureJob(rows, far)?.id).toBe("recent");
    expect(NEAR_JOB_METRES).toBeGreaterThan(0);
  });

  it("uses a closed job only when every job is closed, and nothing when there are none", () => {
    expect(pickCaptureJob([rows[2]], null)?.id).toBe("done-here");
    expect(pickCaptureJob([], here)).toBeNull();
  });
});
