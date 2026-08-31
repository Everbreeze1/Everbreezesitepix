import { describe, expect, it } from "vitest";
import {
  CONTENT_MAX_WIDTH,
  contentInset,
  contentWidth,
  gridColumns,
  isWide,
  TARGET_TILE,
} from "../apps/mobile/src/theme/layout";

/*
 * Tablet layout.
 *
 * `supportsTablet` is true, so Apple reviews this app on an iPad, and every
 * screen in it was laid out against a 390pt phone. These are the two numbers
 * that decide whether it looks designed for the larger screen or stretched onto
 * it, so they are pinned against the sizes of real devices rather than against
 * round numbers.
 *
 * The widths below are points, not pixels: 360 is the narrowest Android phone
 * still worth supporting, 390 an iPhone 15, 744 an iPad mini, 1024 a 10th-gen
 * iPad in landscape and 1366 a 12.9 inch Pro.
 */

const PHONES = [320, 360, 375, 390, 414, 428];
const TABLETS = [744, 820, 1024, 1180, 1366];

/** What the grids subtract before asking: `spacing.lg` either side. */
const padded = (width: number) => width - 32;

describe("gridColumns", () => {
  it("still draws three columns on every phone", () => {
    /*
     * The regression this exists to catch, which I shipped once already.
     *
     * The first version of `TARGET_TILE` was 130, chosen by eye. A 390pt phone
     * has 358pt of usable width, and 358/130 floors to 2, so every photo grid
     * in the app would have quietly dropped from three columns to two on every
     * phone in service. A tablet improvement is not allowed to cost the phones
     * anything, and the phones are almost all of the users.
     */
    for (const width of PHONES) {
      expect(gridColumns(padded(width)), `${width}pt`).toBe(3);
    }
  });

  it("uses the room a tablet has", () => {
    for (const width of TABLETS) {
      expect(gridColumns(padded(width)), `${width}pt`).toBeGreaterThan(3);
    }
    // A 10th-gen iPad in landscape: eight across rather than three, so a
    // contact sheet shows getting on for seven times as many photographs per
    // screen, at a 124pt tile that is still comfortably larger than a phone's.
    expect(gridColumns(padded(1024))).toBe(8);
    // An iPad mini is the first size where the cap does not bind.
    expect(gridColumns(padded(744))).toBe(6);
  });

  it("stops at eight, so a large iPad is a contact sheet and not a mosaic", () => {
    expect(gridColumns(padded(1366))).toBe(8);
    expect(gridColumns(100000)).toBe(8);
  });

  it("never returns something unusable", () => {
    // Zero and negative widths happen: a view can be measured before layout.
    expect(gridColumns(0)).toBe(3);
    expect(gridColumns(-500)).toBe(3);
    // A target of zero would be a division by zero and an Infinity column count.
    expect(Number.isFinite(gridColumns(400, 0))).toBe(true);
  });

  it("never skips a column as the screen grows", () => {
    // Monotonic, because a layout that jumps from four columns to six as a
    // window is dragged looks broken even though each width is defensible.
    let previous = gridColumns(0);
    for (let width = 0; width <= 2000; width += 1) {
      const next = gridColumns(width);
      expect(next).toBeGreaterThanOrEqual(previous);
      expect(next - previous).toBeLessThanOrEqual(1);
      previous = next;
    }
  });

  it("takes a smaller target for grids of smaller things", () => {
    /*
     * The home screen's shortcut buttons are about 110pt, not 130. Sharing the
     * photo constant would have dropped that grid to two columns on a phone,
     * which is why the parameter exists rather than a second hardcoded number.
     */
    expect(gridColumns(padded(390), 110)).toBe(3);
    expect(gridColumns(padded(360), 110)).toBe(3);
  });

  it("keeps the tile near the size it was asked for", () => {
    // The point of a target rather than breakpoints: whatever the width, a tile
    // lands within a reasonable band of it rather than ballooning.
    for (const width of [...PHONES, ...TABLETS]) {
      const usable = padded(width);
      const tile = usable / gridColumns(usable);
      expect(tile, `${width}pt`).toBeGreaterThan(TARGET_TILE * 0.8);
      expect(tile, `${width}pt`).toBeLessThan(TARGET_TILE * 2);
    }
  });
});

describe("contentInset", () => {
  it("leaves a phone exactly as it was", () => {
    // Non-negotiable: this runs on every screen through `Screen`, so if it
    // moved a phone layout by a single point it would move all of them.
    for (const width of PHONES) {
      expect(contentInset(width, 16), `${width}pt`).toBe(16);
      expect(contentInset(width, 0), `${width}pt`).toBe(0);
    }
  });

  it("centres the column on a tablet", () => {
    const inset = contentInset(1024, 16);
    expect(inset).toBe(Math.floor((1024 - CONTENT_MAX_WIDTH) / 2));
    // Both sides plus the column come back to the screen, give or take the
    // rounding. An off-by-one here reads as content sitting slightly left.
    expect(1024 - inset * 2).toBeGreaterThanOrEqual(CONTENT_MAX_WIDTH);
    expect(1024 - inset * 2).toBeLessThanOrEqual(CONTENT_MAX_WIDTH + 2);
  });

  it("never returns less padding than it was given", () => {
    // Just past the threshold the centring inset is tiny, and a screen that
    // asked for `spacing.lg` still needs `spacing.lg`.
    expect(contentInset(CONTENT_MAX_WIDTH + 4, 16)).toBe(16);
  });

  it("is never negative", () => {
    for (const width of [0, 1, 320, 640, 641, 4000]) {
      expect(contentInset(width, 0), `${width}pt`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("contentWidth", () => {
  it("is the other half of contentInset", () => {
    /*
     * These two have to agree or the arithmetic inside a `Screen` is wrong: a
     * grid sizing tiles from the full window width would lay them out across
     * 1024pt inside a 640pt column and overflow it.
     */
    for (const width of [...PHONES, ...TABLETS]) {
      const column = width - contentInset(width, 0) * 2;
      expect(Math.abs(contentWidth(width) - column), `${width}pt`).toBeLessThanOrEqual(2);
    }
  });

  it("leaves a phone at its full width", () => {
    for (const width of PHONES) {
      expect(contentWidth(width), `${width}pt`).toBe(width);
    }
  });
});

describe("isWide", () => {
  it("splits phones from tablets where the column stops growing", () => {
    for (const width of PHONES) expect(isWide(width), `${width}pt`).toBe(false);
    for (const width of TABLETS) expect(isWide(width), `${width}pt`).toBe(true);
    // A phone in landscape is wide, and correctly so: an 844pt line of body
    // text is unreadable whatever device it is on.
    expect(isWide(844)).toBe(true);
  });
});
