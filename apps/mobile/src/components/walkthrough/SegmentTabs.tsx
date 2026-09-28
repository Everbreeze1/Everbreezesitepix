import { Pressable, View } from "react-native";
import { radius, spacing, useTheme } from "@/theme";
import { Icon, Text, type LucideIcon } from "@/ui";

export type Segment<T extends string> = { id: T; label: string; icon?: LucideIcon };

/**
 * Two or three labelled halves of one screen.
 *
 * A pill track with the chosen segment raised onto the card colour, the way
 * the web's Videos / Summaries toggle reads. Equal widths, so the choices look
 * like peers rather than a list with a favourite.
 */
export function SegmentTabs<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        padding: spacing.xs,
        gap: spacing.xs,
        borderRadius: radius.lg,
        backgroundColor: theme.colors.muted,
      }}
    >
      {segments.map((segment) => {
        const selected = segment.id === value;
        return (
          <Pressable
            key={segment.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={segment.label}
            onPress={() => onChange(segment.id)}
            style={({ pressed }) => ({
              flex: 1,
              height: 44,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.sm,
              borderRadius: radius.md,
              backgroundColor: selected ? theme.colors.card : "transparent",
              borderWidth: selected ? 1 : 0,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            {segment.icon ? (
              <Icon icon={segment.icon} size="sm" tone={selected ? "primary" : "muted"} />
            ) : null}
            <Text variant="bodyStrong" tone={selected ? "default" : "muted"} numberOfLines={1}>
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
