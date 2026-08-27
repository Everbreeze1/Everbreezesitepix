import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from "react-native-svg";

/**
 * The Everlumen aperture, drawn from the same geometry as the web logo.
 *
 * A direct port of `apps/web/src/assets/logo.svg` rather than an exported PNG.
 * Vector means it is exact at every screen density, has no banding in the
 * gradients, and cannot drift from the web mark the way a re-drawn or
 * AI-generated copy does. It also costs no image asset in the bundle.
 *
 * The viewBox is the original 150 grid, so every coordinate below is lifted
 * unchanged from the source file and can be diffed against it. Outer vertices
 * sit at r=50 about (75,75) every 60 degrees from -90, inner vertices at r=22
 * every 60 degrees from -115, and the 25 degree offset between the two rings is
 * the twist. Each blade runs outer[n] -> arc -> outer[n+1] -> inner[n+1] ->
 * inner[n], so neighbouring blades share their straight edge exactly and the
 * disc closes solid except for the hexagonal opening at the centre.
 */

/**
 * The six blades. The alternating opacity is what makes them read as blades
 * catching light at different angles rather than as a flat pinwheel.
 */
const BLADES: Array<{ d: string; opacity: number }> = [
  { d: "M75,25 A50,50 0 0 1 118.3,50 L 87.62,56.98 L 65.70,55.06 Z", opacity: 1 },
  { d: "M118.3,50 A50,50 0 0 1 118.3,100 L 96.92,76.92 L 87.62,56.98 Z", opacity: 0.88 },
  { d: "M118.3,100 A50,50 0 0 1 75,125 L 84.30,94.94 L 96.92,76.92 Z", opacity: 1 },
  { d: "M75,125 A50,50 0 0 1 31.7,100 L 62.38,93.02 L 84.30,94.94 Z", opacity: 0.88 },
  { d: "M31.7,100 A50,50 0 0 1 31.7,50 L 53.08,73.08 L 62.38,93.02 Z", opacity: 1 },
  { d: "M31.7,50 A50,50 0 0 1 75,25 L 65.70,55.06 L 53.08,73.08 Z", opacity: 0.88 },
];

/**
 * Outer vertex to the inner vertex 25 degrees behind it: the twisted seams.
 * They are what breaks the silhouette, so without them the mark is a gold disc.
 */
const SEAMS = [
  "M75,25 L65.70,55.06",
  "M118.3,50 L87.62,56.98",
  "M118.3,100 L96.92,76.92",
  "M75,125 L84.30,94.94",
  "M31.7,100 L62.38,93.02",
  "M31.7,50 L53.08,73.08",
];

export type BrandMarkProps = {
  size: number;
  /**
   * Colour of the hairline around each blade, which has to match whatever sits
   * behind the mark.
   *
   * Worth being precise about, because the obvious reading is wrong: the seams
   * are drawn over the shared edges at four times the width, so the only
   * hairline anyone ever sees is on the disc rim and around the aperture. Both
   * of those are places the background shows through, so this is a backdrop
   * colour, not an outline colour, and a value darker than the backdrop puts a
   * keyline round the mark.
   */
  gapColor?: string;
};

export function BrandMark({ size, gapColor = "#171A2C" }: BrandMarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 150 150">
      <Defs>
        {/*
         * The rim glow.
         *
         * The web artwork blurs a filled disc and masks the aperture out of it.
         * react-native-svg has no dependable `feGaussianBlur` across both
         * platforms, so this is a gradient shaped to the same result instead:
         * held at zero out past the aperture, so no light leaks through the
         * opening, and carrying only in the band from the rim outward, which is
         * the only part the opaque blades do not cover anyway.
         */}
        <RadialGradient id="rim" gradientUnits="userSpaceOnUse" cx={75} cy={75} r={58}>
          <Stop offset="0" stopColor="#FFB020" stopOpacity={0} />
          <Stop offset="0.45" stopColor="#FFB020" stopOpacity={0} />
          <Stop offset="0.86" stopColor="#FFB020" stopOpacity={0.28} />
          <Stop offset="1" stopColor="#FFB020" stopOpacity={0} />
        </RadialGradient>
      </Defs>

      <Circle cx={75} cy={75} r={58} fill="url(#rim)" />

      <G stroke={gapColor} strokeWidth={1} strokeLinejoin="round">
        {BLADES.map((blade) => (
          <Path key={blade.d} d={blade.d} fill="#FFB020" opacity={blade.opacity} />
        ))}
      </G>

      <G fill="none" stroke="#1E2B4D" strokeWidth={3} strokeLinecap="round">
        {SEAMS.map((d) => (
          <Path key={d} d={d} />
        ))}
      </G>
    </Svg>
  );
}
