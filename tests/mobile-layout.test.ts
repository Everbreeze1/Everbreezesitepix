import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cardPageColumns,
  cardPageInset,
  cardPageInsetFor,
  CONTENT_MAX_WIDTH,
  contentInset,
  contentWidth,
  gridColumns,
  isWide,
  listMaxHeight,
  pageColumns,
  pageInset,
  pageWidth,
  splitsPane,
  spreads,
  TARGET_TILE,
  usesRightRail,
  WIDE_PAGE_MAX_WIDTH,
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

describe("usesRightRail", () => {
  it("keeps every phone in portrait on the bottom bar", () => {
    for (const width of PHONES) expect(usesRightRail(width, 800), `${width}`).toBe(false);
  });

  it("moves tablets to the right edge in either orientation, bar the iPad mini upright", () => {
    expect(usesRightRail(744, 1133)).toBe(false);
    for (const width of [820, 1024]) expect(usesRightRail(width, 1180), `${width}`).toBe(true);
    for (const width of [1024, 1180, 1366, 1280]) expect(usesRightRail(width, 800)).toBe(true);
  });

  it("moves any screen held on its side, phones included", () => {
    expect(usesRightRail(667, 375)).toBe(true);
    expect(usesRightRail(844, 390)).toBe(true);
  });
});

/*
 * Landscape. Jon, 2026-09-29, on the Portfolio with the tablet on its side:
 * "it looks weird and too centered. it doesnt spread out", and "make all pages
 * both vertical and horizontally optimized". Portrait was approved as it is,
 * so every rule below leaves an upright screen exactly where it was.
 */

/** Real devices, width x height in points, upright. */
const UPRIGHT: [number, number][] = [
  [360, 780],
  [390, 844],
  [430, 932],
  [744, 1133],
  [820, 1180],
  [1024, 1366],
];
const ON_ITS_SIDE: [number, number][] = UPRIGHT.map(([w, h]) => [h, w]);

describe("spreads", () => {
  it("is false for every screen held upright", () => {
    for (const [w, h] of UPRIGHT) expect(spreads(w, h), `${w}x${h}`).toBe(false);
  });

  it("is true for every phone and tablet on its side", () => {
    for (const [w, h] of ON_ITS_SIDE) expect(spreads(w, h), `${w}x${h}`).toBe(true);
  });

  it("leaves a narrow split-screen window as a column", () => {
    expect(spreads(600, 500)).toBe(false);
  });
});

describe("pageInset", () => {
  it("is contentInset exactly when upright", () => {
    for (const [w, h] of UPRIGHT) {
      expect(pageInset(w, h, 16), `${w}x${h}`).toBe(contentInset(w, 16));
      expect(pageInset(w, h, 0), `${w}x${h}`).toBe(contentInset(w, 0));
    }
  });

  it("uses the width on its side instead of a centred 640pt island", () => {
    // The screen Jon saw: a 10th-gen iPad on its side had 192pt of empty
    // margin either side of the Portfolio.
    expect(contentInset(1180, 16)).toBeGreaterThan(200);
    expect(pageInset(1180, 820, 16)).toBe(16);
    for (const [w, h] of ON_ITS_SIDE) {
      if (w <= WIDE_PAGE_MAX_WIDTH) {
        expect(pageWidth(w, h, 16), `${w}x${h}`).toBe(w - 32);
      }
      expect(pageWidth(w, h, 16), `${w}x${h}`).toBeGreaterThan(CONTENT_MAX_WIDTH);
    }
  });

  it("stops growing on a very wide window", () => {
    expect(pageWidth(1920, 1080, 16)).toBeLessThanOrEqual(WIDE_PAGE_MAX_WIDTH);
  });

  it("keeps content out from under a landscape notch", () => {
    // An iPhone on its side reports 47pt either side.
    expect(pageInset(844, 390, 16, 47)).toBe(63);
    expect(pageInset(844, 390, 0, 47)).toBe(47);
    // And an upright phone, whose side insets are zero, is unchanged.
    expect(pageInset(390, 844, 16, 0)).toBe(16);
  });
});

