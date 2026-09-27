import { Pressable, ScrollView, View } from "react-native";
import { radius, spacing, useTheme } from "@/theme";
import { Text, type ChipOption } from "@/ui";

/**
 * The Photo Library's filter row.
 *
 * Not `ChipGroup`, on purpose: the library's pills are a view switch as much
 * as a filter ("By project" regroups the grid rather than hiding anything), and
 * the design draws the chosen one in the dark chrome colour with no outline on
 * the rest, so the row reads as one segmented control rather than a set of
 * independent toggles. Behaviour otherwise matches `ChipGroup`: single select,
 * horizontal scroll, announced as a tab list.
 */
export function GalleryFilterPills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}
      >
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.id)}
              style={({ pressed }) => ({
                justifyContent: "center",
                paddingHorizontal: spacing.lg,
                height: 38,
                borderRadius: radius.pill,
                backgroundColor: selected ? theme.colors.chrome : theme.colors.secondary,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text
                variant="bodyStrong"
                numberOfLines={1}
                style={{
                  fontSize: 14,
                  color: selected
                    ? theme.colors.chromeForeground
                    : theme.colors.secondaryForeground,
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
