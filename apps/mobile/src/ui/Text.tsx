import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { typography, useTheme, type Palette, type TypographyVariant } from "@/theme";

export type TextTone =
  | "default"
  | "muted"
  | "primary"
  | "safety"
  | "success"
  | "destructive"
  | "inverse"
  | "onChrome";

const toneKey: Record<TextTone, keyof Palette> = {
  default: "foreground",
  muted: "mutedForeground",
  primary: "primary",
  safety: "safety",
  success: "success",
  destructive: "destructive",
  inverse: "primaryForeground",
  onChrome: "chromeForeground",
};

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  tone?: TextTone;
  align?: "left" | "center" | "right";
};

/**
 * Text on the type scale, in a palette colour, following dark mode.
 *
 * The screens this replaces wrote `style={[typography.caption, { color:
 * theme.colors.mutedForeground }]}` at roughly every second line. Spelled out
 * that many times it drifts: some captions took `foreground`, some took a
 * hardcoded grey, and a few took `typography.body` at a smaller size. Naming
 * the pair once means "muted caption" looks identical everywhere it appears.
 */
export function Text({ variant = "body", tone = "default", align, style, ...rest }: TextProps) {
  const theme = useTheme();
  return (
    <RNText
      {...rest}
      style={[
        typography[variant],
        { color: theme.colors[toneKey[tone]] },
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
