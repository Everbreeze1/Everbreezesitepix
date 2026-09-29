import { useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import type { PhotoPhase } from "@/api/photos";
import {
  DICTATION_DETAIL,
  DICTATION_HINT,
  VOICE_NOTE_LABEL,
  voiceNoteMode,
} from "@/lib/voice-note";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { Icon, type LucideIcon } from "@/ui";
import { Check, Mic, Tag, X } from "@/ui/icons";
import { useKeyboardOverlap } from "./keyboard-overlap";
import { noteEditorLayout } from "./note-editor-layout";

/** A secondary action in the editor's footer: an icon, named for a screen reader. */
export type NoteEditorAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
};

const PHASES: { id: PhotoPhase; label: string }[] = [
  { id: "before", label: "Before" },
  { id: "untagged", label: "None" },
  { id: "after", label: "After" },
];

/**
 * One photo's note: the caption shown under it, spoken or typed.
 *
 * The camera opens it for the photo just taken (its last-shot thumbnail), and
 * the photo viewer opens it from the caption under a photo, so the note is
 * written and corrected in the same place. One photo at a time: the strip of
 * several photos belongs to walkthroughs only, where the AI reads them
 * together.
 *
 * **The keyboard never covers it.** At rest it shows the photo, its
 * Before/None/After, an "Add voice note" button, the note, its tags and Done.
 * Once the keyboard is up (typing, or the keyboard's mic dictating) it folds
 * into one bar sitting directly on top of the keyboard: the photo small, the
 * note, and Done. The keyboard's height is read from React Native's own
 * keyboard events (`useKeyboardOverlap`), which works whether the Android
 * window resizes for the keyboard or, edge to edge, does not.
 *
 * The note input stays mounted in the same place in both shapes, so folding
 * never drops its focus and closes the keyboard it is folding for.
 *
 * An overlay rather than a Modal, so the camera's tag picker (a Modal) can
 * open over it: iOS will not present a modal on a modal that is already
 * presenting. Dark whatever the app's scheme, because it sits over the live
 * camera or a photo. Portrait phones stack the photo over the controls; a
 * phone held sideways puts them side by side; a tablet docks the editor on
 * the right, where the thumb is, with its actions on the right.
 */
