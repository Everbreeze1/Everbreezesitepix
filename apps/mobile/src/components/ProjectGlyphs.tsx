import Svg, { Circle, Line } from "react-native-svg";

/**
 * Two glyphs the project screens need that the icon registry does not carry.
 *
 * Drawn with the same 24-unit grid and 2px round strokes as lucide, so they sit
 * beside registry icons without looking borrowed. If `EllipsisVertical` and
 * `SlidersHorizontal` are added to `@/ui/icons`, these can go.
 */

export function MoreGlyph({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={5} r={1.6} fill={color} />
      <Circle cx={12} cy={12} r={1.6} fill={color} />
      <Circle cx={12} cy={19} r={1.6} fill={color} />
    </Svg>
  );
}

export function FilterGlyph({ color, size = 22 }: { color: string; size?: number }) {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={3} y1={6} x2={21} y2={6} {...stroke} />
      <Line x1={3} y1={12} x2={21} y2={12} {...stroke} />
      <Line x1={3} y1={18} x2={21} y2={18} {...stroke} />
      <Circle cx={15} cy={6} r={2.2} fill={color} />
      <Circle cx={8} cy={12} r={2.2} fill={color} />
      <Circle cx={16} cy={18} r={2.2} fill={color} />
    </Svg>
  );
}
