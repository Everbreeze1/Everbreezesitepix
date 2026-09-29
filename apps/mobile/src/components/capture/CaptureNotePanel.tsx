import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import type { PhotoPhase } from "@/api/photos";
import { DICTATION_HINT, voiceNoteMode } from "@/lib/voice-note";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { Icon, type LucideIcon } from "@/ui";
import { Mic, Tag, X } from "@/ui/icons";

/** One recent shot in the panel's strip. */
export type NoteStripShot = {
  id: string;
  uri: string;
  phase: PhotoPhase;
  scan?: boolean;
  /** Could not be stored on the device; the panel offers a retry. */
  failed?: boolean;
};

export type NotePanelAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  /** The one action that finishes the panel, drawn filled. */
  primary?: boolean;
};

const PHASES: { id: PhotoPhase; label: string }[] = [
  { id: "before", label: "Before" },
  { id: "untagged", label: "None" },
  { id: "after", label: "After" },
];

/**
 * The camera's caption, tags and voice note, on the camera itself.
 *
 * Two uses, one panel. For the shots still to come (the camera's sticky note),
 * and for one shot already saved, picked from the strip of recent shots, with
 * its own Before/None/After. Every change applies to that one shot only.
 *
 * An overlay rather than a Modal, so the tag picker (a Modal) can open over
 * it: iOS will not present a modal on a modal that is already presenting.
 * Dark whatever the app's scheme, because it sits over the live camera. On a
 * tablet it docks to the right-hand side, where the thumb is, with its
 * actions on the right.
 */
