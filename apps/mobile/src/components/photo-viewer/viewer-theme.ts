import { palettes } from "@/theme";

/**
 * The viewer's colours: always the dark palette, whatever the phone is set to.
 *
 * Web draws the lightbox in the fixed sidebar chrome in both themes, because a
 * photograph reads best against dark and a white panel beside it glares. The
 * phone does the same, from the warm dark palette rather than new hex values,
 * so the viewer is recognisably the same app as the screen it opened from.
 */
const dark = palettes.dark;

export const viewerColors = {
  /** Behind the photograph. */
  stage: "#000000",
  /** Top bar and panel ground. */
  chrome: dark.background,
  /** Cards inside the panel (web's `bg-sidebar-accent`). */
  card: dark.card,
  raised: dark.secondary,
  border: dark.border,
  foreground: dark.foreground,
  muted: dark.mutedForeground,
  faint: "rgba(233, 228, 220, 0.45)",
  primary: dark.primary,
  primaryForeground: dark.primaryForeground,
  success: dark.success,
  safety: dark.safety,
  destructive: dark.destructive,
  input: dark.input,
  /** Glass buttons over the photograph. */
  glass: "rgba(24, 19, 13, 0.72)",
  glassPressed: "rgba(60, 50, 40, 0.9)",
} as const;

/**
 * The colours a comment thread is drawn with.
 *
 * Its own small type so the same thread renders dark inside the viewer and in
 * the app theme on the standalone comments route.
 */
export type ThreadColors = {
  background: string;
  card: string;
  border: string;
  foreground: string;
  muted: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  input: string;
};

export const viewerThreadColors: ThreadColors = {
  background: viewerColors.chrome,
  card: viewerColors.card,
  border: viewerColors.border,
  foreground: viewerColors.foreground,
  muted: viewerColors.muted,
  primary: viewerColors.primary,
  primaryForeground: viewerColors.primaryForeground,
  destructive: viewerColors.destructive,
  input: viewerColors.input,
};
