import type { ReactNode } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * The annotator's tool glyphs.
 *
 * Drawn here rather than taken from lucide: the custom ones (polyline, arrow,
 * squiggle, crop) are web's own SVGs copied path for path, and the rest are
 * lucide's outlines at the same 24px grid, so the rail reads like web's.
 */
export type IconName =
  | "select"
  | "pen"
  | "polyline"
  | "arrow"
  | "measure"
  | "ellipse"
  | "rect"
  | "text"
  | "timestamp"
  | "sticker"
  | "palette"
  | "adjust"
  | "rotate"
  | "crop"
  | "undo"
  | "redo"
  | "trash"
  | "check"
  | "close"
  | "copy"
  | "label";

export function ToolIcon({
  name,
  color = "#fff",
  size = 22,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  const p = {
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  let body: ReactNode = null;
  switch (name) {
    case "select":
      body = <Path {...p} d="M4 4l7 17 2.5-7.5L21 11z" />;
      break;
    case "pen":
      body = <Path {...p} d="M3 15c2-4 4-4 6 0s4 4 6 0 4-4 6 0" />;
      break;
    case "polyline":
      body = (
        <>
          <Circle {...p} cx={6} cy={18} r={2} />
          <Circle {...p} cx={18} cy={18} r={2} />
          <Circle {...p} cx={12} cy={5} r={2} />
          <Path {...p} d="M7.5 16.5 11 8" />
          <Path {...p} d="M16.5 16.5 13 8" />
        </>
      );
      break;
    case "arrow":
      body = (
        <>
          <Path {...p} d="M19 5 6 18" />
          <Path {...p} d="M10 18H6v-4" />
        </>
      );
      break;
    case "measure":
      body = (
        <>
          <Path
            {...p}
            d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"
          />
          <Path {...p} d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2" />
        </>
      );
      break;
    case "ellipse":
      body = <Circle {...p} cx={12} cy={12} r={9} />;
      break;
    case "rect":
      body = <Rect {...p} x={3} y={3} width={18} height={18} rx={2} />;
      break;
    case "text":
      body = <Path {...p} d="M4 7V4h16v3M9 20h6M12 4v16" />;
      break;
    case "timestamp":
      body = (
        <>
          <Circle {...p} cx={12} cy={12} r={9} />
          <Path {...p} d="M12 7v5l3 2" />
        </>
      );
      break;
    case "sticker":
      body = (
        <>
          <Circle {...p} cx={12} cy={12} r={9} />
          <Path {...p} d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
        </>
      );
      break;
    case "palette":
      body = (
        <>
          <Path
            {...p}
            d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1.5 3.3A1.6 1.6 0 0 1 12 22z"
          />
          <Circle cx={7.5} cy={10.5} r={1.2} fill={color} />
          <Circle cx={12} cy={7} r={1.2} fill={color} />
          <Circle cx={16.5} cy={10.5} r={1.2} fill={color} />
        </>
      );
      break;
    case "adjust":
      body = (
        <Path {...p} d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
      );
      break;
    case "rotate":
      body = (
        <>
          <Path {...p} d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.8L21 8" />
          <Path {...p} d="M21 3v5h-5" />
        </>
      );
      break;
    case "crop":
      body = (
        <>
          <Rect {...p} x={4} y={4} width={12} height={12} rx={1.5} />
          <Rect {...p} x={8} y={8} width={12} height={12} rx={1.5} />
        </>
      );
      break;
    case "undo":
      body = <Path {...p} d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />;
      break;
    case "redo":
      body = <Path {...p} d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />;
      break;
    case "trash":
      body = (
        <Path
          {...p}
          d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
        />
      );
      break;
    case "check":
      body = <Path {...p} strokeWidth={3} d="M20 6 9 17l-5-5" />;
      break;
    case "close":
      body = <Path {...p} d="M18 6 6 18M6 6l12 12" />;
      break;
    case "copy":
      body = (
        <>
          <Rect {...p} x={8} y={8} width={14} height={14} rx={2} />
          <Path {...p} d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </>
      );
      break;
    case "label":
      body = <Path {...p} d="M4 7V4h16v3M9 20h6M12 4v16" />;
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}
