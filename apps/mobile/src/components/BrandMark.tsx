import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Stop } from "react-native-svg";

/**
 * The Everlumen aperture, drawn from the same geometry as the web logo.
 *
 * A direct port of `apps/web/src/assets/logo.svg` rather than an exported PNG.
 * Vector means it is exact at every screen density, has no banding in the
 * gradients, and cannot drift from the web mark the way a re-drawn or
 * AI-generated copy does. It also costs no image asset in the bundle.
 *
 * The viewBox is the original 512 grid, so every coordinate below is lifted
 * unchanged from the source file and can be diffed against it.
 */

/** Blade gradients: each runs from a different outer point toward the centre. */
const BLADES = [
  {
    id: "b0",
    x1: 377.686,
    y1: 404.515,
    d: "M 287.125 445.46 L 332.693 231.081 L 435.64 323.775 A 192 192 0 0 1 287.125 445.46 Z",
  },
  {
    id: "b1",
    x1: 445.46,
    y1: 224.875,
    d: "M 435.64 323.775 L 272.766 177.122 L 404.515 134.314 A 192 192 0 0 1 435.64 323.775 Z",
  },
  {
    id: "b2",
    x1: 323.775,
    y1: 76.36,
    d: "M 404.515 134.314 L 196.073 202.041 L 224.875 66.54 A 192 192 0 0 1 404.515 134.314 Z",
  },
  {
    id: "b3",
    x1: 134.314,
    y1: 107.485,
    d: "M 224.875 66.54 L 179.307 280.919 L 76.36 188.225 A 192 192 0 0 1 224.875 66.54 Z",
  },
  {
    id: "b4",
    x1: 66.54,
    y1: 287.125,
    d: "M 76.36 188.225 L 239.234 334.878 L 107.485 377.686 A 192 192 0 0 1 76.36 188.225 Z",
  },
  {
    id: "b5",
    x1: 188.225,
    y1: 435.64,
    d: "M 107.485 377.686 L 315.927 309.959 L 287.125 445.46 A 192 192 0 0 1 107.485 377.686 Z",
  },
];

/** The dark gaps between blades, which is what makes it read as an iris. */
const SEPARATORS = [
  "M 315.927 309.959 L 287.125 445.46",
  "M 332.693 231.081 L 435.64 323.775",
  "M 272.766 177.122 L 404.515 134.314",
  "M 196.073 202.041 L 224.875 66.54",
  "M 179.307 280.919 L 76.36 188.225",
  "M 239.234 334.878 L 107.485 377.686",
];

export type BrandMarkProps = {
  size: number;
  /**
   * Colour of the gaps between blades. Matches whatever sits behind the mark so
   * the blades read as separate rather than as one disc with lines drawn on it.
   */
  gapColor?: string;
};

export function BrandMark({ size, gapColor = "#171B24" }: BrandMarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        {BLADES.map((blade) => (
          <LinearGradient
            key={blade.id}
            id={blade.id}
            gradientUnits="userSpaceOnUse"
            x1={blade.x1}
            y1={blade.y1}
            x2={256}
            y2={256}
          >
            <Stop offset="0" stopColor="#1E5AA6" />
            <Stop offset="1" stopColor="#3E8ADF" />
          </LinearGradient>
        ))}

        {/* The lit well at the centre: warm white cooling outward into blue. */}
        <RadialGradient id="well" gradientUnits="userSpaceOnUse" cx={256} cy={256} r={88.32}>
          <Stop offset="0" stopColor="#FFF8EC" />
          <Stop offset="0.45" stopColor="#CFE7FF" />
          <Stop offset="1" stopColor="#7DB6EE" />
        </RadialGradient>

        <RadialGradient id="halo" gradientUnits="userSpaceOnUse" cx={256} cy={256} r={76.8}>
          <Stop offset="0" stopColor="#FFF8EC" stopOpacity={0.45} />
          <Stop offset="0.4" stopColor="#FFF8EC" stopOpacity={0.2} />
          <Stop offset="0.75" stopColor="#A8D4FF" stopOpacity={0.07} />
          <Stop offset="1" stopColor="#A8D4FF" stopOpacity={0} />
        </RadialGradient>
      </Defs>

      <Circle cx={256} cy={256} r={88.32} fill="url(#well)" />

      <G>
        {BLADES.map((blade) => (
          <Path key={blade.id} d={blade.d} fill={`url(#${blade.id})`} />
        ))}
      </G>

      <G stroke={gapColor} strokeWidth={14} strokeLinecap="butt" fill="none">
        {SEPARATORS.map((d) => (
          <Path key={d} d={d} />
        ))}
      </G>

      <Circle cx={256} cy={256} r={76.8} fill="url(#halo)" />
      <Circle cx={256} cy={256} r={32.64} fill="#FFF8EC" />
    </Svg>
  );
}
