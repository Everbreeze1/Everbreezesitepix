/**
 * Design tokens for the Everlumen field app.
 *
 * The colour values are the web app's brand tokens (`apps/web/src/styles.css`)
 * converted from oklch to sRGB hex, because React Native's style engine has no
 * oklch support. Keep them in sync by converting, not by eyeballing: a hand
 * picked "close enough" blue is how two surfaces of one product drift apart.
 *
 * The previous `src/theme.ts` used a green palette that matched nothing in the
 * product. It is replaced by this module.
 */

export type ColorScheme = "light" | "dark";

export type Palette = {
  /** App canvas. */
  background: string;
  /** Default text on `background`. */
  foreground: string;
  /** Raised surfaces: cards, rows, sheets. */
  card: string;
  cardForeground: string;
  /**
   * The wordmark gold, from the logo artwork.
   *
   * Darkened on the light palette: #ffb020 on a white canvas measures about
   * 1.8:1, and #d97c0a reaches 3.3:1, which clears AA for the large bold sizes
   * the wordmark is ever set at. Nothing smaller than that may use it.
   */
  brand: string;
  /** Warm amber, matching the web app. Primary actions. */
  primary: string;
  primaryForeground: string;
  primaryGlow: string;
  /** Low-emphasis fills. */
  secondary: string;
  secondaryForeground: string;
  muted: string;
  /** Secondary text, captions, metadata. */
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  /** Construction amber. Warnings, offline and pending states. */
  safety: string;
  safetyForeground: string;
  /**
   * Completion and pass states.
   *
   * The web app has no CSS variable for this: it reaches for Tailwind emerald
   * directly (`text-emerald-600` in light, `text-emerald-400` in dark,
   * `bg-emerald-500` for fills, roughly 90 usages). Those are the values
   * mirrored here, so a completed checklist reads the same green on both.
   */
  success: string;
  successForeground: string;
  /** Errors and destructive actions. */
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  /** Focus ring. */
  ring: string;
  /** Always-dark chrome, matching the web app's fixed navy sidebar. */
  chrome: string;
  chromeForeground: string;
  /** Scrim behind modals and over the camera viewfinder. */
  scrim: string;
};

const light: Palette = {
  background: "#f9f4ee",
  foreground: "#221c12",
  card: "#fdfbf9",
  cardForeground: "#221c12",
  brand: "#d97c0a",
  primary: "#cb7229",
  primaryForeground: "#fdfbf9",
  primaryGlow: "#e78a45",
  secondary: "#f2ece4",
  secondaryForeground: "#3a3127",
  muted: "#f2ece4",
  mutedForeground: "#645c51",
  accent: "#fee2cf",
  accentForeground: "#9a4f14",
  safety: "#f5b544",
  safetyForeground: "#221c12",
  success: "#3d8f4a",
  successForeground: "#ffffff",
  destructive: "#df2225",
  destructiveForeground: "#fcfcfc",
  border: "#e6e0d8",
  input: "#dfdad2",
  ring: "#cb7229",
  chrome: "#18130d",
  chromeForeground: "#dcd6cf",
  scrim: "rgba(24, 19, 13, 0.6)",
};

const dark: Palette = {
  background: "#18130d",
  foreground: "#e9e4dc",
  card: "#211c15",
  cardForeground: "#e9e4dc",
  brand: "#ffb020",
  primary: "#dc8748",
  primaryForeground: "#18130d",
  primaryGlow: "#f0995b",
  secondary: "#2f281e",
  secondaryForeground: "#e9e4dc",
  muted: "#2c251c",
  mutedForeground: "#a69d91",
  accent: "#462c19",
  accentForeground: "#f6c9a4",
  safety: "#f5b544",
  safetyForeground: "#18130d",
  success: "#5fbf6e",
  successForeground: "#18130d",
  destructive: "#f9423d",
  destructiveForeground: "#f5f5f5",
  border: "rgba(255, 255, 255, 0.12)",
  input: "rgba(255, 255, 255, 0.15)",
  ring: "#dc8748",
  chrome: "#110d09",
  chromeForeground: "#dcd6cf",
  scrim: "rgba(0, 0, 0, 0.7)",
};

export const palettes: Record<ColorScheme, Palette> = { light, dark };

/**
 * 4pt base scale. Field use means gloves and sunlight, so the app leans on the
 * larger end of this scale more than the web app does.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Mirrors the web's `--radius: 0.625rem` (10px) and its derived sizes. */
export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: "700" },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "700" },
  heading: { fontSize: 19, lineHeight: 25, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 23, fontWeight: "400" },
  bodyStrong: { fontSize: 16, lineHeight: 23, fontWeight: "600" },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: "600", letterSpacing: 0.6 },
} as const;

export type TypographyVariant = keyof typeof typography;

/**
 * Minimum touch target. Apple asks for 44pt, Android for 48dp, and a person
 * wearing work gloves wants more than either, so 48 is the floor here.
 */
export const HIT_TARGET = 48;

export const elevation = {
  card: {
    shadowColor: "#221c12",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sheet: {
    shadowColor: "#221c12",
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
} as const;