export function CaptureNotePanel({
  title,
  caption,
  onCaptionChange,
  captionPlaceholder,
  tags,
  onEditTags,
  phase,
  onPhaseChange,
  strip,
  actions,
  focusCaption = false,
  message,
  wide,
  insets,
  onClose,
}: {
  title: string;
  caption: string;
  onCaptionChange: (text: string) => void;
  captionPlaceholder: string;
  tags: string[];
  onEditTags: () => void;
  /** Omitted to hide the Before/None/After row (the next shots, or a scan). */
  phase?: PhotoPhase;
  onPhaseChange?: (phase: PhotoPhase) => void;
  strip?: { shots: NoteStripShot[]; selectedId: string | null; onSelect: (id: string) => void };
  actions: NotePanelAction[];
  /** Open with the keyboard up, which is how the mic starts dictation. */
  focusCaption?: boolean;
  /** A line under the note, such as a failed save. */
  message?: string | null;
  wide: boolean;
  insets: { bottom: number; left: number; right: number };
  onClose: () => void;
}) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [hint, setHint] = useState<string | null>(focusCaption ? DICTATION_HINT : null);

  useEffect(() => {
    if (!focusCaption) return;
    // After the overlay has laid out, or the focus is dropped on Android.
    const timer = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, [focusCaption]);

  /**
   * The mic. Dictation today: the note takes focus and says where the
   * keyboard's microphone is. `voice-note.ts` is where a recorder plugs in.
   */
  function startVoiceNote() {
    if (voiceNoteMode() === "dictation") {
      inputRef.current?.focus();
      setHint(DICTATION_HINT);
    }
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.anchor}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.sheet,
            wide ? styles.sheetWide : null,
            {
              backgroundColor: theme.colors.chrome,
              marginLeft: wide ? 0 : insets.left + spacing.sm,
              marginRight: insets.right + spacing.sm,
              marginBottom: insets.bottom + spacing.sm,
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={8}
              style={styles.close}
            >
              <Icon icon={X} size="md" color={FG} />
            </Pressable>
          </View>

          {strip && strip.shots.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.strip}
              keyboardShouldPersistTaps="handled"
            >
              {strip.shots.map((shot) => {
                const selected = shot.id === strip.selectedId;
                const pill = shot.scan ? null : shot.phase === "untagged" ? null : shot.phase;
                return (
                  <Pressable
                    key={shot.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Photo${pill ? `, ${pill}` : ""}${shot.failed ? ", not saved" : ""}`}
                    onPress={() => strip.onSelect(shot.id)}
                    style={[styles.stripItem, selected && { borderColor: theme.colors.primary }]}
                  >
                    <Image
                      source={{ uri: shot.uri }}
                      style={styles.stripImage}
                      contentFit="cover"
                      recyclingKey={shot.id}
                      allowDownscaling
                      transition={0}
                    />
                    {pill ? (
                      <View style={[styles.stripPill, { backgroundColor: PHASE_FILL[pill] }]}>
                        <Text style={styles.stripPillText}>{pill.toUpperCase()}</Text>
                      </View>
                    ) : null}
                    {shot.failed ? (
                      <View style={styles.stripFailed}>
                        <Text style={styles.stripPillText}>!</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {phase !== undefined && onPhaseChange ? (
            <View style={styles.segmented} accessibilityRole="radiogroup">
              {PHASES.map((option) => {
                const active = phase === option.id;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={
                      option.id === "untagged" ? "No before or after tag" : option.label
                    }
                    onPress={() => onPhaseChange(option.id)}
                    style={[
                      styles.segment,
                      active &&
                        (option.id === "untagged"
                          ? styles.segmentNone
                          : { backgroundColor: PHASE_FILL[option.id as "before" | "after"] }),
                    ]}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={styles.captionRow}>
            <TextInput
              ref={inputRef}
              value={caption}
              onChangeText={onCaptionChange}
              placeholder={captionPlaceholder}
              placeholderTextColor="rgba(255,255,255,0.5)"
              multiline
              style={styles.caption}
              accessibilityLabel="Photo note"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Voice note"
              accessibilityHint="Opens the note for dictation with the keyboard's microphone"
              onPress={startVoiceNote}
              style={[styles.mic, { backgroundColor: theme.colors.primary }]}
            >
              <Icon icon={Mic} size="md" color={theme.colors.primaryForeground} />
            </Pressable>
          </View>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tags.length ? `Tags: ${tags.join(", ")}. Change tags` : "Add tags"}
            onPress={onEditTags}
            style={styles.tagsRow}
          >
            <Icon icon={Tag} size="sm" color={FG} />
            {tags.length ? (
              <View style={styles.tagChips}>
                {tags.map((tag) => (
                  <View key={tag} style={styles.tagChip}>
                    <Text style={styles.tagChipText} numberOfLines={1}>
                      {tag}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.tagsEmpty}>Add tags</Text>
            )}
          </Pressable>

          {message ? <Text style={styles.message}>{message}</Text> : null}

          <View style={[styles.actions, wide && styles.actionsWide]}>
            {actions.map((action) => (
              <Pressable
                key={action.id}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={action.onPress}
                style={[
                  styles.action,
                  action.primary && { backgroundColor: theme.colors.primary },
                  !wide && action.primary && styles.actionPrimaryPhone,
                ]}
              >
                <Icon
                  icon={action.icon}
                  size="sm"
                  color={action.primary ? theme.colors.primaryForeground : FG}
                />
                <Text
                  style={[
                    styles.actionText,
                    action.primary && { color: theme.colors.primaryForeground },
                  ]}
                  numberOfLines={1}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const FG = "#ffffff";

/** The watermark pill's own colours (`watermark.ts`), as the strip and the toggle show them. */
const PHASE_FILL: Record<"before" | "after", string> = {
  before: "rgba(37,99,235,0.96)",
  after: "rgba(16,185,129,0.96)",
};

const THUMB = 64;

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.35)" },
  anchor: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sheetWide: { alignSelf: "flex-end", width: 440 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flex: 1, color: FG, fontSize: 16, fontWeight: "800" },
  close: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  strip: { gap: spacing.sm, paddingVertical: 2 },
  stripItem: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: "transparent",
    overflow: "hidden",
  },
  stripImage: { width: "100%", height: "100%", backgroundColor: "#222" },
  stripPill: {
    position: "absolute",
    left: 3,
    bottom: 3,
    borderRadius: radius.pill,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  stripFailed: {
    position: "absolute",
    right: 3,
    top: 3,
    minWidth: 16,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "rgba(180,35,24,0.95)",
  },
  stripPillText: { color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },
  segmented: {
    flexDirection: "row",
    gap: spacing.xs,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  segment: {
    flex: 1,
    minHeight: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentNone: { backgroundColor: "rgba(255,255,255,0.18)" },
  segmentText: { color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: "700" },
  segmentTextActive: { color: "#fff", fontWeight: "800" },
  captionRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  caption: {
    flex: 1,
    minHeight: HIT_TARGET,
    maxHeight: 120,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.06)",
    color: FG,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  mic: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    borderRadius: HIT_TARGET / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { color: "rgba(255,255,255,0.75)", fontSize: 12, lineHeight: 16 },
  tagsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: HIT_TARGET,
  },
  tagChips: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  tagChip: {
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    maxWidth: 180,
  },
  tagChipText: { color: FG, fontSize: 12, fontWeight: "700" },
  tagsEmpty: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "600" },
  message: { color: "#fca5a5", fontSize: 13, fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  actionsWide: { justifyContent: "flex-end" },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  actionPrimaryPhone: { flexGrow: 1, justifyContent: "center" },
  actionText: { color: FG, fontSize: 14, fontWeight: "700" },
});
