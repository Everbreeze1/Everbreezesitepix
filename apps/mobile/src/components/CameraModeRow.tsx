import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { radius, spacing } from "@/theme";
import { Icon, type LucideIcon } from "@/ui";
import {
  ArrowLeftRight,
  Camera,
  Footprints,
  Layers,
  Ruler,
  ScanLine,
  Tag,
  Video,
} from "@/ui/icons";

export type CameraMode =
  | "photo"
  | "before-after"
  | "measure"
  | "untagged"
  | "scan"
  | "video"
  | "walkthrough"
  | "dual";

export type CameraModeOption = {
  id: CameraMode;
  label: string;
  /** Spoken by screen readers; what the mode does, not just its name. */
  hint: string;
  icon: LucideIcon;
  /** Shown in the bar, as web shows it, but tapping it only says it is coming. */
  comingSoon?: boolean;
};

/**
 * The modes the mobile camera offers, in the order and with the glyphs web's
 * mode bar uses.
 *
 * Measure is Pro/Team on a supported phone; `cameraModes` leaves it out for
 * everyone else. Dual is "coming soon" on web, and here too: it sits in the
 * bar so the two cameras match, and says so when tapped rather than faking a
 * second stream.
 */
export const CAMERA_MODES: CameraModeOption[] = [
  { id: "photo", label: "Picture", hint: "Normal photos", icon: Camera },
  {
    id: "before-after",
    label: "Before/After",
    hint: "Tag photos as before or after",
    icon: ArrowLeftRight,
  },
  {
    id: "measure",
    label: "Measure",
    hint: "Take a photo and mark measurements on it",
    icon: Ruler,
  },
  { id: "untagged", label: "Untagged", hint: "Pick tags for these photos", icon: Tag },
  { id: "scan", label: "Scan", hint: "High-contrast document capture", icon: ScanLine },
  { id: "video", label: "Video", hint: "Record a site video for this project", icon: Video },
  {
    id: "walkthrough",
    label: "Walkthrough",
    hint: "Open the walkthrough recorder",
    icon: Footprints,
  },
  { id: "dual", label: "Dual", hint: "Coming soon", icon: Layers, comingSoon: true },
];

/** The bar for this viewer: Measure only when `canMeasure`. */
export function cameraModes(canMeasure: boolean): CameraModeOption[] {
  return canMeasure ? CAMERA_MODES : CAMERA_MODES.filter((mode) => mode.id !== "measure");
}

/*
 * Camera chrome stays dark whatever the app scheme, for the same reason the
 * capture screen's buttons do: it sits on a live picture.
 */
const CHROME_BAR = "rgba(10, 8, 6, 0.62)";
const INACTIVE_FG = "rgba(255, 255, 255, 0.72)";
const ACTIVE_FILL = "#ffffff";
const ACTIVE_FG = "#18130d";

/**
 * Web's mode bar: one rounded, translucent bar that scrolls sideways, each
 * mode an icon over an uppercase word, the chosen one on a white pill.
 *
 * The chosen mode is scrolled towards the middle whenever it changes, so a
 * mode picked at the end of the bar does not sit half off screen.
 *
 * `labels` overrides a mode's word, which is how Untagged shows the tag or
 * the tag count once tags are picked, as web does.
 */
export function CameraModeRow({
  modes = CAMERA_MODES,
  value,
  onChange,
  disabled = false,
  labels,
}: {
  modes?: CameraModeOption[];
  value: CameraMode;
  onChange: (mode: CameraMode) => void;
  disabled?: boolean;
  labels?: Partial<Record<CameraMode, string>>;
}) {
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
          const label = labels?.[mode.id] ?? mode.label;
          const fg = active ? ACTIVE_FG : INACTIVE_FG;
          return (
            <Pressable
              key={mode.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={mode.comingSoon ? `${label}, coming soon` : label}
              accessibilityHint={mode.hint}
              disabled={disabled}
              hitSlop={4}
              onLayout={(event) => onItemLayout(mode.id, event)}
              onPress={() => onChange(mode.id)}
              style={[styles.item, active && styles.itemActive]}
            >
              <Icon icon={mode.icon} size="md" color={fg} />
              <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
                {label.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignSelf: "stretch",
    backgroundColor: CHROME_BAR,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.18)",
    overflow: "hidden",
  },
  content: {
    padding: 6,
    gap: spacing.xs,
    alignItems: "center",
  },
  item: {
    minWidth: 72,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  itemActive: { backgroundColor: ACTIVE_FILL },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, maxWidth: 140 },
});
