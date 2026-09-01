import type { ReactNode } from "react";
import { Search, X } from "@/ui/icons";
import { TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";
import { IconButton } from "./Button";
import { Icon } from "./Icon";
import { Text } from "./Text";

/**
 * The header a tab screen draws for itself.
 *
 * The tab screens deliberately run with the navigator header turned off. A
 * stock header gives one centred title of fixed height and no room for the
 * things these screens actually need at the top: a search field that stays put
 * while the list scrolls under it, a filter row, a count. The web app made the
 * same call with `PageHeader`, and this is its counterpart.
 *
 * Because there is no navigator header above it, this one owns the top safe
 * area. Screens pushed onto the stack keep the native header and must not use
 * this, or they get two titles.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Icon buttons, right-aligned against the title. */
  actions?: ReactNode;
  /** A search field, a chip row, or anything else pinned under the title. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingTop: insets.top + spacing.sm,
        paddingBottom: spacing.sm,
        backgroundColor: theme.colors.background,
        gap: spacing.md,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="display" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions}
      </View>
      {children}
    </View>
  );
}

/**
 * The search field that sits under a page title.
 *
 * Separate from `Field` because it is a different control: rounded to a pill,
 * no label, and it carries a clear button. The clear button matters more on a
 * phone than on the web, where a keyboard has an escape key: without it the
 * only way out of a filtered list is to hold backspace.
 */
export function SearchField({
  value,
  onChangeText,
  placeholder = "Search",
  accessibilityLabel = "Search",
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: spacing.lg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          height: HIT_TARGET,
          paddingHorizontal: spacing.md,
          borderRadius: radius.pill,
          backgroundColor: theme.colors.secondary,
        }}
      >
        <Icon icon={Search} size="md" tone="muted" />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.mutedForeground}
          accessibilityLabel={accessibilityLabel}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
          style={[typography.body, { flex: 1, color: theme.colors.foreground, paddingVertical: 0 }]}
        />
        {value.length > 0 ? (
          <IconButton
            icon={X}
            size="sm"
            accessibilityLabel="Clear search"
            surface={false}
            tone="muted"
            onPress={() => onChangeText("")}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * The line under a screen's name, for screens that already HAVE a name.
 *
 * `PageHeader` draws a large title and pads for the status bar, which is right
 * for a tab screen that has no navigation bar above it. Three screens were
 * using it underneath a `Stack.Screen` that already showed the same word, so
 * the title appeared twice - once in the nav bar and again in 32pt directly
 * below it - and the safe-area padding was added a second time on top of the
 * nav bar's own, which is where the band of empty space came from.
 *
 * The subtitle was the only part worth keeping: "2 questions in this thread"
 * says something the nav bar cannot.
 */
export function ScreenNote({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
      <Text variant="caption" tone="muted">
        {text}
      </Text>
    </View>
  );
}
