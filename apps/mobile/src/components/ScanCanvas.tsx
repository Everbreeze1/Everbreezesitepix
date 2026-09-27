import { forwardRef } from "react";
import Svg, { Defs, FeColorMatrix, Filter, Image as SvgImage } from "react-native-svg";

/**
 * Contrast applied on top of the greyscale, matching web's Scan mode
 * (`CameraCapture.tsx`: `contrast = 1.35`, `intercept = 128 * (1 - contrast)`).
 */
const SCAN_CONTRAST = 1.35;
/** The web intercept, expressed on the 0..1 channel scale an SVG matrix uses. */
const SCAN_OFFSET = (128 * (1 - SCAN_CONTRAST)) / 255;

/*
 * One matrix does both steps: every output channel is the Rec. 601 luma of
 * the input (the same 0.299 / 0.587 / 0.114 weights web uses), scaled by the
 * contrast and shifted by the intercept. Alpha passes through untouched.
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
 * A captured page with the Scan mode document look: greyscale, contrast
 * boosted, so paper goes whiter and ink goes darker.
 *
 * Rendered off-screen and flattened with `renderWatermarked`, the same way
 * `WatermarkCanvas` burns in the before/after pill. Sized in image pixels so
 * the flattened file keeps the photo's resolution.
 */
export const ScanCanvas = forwardRef<Svg, { uri: string; width: number; height: number }>(
  function ScanCanvas({ uri, width, height }, ref) {
    return (
      <Svg ref={ref} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
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
          preserveAspectRatio="xMidYMid slice"
          filter="url(#scan)"
        />
      </Svg>
    );
  },
);
