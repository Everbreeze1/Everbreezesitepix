/**
 * Four-corner perspective correction for Scan mode, as arithmetic.
 *
 * Web's `ScanCrop` warps the page quad into a rectangle pixel by pixel through
 * a homography on a canvas. The phone has no pixel access (no canvas, and no
 * image library that warps), but `react-native-svg` can draw an image through
 * any AFFINE matrix and clip it to any shape. A homography is not affine, but
 * over a small enough patch it is very nearly one, so the output rectangle is
 * cut into a grid of triangles and each triangle gets the affine map that
 * agrees with the homography at its three corners. Neighbouring triangles
 * agree along the edge they share, so the patches meet without gaps or steps.
 * At the grid size used here the result differs from a true per-pixel warp by
 * about a pixel on a steeply tilted page (a quarter narrower at the top than
 * the bottom), which is invisible in text, and by less on a squarer shot.
 *
 * Import-free so it can be tested.
 */

export type Pt = { x: number; y: number };

/** Corners in the order top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

/** SVG `matrix(a b c d e f)`: x' = a x + c y + e, y' = b x + d y + f. */
export type Affine = [number, number, number, number, number, number];

export type WarpPatch = {
  /** The triangle in output pixels, which the patch is clipped to. */
  clip: [Pt, Pt, Pt];
  /** Source image pixels to output pixels, for this triangle. */
  matrix: Affine;
};

/** Cells per side of the triangle grid. 12 x 12 cells is 288 triangles. */
export const WARP_GRID = 12;

/** The largest side a scan is written at. Plenty for print, and kind to memory. */
export const SCAN_MAX_SIDE = 2400;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The 8 coefficients of the homography taking `src[i]` to `dst[i]`, as web's
 * `computeHomography`: [a b c; d e f; g h 1], by Gaussian elimination.
 */
export function computeHomography(src: Pt[], dst: Pt[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const n = 8;
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let k = i + 1; k < n; k += 1) {
      if (Math.abs(A[k][i]) > Math.abs(A[pivot][i])) pivot = k;
    }
    if (pivot !== i) {
      [A[i], A[pivot]] = [A[pivot], A[i]];
      [b[i], b[pivot]] = [b[pivot], b[i]];
    }
    if (Math.abs(A[i][i]) < 1e-9) return null;
    for (let k = i + 1; k < n; k += 1) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < n; j += 1) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = b[i];
    for (let j = i + 1; j < n; j += 1) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

/** Apply a homography from `computeHomography` to one point. */
export function applyHomography(h: number[], p: Pt): Pt {
  const [a, b, c, d, e, f, g, k] = h;
  const w = g * p.x + k * p.y + 1;
  return { x: (a * p.x + b * p.y + c) / w, y: (d * p.x + e * p.y + f) / w };
}

/**
 * The affine map taking triangle `from` onto triangle `to`, or null when
 * `from` is degenerate (its three points on one line).
 */
export function affineFromTriangles(from: [Pt, Pt, Pt], to: [Pt, Pt, Pt]): Affine | null {
  const [p0, p1, p2] = from;
  const [q0, q1, q2] = to;
  const ux = p1.x - p0.x;
  const uy = p1.y - p0.y;
  const vx = p2.x - p0.x;
  const vy = p2.y - p0.y;
  const det = ux * vy - vx * uy;
  if (Math.abs(det) < 1e-9) return null;
  // Inverse of [ux vx; uy vy].
  const i00 = vy / det;
  const i01 = -vx / det;
  const i10 = -uy / det;
  const i11 = ux / det;
  const sx = q1.x - q0.x;
  const sy = q1.y - q0.y;
  const tx = q2.x - q0.x;
  const ty = q2.y - q0.y;
  // M = [sx tx; sy ty] * inverse.
  const a = sx * i00 + tx * i10;
  const c = sx * i01 + tx * i11;
  const b = sy * i00 + ty * i10;
  const d = sy * i01 + ty * i11;
  const e = q0.x - (a * p0.x + c * p0.y);
  const f = q0.y - (b * p0.x + d * p0.y);
  return [a, b, c, d, e, f];
}

/**
 * The output page size for a quad in source pixels: the longer of each pair
 * of opposite edges, as web does, scaled down to `SCAN_MAX_SIDE`.
 */
