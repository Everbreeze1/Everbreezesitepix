import { useState } from "react";
import {
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";
import { Icon, type LucideIcon } from "./Icon";
import { Text } from "./Text";

/**
 * A labelled text input.
 *
 * The new-project screen and the login screen each grew their own, and the two
 * disagreed on height, radius, and whether a focused field shows a ring at all.
 * A focus ring matters more here than on the web: on a phone the keyboard
 * covers half the screen and there is no cursor to look for, so the ring is the
 * only thing telling you which field the next keystroke lands in.
 */

export type FieldProps = {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  /** Shown under the field in the destructive tone, and announced as invalid. */
  error?: string;
  /** Shown under the field in the muted tone when there is no error. */
  hint?: string;
  icon?: LucideIcon;
  multiline?: boolean;
  /** Rows of visible height when `multiline`. */
  rows?: number;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: "off" | "email" | "name" | "tel" | "street-address" | "current-password";
  secureTextEntry?: boolean;
  editable?: boolean;
  onSubmitEditing?: () => void;
  /** Fired after the internal focus state clears. Checklist answers commit here. */
  onBlur?: () => void;
  returnKeyType?: "done" | "next" | "search" | "send";
  /**
   * Where the caret is, as the platform reports it.
   *
   * Only needed by a field that has to know what is being typed *at the caret*
   * rather than what the whole value says. The comment composer uses it to spot
   * a half-written `@handle` and open the mention picker.
   */
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  /**
   * Where to put the caret. Controlled, so leave it undefined unless you are
   * moving it: passing a fixed value pins the caret and the field stops
   * behaving like a text box.
   */
  selection?: { start: number; end: number };
  style?: StyleProp<ViewStyle>;
};

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  hint,
  icon,
  multiline = false,
  rows = 4,
  keyboardType,
  autoCapitalize = "sentences",
  autoComplete,
  secureTextEntry,
  editable = true,
  onSubmitEditing,
  onBlur,
  returnKeyType,
  onSelectionChange,
  selection,
  style,
}: FieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.colors.destructive
    : focused
      ? theme.colors.ring
      : theme.colors.input;

  return (
    <View style={[{ gap: spacing.xs }, style]}>
      {label ? (
        <Text variant="caption" tone="muted">
          {label}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: multiline ? "flex-start" : "center",
          gap: spacing.sm,
          minHeight: HIT_TARGET,
          paddingHorizontal: spacing.md,
          paddingVertical: multiline ? spacing.md : 0,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor,
          backgroundColor: editable ? theme.colors.card : theme.colors.muted,
          /*
           * The ring is drawn as a wider border colour rather than a shadow,
           * because Android does not render `shadow*` on a transparent-ish
           * surface and the field would then look focused on iOS only.
           */
        }}
      >
        {icon ? <Icon icon={icon} size="md" tone={focused ? "primary" : "muted"} /> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.mutedForeground}
          multiline={multiline}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          secureTextEntry={secureTextEntry}
          editable={editable}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          onSelectionChange={
            onSelectionChange
              ? (event) => onSelectionChange(event.nativeEvent.selection)
              : undefined
          }
          selection={selection}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          accessibilityLabel={label}
          accessibilityState={{ disabled: !editable }}
          style={[
            typography.body,
            {
              flex: 1,
              color: theme.colors.foreground,
              minHeight: multiline ? rows * 22 : HIT_TARGET,
              // Android centres single-line text oddly without this, and pins
              // multiline text to the middle of the box instead of the top.
              textAlignVertical: multiline ? "top" : "center",
              paddingVertical: 0,
            },
          ]}
        />
      </View>
      {error ? (
        <Text variant="caption" tone="destructive">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
