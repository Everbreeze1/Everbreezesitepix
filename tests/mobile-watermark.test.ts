import { describe, expect, it } from "vitest";
import { pillGeometry, tagForPhase } from "../apps/mobile/src/api/watermark";

/*
 * The before/after pill burnt into a captured photo.
 *
 * Every constant is copied from `apps/web/src/lib/watermark.ts`, because both
 * clients write into one gallery. A pill at a different size or inset would be
 * visibly a different pill sitting next to web's, which is worse than the phone
 * drawing none at all.
 */

describe("tagForPhase", () => {
  it("gives before and after a pill", () => {
    expect(tagForPhase("before")).toBe("before");
    expect(tagForPhase("after")).toBe("after");
  });

  it("gives untagged nothing at all", () => {
    /*
     * The web version stamped a slate "UNTAGGED" chip and removed it. The word
     * is burnt into the JPEG forever, so tagging the photo properly a minute
     * later leaves the pixels contradicting the record with no way to resync.
     * Mobile must not reintroduce it.
     */
    expect(tagForPhase("untagged")).toBeNull();
    expect(tagForPhase(null)).toBeNull();
    expect(tagForPhase(undefined)).toBeNull();
    expect(tagForPhase("")).toBeNull();
  });

  it("gives an unknown phase nothing", () => {
    // `photos.phase` is a nullable text column with no enum behind it, so a row
    // written by an older client can hold anything.
    expect(tagForPhase("during")).toBeNull();
  });
});

describe("pillGeometry", () => {
  // A 2048px long edge is what `MAX_DIM` in photos.ts stores, so this is the
  // realistic case rather than a round number.
  const landscape = pillGeometry(2048, 1536, "after");

  it("insets by 3.5% of the shorter edge", () => {
    // minDim 1536 -> pad 54.
    expect(landscape.y).toBe(54);
    expect(2048 - (landscape.x + landscape.width)).toBe(54);
  });

  it("sizes the label at 8.2% of the shorter edge", () => {
    expect(landscape.fontSize).toBe(Math.round(1536 * 0.082));
  });

  it("keeps a 30px floor on small images", () => {
    /*
     * A thumbnail-sized image would otherwise get a label a few pixels tall,
     * which is a smudge rather than a badge.
     */
    const tiny = pillGeometry(200, 150, "before");
    expect(tiny.fontSize).toBe(30);
  });

  it("is a full pill, not a rounded rectangle", () => {
    expect(landscape.radius).toBe(Math.round(landscape.height / 2));
  });

  it("uses web's blue for before and green for after", () => {
    expect(pillGeometry(2048, 1536, "before").fill).toBe("rgba(37,99,235,0.96)");
    expect(pillGeometry(2048, 1536, "after").fill).toBe("rgba(16,185,129,0.96)");
  });

  it("stays inside the image on a portrait photo", () => {
    // The shorter edge drives every size, so portrait and landscape have to be
    // checked separately or a pill can run off the right edge.
    const portrait = pillGeometry(1536, 2048, "before");
    expect(portrait.x).toBeGreaterThan(0);
    expect(portrait.x + portrait.width).toBeLessThanOrEqual(1536);
    expect(portrait.y + portrait.height).toBeLessThanOrEqual(2048);
  });

  it("puts the text inside the box", () => {
    // The failure this catches is a label that starts left of its own pill,
    // which happens if the horizontal padding is applied to the wrong edge.
    expect(landscape.textX).toBeGreaterThan(landscape.x);
    expect(landscape.textX).toBeLessThan(landscape.x + landscape.width);
    expect(landscape.textY).toBeGreaterThan(landscape.y);
    expect(landscape.textY).toBeLessThan(landscape.y + landscape.height);
  });

  it("gives BEFORE a wider box than AFTER", () => {
    // Six characters against five. A box that did not grow with the label would
    // clip one of them.
    const before = pillGeometry(2048, 1536, "before");
    const after = pillGeometry(2048, 1536, "after");
    expect(before.width).toBeGreaterThan(after.width);
    expect(before.label).toBe("BEFORE");
    expect(after.label).toBe("AFTER");
  });

  it("scales the outline with the image", () => {
    expect(landscape.strokeWidth).toBe(Math.max(1, Math.round(1536 * 0.003)));
    // Never disappears entirely on a small image.
    expect(pillGeometry(200, 150, "after").strokeWidth).toBeGreaterThanOrEqual(1);
  });
});
