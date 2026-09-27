import { Pressable, ScrollView, View } from "react-native";
import { isProjectStatus, PROJECT_STATUS_LABELS } from "@everlumen/shared";
import { radius, spacing, useTheme, type Theme } from "@/theme";
import { Text } from "@/ui";

/**
 * A project's status, as the list card and the project hero draw it.
 *
 * Not the kit's `Badge`: that one is an uppercase overline, which is right for
 * a small state flag inside a dense row and too quiet for the one fact a crew
 * scans a job list for. This is sentence case at caption weight, tinted by the
 * same three buckets `PROJECT_STATUSES` defines.
 */

export function projectStatusLabel(status: string): string {
  return isProjectStatus(status) ? PROJECT_STATUS_LABELS[status] : status;
}

/** Fill and ink for a status. Unknown statuses fall back to the neutral pair. */
function statusColors(theme: Theme, status: string): { fill: string; ink: string } {
  if (status === "active") {
    return {
      fill: withAlpha(theme.colors.success, theme.scheme === "dark" ? 0.22 : 0.14),
      ink: theme.colors.success,
    };
  }
  if (status === "on_hold") {
    // Accent peach with its own ink. The safety amber as text on cream
    // measures well under 3:1, so it cannot be the label colour here.
    return { fill: theme.colors.accent, ink: theme.colors.accentForeground };
  }
  return { fill: theme.colors.secondary, ink: theme.colors.mutedForeground };
}

export function ProjectStatusPill({ status }: { status: string }) {
  const theme = useTheme();
  const { fill, ink } = statusColors(theme, status);
  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radius.pill,
        backgroundColor: fill,
      }}
    >
      <Text variant="caption" style={{ color: ink, fontWeight: "700" }} numberOfLines={1}>
        {projectStatusLabel(status)}
      </Text>
    </View>
  );
}

export type ProjectFilterOption<T extends string> = { id: T; label: string; count?: number };

/**
 * The status filter row on the Projects tab.
 *
 * Selected is the dark ink fill; unselected pills carry their status tint so
 * "Active" reads as the green one before anybody reads the word. Counts come
 * from the caller, which derives them from the unfiltered list.
 */
export function ProjectFilterPills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ProjectFilterOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={label}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
    >
      {options.map((option) => {
        const selected = option.id === value;
        const tint =
          option.id === "all"
            ? { fill: theme.colors.secondary, ink: theme.colors.secondaryForeground }
            : statusColors(theme, option.id);
        const fill = selected ? theme.colors.foreground : tint.fill;
        const ink = selected ? theme.colors.background : tint.ink;
        const text =
          option.count === undefined ? option.label : `${option.label} · ${option.count}`;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={
              option.count === undefined ? option.label : `${option.label}, ${option.count}`
            }
            onPress={() => onChange(option.id)}
            style={({ pressed }) => ({
              height: 38,
              paddingHorizontal: spacing.lg,
              borderRadius: radius.pill,
              justifyContent: "center",
              backgroundColor: fill,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Text variant="caption" style={{ color: ink, fontWeight: "700" }} numberOfLines={1}>
              {text}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function withAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
