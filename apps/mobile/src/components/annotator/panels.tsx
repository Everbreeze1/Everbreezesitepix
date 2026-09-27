import { useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  COLORS,
  STICKER_GROUPS,
  WIDTH_MAX,
  WIDTH_MIN,
  WIDTH_PRESETS,
  type Adjust,
  type CalibrationUnit,
} from "./model";

/**
 * The annotator's pop-overs, as web has them: colour and thickness, stickers,
 * image adjustments, the text box and the calibration box.
 *
 * Dark and self-contained like the rest of the editor, which is a full-bleed
 * photo surface the light design system does not govern (the camera is the
 * other one).
 */

export const ACCENT = "#cb7229";
export const PANEL_BG = "rgba(23,23,23,0.97)";

export function Panel({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

/** A drag track. RN core has no slider, and this is the only place that needs one. */
export function Track({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const widthRef = useRef(1);
  const set = (x: number) => {
    const t = Math.max(0, Math.min(1, x / widthRef.current));
    onChange(Math.round(min + t * (max - min)));
  };
  const t = (value - min) / (max - min);
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) =>
        onChange(
          Math.max(min, Math.min(max, value + (e.nativeEvent.actionName === "increment" ? 1 : -1))),
        )
      }
      style={styles.trackHit}
      onLayout={(e) => {
        widthRef.current = Math.max(1, e.nativeEvent.layout.width);
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => set(e.nativeEvent.locationX)}
      onResponderMove={(e) => set(e.nativeEvent.locationX)}
    >
      <View style={styles.track} pointerEvents="none">
        <View style={[styles.trackFill, { width: `${t * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: `${t * 100}%` }]} />
    </View>
  );
}

export function StylePanel({
  color,
  width,
  onColor,
  onWidth,
}: {
  color: string;
  width: number;
  onColor: (c: string) => void;
  onWidth: (w: number) => void;
}) {
  return (
    <>
      <Text style={styles.caption}>Pick a color</Text>
      <View style={styles.swatches}>
        {COLORS.map((c) => (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityLabel={`Color ${c}`}
            accessibilityState={{ selected: color === c }}
            onPress={() => onColor(c)}
            style={[styles.swatch, { backgroundColor: c }, color === c ? styles.swatchOn : null]}
          />
        ))}
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.caption}>Thickness</Text>
        <Text style={styles.caption}>{width}px</Text>
      </View>
      <Track value={width} min={WIDTH_MIN} max={WIDTH_MAX} onChange={onWidth} label="Thickness" />
      <View style={styles.chips}>
        {WIDTH_PRESETS.map((w) => (
          <Chip key={w} label={String(w)} on={width === w} onPress={() => onWidth(w)} />
        ))}
      </View>
    </>
  );
}

export function StickerPanel({ glyph, onPick }: { glyph: string; onPick: (g: string) => void }) {
  return (
    <>
      <Text style={styles.caption}>Pick a sticker, then tap the photo.</Text>
      <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
        {STICKER_GROUPS.map((g) => (
          <View key={g.label} style={{ marginTop: 6 }}>
            <Text style={styles.groupLabel}>{g.label.toUpperCase()}</Text>
            <View style={styles.stickerGrid}>
              {g.glyphs.map((s) => (
                <Pressable
                  key={s}
                  accessibilityRole="button"
                  accessibilityLabel={`Sticker ${s}`}
                  accessibilityState={{ selected: glyph === s }}
                  onPress={() => onPick(s)}
                  style={[styles.sticker, glyph === s ? styles.stickerOn : null]}
                >
                  <Text style={styles.stickerGlyph}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </>
  );
}

export function AdjustPanel({
  adjust,
  onChange,
}: {
  adjust: Adjust;
  onChange: (a: Adjust) => void;
}) {
  const rows: { key: keyof Adjust; label: string }[] = [
    { key: "brightness", label: "Brightness" },
    { key: "contrast", label: "Contrast" },
    { key: "saturation", label: "Saturation" },
  ];
  return (
    <>
      {rows.map((r) => (
        <View key={r.key} style={{ gap: 4 }}>
          <View style={styles.rowBetween}>
            <Text style={styles.caption}>{r.label}</Text>
            <Text style={styles.caption}>{adjust[r.key]}%</Text>
          </View>
          <Track
            label={r.label}
            value={adjust[r.key]}
            min={0}
            max={200}
            onChange={(v) => onChange({ ...adjust, [r.key]: v })}
          />
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => onChange({ brightness: 100, contrast: 100, saturation: 100 })}
        style={styles.wideButton}
      >
        <Text style={styles.wideButtonText}>Reset</Text>
      </Pressable>
    </>
  );
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      onPress={onPress}
      style={[styles.chip, on ? { backgroundColor: ACCENT } : null]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

export type TextMode = "plain" | "imperial" | "metric";

/** Web's text box: Text, Imperial or Metric, with unit buttons for the last two. */
export function TextPromptCard({
  value,
  editing,
  isLabel,
  onChange,
  onCancel,
  onCommit,
}: {
  value: string;
  editing: boolean;
  /** A polyline segment label: Cancel reads as Skip. */
  isLabel?: boolean;
  onChange: (v: string) => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const [mode, setMode] = useState<TextMode>("plain");
  const units = mode === "imperial" ? [" in", " ft", " yd"] : [" mm", " cm", " m"];
  return (
    <Panel style={styles.card}>
      <View style={styles.chips}>
        {(["plain", "imperial", "metric"] as const).map((m) => (
          <Chip
            key={m}
            label={m === "plain" ? "Text" : m === "imperial" ? "Imperial" : "Metric"}
            on={mode === m}
            onPress={() => setMode(m)}
          />
        ))}
      </View>
      <TextInput
        autoFocus
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onCommit}
        returnKeyType="done"
        keyboardType={mode === "plain" ? "default" : "decimal-pad"}
        placeholder={
          mode === "plain" ? "Type label..." : mode === "imperial" ? "e.g. 12.5" : "e.g. 3.8"
        }
        placeholderTextColor="rgba(255,255,255,0.4)"
        accessibilityLabel="Annotation text"
        style={styles.input}
      />
      {mode !== "plain" ? (
        <View style={styles.chips}>
          {units.map((u) => (
            <Chip key={u} label={u.trim()} onPress={() => onChange((value + u).trimStart())} />
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.ghost}>
          <Text style={styles.ghostText}>{isLabel ? "Skip" : "Cancel"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCommit} style={styles.primary}>
          <Text style={styles.primaryText}>{editing ? "Update" : "Add"}</Text>
        </Pressable>
      </View>
    </Panel>
  );
}

/** Web's calibration box: the real length of the selected measurement. */
export function CalibrateCard({
  value,
  unit,
  onValue,
  onUnit,
  onCancel,
  onCommit,
}: {
  value: string;
  unit: CalibrationUnit;
  onValue: (v: string) => void;
  onUnit: (u: CalibrationUnit) => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  return (
    <Panel style={styles.card}>
      <Text style={styles.caption}>{"Enter this segment's real length to calibrate scale"}</Text>
      <View style={[styles.chips, { alignItems: "center" }]}>
        <TextInput
          autoFocus
          value={value}
          onChangeText={onValue}
          onSubmitEditing={onCommit}
          keyboardType="decimal-pad"
          returnKeyType="done"
          placeholder="Length"
          placeholderTextColor="rgba(255,255,255,0.4)"
          accessibilityLabel="Real length"
          style={[styles.input, { flex: 1 }]}
        />
        {(["in", "ft", "cm", "m"] as const).map((u) => (
          <Chip key={u} label={u} on={unit === u} onPress={() => onUnit(u)} />
        ))}
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.ghost}>
          <Text style={styles.ghostText}>Cancel</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCommit} style={styles.primary}>
          <Text style={styles.primaryText}>Set scale</Text>
        </Pressable>
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: PANEL_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 12,
    gap: 10,
  },
  card: { width: "100%", maxWidth: 420, alignSelf: "center" },
  caption: { color: "rgba(255,255,255,0.65)", fontSize: 12 },
  groupLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
  },
  swatchOn: { borderColor: "#fff", transform: [{ scale: 1.1 }] },
  rowBetween: { flexDirection: "row", justifyContent: "space-between" },
  trackHit: { height: 44, justifyContent: "center" },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.15)",
    overflow: "hidden",
  },
  trackFill: { height: 6, backgroundColor: ACCENT },
  thumb: {
    position: "absolute",
    width: 24,
    height: 24,
    marginLeft: -12,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: ACCENT,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  stickerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  sticker: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "#262626",
    alignItems: "center",
    justifyContent: "center",
  },
  stickerOn: { borderColor: ACCENT, backgroundColor: "rgba(203,114,41,0.25)" },
  stickerGlyph: { fontSize: 24 },
  wideButton: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  wideButtonText: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "600" },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "#262626",
    color: "#fff",
    fontSize: 16,
    paddingHorizontal: 12,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  ghost: { minHeight: 44, paddingHorizontal: 16, justifyContent: "center", borderRadius: 10 },
  ghostText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  primary: {
    minHeight: 44,
    paddingHorizontal: 18,
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: ACCENT,
  },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
