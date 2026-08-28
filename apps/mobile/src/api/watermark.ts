/**
 * The before/after pill burnt into a captured photo, free of imports so the
 * geometry can be tested directly.
 *
 * WHY THIS EXISTS
 *
 * The web app bakes this pill into every photo it uploads, through
 * `applyWatermarkToFile` in `apps/web/src/lib/watermark.ts`. Mobile captures had
 * none. Both clients write into one `photos` table and one gallery, so the same
 * job ends up with some photos labelled in the pixels and some not, and nothing
 * on screen explains why. It was found by opening a photo on the device and
 * seeing a green AFTER pill the phone had never drawn.
 *
 * Every number here is copied from that file rather than chosen. A pill at a
 * different size or inset would be visibly a different pill in a grid that
 * mixes both sources, which is worse than having none.
 */

/** The only two values that get a pill. */
export type WatermarkTag = "before" | "after";

/**
 * Whether a phase gets a pill at all.
 *
 * `untagged` deliberately gets nothing. The web version used to stamp a slate
 * "UNTAGGED" chip and removed it, for a reason worth repeating: the word is
 * burnt into the JPEG forever, so tagging the photo properly a minute later
 * leaves the pixels contradicting the record with no way to resync. It also
 * conflated "the shooter picked the Untagged capture mode" with `photos.tags`,
 * which is a different thing entirely.
 */
export function tagForPhase(phase: string | null | undefined): WatermarkTag | null {
  return phase === "before" || phase === "after" ? phase : null;
}

export type PillGeometry = {
  /** Box position and size, in image pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius. A full pill, so half the height. */
  radius: number;
  /** Font size for the label. */
  fontSize: number;
  /** Baseline-centred text origin. */
  textX: number;
  textY: number;
  /** Fill and stroke, matching web exactly. */
  fill: string;
  stroke: string;
  strokeWidth: number;
  label: string;
};

/**
 * Approximate advance width per character at weight 800, as a fraction of the
 * font size.
 *
 * The web version measures the string with `ctx.measureText`. React Native has
 * no equivalent before layout, and the pill has to be sized before it is drawn,
 * so this approximates instead. That is tolerable here for one reason only:
 * there are exactly two possible strings. The ratios below are per label rather
 * than per character, so neither has to be guessed from an average that fits
 * neither.
 *
 * Slightly generous on purpose. A box a few pixels wider than the text reads as
 * padding; one a few pixels narrower clips a letter.
 */
const LABEL_WIDTH_RATIO: Record<WatermarkTag, number> = {
  before: 4.05,
  after: 3.35,
};

/** Web's fills, unchanged. Blue for before, green for after. */
const FILL: Record<WatermarkTag, string> = {
  before: "rgba(37,99,235,0.96)",
  after: "rgba(16,185,129,0.96)",
};

/**
 * Where the pill goes on an image of this size.
 *
 * Top-right, inset by 3.5% of the shorter edge, with the label at 8.2% of that
 * edge and a 30px floor so a small image still gets a readable badge. All four
 * constants are web's.
 */
export function pillGeometry(width: number, height: number, tag: WatermarkTag): PillGeometry {
  const minDim = Math.min(width, height);
  const pad = Math.round(minDim * 0.035);
  const fontSize = Math.max(30, Math.round(minDim * 0.082));

  const label = tag.toUpperCase();
  const textWidth = fontSize * LABEL_WIDTH_RATIO[tag];

  const px = Math.round(fontSize * 0.78);
  const py = Math.round(fontSize * 0.45);
  const boxW = Math.round(textWidth + px * 2);
  const boxH = Math.round(fontSize + py * 2);

  const x = width - pad - boxW;
  const y = pad;

  return {
    x,
    y,
    width: boxW,
    height: boxH,
    radius: Math.round(boxH * 0.5),
    fontSize,
    textX: x + px,
    // Web nudges the baseline down by 4% of the font size to sit optically
    // centred rather than mathematically centred.
    textY: y + boxH / 2 + Math.round(fontSize * 0.04),
    fill: FILL[tag],
    stroke: "rgba(255,255,255,0.55)",
    strokeWidth: Math.max(1, Math.round(minDim * 0.003)),
    label,
  };
}
