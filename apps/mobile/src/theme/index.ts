import { useColorScheme } from "react-native";
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
