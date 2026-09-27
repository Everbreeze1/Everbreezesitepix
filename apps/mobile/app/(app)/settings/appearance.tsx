import { useEffect, useState } from "react";
import { View } from "react-native";
import { spacing, useTheme } from "@/theme";
import {
  loadAppearance,
  saveAppearance,
  type AppearancePreference,
} from "@/theme/appearance";
import { Check, Smartphone, Sun, Moon } from "@/ui/icons";
import { Icon, ListGroup, ListRow, RowDivider, Screen, Text } from "@/ui";

/**
 * Light, dark, or follow the phone: the web Settings page's Appearance choice.
 *
 * Applied the moment it is tapped and kept on this device. The whole app
 * follows it, headers and pickers included, because the override is React
 * Native's own rather than a second theme source (see `theme/appearance.ts`).
 */
const OPTIONS: {
  id: AppearancePreference;
  title: string;
  subtitle: string;
  icon: typeof Sun;
}[] = [
  { id: "system", title: "System", subtitle: "Match the phone's setting", icon: Smartphone },
  { id: "light", title: "Light", subtitle: "Warm cream, best in daylight", icon: Sun },
  { id: "dark", title: "Dark", subtitle: "Easier on the eyes at night", icon: Moon },
];

export default function AppearanceScreen() {
  const theme = useTheme();
  const [choice, setChoice] = useState<AppearancePreference | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadAppearance().then((stored) => {
      if (!cancelled) setChoice(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Screen scroll bottomInset={spacing.xxl}>
      <ListGroup>
        {OPTIONS.map((option, index) => (
          <View key={option.id}>
            {index > 0 ? <RowDivider /> : null}
            <ListRow
              icon={option.icon}
              title={option.title}
              subtitle={option.subtitle}
              chevron={false}
              right={
                choice === option.id ? (
                  <Icon icon={Check} size="md" color={theme.colors.primary} />
                ) : undefined
              }
              onPress={() => {
                setChoice(option.id);
                void saveAppearance(option.id);
              }}
            />
          </View>
        ))}
      </ListGroup>
      <Text variant="caption" tone="muted">
        Saved on this phone only. The web app keeps its own choice.
      </Text>
    </Screen>
  );
}
