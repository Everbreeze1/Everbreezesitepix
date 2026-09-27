import { forwardRef, type ReactNode } from "react";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  FeColorMatrix,
  Filter,
  G,
  Image as SvgImage,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import {
  adjustMatrix,
  formatMeasure,
  isAdjusted,
  measureLayout,
  polylinePath,
  readableOutline,
  taperedArrowPath,
  NO_ADJUST,
  type Adjust,
  type Shape,
  type Size,
} from "@/components/annotator/model";

/**
 * The photo with its markup on top, as one SVG, drawn the way the web
 * annotator draws its canvas.
 *
 * Used twice with the same document: on screen at whatever size the phone
 * gives it, and off screen at the photo's real pixel size to be rasterised by
 * `toDataURL`. Rendering the saved copy through the same component as the
 * preview is how the two are kept identical. The drawing itself is always in
 * the image's own pixels (the `viewBox`); only the element size changes.
 *
 * The image is inside the SVG rather than behind it so `toDataURL` flattens
 * both together. An `<Image>` underneath would rasterise to markup on
 * transparency.
 */
export type AnnotationCanvasProps = {
  uri: string;
  /** Element size on screen (or the export size). */
  width: number;
  height: number;
  /** The working image's pixel size: the coordinate space of every shape. */
  image: Size;
  shapes: Shape[];
  /** Pixels per real inch for measurements (web's calibration). */
  pxPerInch: number;
  adjust?: Adjust;
  /** Editor-only drawing (selection, handles, crop box) in image pixels. Never exported. */
  overlay?: ReactNode;
  /** Show a region of the image instead of all of it (the loupe). */
  viewBox?: string;
};

