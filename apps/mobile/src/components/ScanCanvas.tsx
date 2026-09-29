import { forwardRef } from "react";
import { PixelRatio } from "react-native";
import Svg, {
  ClipPath,
  Defs,
  FeColorMatrix,
  Filter,
  G,
  Image as SvgImage,
  Polygon,
  Rect,
  Use,
} from "react-native-svg";
import type { WarpPatch } from "@/components/scan-warp";

/**
 * The document look, as one colour matrix.
 *
 * Web's Scan mode greys the frame and applies `contrast = 1.35` around the
 * midpoint. That keeps a page readable but leaves the paper a mid grey under
 * indoor light, which is most of what "the scan does not look like a scan"
 * meant on device. This is the same Rec. 601 greyscale with a steeper curve
 * anchored at the white end instead: anything from about 83% brightness up
 * becomes clean white paper, and ink at 30% or darker becomes solid black.
 * Pencil and faint print (40 to 60%) stay a readable grey rather than
 * vanishing, which a hard black and white threshold would do to them.
 *
 * It is a fixed curve because the phone has no per-pixel access to measure the
 * page first: react-native-svg's filters are what can run on the image, and
 * the ones that would flatten shadows (blur and arithmetic composite) are
 * capped or compute alpha differently on Android.
 */
const SCAN_CONTRAST = 1.8;
const SCAN_OFFSET = -0.5;

/*
 * Every output channel is the luma of the input (0.299 / 0.587 / 0.114, the
 * weights web uses), scaled by the contrast and shifted by the offset on the
 * 0..1 scale an SVG matrix uses. Alpha passes through untouched.
 */
const L = [0.299, 0.587, 0.114].map((w) => w * SCAN_CONTRAST);
// prettier-ignore
const SCAN_MATRIX = [
  ...L, 0, SCAN_OFFSET,
  ...L, 0, SCAN_OFFSET,
  ...L, 0, SCAN_OFFSET,
  0, 0, 0, 1, 0,
];

/**
 * Layout size for an off-screen surface that should rasterise at `px` pixels.
 *
 * `toDataURL` renders at the view's size in physical pixels, which is its
 * layout size times the screen density. A surface laid out at the photo's
 * pixel size would render at three times that on most phones: a 4000px shot
 * becomes a 12000px bitmap, which runs out of memory and fails over to the
 * untreated original. Laying out at pixels over density renders at the size
 * the file actually has, and the viewBox keeps drawing in image pixels.
 */
function layoutSize(px: number): number {
  return px / PixelRatio.get();
}

/**
 * A captured page with the Scan mode document look: greyscale, paper pushed to
 * white and ink to black.
 *
 * Rendered off-screen and flattened with `renderWatermarked`, the same way
 * `WatermarkCanvas` burns in the before/after pill.
 */
export const ScanCanvas = forwardRef<Svg, { uri: string; width: number; height: number }>(
  function ScanCanvas({ uri, width, height }, ref) {
    return (
      <Svg
        ref={ref}
        width={layoutSize(width)}
        height={layoutSize(height)}
        viewBox={`0 0 ${width} ${height}`}
      >
        <Defs>
          <Filter id="scan" x={0} y={0} width="100%" height="100%">
            <FeColorMatrix type="matrix" values={SCAN_MATRIX} />
          </Filter>
        </Defs>
        <SvgImage
          href={{ uri }}
          x={0}
          y={0}
          width={width}
          height={height}
          preserveAspectRatio="none"
          filter="url(#scan)"
        />
      </Svg>
    );
  },
);

/**
 * The page straightened: the photo drawn once per patch of `warpPatches`,
 * each through its own affine matrix and clipped to its triangle of the output
 * rectangle. See `scan-warp.ts` for why patches rather than one transform.
 *
 * The photo is defined once and every patch `Use`s it, so it is decoded once
 * however many patches there are. White underneath, so anything the corners
 * reach past the photo's edge comes out as paper, as web's warp does.
 */
export const ScanWarpCanvas = forwardRef<
  Svg,
  {
    uri: string;
    sourceWidth: number;
    sourceHeight: number;
    width: number;
    height: number;
    patches: WarpPatch[];
  }
>(function ScanWarpCanvas({ uri, sourceWidth, sourceHeight, width, height, patches }, ref) {
  return (
    <Svg
      ref={ref}
      width={layoutSize(width)}
      height={layoutSize(height)}
      viewBox={`0 0 ${width} ${height}`}
    >
      <Defs>
        <SvgImage
          id="page"
          href={{ uri }}
          x={0}
          y={0}
          width={sourceWidth}
          height={sourceHeight}
          preserveAspectRatio="none"
        />
        {patches.map((patch, i) => (
          <ClipPath key={i} id={`patch${i}`}>
            <Polygon points={patch.clip.map((p) => `${p.x},${p.y}`).join(" ")} />
          </ClipPath>
        ))}
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="#ffffff" />
      {patches.map((patch, i) => (
        <G key={i} clipPath={`url(#patch${i})`}>
          <Use href="#page" transform={`matrix(${patch.matrix.join(" ")})`} />
        </G>
      ))}
    </Svg>
  );
});
