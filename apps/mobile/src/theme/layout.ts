/**
 * Layout that depends on how wide the screen actually is.
 *
 * Import-free so it can be tested, which matters because the numbers below are
 * the difference between an app that looks designed for a tablet and one that
 * looks like a phone app someone stretched.
 *
 * `supportsTablet` is true in `app.json`, so **Apple reviews this app on an
 * iPad**, and the iPad it reaches for is usually the 12.9 inch one. Every
 * screen here was laid out against a 390pt phone: full-width buttons, rows that
 * run edge to edge, a three-column photo grid. At 1024pt none of that is
 * merely bigger, it is wrong. A row of text 1000pt wide is unreadable because
 * the eye loses the line, and a "full width" primary button a metre across
 * reads as a mistake.
 */

/**
 * The widest a column of content should ever be.
 *
 * Typographic rather than arbitrary: a line of body text stops being
 * comfortable somewhere past 70 characters, and at this app's 16pt body that
 * lands around 640pt. Content wider than this is centred with space either
 * side, which is what every well-behaved tablet app does and what a stretched
 * phone app conspicuously does not.
 */
export const CONTENT_MAX_WIDTH = 640;

/** A screen wide enough that filling it would be the wrong thing to do. */
export function isWide(width: number): boolean {
  return width > CONTENT_MAX_WIDTH;
}

/**
 * Horizontal padding that centres content on a wide screen.
 *
 * Returned as padding rather than a fixed width so a caller can keep using
 * `flex: 1` and full-width children: the children stay full width of the
 * *column*, and the column is centred. Swapping to a fixed width would mean
 * every screen also needing `alignSelf`, which is the kind of change that gets
 * applied to nine screens and forgotten on the tenth.
 */
export function contentInset(width: number, base: number): number {
  if (!isWide(width)) return base;
  return Math.max(base, Math.floor((width - CONTENT_MAX_WIDTH) / 2));
}

/**
 * How wide a child of `Screen` actually gets to be.
 *
 * The other half of `contentInset`, and needed because anything doing its own
 * width arithmetic inside a `Screen` must measure against the COLUMN, not the
 * display. `useWindowDimensions` reports the whole screen, so a grid on a
 * tablet that sized tiles from it would lay them out across 1024pt inside a
 * 640pt column and overflow it.
 *
 * Screens that deliberately run full-bleed - the photo grids, which want to be
 * a contact sheet rather than a page - are not inside a `Screen` and should
 * keep using the raw width.
 */
export function contentWidth(width: number): number {
  return Math.min(width, CONTENT_MAX_WIDTH);
}

/**
 * Roughly how wide one photo tile wants to be.
 *
 * Calibrated against what actually ships rather than picked: the phone grids
 * are three columns inside `spacing.lg` padding with a `spacing.xs` gap, which
 * on the narrowest phone still sold (360pt) works out at about 109pt a tile.
 * Anything above that silently drops those phones to two columns, which is a
 * regression dressed up as a tablet improvement.
 */
export const TARGET_TILE = 105;

/**
 * How many tiles fit across.
 *
 * Three on a phone, which is what every one of these grids hardcoded. On a
 * tablet three tiles means each one is over 300pt: a contact sheet showing nine
 * photographs where it could comfortably show twenty-five, and thumbnails so
 * large they read as a gallery rather than an index.
 *
 * Driven by a target tile size rather than by breakpoints, so it behaves
 * sensibly on a split-screen iPad and on whatever aspect ratio Android
 * foldables settle on, neither of which is a size anybody will remember to add
 * a breakpoint for.
 *
 * @param width  Space available to the grid, padding already subtracted.
 * @param target Roughly how wide one tile should be. Defaults to the photo
 *   tile, but a grid of smaller things - the home screen's shortcut buttons -
 *   passes its own.
 */
