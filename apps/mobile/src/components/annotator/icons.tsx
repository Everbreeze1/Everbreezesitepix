import type { ComponentType } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import {
  Check,
  CircleOutline,
  Clock,
  Copy,
  Palette,
  Redo2,
  RotateCw,
  Ruler,
  Save,
  SlidersVertical,
  Smile,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from "./lucide";

/**
 * The annotator's tool glyphs: exactly the ones the web toolbar shows.
 *
 * Most are lucide icons, the same ones web imports. Four are web's own inline
 * SVGs (Freehand's squiggle, Line's three-point polyline, the Arrow and the
 * overlapping-squares Crop), copied here path for path because lucide has no
 * equivalent and web does not use one.
 */
export type IconName =
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
  | "label"
  | "save";

type LucideLike = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

const LUCIDE: Partial<Record<IconName, LucideLike>> = {
  measure: Ruler,
  ellipse: CircleOutline,
  rect: Square,
  text: Type,
  label: Type,
  timestamp: Clock,
  sticker: Smile,
  palette: Palette,
  adjust: SlidersVertical,
  rotate: RotateCw,
  undo: Undo2,
  redo: Redo2,
  trash: Trash2,
  check: Check,
  close: X,
  copy: Copy,
  save: Save,
};

export function ToolIcon({
  name,
  color = "#fff",
  size = 22,
  strokeWidth = 2,
}: {
  name: IconName;
  color?: string;
  size?: number;
  strokeWidth?: number;
}) {
  const Icon = LUCIDE[name];
  if (Icon) return <Icon color={color} size={size} strokeWidth={strokeWidth} />;
  const p = {
    stroke: color,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "pen" ? <Path {...p} d="M3 15c2-4 4-4 6 0s4 4 6 0 4-4 6 0" /> : null}
      {name === "polyline" ? (
        <>
          <Circle {...p} cx={6} cy={18} r={2} />
          <Circle {...p} cx={18} cy={18} r={2} />
          <Circle {...p} cx={12} cy={5} r={2} />
          <Path {...p} d="M7.5 16.5 11 8" />
          <Path {...p} d="M16.5 16.5 13 8" />
        </>
      ) : null}
      {name === "arrow" ? (
        <>
          <Path {...p} d="M19 5 6 18" />
          <Path {...p} d="M10 18H6v-4" />
        </>
      ) : null}
      {name === "crop" ? (
        <>
          <Rect {...p} x={4} y={4} width={12} height={12} rx={1.5} />
          <Rect {...p} x={8} y={8} width={12} height={12} rx={1.5} />
        </>
      ) : null}
    </Svg>
  );
}
