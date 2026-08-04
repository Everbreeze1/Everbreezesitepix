/**
 * Contrast helpers for surfaces painted with a user-chosen brand colour.
 *
 * A portfolio's accent is picked by the contractor from a colour input, so it
 * can be anything — including pale yellow. Hardcoding white button text is what
 * turns "brand colour" into "illegible button", hence these.
 */

/** #rgb / #rrggbb -> [r, g, b]; null when it isn't a hex colour. */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1];
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Black or white text, whichever has more contrast against `background`.
 *
 * The 0.55 threshold rather than the textbook 0.179 is deliberate: it is tuned
 * for large, bold display type on big colour fields, where white stays readable
 * further down the luminance scale than body copy would.
 */
export function readableTextOn(background: string | null | undefined): string {
  const rgb = background ? parseHex(background) : null;
  if (!rgb) return "#ffffff";
  return luminance(rgb) > 0.55 ? "#111111" : "#ffffff";
}

/** `rgba()` version of a hex colour, for tints and hairlines. */
export function withAlpha(hex: string | null | undefined, alpha: number): string {
  const rgb = hex ? parseHex(hex) : null;
  if (!rgb) return `rgba(37, 99, 235, ${alpha})`;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * Darkens toward black by `amount` (0–1). Used for hover states, where
 * `filter: brightness()` would also wash out the text sitting on top.
 */
export function darken(hex: string | null | undefined, amount: number): string {
  const rgb = hex ? parseHex(hex) : null;
  if (!rgb) return "#1d4ed8";
  const k = 1 - Math.min(Math.max(amount, 0), 1);
  const to = (v: number) =>
    Math.round(v * k)
      .toString(16)
      .padStart(2, "0");
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}