export function gridColumns(width: number, target = TARGET_TILE): number {
  /*
   * Floor of three, ceiling of eight.
   *
   * Three because that is what every one of these grids has always drawn on a
   * phone, so the floor guarantees this helper can only ever ADD columns where
   * there is room. It never takes one away from a layout somebody has already
   * looked at and approved.
   *
   * Eight because a contact sheet past that reads as a mosaic: you scan it
   * rather than see the photographs, which is the opposite of what a thumbnail
   * grid is for. It binds from a full-width 10 inch iPad upwards, where the
   * natural fit would be nine or more.
   */
  const fitted = Math.floor(Math.max(0, width) / Math.max(1, target));
  return Math.min(8, Math.max(3, fitted));
}

/**
 * The width from which a screen is laid out for a tablet held in the hand.
 *
 * 768 rather than the 640 of `isWide`: an iPad mini in portrait (744) is still
 * held and thumbed like a big phone, and keeping the bottom bar there is what
 * its owner expects. From 768 up (every 10 inch tablet in either orientation,
 * and the Android tablets managers carry) the device is gripped at the sides.
 */
export const TABLET_MIN_WIDTH = 768;

/**
 * Whether the primary actions belong on the right edge rather than the bottom.
 *
 * True on a tablet, and on any screen in landscape. Both are held with a hand
 * on each side, and most people tap with the right one, so the thumb that is
 * free to reach is the one resting on the right edge. The bottom centre, where
 * a phone keeps its camera button, is the one place on a landscape tablet that
 * neither thumb can reach without letting go.
 *
 * Landscape counts on a phone too: 390pt of height with a bottom bar, a header
 * and a keyboard leaves almost nothing, and a rail costs width, which a phone
 * on its side has plenty of.
 */
export function usesRightRail(width: number, height: number): boolean {
  return width >= TABLET_MIN_WIDTH || width > height;
}

/**
 * The widest a page of cards gets on a tablet before it stops growing.
 *
 * Wider than `CONTENT_MAX_WIDTH` because a list of cards is not a line of
 * prose: at 768pt and up the project sub-pages lay their cards out two across,
 * and two 440pt cards read as a board where one 900pt card reads as a banner.
 */
export const CARD_PAGE_MAX_WIDTH = 960;

/** One column of cards on a phone, two from a hand-held tablet up. */
export function cardColumns(width: number): number {
  return width >= TABLET_MIN_WIDTH ? 2 : 1;
}

/**
 * Horizontal padding that centres a page of cards, capped at
 * `CARD_PAGE_MAX_WIDTH`. `contentInset` with a different ceiling.
 */
export function cardPageInset(width: number, base: number): number {
  if (width <= CARD_PAGE_MAX_WIDTH) return base;
  return Math.max(base, Math.floor((width - CARD_PAGE_MAX_WIDTH) / 2));
}

/*
 * Landscape.
 *
 * Everything above treats a wide screen as a page to be centred. That is right
 * for a tablet held upright, where 640pt of column is most of the glass, and
 * wrong on its side: Jon, 2026-09-29, on the Portfolio in landscape, "it looks
 * weird and too centered. it doesnt spread out." A 1024pt iPad on its side was
 * showing a 640pt column with 190pt of empty margin either side, and a phone on
 * its side was doing the same thing in miniature.
 *
 * So a screen held on its side SPREADS: the column grows to
 * `WIDE_PAGE_MAX_WIDTH`, and screens that have more than one thing to show lay
 * those things out side by side (`pageColumns`) or as a list with its detail
 * beside it (`splitsPane`) rather than stretching one line of prose across it.
 * Portrait is untouched by all of this, on purpose: it was approved as it is.
 */

/**
 * The widest a page gets when it spreads. Wide enough that no tablet in
 * service shows a centred island in landscape (a 12.9 inch iPad Pro is 1366pt
 * and keeps a gutter of about 40pt), narrow enough that an external display
 * or a desktop-sized Android window does not run a card a metre wide.
 */
export const WIDE_PAGE_MAX_WIDTH = 1280;

/** Held on its side: wider than tall. */
export function isLandscape(width: number, height: number): boolean {
  return width > height;
}

/**
 * Whether a page should use the width rather than sit in a centred column.
 *
 * Landscape and wider than the reading column. A split-screen iPad window
 * narrower than that stays a single column, which is what it looks like.
 */
