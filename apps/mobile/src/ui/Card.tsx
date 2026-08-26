import type { ReactNode } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { radius, spacing, useTheme } from "@/theme";
import { Icon, type LucideIcon } from "./Icon";
import { Text } from "./Text";

/**
 * A raised surface.
 *
 * Counted across the app before this existed: nine separate `StyleSheet`
 * entries drawing a bordered box, with radii of 6, 10, 10, 12, 14 and 16, three
 * different border colours and two that had no border at all. None of that was
 * a decision, it was each screen being written on a different day.
 */

export function Card({
  children,
  padded = true,
  onPress,
  accessibilityLabel,
  raised = false,
  style,
}: {
  children: ReactNode;
  padded?: boolean;
  /** Makes the whole card the tap target. Adds the button role automatically. */
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Adds a shadow. Reserve it for cards that float over content, such as a sheet. */
  raised?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const box: StyleProp<ViewStyle> = [
    {
      backgroundColor: theme.colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: padded ? spacing.lg : 0,
      overflow: "hidden",
    },
    raised ? theme.elevation.card : null,
    style,
  ];

  if (!onPress) return <View style={box}>{children}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [box, { opacity: pressed ? 0.75 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

/**
 * Title bar inside a card, with room for one action on the right.
 *
 * One action, not a menu: anything needing a second belongs in a sheet, because
 * two icon buttons 8pt apart at the top corner of a card is the layout people
 * mis-tap most on a phone held in one hand.
 */
export function CardHeader({
  icon,
  title,
  subtitle,
  right,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        marginBottom: spacing.md,
      }}
    >
      {icon ? <Icon icon={icon} size="md" tone="primary" /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/**
 * A titled block between cards.
 *
 * `action` is a label plus a handler rather than arbitrary children, so every
 * section header on every screen puts its one link in the same place at the
 * same size.
 */
export function SectionHeader({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        marginTop: spacing.xl,
        marginBottom: spacing.sm,
      }}
    >
      <Text variant="overline" tone="muted">
        {title.toUpperCase()}
      </Text>
      {count !== undefined ? (
        <Text variant="overline" tone="muted">
          {count}
        </Text>
      ) : null}
      <View style={{ flex: 1 }} />
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          hitSlop={12}
        >
          <Text variant="caption" tone="primary">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
