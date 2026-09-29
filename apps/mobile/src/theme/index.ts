import { useColorScheme, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  cardPageColumns,
  cardPageInsetFor,
  isLandscape,
  listMaxHeight,
  pageColumns,
  pageInset,
  pageWidth,
  splitsPane,
  spreads,
  TABLET_MIN_WIDTH,
  usesRightRail,
} from "./layout";
import {
  elevation,
  HIT_TARGET,
  palettes,
  radius,
  spacing,
  typography,
  type ColorScheme,
  type Palette,
  type TypographyVariant,
} from "./tokens";

export {
  CARD_PAGE_MAX_WIDTH,
  cardColumns,
  cardPageColumns,
  cardPageInset,
  cardPageInsetFor,
  CONTENT_MAX_WIDTH,
  isLandscape,
  listMaxHeight,
  pageColumns,
  pageInset,
  pageWidth,
  splitsPane,
  spreads,
  WIDE_PAGE_MAX_WIDTH,
  TABLET_MIN_WIDTH,
  TARGET_TILE,
  contentInset,
  contentWidth,
  gridColumns,
  isWide,
  usesRightRail,
} from "./layout";

export {
  elevation,
  HIT_TARGET,
  palettes,
  radius,
  spacing,
  typography,
  type ColorScheme,
  type Palette,
  type TypographyVariant,
};

export type Theme = {
  scheme: ColorScheme;
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  elevation: typeof elevation;
};

function themeFor(scheme: ColorScheme): Theme {
  return { scheme, colors: palettes[scheme], spacing, radius, typography, elevation };
}

const themes: Record<ColorScheme, Theme> = {
  light: themeFor("light"),
  dark: themeFor("dark"),
};

/**
 * The active theme, following the OS appearance setting.
 *
 * `app.json` sets `userInterfaceStyle: "automatic"`, so this tracks the system
 * without any extra wiring. The two Theme objects are module constants rather
 * than fresh objects per render, which keeps them safe to use in dependency
 * arrays and in `useMemo` comparisons.
 */
export function useTheme(): Theme {
  return themes[useColorScheme() === "dark" ? "dark" : "light"];
}

/**
 * Light palette as a plain object.
 *
 * Only for module scope, where hooks cannot run: `StyleSheet.create` calls at
 * the top of a file, and navigator options defined outside a component. Prefer
 * `useTheme()` anywhere a hook is legal, or dark mode will not follow.
 */
export const colors = palettes.light;

/**
 * Whether this screen, at its current size and orientation, puts its primary
 * actions on a right-hand rail. See `usesRightRail`; re-evaluated on rotation.
 */
export function useRightRail(): boolean {
  const { width, height } = useWindowDimensions();
  return usesRightRail(width, height);
}

export type Layout = {
  width: number;
  height: number;
  /** Wider than tall. */
  landscape: boolean;
  /** 768pt and up in this orientation. */
  tablet: boolean;
  /** Primary actions on the right edge (see `usesRightRail`). */
  rail: boolean;
  /** Landscape and wide: use the width instead of a centred column. */
  spread: boolean;
  /** The larger side safe-area inset: the notch of a phone on its side. */
  safeSide: number;
  /** Page gutter for a given base padding. Portrait is `contentInset` as before. */
  inset: (base: number) => number;
  /** Width of the page's content for a given base padding. */
  contentWidth: (base: number) => number;
  /** Columns of sections at least `minColumn` wide. Always 1 upright. */
  columns: (minColumn?: number, max?: number, base?: number) => number;
  /** List and detail side by side instead of a sheet. */
  split: (base?: number) => boolean;
  /** The project sub-pages' board: gutter and columns of cards. */
  cardInset: (base: number) => number;
  cardColumns: (base: number) => number;
  /** Cap for a list scrolling inside a sheet (see `listMaxHeight`). */
  listMaxHeight: (preferred: number) => number;
};

/**
 * The one place a screen asks how to lay itself out. Re-read on rotation.
 *
 * Every screen was answering this for itself with a `useWindowDimensions`, a
 * magic number and no idea about the notch; this is those answers in one hook,
 * backed by the pure functions in `layout.ts` so they can be tested.
 */
export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const safeSide = Math.max(insets.left, insets.right);
  return {
    width,
    height,
    landscape: isLandscape(width, height),
    tablet: width >= TABLET_MIN_WIDTH,
    rail: usesRightRail(width, height),
    spread: spreads(width, height),
    safeSide,
    inset: (base) => pageInset(width, height, base, safeSide),
    contentWidth: (base) => pageWidth(width, height, base, safeSide),
    columns: (minColumn = 320, max = 3, base = 16) =>
      pageColumns(width, height, pageWidth(width, height, base, safeSide), minColumn, max),
    split: (base = 16) => splitsPane(width, height, pageWidth(width, height, base, safeSide)),
    cardInset: (base) => cardPageInsetFor(width, height, base, safeSide),
    cardColumns: (base) => cardPageColumns(width, height, base, safeSide),
    listMaxHeight: (preferred) => listMaxHeight(width, height, preferred),
  };
}
