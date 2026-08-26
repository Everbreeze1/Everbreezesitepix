import type { ReactNode } from "react";
import { X } from "@/ui/icons";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, spacing, useTheme } from "@/theme";
import { IconButton } from "./Button";
import { Icon, type LucideIcon } from "./Icon";
import { Text } from "./Text";

/**
 * A bottom sheet.
 *
 * The web app reaches for a dialog for anything secondary: tag a photo, pick a
 * template, edit a project. Ported to a phone as a centred modal those all
 * arrive in the middle of the screen, which is the part of a 6.7 inch display a
 * thumb cannot comfortably reach. A sheet puts the same content against the
 * bottom edge where the hand already is.
 *
 * Built on RN `Modal` rather than a gesture library. A draggable sheet wants
 * `react-native-gesture-handler` plus `@gorhom/bottom-sheet`, and the drag is
 * not what makes this useful: the position is. When a screen needs a sheet that
 * snaps and drags (the photo details panel is the likely first one) that is the
 * moment to add the dependency, not before.
 */

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  /** Caps the panel height so a long list scrolls instead of covering the screen. */
  maxHeightRatio = 0.85,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxHeightRatio?: number;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // Android's hardware back must close the sheet, not the screen behind it.
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: theme.colors.scrim }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{ flex: 1 }}
        />
        <View
          style={[
            {
              maxHeight: `${Math.round(maxHeightRatio * 100)}%`,
              backgroundColor: theme.colors.card,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingBottom: insets.bottom,
            },
            theme.elevation.sheet,
          ]}
        >
          {/* Grabber. Purely a signal that this panel belongs to the bottom edge. */}
          <View style={{ alignItems: "center", paddingTop: spacing.sm }}>
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: radius.pill,
                backgroundColor: theme.colors.border,
              }}
            />
          </View>

          {title ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.md,
                paddingBottom: spacing.sm,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="title" numberOfLines={1}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text variant="caption" tone="muted" numberOfLines={2}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <IconButton icon={X} accessibilityLabel="Close" onPress={onClose} surface={false} />
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>

          {footer ? (
            <View
              style={{
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.md,
                paddingBottom: spacing.md,
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
                gap: spacing.sm,
              }}
            >
              {footer}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export type SheetAction = {
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * A sheet that is only a list of actions, replacing the overflow menu.
 *
 * Selecting an action closes the sheet first. Leaving it open while the handler
 * navigates means the sheet is still mounted over the next screen, and on
 * Android that swallows the first back press.
 */
export function ActionSheet({
  visible,
  onClose,
  title,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  actions: SheetAction[];
}) {
  const theme = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ gap: spacing.xs }}>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: action.disabled }}
            disabled={action.disabled}
            onPress={() => {
              onClose();
              action.onPress();
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              minHeight: 52,
              paddingHorizontal: spacing.md,
              borderRadius: radius.md,
              opacity: action.disabled ? 0.45 : 1,
              backgroundColor: pressed ? theme.colors.secondary : "transparent",
            })}
          >
            {action.icon ? (
              <Icon
                icon={action.icon}
                size="md"
                tone={action.destructive ? "destructive" : "default"}
              />
            ) : null}
            <Text variant="body" tone={action.destructive ? "destructive" : "default"}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}
