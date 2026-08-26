import type { LucideIcon } from "lucide-react-native";
import type { ColorValue } from "react-native";
import { useTheme, type Palette } from "@/theme";

export type { LucideIcon };

/**
 * Why the app has icons at all now.
 *
 * Every control here used to be a bare label. A row reading "Checklists" with a
 * chevron and nothing else gives a person scanning the screen one thing to read
 * and nothing to recognise, and on a phone held at arm's length in daylight
 * recognition is most of what is happening. The web app leans on `lucide-react`
 * for exactly this, so the field app uses `lucide-react-native`: same icon set,
 * same names, so a screen ported from web keeps its glyphs instead of picking
 * new ones that mean almost the same thing.
 *
 * Sizes are named rather than passed as numbers, because an icon that does not
 * sit on the type scale looks like a mistake next to the label it belongs to.
 */
export const iconSize = { xs: 14, sm: 16, md: 20, lg: 24, xl: 28, xxl: 40 } as const;

export type IconSize = keyof typeof iconSize;

export type IconTone =
  | "default"
  | "muted"
  | "primary"
  | "safety"
  | "success"
  | "destructive"
  | "inverse";

const toneKey: Record<IconTone, keyof Palette> = {
  default: "foreground",
  muted: "mutedForeground",
  primary: "primary",
  safety: "safety",
  success: "success",
  destructive: "destructive",
  inverse: "primaryForeground",
};

export type IconProps = {
  icon: LucideIcon;
  size?: IconSize;
  tone?: IconTone;
  /**
   * Escape hatch for surfaces that are not on the palette, such as the camera
   * viewfinder. Typed as `ColorValue` rather than `string` so a navigator can hand
   * its own tint straight through: `tabBarIcon` supplies one.
   */
  color?: ColorValue;
  strokeWidth?: number;
};

export function Icon({
  icon: Glyph,
  size = "md",
  tone = "default",
  color,
  strokeWidth,
}: IconProps) {
  const theme = useTheme();
  return (
    <Glyph
      size={iconSize[size]}
      color={color ?? theme.colors[toneKey[tone]]}
      /*
       * Lucide draws at stroke width 2 for a 24px box. Below that the stroke
       * starts to look heavier than the text beside it, so the small sizes are
       * thinned to keep the optical weight matched.
       */
      strokeWidth={strokeWidth ?? (iconSize[size] <= 16 ? 2.25 : 2)}
    />
  );
}
