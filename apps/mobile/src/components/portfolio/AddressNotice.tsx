import { View } from "react-native";
import { townOnly } from "@/api/portfolio-showcase";
import { radius, spacing, useTheme } from "@/theme";
import { TriangleAlert } from "@/ui/icons";
import { Button, Icon, Text } from "@/ui";

/**
 * The privacy check on a line that publishes where a customer lives: the
 * web's `AddressPrivacyNotice`. Shown only when the line looks like a street
 * address, with a one-tap fix that keeps the town. Nothing when the line is fine.
 */
export function AddressNotice({
  value,
  city,
  state,
  onUseTownOnly,
}: {
  value: string;
  city: string;
  state: string;
  onUseTownOnly: (next: string) => void;
}) {
  const theme = useTheme();
  const fixed = townOnly(value, city, state);
  if (fixed === null) return null;
  return (
    <View
      style={{
        gap: spacing.xs,
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: theme.colors.safety,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Icon icon={TriangleAlert} size="sm" tone="safety" />
        <Text variant="bodyStrong">This looks like a street address</Text>
      </View>
      <Text variant="caption" tone="muted">
        Anyone with the link can read this. On a customer&apos;s home, the town is usually as much
        as you want to publish.
      </Text>
      <View style={{ flexDirection: "row" }}>
        <Button
          label="Use the town only"
          size="sm"
          variant="secondary"
          onPress={() => onUseTownOnly(fixed)}
        />
      </View>
    </View>
  );
}
