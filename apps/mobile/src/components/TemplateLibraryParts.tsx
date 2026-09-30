import { Alert, View } from "react-native";
import { can } from "@everlumen/shared/team-permissions";
import { TRADE_CHOICES } from "@/api/template-library-view";
import { spacing } from "@/theme";
import { Chip, Text } from "@/ui";

/**
 * Pieces every template library screen shares: the trade picker, the
 * permission rule and the delete confirmation.
 */

/**
 * Whether this account may change the shared library: the web's rule, where a
 * solo user with no team owns everything they can see.
 */
export function canManageLibrary(myRole: string | null | undefined, loaded: boolean): boolean {
  if (!loaded) return false;
  return !myRole || can(myRole, "manage_templates");
}

/** The trade a template files under, as wrapping chips. */
export function TradeChips({
  value,
  onChange,
  label = "Trade",
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {TRADE_CHOICES.map((trade) => (
          <Chip
            key={trade}
            label={trade}
            selected={value === trade}
            onPress={disabled ? undefined : () => onChange(trade)}
          />
        ))}
      </View>
    </View>
  );
}

/** Every destructive action asks first, and says what survives it. */
export function confirmDelete(title: string, body: string, confirm: string, onConfirm: () => void) {
  Alert.alert(title, body, [
    { text: "Cancel", style: "cancel" },
    { text: confirm, style: "destructive", onPress: onConfirm },
  ]);
}

/** Error text from anything thrown. */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
