import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { HIT_TARGET, radius, spacing, useTheme, type Palette } from "@/theme";
import { Icon, type IconSize, type LucideIcon } from "./Icon";
import { Text, type TextTone } from "./Text";

/**
 * The app's button.
 *
 * `BrandButton` is not this: it is the gradient pill built for the launch
 * screen, sized to a dark marketing surface and hardcoded to the mark's own
 * gold, which is a brand decision rather than a palette one.
 * This is the one for the other two hundred taps in the product, and it exists
 * because every screen had been drawing its own. Three screens had a
 * `primaryButton` style, each with a different radius, and the checklist runner
 * had a fourth that was a `Pressable` with padding and no shared shape at all.
 *
 * `destructive` deliberately does not get a solid fill by default. A red block
 * on a phone screen is what people tap by accident while holding it one-handed,
 * so the outline variant is the honest default for delete and discard and the
 * solid one is reserved for a confirmation the user has already opened.
 */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "success";

export type ButtonSize = "sm" | "md" | "lg";

const sizing: Record<ButtonSize, { height: number; padX: number; gap: number; icon: IconSize }> = {
  sm: { height: 40, padX: spacing.lg, gap: spacing.sm, icon: "sm" },
  // The floor is HIT_TARGET, which is 48: Apple asks 44, Android 48, and a
  // person in work gloves wants more than either.
  md: { height: HIT_TARGET, padX: spacing.xl, gap: spacing.sm, icon: "md" },
  lg: { height: 56, padX: spacing.xl, gap: spacing.md, icon: "md" },
};

type Skin = {
  bg: keyof Palette | "transparent";
  border: keyof Palette | null;
  label: TextTone;
};

const skins: Record<ButtonVariant, Skin> = {
  primary: { bg: "primary", border: null, label: "inverse" },
  secondary: { bg: "secondary", border: null, label: "default" },
  outline: { bg: "transparent", border: "border", label: "default" },
  ghost: { bg: "transparent", border: null, label: "default" },
  destructive: { bg: "transparent", border: "destructive", label: "destructive" },
  success: { bg: "success", border: null, label: "inverse" },
};

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  /** Stretches to the container. Off by default, so a button in a row stays button-shaped. */
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const skin = skins[variant];
  const dims = sizing[size];
  const inert = disabled || loading;

  const background = skin.bg === "transparent" ? "transparent" : theme.colors[skin.bg];
  const labelTone = variant === "success" ? "inverse" : skin.label;
  const spinnerColor =
    labelTone === "inverse" ? theme.colors.primaryForeground : theme.colors.foreground;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy: loading }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: dims.height,
          paddingHorizontal: dims.padX,
          borderRadius: radius.md,
          backgroundColor: background,
          borderWidth: skin.border ? 1 : 0,
          borderColor: skin.border ? theme.colors[skin.border] : undefined,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: dims.gap,
          alignSelf: fullWidth ? "stretch" : "flex-start",
          /*
           * Opacity rather than a darker fill. A pressed state built by mixing
           * the palette has to be defined per variant and per scheme, which is
           * six more colours to keep in sync for a state that lasts 100ms.
           */
          opacity: inert ? 0.45 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={spinnerColor} />
      ) : icon ? (
        <Icon icon={icon} size={dims.icon} tone={iconToneFor(labelTone)} />
      ) : null}
      <Text variant={size === "sm" ? "caption" : "bodyStrong"} tone={labelTone} numberOfLines={1}>
        {label}
      </Text>
      {iconRight && !loading ? (
        <Icon icon={iconRight} size={dims.icon} tone={iconToneFor(labelTone)} />
      ) : null}
    </Pressable>
  );
}

function iconToneFor(tone: TextTone) {
  return tone === "inverse" ? "inverse" : tone === "destructive" ? "destructive" : "default";
}

/**
 * A circular icon-only button, for toolbars and camera chrome.
 *
 * Split from `Button` rather than folded in as a variant because it has no
 * label, and a button whose label is optional is one where somebody eventually
 * ships a control that announces nothing to a screen reader.
 */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = "md",
  tone = "default",
  surface = true,
  disabled = false,
}: {
  icon: LucideIcon;
  onPress?: () => void;
  accessibilityLabel: string;
  size?: ButtonSize;
  /*
   * The same tones `Icon` offers, minus `inverse` which needs a coloured
   * surface behind it. A starred project wants the safety amber and there was
   * no way to ask for it, which is the kind of gap that ends with a screen
   * hardcoding a hex.
   */
  tone?: "default" | "muted" | "primary" | "safety" | "success" | "destructive";
  /** Draws the tinted circle behind the glyph. Off gives a bare tappable glyph. */
  surface?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const box = sizing[size].height;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={box < HIT_TARGET ? (HIT_TARGET - box) / 2 : 0}
      style={({ pressed }) => ({
        width: box,
        height: box,
        borderRadius: box / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: surface ? theme.colors.secondary : "transparent",
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <Icon icon={icon} size={size === "sm" ? "sm" : "md"} tone={tone} />
    </Pressable>
  );
}

/** Puts buttons in a row that wraps instead of overflowing off a narrow phone. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>{children}</View>
  );
}
