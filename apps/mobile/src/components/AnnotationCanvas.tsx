import { forwardRef } from "react";
import Svg, { Ellipse, Image as SvgImage, Path, Rect } from "react-native-svg";
import { arrowHead, boxOf, penPath, type Shape } from "@/api/annotation";

/**
 * The photo with its markup on top, as one SVG.
 *
 * Used twice with the same props: once on screen at whatever size the phone
 * gives it, and once off screen at the photo's real pixel size to be
 * rasterised. Rendering the saved copy through the same component as the
 * preview is the only way to be sure they match, and matching is the whole
 * problem: an annotation that lands correctly in the editor and two hundred
 * pixels off in the saved file looks right until someone opens it on the web.
 *
 * The image is inside the SVG rather than behind it so `toDataURL` flattens
 * both together. An `<Image>` sitting underneath would rasterise to markup on
 * transparency.
 */
export type AnnotationCanvasProps = {
  uri: string;
  width: number;
  height: number;
  shapes: Shape[];
  /** The stroke in progress, drawn but not yet committed. */
  draft?: Shape | null;
};

function renderShape(shape: Shape, width: number, height: number) {
  const stroke = shape.color;
  // Stroke width is normalised too, so it thickens with the render size instead
  // of turning into a hairline on the full-size copy.
  const strokeWidth = Math.max(1, shape.width * Math.min(width, height));

  switch (shape.tool) {
    case "pen":
      return (
        <Path
          key={shape.id}
          d={penPath(shape, width, height)}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      );
    case "arrow": {
      const x1 = shape.from.x * width;
      const y1 = shape.from.y * height;
      const x2 = shape.to.x * width;
      const y2 = shape.to.y * height;
      return (
        <Path
          key={shape.id}
          d={`M${x1} ${y1} L${x2} ${y2} ${arrowHead(shape, width, height)}`}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      );
    }
    case "rect": {
      const box = boxOf(shape, width, height);
      return (
        <Rect
          key={shape.id}
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
        />
      );
    }
    case "ellipse": {
      const box = boxOf(shape, width, height);
      return (
        <Ellipse
          key={shape.id}
          cx={box.x + box.width / 2}
          cy={box.y + box.height / 2}
          rx={box.width / 2}
          ry={box.height / 2}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
        />
      );
    }
    default:
      return null;
  }
}

export const AnnotationCanvas = forwardRef<Svg, AnnotationCanvasProps>(function AnnotationCanvas(
  { uri, width, height, shapes, draft },
  ref,
) {
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
      {shapes.map((shape) => renderShape(shape, width, height))}
      {draft ? renderShape(draft, width, height) : null}
    </Svg>
  );
});
