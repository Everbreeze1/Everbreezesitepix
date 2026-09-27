import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { radius, spacing, useTheme } from "@/theme";

export type CameraMode =
  | "photo"
  | "before-after"
  | "measure"
  | "untagged"
  | "scan"
  | "video"
  | "walkthrough";

export type CameraModeOption = {
  id: CameraMode;
  label: string;
  /** Spoken by screen readers; what the mode does, not just its name. */
  hint: string;
};

/**
 * The modes the mobile camera offers, in the order web's mode row uses.
 *
 * Measure is Pro/Team, as on web; `cameraModes` leaves it out for everyone
 * else. Dual is "coming soon" on web too, so it is not here.
 */
export const CAMERA_MODES: CameraModeOption[] = [
  { id: "photo", label: "Photo", hint: "Normal photos" },
  { id: "before-after", label: "Before/After", hint: "Tag photos as before or after" },
  { id: "measure", label: "Measure", hint: "Take a photo and mark measurements on it" },
  { id: "untagged", label: "Untagged", hint: "Photos with no phase and no tags" },
  { id: "scan", label: "Scan", hint: "High-contrast document capture" },
  { id: "video", label: "Video", hint: "Record video with the walkthrough recorder" },
  { id: "walkthrough", label: "Walkthrough", hint: "Open the walkthrough recorder" },
];

/** The row for this viewer: Measure only on a Pro or Team plan. */
export function cameraModes(canMeasure: boolean): CameraModeOption[] {
  return canMeasure ? CAMERA_MODES : CAMERA_MODES.filter((mode) => mode.id !== "measure");
}

/*
 * Camera chrome stays dark whatever the app scheme, for the same reason the
 * capture screen's bars do: it sits on a live picture.
 */
const CHROME_BAR = "rgba(10, 8, 6, 0.82)";
const INACTIVE_FG = "rgba(255, 255, 255, 0.72)";

/**
 * A native-camera style mode strip: a horizontally scrolling row of words
 * under the shutter, the active one in the brand orange with a dot beneath.
 *
 * The active mode is scrolled towards the middle whenever it changes, so a
 * mode picked at the end of the row does not sit half off screen.
 */
export function CameraModeRow({
  modes = CAMERA_MODES,
  value,
  onChange,
  disabled = false,
}: {
  modes?: CameraModeOption[];
  value: CameraMode;
  onChange: (mode: CameraMode) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const positions = useRef<Partial<Record<CameraMode, { x: number; width: number }>>>({});

  useEffect(() => {
    const pos = positions.current[value];
    if (!pos || !rowWidth) return;
    const target = Math.max(0, pos.x + pos.width / 2 - rowWidth / 2);
    scrollRef.current?.scrollTo({ x: target, animated: true });
  }, [value, rowWidth]);

  function onItemLayout(id: CameraMode, event: LayoutChangeEvent) {
    const { x, width } = event.nativeEvent.layout;
    positions.current[id] = { x, width };
  }

  return (
    <View
      style={styles.bar}
      onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
      accessibilityRole="radiogroup"
      accessibilityLabel="Camera mode"
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {modes.map((mode) => {
          const active = mode.id === value;
          return (
            <Pressable
              key={mode.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={mode.label}
              accessibilityHint={mode.hint}
              disabled={disabled}
              hitSlop={4}
              onLayout={(event) => onItemLayout(mode.id, event)}
              onPress={() => onChange(mode.id)}
              style={styles.item}
            >
              <Text
                style={[styles.label, { color: active ? theme.colors.primary : INACTIVE_FG }]}
                numberOfLines={1}
              >
                {mode.label.toUpperCase()}
              </Text>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: active ? theme.colors.primary : "transparent" },
                ]}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: CHROME_BAR,
    borderRadius: radius.pill,
    marginHorizontal: spacing.lg,
    overflow: "hidden",
  },
  content: {
    paddingHorizontal: spacing.md,
    alignItems: "center",
  },
  item: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 6,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  label: { fontSize: 13, fontWeight: "800", letterSpacing: 0.8 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});
