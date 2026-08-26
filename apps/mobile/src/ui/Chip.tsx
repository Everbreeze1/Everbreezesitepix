import { Pressable, ScrollView, View } from "react-native";
import { radius, spacing, useTheme } from "@/theme";
import { Icon, type LucideIcon } from "./Icon";
import { Text } from "./Text";

/**
 * The filter row.
 *
 * Photo phase, task assignee, checklist status, project status: the same
 * control, hand-rolled four times with four different paddings. It scrolls
 * horizontally because the number of options is set by the user's data (labels,
 * phases, crew), not by the designer, so it will eventually be wider than a
 * phone no matter what fits today.
 */

export type ChipOption<T extends string> = {
  id: T;
  label: string;
  icon?: LucideIcon;
  count?: number;
};

export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  count,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: LucideIcon;
  count?: number;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        paddingHorizontal: spacing.lg,
        // 38 rather than the 48 floor: these sit in a scrolling row where the
        // neighbouring targets are the same action, so a mis-tap costs a filter
        // change and not a destructive write.
        height: 38,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? theme.colors.primary : theme.colors.border,
        backgroundColor: selected ? theme.colors.primary : theme.colors.card,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {icon ? <Icon icon={icon} size="sm" tone={selected ? "inverse" : "muted"} /> : null}
      <Text variant="caption" tone={selected ? "inverse" : "default"} numberOfLines={1}>
        {label}
      </Text>
      {count !== undefined ? (
        <Text variant="caption" tone={selected ? "inverse" : "muted"}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Announced to screen readers, since a bare row of chips has no name. */
  label: string;
}) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}
      >
        {options.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            icon={option.icon}
            count={option.count}
            selected={option.id === value}
            onPress={() => onChange(option.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
