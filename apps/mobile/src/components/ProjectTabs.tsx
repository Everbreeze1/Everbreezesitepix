import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { spacing, useTheme } from "@/theme";
import { Text } from "@/ui";

/**
 * The tab row under a project's header.
 *
 * It scrolls sideways because a job has more sections than a phone is wide.
 * The active tab is marked with an orange underline as well as orange ink, so
 * it does not rely on colour alone.
 */

export type ProjectTab<T extends string> = { id: T; label: string };

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
        backgroundColor: theme.colors.card,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        contentContainerStyle={{ paddingHorizontal: spacing.sm }}
      >
        {tabs.map((tab) => {
          const active = tab.id === value;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab.label}
              onPress={() => onChange(tab.id)}
              style={({ pressed }) => ({
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.md,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                variant="bodyStrong"
                style={{
                  fontWeight: "700",
                  color: active ? theme.colors.primary : theme.colors.mutedForeground,
                }}
              >
                {tab.label}
              </Text>
              <View
                style={{
                  marginTop: spacing.sm,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: active ? theme.colors.primary : "transparent",
                }}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
