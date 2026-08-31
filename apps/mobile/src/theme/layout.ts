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
