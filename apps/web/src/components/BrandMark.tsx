import { useId } from "react";

/**
 * The Everlumen aperture, drawn rather than loaded.
 *
 * This is a port of `apps/web/src/assets/logo.svg`, not an exported PNG. Vector
 * means it is exact at every device pixel ratio, the gradients do not band, and
 * the mark cannot drift from the asset the app icons are rendered from. Every
 * coordinate below is lifted unchanged from that file and can be diffed
 * against it.
 *
 * Geometry: outer vertices sit at r=50 about (75,75) every 60 degrees from
 * -90; inner vertices at r=22 every 60 degrees from -115. The 25 degree offset
 * between the rings is the twist. Each blade runs outer[n] -> arc ->
 * outer[n+1] -> inner[n+1] -> inner[n], so neighbouring blades share their
 * straight edge exactly and the disc closes solid except for the hexagonal
 * opening at the centre.
 */

/** `[d, opacity]`. The alternating opacity is what makes six wedges read as
 *  blades catching light at different angles rather than as a pinwheel. */
const BLADES: Array<[string, number]> = [
  ["M75,25 A50,50 0 0 1 118.3,50 L 87.62,56.98 L 65.70,55.06 Z", 1],
  ["M118.3,50 A50,50 0 0 1 118.3,100 L 96.92,76.92 L 87.62,56.98 Z", 0.88],
  ["M118.3,100 A50,50 0 0 1 75,125 L 84.30,94.94 L 96.92,76.92 Z", 1],
  ["M75,125 A50,50 0 0 1 31.7,100 L 62.38,93.02 L 84.30,94.94 Z", 0.88],
  ["M31.7,100 A50,50 0 0 1 31.7,50 L 53.08,73.08 L 62.38,93.02 Z", 1],
  ["M31.7,50 A50,50 0 0 1 75,25 L 65.70,55.06 L 53.08,73.08 Z", 0.88],
];

/** Outer vertex to the inner vertex 25 degrees behind it: the twisted seams.
 *  Without them the silhouette is a plain gold circle. */
const SEAMS = [
  "M75,25 L65.70,55.06",
  "M118.3,50 L87.62,56.98",
  "M118.3,100 L96.92,76.92",
  "M75,125 L84.30,94.94",
  "M31.7,100 L62.38,93.02",
  "M31.7,50 L53.08,73.08",
];

/** The aperture itself, as a polygon, for masking the glow out of it. */
const APERTURE = "65.70,55.06 87.62,56.98 96.92,76.92 84.30,94.94 62.38,93.02 53.08,73.08";

const TONES = {
  /** On the brand navy and on anything else dark. */
  dark: { blade: "#FFB020", seam: "#1E2B4D", gap: "#171A2C", hole: "#171A2C" },
  /** Reversed. The gold is darkened because #FFB020 on a light ground measures
   *  under 2:1 and the blades stop being distinguishable from the paper. */
  light: { blade: "#D97C0A", seam: "#3A4A6B", gap: "#EAE7E0", hole: "#EAE7E0" },
} as const;

/**
 * How much of the mark survives at a given size.
 *
 * Below about 24px the seams collapse into the blade edges and the whole thing
 * turns into gold mud, so it simplifies to the silhouette that still reads:
 * a solid disc with the aperture punched out of it.
 */
function detailFor(size: number) {
  if (size >= 48) return "full" as const;
  if (size >= 24) return "plain" as const;
  return "minimal" as const;
}

export type BrandMarkProps = {
  size?: number;
  /** Whether the mark sits on a dark or a light ground. */
  tone?: keyof typeof TONES;
  /**
   * Colour of the hairline around each blade, which has to match whatever is
   * actually behind the mark. Override it when the surface is not the default
   * for the tone; pass `null` to drop the hairline entirely.
   *
   * Worth being precise about, because the obvious reading is wrong: the seams
   * are drawn over the shared edges at three times the width, so the only
   * hairline anyone ever sees is on the disc rim and around the aperture. Both
   * of those are places the background shows through, so this is a backdrop
   * colour, not an outline colour, and a value darker than the backdrop puts a
   * keyline round the mark.
   */
  gapColor?: string | null;
  className?: string;
};

export function BrandMark({ size = 40, tone = "dark", gapColor, className }: BrandMarkProps) {
  /*
   * Gradient and mask ids are document-global in SVG, so two marks on one page
   * (the site header and the site footer, for instance) would have the second
   * one's defs silently win for both. `useId` keeps each instance referring to
   * its own.
   *
   * Stripped to alphanumerics rather than to anything narrower: React has
   * wrapped the id in `:` and, since 19, in guillemets, and neither belongs
   * inside a `url(#...)` reference.
   */
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const t = TONES[tone];
  const gap = gapColor === undefined ? t.gap : gapColor;
  const detail = detailFor(size);

  // Strokes are in user units, so a mark rendered small needs them thickened
  // to survive the downscale.
  const seamWidth = detail === "full" ? 3 : 3.5;
  const gapWidth = detail === "full" ? 1 : 1.5;

  if (detail === "minimal") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 150 150"
        className={className}
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="75" cy="75" r="50" fill={t.blade} />
        <circle cx="75" cy="75" r="12" fill={t.hole} />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 150 150"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {detail === "full" && (
        <defs>
          <radialGradient id={`glow-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={t.blade} stopOpacity="0.45" />
            <stop offset="100%" stopColor={t.blade} stopOpacity="0" />
          </radialGradient>
          <filter id={`blur-${uid}`}>
            <feGaussianBlur stdDeviation="6" />
          </filter>
          {/* Keeps the light bleeding past the rim out of the aperture, so the
              opening still reads as a hole and not as a lit well. */}
          <mask id={`hole-${uid}`}>
            <rect width="150" height="150" fill="white" />
            <polygon points={APERTURE} fill="black" />
          </mask>
        </defs>
      )}

      {detail === "full" && (
        <circle
          cx="75"
          cy="75"
          r="58"
          fill={`url(#glow-${uid})`}
          filter={`url(#blur-${uid})`}
          mask={`url(#hole-${uid})`}
        />
      )}

      <g stroke={gap ?? undefined} strokeWidth={gap ? gapWidth : undefined} strokeLinejoin="round">
        {BLADES.map(([d, opacity]) => (
          <path key={d} d={d} fill={t.blade} opacity={opacity === 1 ? undefined : opacity} />
        ))}
      </g>

      <g fill="none" stroke={t.seam} strokeWidth={seamWidth} strokeLinecap="round">
        {SEAMS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}