function renderShape(s: Shape, pxPerInch: number, canvas: Size) {
  switch (s.kind) {
    case "pen":
      return (
        <Path
          key={s.id}
          d={s.points.length === 1 ? `${polylinePath(s.points)} l0.01 0` : polylinePath(s.points)}
          stroke={s.color}
          strokeWidth={s.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      );
    case "polyline": {
      // Large, high-contrast vertex dots, as on web, so the points read.
      const r = Math.max(8, s.width * 1.4);
      return (
        <G key={s.id}>
          <Path
            d={polylinePath(s.points)}
            stroke={s.color}
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {s.points.map((p, i) => (
            <G key={i}>
              <Circle cx={p.x} cy={p.y} r={r + 2} fill="rgba(255,255,255,0.95)" />
              <Circle cx={p.x} cy={p.y} r={r} fill={s.color} />
              {i === 0 ? (
                <Circle cx={p.x} cy={p.y} r={r + 6} stroke="#ffffff" strokeWidth={2} fill="none" />
              ) : null}
            </G>
          ))}
        </G>
      );
    }
    case "rect":
      return (
        <Rect
          key={s.id}
          x={Math.min(s.from.x, s.to.x)}
          y={Math.min(s.from.y, s.to.y)}
          width={Math.abs(s.to.x - s.from.x)}
          height={Math.abs(s.to.y - s.from.y)}
          stroke={s.color}
          strokeWidth={s.width}
          strokeLinejoin="round"
          fill="none"
        />
      );
    case "ellipse":
      return (
        <Ellipse
          key={s.id}
          cx={(s.from.x + s.to.x) / 2}
          cy={(s.from.y + s.to.y) / 2}
          rx={Math.abs(s.to.x - s.from.x) / 2}
          ry={Math.abs(s.to.y - s.from.y) / 2}
          stroke={s.color}
          strokeWidth={s.width}
          fill="none"
        />
      );
    case "arrow": {
      const d = taperedArrowPath(s.from, s.to, s.width);
      return d ? <Path key={s.id} d={d} fill={s.color} /> : null;
    }
    case "measure":
      return renderMeasure(s, pxPerInch, canvas);
    case "text": {
      /*
       * Two stacked copies, outline behind and fill in front. SVG's
       * `paint-order` would do it in one, and react-native-svg does not expose
       * it. The baseline sits 0.8 of the size below `pos`, standing in for
       * web's `textBaseline = "top"`.
       */
      const common = {
        x: s.pos.x,
        y: s.pos.y + s.size * 0.8,
        fontSize: s.size,
        fontWeight: "600" as const,
      };
      return (
        <G key={s.id}>
          <SvgText
            {...common}
            fill="none"
            stroke={readableOutline(s.color)}
            strokeWidth={Math.max(2, s.size / 14) * 2}
            strokeLinejoin="round"
          >
            {s.text}
          </SvgText>
          <SvgText {...common} fill={s.color}>
            {s.text}
          </SvgText>
        </G>
      );
    }
    case "sticker":
      return (
        <SvgText key={s.id} x={s.pos.x} y={s.pos.y + s.size * 0.85} fontSize={s.size}>
          {s.glyph}
        </SvgText>
      );
    default:
      return null;
  }
}

/** Web's dimension line: white halo, the line, end caps, and a dark label chip. */
function renderMeasure(s: Extract<Shape, { kind: "measure" }>, pxPerInch: number, canvas: Size) {
  const m = measureLayout(s.from, s.to, s.width, canvas);
  if (m.len < 1) return null;
  const line = `M${s.from.x} ${s.from.y} L${s.to.x} ${s.to.y}`;
  const cap = (x: number, y: number) =>
    `M${x + m.nx * m.capLen} ${y + m.ny * m.capLen} L${x - m.nx * m.capLen} ${y - m.ny * m.capLen}`;
  const caps = `${cap(s.from.x, s.from.y)} ${cap(s.to.x, s.to.y)}`;
  const label = formatMeasure(m.len, pxPerInch);
  // No text metrics in react-native-svg, so the chip is sized from an estimate
  // of bold digits, which is what the label is almost entirely made of.
  const bw = label.length * m.fontSize * 0.52 + m.padX * 2;
  return (
    <G key={s.id}>
      <Path
        d={line}
        stroke="rgba(255,255,255,0.9)"
        strokeWidth={m.w + 4}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d={`${line} ${caps}`}
        stroke={s.color}
        strokeWidth={m.w}
        strokeLinecap="round"
        fill="none"
      />
      <G transform={`translate(${m.labelAt.x} ${m.labelAt.y}) rotate(${m.labelRotationDeg})`}>
        <Rect
          x={-bw / 2}
          y={-m.bh / 2}
          width={bw}
          height={m.bh}
          rx={m.bh / 2}
          ry={m.bh / 2}
          fill="rgba(15,23,42,0.92)"
        />
        <SvgText
          x={0}
          y={m.fontSize * 0.36}
          fontSize={m.fontSize}
          fontWeight="700"
          textAnchor="middle"
          fill="#ffffff"
        >
          {label}
        </SvgText>
      </G>
    </G>
  );
}

export const AnnotationCanvas = forwardRef<Svg, AnnotationCanvasProps>(function AnnotationCanvas(
  { uri, width, height, image, shapes, pxPerInch, adjust = NO_ADJUST, overlay, viewBox },
  ref,
) {
  const filtered = isAdjusted(adjust);
  return (
    <Svg ref={ref} width={width} height={height} viewBox={viewBox ?? `0 0 ${image.w} ${image.h}`}>
      {filtered ? (
        <Defs>
          <Filter id="adjust" x={0} y={0} width="100%" height="100%">
            <FeColorMatrix type="matrix" values={adjustMatrix(adjust)} />
          </Filter>
        </Defs>
      ) : null}
      <SvgImage
        href={{ uri }}
        x={0}
        y={0}
        width={image.w}
        height={image.h}
        /*
         * `meet`, not `slice`. The surface always has the photo's own aspect,
         * so the two agree and neither crops; if they ever disagree, `meet`
         * letterboxes where `slice` would silently cut the picture down and
         * write the cropped version to the saved copy.
         */
        preserveAspectRatio="xMidYMid meet"
        filter={filtered ? "url(#adjust)" : undefined}
      />
      {shapes.map((s) => renderShape(s, pxPerInch, image))}
      {overlay}
    </Svg>
  );
});
