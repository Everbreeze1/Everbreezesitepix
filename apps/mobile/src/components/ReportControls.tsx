import { Pressable, View } from "react-native";
import { photosPerPageHint, type PhotosPerPage } from "@/api/report-builder-view";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { Badge, ListRow, Text } from "@/ui";
import type { LucideIcon } from "@/ui";

/**
 * Small controls the report screens share: the photos-per-page segmented row
 * and an on/off row. Drawn from the kit's own tokens so they sit in the warm
 * theme with the rest of the report screens.
 */

export function PhotosPerPagePicker({
  value,
  onChange,
  hint = true,
}: {
  value: PhotosPerPage;
  onChange: (next: PhotosPerPage) => void;
  hint?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="caption" tone="muted">
        Photos per page
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Photos per page"
        style={{
          flexDirection: "row",
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          overflow: "hidden",
        }}
      >
        {([1, 2, 3, 4] as const).map((n, i) => {
          const on = n === value;
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${n} per page`}
              onPress={() => onChange(n)}
              style={{
                flex: 1,
                minHeight: HIT_TARGET,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: on ? theme.colors.primary : theme.colors.card,
                borderLeftWidth: i === 0 ? 0 : 1,
                borderLeftColor: theme.colors.border,
              }}
            >
              <Text variant="bodyStrong" tone={on ? "inverse" : "default"}>
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? (
        <Text variant="caption" tone="muted">
          {photosPerPageHint(value)}
        </Text>
      ) : null}
    </View>
  );
}

/** A list row that flips a setting, with the state as a pill. */
export function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
  icon,
  disabled,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  icon?: LucideIcon;
  disabled?: boolean;
}) {
  return (
    <ListRow
      icon={icon}
      iconTone={value ? "success" : "muted"}
      title={title}
      subtitle={subtitle}
      disabled={disabled}
      accessibilityHint={value ? "On. Tap to turn off." : "Off. Tap to turn on."}
      right={
        <Badge
          label={value ? "On" : "Off"}
          tone={value ? "success" : "neutral"}
          variant={value ? "soft" : "outline"}
        />
      }
      onPress={() => onChange(!value)}
    />
  );
}