export function scanOutputSize(
  quad: Quad,
  maxSide = SCAN_MAX_SIDE,
): { width: number; height: number } {
  const w = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  const h = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
  const scale = Math.min(1, maxSide / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Push a triangle's corners out from its centre by `by` pixels, so the
 * anti-aliased edges of neighbouring patches overlap rather than leaving a
 * faint hairline between them. The overlap draws identical pixels.
 */
function grow(tri: [Pt, Pt, Pt], by: number): [Pt, Pt, Pt] {
  const cx = (tri[0].x + tri[1].x + tri[2].x) / 3;
  const cy = (tri[0].y + tri[1].y + tri[2].y) / 3;
  return tri.map((p) => {
    const d = Math.hypot(p.x - cx, p.y - cy) || 1;
    return { x: p.x + ((p.x - cx) / d) * by, y: p.y + ((p.y - cy) / d) * by };
  }) as [Pt, Pt, Pt];
}

/**
 * The patches that warp `quad` (source pixels) onto a `width` x `height`
 * rectangle. Empty when the quad is degenerate, so a caller can fall back.
 */
export function warpPatches(
  quad: Quad,
  width: number,
  height: number,
  grid = WARP_GRID,
): WarpPatch[] {
  const rect: Pt[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  // Output to source, so each grid point can be located on the photo.
  const h = computeHomography(rect, quad);
  if (!h) return [];
  const out = (i: number, j: number): Pt => ({ x: (i / grid) * width, y: (j / grid) * height });
  const src = (i: number, j: number): Pt => applyHomography(h, out(i, j));

  const patches: WarpPatch[] = [];
  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const tris: [[number, number], [number, number], [number, number]][] = [
        [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
        ],
        [
          [i, j],
          [i + 1, j + 1],
          [i, j + 1],
        ],
      ];
      for (const tri of tris) {
        const to = tri.map(([a, b]) => out(a, b)) as [Pt, Pt, Pt];
        const from = tri.map(([a, b]) => src(a, b)) as [Pt, Pt, Pt];
        const matrix = affineFromTriangles(from, to);
        if (!matrix) return [];
        patches.push({ clip: grow(to, 0.75), matrix });
      }
    }
  }
  return patches;
}

/** The quad's bounding box, clamped to the image: the fallback crop. */
export function quadBounds(
  quad: Quad,
  imageWidth: number,
  imageHeight: number,
): { originX: number; originY: number; width: number; height: number } {
  const xs = quad.map((p) => Math.min(imageWidth, Math.max(0, p.x)));
  const ys = quad.map((p) => Math.min(imageHeight, Math.max(0, p.y)));
  const originX = Math.floor(Math.min(...xs));
  const originY = Math.floor(Math.min(...ys));
  return {
    originX,
    originY,
    width: Math.max(1, Math.ceil(Math.max(...xs)) - originX),
    height: Math.max(1, Math.ceil(Math.max(...ys)) - originY),
  };
}

/**
 * Where the viewfinder's paper guide lands on the photo, as the starting quad
 * for the corner step.
 *
 * The preview fills its box the way `cover` does (scaled to fill, centred,
 * overflow cropped), so a point on screen maps back through that scale and
 * offset. All normalised 0..1, since the photo's pixel size is only known
 * after the shot. Clamped, because a guide on a letterboxed preview can fall
 * past the photo's edge.
 */
export function guideToImageQuad(
  guide: { x: number; y: number; width: number; height: number },
  view: { width: number; height: number },
  image: { width: number; height: number },
): Quad {
  const scale = Math.max(view.width / image.width, view.height / image.height);
  const shownW = image.width * scale;
  const shownH = image.height * scale;
  const offX = (shownW - view.width) / 2;
  const offY = (shownH - view.height) / 2;
  const map = (x: number, y: number): Pt => ({
    x: Math.min(1, Math.max(0, (x + offX) / shownW)),
    y: Math.min(1, Math.max(0, (y + offY) / shownH)),
  });
  return [
    map(guide.x, guide.y),
    map(guide.x + guide.width, guide.y),
    map(guide.x + guide.width, guide.y + guide.height),
    map(guide.x, guide.y + guide.height),
  ];
}

/** The default corners, inset 8% as web's `ScanCrop` starts them. Normalised. */
export const DEFAULT_QUAD: Quad = [
  { x: 0.08, y: 0.08 },
  { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 },
  { x: 0.08, y: 0.92 },
];

/**
 * Whether four corners still make a usable page: convex and not folded over
 * itself. A crossed quad would warp into a mirrored bow tie.
 */
export function isConvexQuad(quad: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-12) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
