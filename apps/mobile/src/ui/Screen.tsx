import type { ReactNode } from "react";
import {
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { contentInset, spacing, useTheme } from "@/theme";

/**
 * The screen scaffold.
 *
 * Three things every screen needs and every screen was doing slightly
 * differently: the palette background (so dark mode is not a white flash behind
 * a dark list), the bottom safe-area inset, and pull to refresh.
 *
 * The bottom inset is the one that actually bites. The home indicator on a
 * modern iPhone sits over the last 34pt of the screen, so a list that ends at
 * `paddingBottom: 0` puts its final row under a system control, and the tab bar
 * added on top of that hides the row entirely. Every screen paying attention to
 * this on its own is how one screen ends up not paying attention.
 *
 * The top inset is deliberately not applied: these screens sit under a
 * navigation header that already accounts for it, and adding it again pushes
 * the content down by the height of a status bar for no reason.
 */

export type ScreenProps = {
  children: ReactNode;
  /** Wraps the content in a ScrollView. Leave off for a screen that owns its own list. */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Horizontal gutter. Off for full-bleed content such as a photo grid. */
  padded?: boolean;
  /** Extra bottom room, for a floating action button or a docked bar. */
  bottomInset?: number;
  contentStyle?: StyleProp<ViewStyle>;
};

export function Screen({
  children,
  scroll = false,
  refreshing,
  onRefresh,
  padded = true,
  bottomInset = 0,
  contentStyle,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  /*
   * On a tablet the content is centred in a column rather than stretched.
   *
   * `supportsTablet` is true, so Apple reviews this on an iPad, and every
   * screen here was laid out against a 390pt phone. At 1024pt a full-width
   * primary button is a metre across and a line of body text is too wide to
   * read without losing your place. Done here rather than per screen because
   * every screen is built on this component, so one change fixes all of them
   * and none of them can be forgotten.
   *
   * Padding rather than a fixed width: children keep using `flex: 1` and stay
   * full width of the column. A fixed width would need `alignSelf` on every
   * screen, which is the kind of change that gets applied to nine and missed on
   * the tenth.
   */
  const horizontal = contentInset(width, padded ? spacing.lg : 0);

  const padding: StyleProp<ViewStyle> = {
    paddingHorizontal: horizontal,
    paddingBottom: insets.bottom + bottomInset + spacing.lg,
  };

  const refreshControl =
    onRefresh !== undefined ? (
      <RefreshControl
        refreshing={refreshing ?? false}
        onRefresh={onRefresh}
        tintColor={theme.colors.mutedForeground}
        colors={[theme.colors.primary]}
        progressBackgroundColor={theme.colors.card}
      />
    ) : undefined;

  if (!scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={[{ flex: 1 }, padding, contentStyle]}>{children}</View>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={[{ gap: spacing.md }, padding, contentStyle]}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

/**
 * A bar docked above the safe area, for the one action a screen is about.
 *
 * Distinct from a floating button: use this when the action is the reason the
 * screen exists (Save, Complete checklist, Upload) and a FAB when it is one of
 * several things a person might do next.
 */
export function ScreenFooter({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        {
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          paddingBottom: insets.bottom + spacing.md,
          gap: spacing.sm,
          backgroundColor: theme.colors.card,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
        },
        theme.elevation.sheet,
      ]}
    >
      {children}
    </View>
  );
}
