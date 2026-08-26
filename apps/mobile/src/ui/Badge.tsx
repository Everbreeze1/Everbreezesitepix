import { View, type StyleProp, type ViewStyle } from "react-native";
import { radius, spacing, useTheme } from "@/theme";
import { Icon, type LucideIcon } from "./Icon";
import { Text } from "./Text";

/**
 * A status pill.
 *
 * The product is full of states that a person needs to read at a glance and
 * never needs to tap: a project's status, whether a checklist passed, how many
 * photos are queued, whether a walkthrough has a transcript yet. Written as
 * plain text those all look like body copy and the eye slides past them.
 *
 * `soft` is the default rather than `solid` because these usually sit inside a
 * card that already has a primary action in it, and two saturated blocks in one
 * card leaves nothing to look at first.
 */

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger";
export type BadgeVariant = "soft" | "solid" | "outline";

export type BadgeProps = {
  label: string;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
};

export function Badge({ label, tone = "neutral", variant = "soft", icon, style }: BadgeProps) {
  const theme = useTheme();

  const base = {
    neutral: theme.colors.mutedForeground,
    primary: theme.colors.primary,
    success: theme.colors.success,
    warning: theme.colors.safety,
    danger: theme.colors.destructive,
  }[tone];

  const solidLabel = {
    neutral: theme.colors.card,
    primary: theme.colors.primaryForeground,
    success: theme.colors.successForeground,
    warning: theme.colors.safetyForeground,
    danger: theme.colors.destructiveForeground,
  }[tone];

  /*
   * The soft fill is the tone at low alpha rather than a second set of tokens.
   * Eight-digit hex is not universally supported by the RN style engine, so the
   * alpha goes through rgba, which means the tone has to be resolvable to
   * channels. Every palette colour here is a six-digit hex, so this holds.
   */
  const softFill = withAlpha(base, theme.scheme === "dark" ? 0.22 : 0.12);

  const background = variant === "solid" ? base : variant === "soft" ? softFill : "transparent";
  const labelColor = variant === "solid" ? solidLabel : base;

  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          alignSelf: "flex-start",
          paddingHorizontal: spacing.sm,
          paddingVertical: 3,
          borderRadius: radius.pill,
          backgroundColor: background,
          borderWidth: variant === "outline" ? 1 : 0,
          borderColor: variant === "outline" ? withAlpha(base, 0.45) : undefined,
        },
        style,
      ]}
    >
      {icon ? <Icon icon={icon} size="xs" color={labelColor} /> : null}
      <Text variant="overline" style={{ color: labelColor }} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

/** A small count, for tab bars and list rows. Reads "12" not "TWELVE PHOTOS". */
export function CountBadge({ count, tone = "primary" }: { count: number; tone?: BadgeTone }) {
  const theme = useTheme();
  if (count <= 0) return null;
  const base = tone === "danger" ? theme.colors.destructive : theme.colors.primary;
  return (
    <View
      style={{
        minWidth: 20,
        height: 20,
        paddingHorizontal: 5,
        borderRadius: radius.pill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: base,
      }}
    >
      <Text variant="overline" style={{ color: theme.colors.primaryForeground }}>
        {count > 99 ? "99+" : String(count)}
      </Text>
    </View>
  );
}

function withAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