describe("pageColumns", () => {
  it("is always one upright, so portrait layouts cannot move", () => {
    for (const [w, h] of UPRIGHT) {
      expect(pageColumns(w, h, pageWidth(w, h, 16)), `${w}x${h}`).toBe(1);
    }
  });

  it("puts sections side by side on its side", () => {
    // A phone on its side and a 10 inch iPad get two, a 12.9 inch three.
    expect(pageColumns(844, 390, pageWidth(844, 390, 16, 47))).toBe(2);
    expect(pageColumns(1180, 820, pageWidth(1180, 820, 16))).toBe(3);
    expect(pageColumns(1366, 1024, pageWidth(1366, 1024, 16))).toBe(3);
    expect(pageColumns(1366, 1024, pageWidth(1366, 1024, 16), 320, 2)).toBe(2);
  });

  it("never returns zero", () => {
    expect(pageColumns(700, 300, 0)).toBe(1);
  });
});

describe("splitsPane", () => {
  it("shows list and detail together only on its side with room for both", () => {
    for (const [w, h] of UPRIGHT) expect(splitsPane(w, h, pageWidth(w, h, 16))).toBe(false);
    expect(splitsPane(1180, 820, pageWidth(1180, 820, 16))).toBe(true);
    expect(splitsPane(844, 390, pageWidth(844, 390, 16, 47))).toBe(false);
  });
});

describe("the project sub-pages' board", () => {
  it("is unchanged upright", () => {
    for (const [w, h] of UPRIGHT) {
      expect(cardPageInsetFor(w, h, 16), `${w}x${h}`).toBe(cardPageInset(w, 16));
    }
  });

  it("spreads and gains a column on a large tablet on its side", () => {
    expect(cardPageInset(1366, 16)).toBeGreaterThan(200);
    expect(cardPageInsetFor(1366, 1024, 16)).toBeLessThan(50);
    expect(cardPageColumns(1366, 1024, 16)).toBe(3);
    // A phone on its side gets two cards across.
    expect(cardPageColumns(844, 390, 16, 47)).toBe(2);
    // Never fewer than an upright tablet already had.
    expect(cardPageColumns(820, 1180, 16)).toBe(2);
    expect(cardPageColumns(390, 844, 16)).toBe(1);
  });
});

describe("listMaxHeight", () => {
  it("keeps the fixed caps upright", () => {
    for (const [w, h] of UPRIGHT) expect(listMaxHeight(w, h, 380), `${w}x${h}`).toBe(380);
  });

  it("shrinks inside a sheet on a phone held on its side", () => {
    expect(listMaxHeight(844, 390, 380)).toBe(160);
    expect(listMaxHeight(844, 390, 380)).toBeLessThan(390 * 0.85 - 120);
    // A tablet on its side has the room to keep most of it.
    expect(listMaxHeight(1180, 820, 380)).toBe(328);
  });
});

describe("the screens use it", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("spreads every Screen on its side through one helper", () => {
    const screen = read("apps/mobile/src/ui/Screen.tsx");
    expect(screen).toContain("layout.inset(padded ? spacing.lg : 0)");
    expect(screen).not.toContain("contentInset(");
    const subPage = read("apps/mobile/src/ui/SubPage.tsx");
    expect(subPage).toContain("layout.cardInset(spacing.lg)");
  });

  it("lays the Portfolio out across the width on its side", () => {
    const screen = read("apps/mobile/app/(app)/portfolio.tsx");
    expect(screen).toContain("useLayout()");
    expect(screen).toContain("projectColumns > 1");
    const editor = read("apps/mobile/src/components/portfolio/SiteEditor.tsx");
    expect(editor).toContain("useLayout().split()");
    expect(editor).toContain("<SplitPane");
    const embeds = read("apps/mobile/src/components/portfolio/EmbedsPanel.tsx");
    expect(embeds).toContain("sideBySide");
  });

  it("puts multi-section screens in columns on its side", () => {
    for (const path of [
      "apps/mobile/app/(app)/(tabs)/account.tsx",
      "apps/mobile/app/(app)/(tabs)/index.tsx",
      "apps/mobile/app/(app)/admin/index.tsx",
      "apps/mobile/app/(app)/admin/health.tsx",
      "apps/mobile/app/(app)/settings/security.tsx",
    ]) {
      expect(read(path), path).toContain("<Columns");
    }
  });

  it("keeps the full-bleed grids and headers clear of a landscape notch", () => {
    for (const path of [
      "apps/mobile/app/(app)/(tabs)/gallery.tsx",
      "apps/mobile/app/(app)/(tabs)/projects.tsx",
      "apps/mobile/app/(app)/project/[id]/index.tsx",
    ]) {
      expect(read(path), path).toContain("safeSide");
    }
    expect(read("apps/mobile/src/ui/PageHeader.tsx")).toContain("paddingLeft: insets.left");
  });
});