export function spreads(width: number, height: number): boolean {
  return isLandscape(width, height) && width > CONTENT_MAX_WIDTH;
}

/**
 * Horizontal padding for a page, by orientation.
 *
 * Portrait: exactly `contentInset`, so nothing upright moves by a point.
 * Landscape: the gutter it was given, growing only once the window passes
 * `WIDE_PAGE_MAX_WIDTH`, and never less than the side safe area (the notch of
 * an iPhone on its side is 47pt, and content under it is content cut off).
 *
 * @param safeSide The larger of the left and right safe-area insets.
 */
export function pageInset(width: number, height: number, base: number, safeSide = 0): number {
  const floor = base + Math.max(0, safeSide);
  if (!spreads(width, height)) return Math.max(contentInset(width, base), floor);
  return Math.max(floor, Math.floor((width - WIDE_PAGE_MAX_WIDTH) / 2));
}

/** The width left for content once `pageInset` is taken off both sides. */
export function pageWidth(width: number, height: number, base: number, safeSide = 0): number {
  return Math.max(0, width - pageInset(width, height, base, safeSide) * 2);
}

/**
 * How many columns of sections or cards a page lays out.
 *
 * One whenever the page does not spread, so portrait layouts are exactly what
 * they were. In landscape, as many columns of at least `minColumn` as fit,
 * capped at `max`: two on a phone on its side and a 10 inch iPad, three on a
 * 12.9 inch.
 *
 * @param usable Width available, padding already taken off (`pageWidth`).
 */
export function pageColumns(
  width: number,
  height: number,
  usable: number,
  minColumn = 320,
  max = 3,
  gap = 16,
): number {
  if (!spreads(width, height)) return 1;
  const fitted = Math.floor((Math.max(0, usable) + gap) / (Math.max(1, minColumn) + gap));
  return Math.max(1, Math.min(max, fitted));
}

/**
 * Whether a list-and-detail screen shows both at once.
 *
 * The master-detail layout every tablet settings screen uses: the list on the
 * left, the selected item's fields on the right, instead of a sheet sliding up
 * over the list. Only when spreading and there is room for a readable detail
 * pane beside a list (about 300pt + 400pt), which excludes the smallest phones
 * on their side, where a sheet is still the better use of 320pt of height.
 */
export function splitsPane(width: number, height: number, usable: number): boolean {
  return spreads(width, height) && usable >= 720;
}

/**
 * `cardPageInset` for the current orientation: unchanged upright, spread on
 * its side. The project sub-pages capped their board at 960pt, which on a
 * 12.9 inch iPad in landscape was a 200pt margin either side.
 */
export function cardPageInsetFor(
  width: number,
  height: number,
  base: number,
  safeSide = 0,
): number {
  if (!spreads(width, height)) return Math.max(cardPageInset(width, base), base + safeSide);
  return pageInset(width, height, base, safeSide);
}

/**
 * Columns of cards for the current orientation. Never fewer than
 * `cardColumns` gives, so a tablet upright keeps its two.
 */
export function cardPageColumns(width: number, height: number, base: number, safeSide = 0): number {
  const usable = width - cardPageInsetFor(width, height, base, safeSide) * 2;
  return Math.max(cardColumns(width), pageColumns(width, height, usable, 300, 3));
}

/**
 * The tallest a scrolling list inside a sheet should be.
 *
 * Several sheets cap an inner list at a fixed 360 to 400pt, chosen on a phone
 * held upright. A phone on its side is about 390pt tall, and the sheet itself
 * stops at 85% of that, so a 380pt inner list is taller than the sheet it sits
 * in and its last rows can only be reached by fighting two scroll views. On its
 * side the cap is 40% of the window, never below 160pt (three rows). Upright it
 * is the number the sheet asked for, unchanged.
 */
export function listMaxHeight(width: number, height: number, preferred: number): number {
  if (!isLandscape(width, height)) return preferred;
  return Math.min(preferred, Math.max(160, Math.floor(height * 0.4)));
}