export function PhotoNoteEditor({
  title,
  photoUri,
  caption,
  onCaptionChange,
  placeholder,
  tags,
  onEditTags,
  phase,
  onPhaseChange,
  actions = [],
  startWith,
  message,
  wide,
  insets,
  onDone,
  onClose,
}: {
  title: string;
  /** The photo, drawn in the editor. Omitted for the camera's next-photos note. */
  photoUri?: string | null;
  caption: string;
  onCaptionChange: (text: string) => void;
  placeholder: string;
  /** Omitted to leave tags out (the viewer edits them in its own panel). */
  tags?: string[];
  onEditTags?: () => void;
  /** Omitted to hide the Before/None/After row (the next photos, or a scan). */
  phase?: PhotoPhase;
  onPhaseChange?: (phase: PhotoPhase) => void;
  actions?: NoteEditorAction[];
  /** "voice" opens straight into dictation, "type" with the keyboard up. */
  startWith?: "voice" | "type" | null;
  /** A line under the note, such as a failed save. */
  message?: string | null;
  wide: boolean;
  insets: { top: number; bottom: number; left: number; right: number };
  /** Done: the note is kept and the editor closes. */
  onDone: () => void;
  /** The backdrop, the cross or Android's Back. Keeps the note as well. */
  onClose: () => void;
}) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const screen = useWindowDimensions();
  const keyboard = useKeyboardOverlap();
  const [dictating, setDictating] = useState(startWith === "voice");

  const layout = noteEditorLayout({
    width: screen.width - insets.left - insets.right,
    height: screen.height - insets.top - insets.bottom,
    keyboard: keyboard.overlap,
    typing: keyboard.visible,
    wide,
  });
  const typing = layout.mode === "typing";
  const side = layout.arrangement === "side";

  useEffect(() => {
    if (!startWith) return;
    // After the overlay has laid out, or the focus is dropped on Android.
    const timer = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, [startWith]);

  /*
   * The keyboard going away ends a dictation, so tapping the note later to
   * fix a word does not still say "Speak now".
   */
  const wasUp = useRef(false);
  useEffect(() => {
    if (wasUp.current && !keyboard.visible) setDictating(false);
    wasUp.current = keyboard.visible;
  }, [keyboard.visible]);

  /* Android's Back closes the editor, not the camera behind it. */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  /**
   * The voice action. Dictation today: the note takes focus, the editor
   * folds onto the keyboard, and says to use the keyboard's microphone.
   * `voice-note.ts` is where a recorder plugs in.
   */
  function startVoiceNote() {
    if (voiceNoteMode() === "dictation") {
      setDictating(true);
      inputRef.current?.focus();
    }
  }

  function done() {
    Keyboard.dismiss();
    onDone();
  }

  const showTags = tags !== undefined && onEditTags !== undefined;
  const photo = photoUri ? (
    <Image
      source={{ uri: photoUri }}
      style={
        typing
          ? { width: layout.typingThumb, height: layout.typingThumb, borderRadius: radius.md }
          : { width: layout.photo.width, height: layout.photo.height, borderRadius: radius.md }
      }
      contentFit={typing ? "cover" : "contain"}
      allowDownscaling
      transition={0}
      accessibilityLabel="The photo this note is for"
    />
  ) : null;

  const availableHeight = screen.height - insets.top - keyboard.overlap - spacing.sm * 2;

  return (
    <View
      ref={keyboard.ref}
      onLayout={keyboard.onLayout}
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
    >
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={onClose}
        accessibilityLabel="Close note"
      />
      <View
        style={[
          styles.anchor,
          {
            paddingTop: insets.top + spacing.sm,
            // On the keyboard when it is up, else clear of the home indicator.
            paddingBottom: keyboard.overlap > 0 ? keyboard.overlap : insets.bottom + spacing.sm,
          },
        ]}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.sheet,
            typing && styles.sheetTyping,
            {
              backgroundColor: theme.colors.chrome,
              maxHeight: Math.max(availableHeight, 96),
              marginLeft: wide ? 0 : insets.left + spacing.sm,
              marginRight: insets.right + spacing.sm,
            },
            layout.width !== null && { alignSelf: "flex-end", width: layout.width },
            // Flush on the keyboard, as a keyboard's own toolbar is.
            keyboard.overlap > 0 && styles.sheetOnKeyboard,
          ]}
        >
          {!typing ? (
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
          ) : null}

          {!typing && !side && photo ? <View style={styles.photoStacked}>{photo}</View> : null}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.body, (side || typing) && styles.bodyRow]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            scrollEnabled={!typing}
          >
            {(typing || side) && photo ? photo : null}

            <View style={styles.column}>
              {!typing && phase !== undefined && onPhaseChange ? (
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

              {!typing ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={VOICE_NOTE_LABEL}
                  accessibilityHint="Opens the note with the keyboard up. Speak using the keyboard's microphone."
                  onPress={startVoiceNote}
                  style={[styles.voice, { backgroundColor: theme.colors.primary }]}
                >
                  <Icon icon={Mic} size="md" color={theme.colors.primaryForeground} />
                  <Text style={[styles.voiceText, { color: theme.colors.primaryForeground }]}>
                    {VOICE_NOTE_LABEL}
                  </Text>
                </Pressable>
              ) : null}

              {typing && dictating ? (
                <View style={styles.hintRow} accessibilityLiveRegion="polite">
                  <Icon icon={Mic} size="sm" color={theme.colors.primary} />
                  <Text style={[styles.hint, { color: FG }]} numberOfLines={1}>
                    {DICTATION_HINT}
                  </Text>
                </View>
              ) : null}

              <TextInput
                ref={inputRef}
                value={caption}
                onChangeText={onCaptionChange}
                placeholder={placeholder}
                placeholderTextColor="rgba(255,255,255,0.5)"
                multiline
                style={[styles.note, { maxHeight: layout.noteMaxHeight }]}
                accessibilityLabel="Photo note"
                accessibilityHint="Shown as the caption under the photo"
              />

              {typing && dictating && layout.typingThumb > 40 ? (
                <Text style={styles.detail} numberOfLines={1}>
                  {DICTATION_DETAIL}
                </Text>
              ) : null}

              {!typing && showTags ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    tags.length ? `Tags: ${tags.join(", ")}. Change tags` : "Add tags"
                  }
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
              ) : null}

              {!typing && message ? <Text style={styles.message}>{message}</Text> : null}
            </View>

            {typing ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Done"
                onPress={done}
                style={[styles.doneRound, { backgroundColor: theme.colors.primary }]}
              >
                <Icon icon={Check} size="md" color={theme.colors.primaryForeground} />
              </Pressable>
            ) : null}
          </ScrollView>

          {!typing ? (
            <View style={[styles.actions, wide && styles.actionsWide]}>
              {actions.map((action) => (
                <Pressable
                  key={action.id}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  onPress={action.onPress}
                  hitSlop={2}
                  style={styles.iconAction}
                >
                  <Icon icon={action.icon} size="md" color={FG} />
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Done"
                onPress={done}
                style={[
                  styles.done,
                  { backgroundColor: theme.colors.primary },
                  !wide && styles.doneGrow,
                ]}
              >
                <Icon icon={Check} size="sm" color={theme.colors.primaryForeground} />
                <Text style={[styles.doneText, { color: theme.colors.primaryForeground }]}>
                  Done
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const FG = "#ffffff";

/** The watermark pill's own colours (`watermark.ts`), as the toggle shows them. */
const PHASE_FILL: Record<"before" | "after", string> = {
  before: "rgba(37,99,235,0.96)",
  after: "rgba(16,185,129,0.96)",
};

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.35)" },
  anchor: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sheetTyping: { padding: spacing.sm, paddingHorizontal: spacing.md },
  sheetOnKeyboard: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    marginLeft: 0,
    marginRight: 0,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flex: 1, color: FG, fontSize: 16, fontWeight: "800" },
  close: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  photoStacked: { alignItems: "center", backgroundColor: "#000", borderRadius: radius.md },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: spacing.md },
  bodyRow: { flexDirection: "row", alignItems: "flex-start" },
  column: { flex: 1, minWidth: 0, gap: spacing.sm },
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
  voice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: HIT_TARGET,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
  },
  voiceText: { fontSize: 16, fontWeight: "800" },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  hint: { flex: 1, fontSize: 14, fontWeight: "800" },
  detail: { color: "rgba(255,255,255,0.7)", fontSize: 12, lineHeight: 16 },
  note: {
    minHeight: HIT_TARGET,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.06)",
    color: FG,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    textAlignVertical: "top",
  },
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
  doneRound: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    borderRadius: HIT_TARGET / 2,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end",
  },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  actionsWide: { justifyContent: "flex-end" },
  iconAction: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    borderRadius: HIT_TARGET / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  done: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
  },
  doneGrow: { flexGrow: 1 },
  doneText: { fontSize: 15, fontWeight: "800" },
});
