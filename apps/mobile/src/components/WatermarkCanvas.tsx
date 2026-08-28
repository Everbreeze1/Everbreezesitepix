import { forwardRef } from "react";
import Svg, { Image as SvgImage, Rect, Text as SvgText } from "react-native-svg";
import { pillGeometry, type WatermarkTag } from "@/api/watermark";

/**
 * A photo with its before/after pill, ready to be flattened.
 *
 * Rendered off-screen and rasterised with `toDataURL`, the same technique
 * `photo-annotations.ts` uses to flatten annotations. Putting the photo inside
 * the `<Svg>` rather than behind it is what makes one call produce a single
 * image with the pill burnt in.
 *
 * Sized in image pixels, not screen points. The pill geometry is a fraction of
 * the shorter edge, so rendering at display size and letting the rasteriser
 * scale up would produce a pill sized for a phone screen sitting on a 2048px
 * photo. That is the same class of mistake the annotation canvas documents
 * about storing coordinates in screen space.
 */
export const WatermarkCanvas = forwardRef<
  Svg,
  { uri: string; width: number; height: number; tag: WatermarkTag }
>(function WatermarkCanvas({ uri, width, height, tag }, ref) {
  const pill = pillGeometry(width, height, tag);

  return (
    <Svg ref={ref} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <SvgImage
        href={{ uri }}
        x={0}
        y={0}
        width={width}
        height={height}
        preserveAspectRatio="xMidYMid slice"
      />

      <Rect
        x={pill.x}
        y={pill.y}
        width={pill.width}
        height={pill.height}
        rx={pill.radius}
        ry={pill.radius}
        fill={pill.fill}
        stroke={pill.stroke}
        strokeWidth={pill.strokeWidth}
      />

      <SvgText
        x={pill.textX}
        y={pill.textY}
        fill="#ffffff"
        fontSize={pill.fontSize}
        /*
         * 800 to match web. `react-native-svg` maps this onto whatever the
         * platform has nearest, which on Android is Roboto Black and on iOS is
         * the system heavy face, so the two will not be pixel-identical. The
         * pill geometry is what has to match, and that is computed rather than
         * measured.
         */
        fontWeight="800"
        // Vertically centred by the y computed above, so only the horizontal
        // anchor is set here.
        textAnchor="start"
        alignmentBaseline="middle"
      >
        {pill.label}
      </SvgText>
    </Svg>
  );
});
