import type { ReactNode } from "react";
import { ChevronRight } from "@/ui/icons";
import { Pressable, View } from "react-native";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { Icon, type LucideIcon } from "./Icon";
import { Text } from "./Text";

/**
 * The navigation row: icon, label, optional value, chevron.
 *
 * This is the single most repeated shape in the app. The project screen stacks
 * six of them (Checklists, Tasks, Workflows, Walkthroughs and the rest) and the
 * account screen has four more, and until now each screen drew its own at a
 * different height. On a list of six, an inconsistent row height is visible
 * even to someone who is not looking for it.
 *
 * The chevron is drawn here rather than passed in, because a row that navigates
 * and a row that toggles must not look the same, and the way to guarantee that
 * is to let the presence of `onPress` decide.
 */

export type ListRowProps = {
  icon?: LucideIcon;
  iconTone?: "primary" | "muted" | "safety" | "success" | "destructive";
  title: string;
  subtitle?: string;
  /** Right-hand text, for a count or a status word. */
  value?: string;
  /** Anything richer than `value`: a badge, a switch, a small avatar stack. */
  right?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  accessibilityHint?: string;
};

export function ListRow({
  icon,
  iconTone = "primary",
  title,
  subtitle,
  value,
  right,
  onPress,
  disabled = false,
  destructive = false,
  accessibilityHint,
}: ListRowProps) {
  const theme = useTheme();

  const body = (
    <>
      {icon ? (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.sm,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.secondary,
          }}
        >
          <Icon icon={icon} size="md" tone={destructive ? "destructive" : iconTone} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" tone={destructive ? "destructive" : "default"} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {onPress ? <Icon icon={ChevronRight} size="md" tone="muted" /> : null}
    </>
  );

  const layout = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    minHeight: HIT_TARGET + spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    opacity: disabled ? 0.45 : 1,
  };

  if (!onPress) return <View style={layout}>{body}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        layout,
        { backgroundColor: pressed ? theme.colors.secondary : "transparent" },
      ]}
    >
      {body}
    </Pressable>
  );
}

/**
 * Groups rows into one bordered block with hairlines between them.
 *
 * A separate card per row is the other common way to do this, and it costs
 * roughly 12pt of vertical space per row. On a settings screen with ten rows
 * that is a whole extra screenful of scrolling bought no information.
 */
export function ListGroup({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.card,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

/** Hairline between rows in a `ListGroup`, inset to clear the icon column. */
export function RowDivider({ inset = true }: { inset?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 1,
        backgroundColor: theme.colors.border,
        marginLeft: inset ? spacing.lg + 36 + spacing.md : 0,
      }}
    />
  );
}
