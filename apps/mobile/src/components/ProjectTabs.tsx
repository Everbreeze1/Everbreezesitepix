import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { radius, spacing, useTheme } from "@/theme";
import { Icon, Text, type LucideIcon } from "@/ui";

/**
 * The tab row under a project's header.
 *
 * Pills rather than underlined words: each carries its section's icon and,
 * where it is cheap to know, how many things are in it, so the row answers
 * "is there anything in Tasks?" before anybody taps. The active tab is a
 * filled orange pill, which does not rely on colour alone: the fill is a shape.
 *
 * It scrolls sideways because a job has more sections than a phone is wide.
 */

export type ProjectTab<T extends string> = {
  id: T;
  label: string;
  icon?: LucideIcon;
  /** A count, or a short reading such as "60+". Hidden when zero or absent. */
  count?: number | string | null;
};

export function ProjectTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: ProjectTab<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.background,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          gap: spacing.sm,
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === value;
          const ink = active ? theme.colors.primaryForeground : theme.colors.foreground;
          const showCount = tab.count !== undefined && tab.count !== null && tab.count !== 0;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={showCount ? `${tab.label}, ${tab.count}` : tab.label}
              onPress={() => onChange(tab.id)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs + 2,
                height: 40,
                paddingLeft: tab.icon ? spacing.md : spacing.lg,
                paddingRight: showCount ? spacing.sm : spacing.lg,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: active ? theme.colors.primary : theme.colors.border,
                backgroundColor: active ? theme.colors.primary : theme.colors.card,
                opacity: pressed ? 0.75 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              {tab.icon ? (
                <Icon
                  icon={tab.icon}
                  size="sm"
                  color={active ? theme.colors.primaryForeground : theme.colors.primary}
                />
              ) : null}
              <Text variant="caption" style={{ color: ink, fontWeight: "700" }} numberOfLines={1}>
                {tab.label}
              </Text>
              {showCount ? (
                <View
                  style={{
                    minWidth: 22,
                    height: 22,
                    paddingHorizontal: 6,
                    borderRadius: radius.pill,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: active ? "rgba(255,255,255,0.22)" : theme.colors.secondary,
                  }}
                >
                  <Text
                    variant="overline"
                    style={{
                      color: active ? theme.colors.primaryForeground : theme.colors.mutedForeground,
                    }}
                  >
                    {typeof tab.count === "number" && tab.count > 99 ? "99+" : String(tab.count)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
