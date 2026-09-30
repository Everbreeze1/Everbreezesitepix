import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
  TRANSCRIBING_LABEL,
  VOICE_NOTE_LABEL,
  VOICE_NOTE_MAX_SECONDS,
  appendTranscript,
  fallbackMessage,
  formatElapsed,
  voiceNoteMode,
} from "@/lib/voice-note";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { Icon, type LucideIcon } from "@/ui";
import { Check, Mic, Square, Tag, X } from "@/ui/icons";
import { useKeyboardOverlap } from "./keyboard-overlap";
import { noteEditorLayout } from "./note-editor-layout";
import { useVoiceNoteRecorder } from "./use-voice-note-recorder";

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
 * **The voice note records.** "Add voice note" starts the microphone at once
 * and turns into a recording bar with the time and a Stop button; Stop sends
 * the clip for transcription ("Transcribing...") and the words are added to
 * the end of the note, still editable, saving as the caption as typing does.
 * When recording cannot be used (no microphone permission, a server without
 * voice notes yet, a failed transcription) it says so in one line and opens
 * the keyboard, whose own mic dictates instead. See `lib/voice-note.ts`.
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
  voiceAfterClose = false,
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
  /** "voice" opens straight into recording, "type" with the keyboard up. */
  startWith?: "voice" | "type" | null;
  /**
   * `onCaptionChange` still saves after the editor closes, so Done need not
   * wait for a voice note's words. See `finishVoice`.
   */
  voiceAfterClose?: boolean;
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
  const [dictating, setDictating] = useState(
    startWith === "voice" && voiceNoteMode() === "dictation",
  );
  /** Why the recorder handed over to the keyboard, until the keyboard goes. */
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);

  /*
   * The latest note, read when the words come back: typing carries on while
   * the clip is transcribed, and the words are added to what is there then.
   */
  const captionRef = useRef(caption);
  captionRef.current = caption;
  const open = useRef(true);
  /** Done or close was tapped: the editor is on its way out. */
  const closing = useRef(false);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  const voice = useVoiceNoteRecorder({
    onText: (text) => {
      if (open.current) setVoiceMessage(null);
      onCaptionChange(appendTranscript(captionRef.current, text));
    },
    onFallback: (reason) => {
      if (!open.current || closing.current) return;
      setVoiceMessage(fallbackMessage(reason));
      // Nothing was heard: the mic is still the way to try again.
      if (reason !== "silent") startDictation();
    },
  });
  const listening = voice.phase !== "idle";

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
    const timer = setTimeout(() => {
      if (startWith === "voice" && voiceNoteMode() === "record") void voice.start();
      else inputRef.current?.focus();
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWith]);

  /*
   * The keyboard going away ends a dictation, so tapping the note later to
   * fix a word does not still say "Speak now".
   */
  const wasUp = useRef(false);
  useEffect(() => {
    if (wasUp.current && !keyboard.visible) {
      setDictating(false);
      setVoiceMessage(null);
    }
    wasUp.current = keyboard.visible;
  }, [keyboard.visible]);

  /* Android's Back closes the editor, not the camera behind it. */
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  /**
   * The voice action: record, or with no recorder on this build, dictation
   * (the note takes focus, the editor folds onto the keyboard, and says to
   * use the keyboard's microphone).
   */
  function startVoiceNote() {
    setVoiceMessage(null);
    if (voiceNoteMode() === "record") {
      Keyboard.dismiss();
      void voice.start();
    } else {
      startDictation();
    }
  }

  function startDictation() {
    setDictating(true);
    inputRef.current?.focus();
  }

  /* The parent's latest handlers: after a wait, the ones captured at the tap are stale. */
  const exits = useRef({ onDone, onClose });
  exits.current = { onDone, onClose };

  function done() {
    Keyboard.dismiss();
    void finishVoice().finally(() => exits.current.onDone());
  }

  function close() {
    void finishVoice().finally(() => exits.current.onClose());
  }

  /*
   * Done or close while recording keeps what was said. Where `onCaptionChange`
   * still lands after the editor has gone (the camera's shots), the clip is
   * finished and sent and the editor closes at once, so the camera is back
   * for the next shot straight away. Elsewhere (the viewer saves on close)
   * it waits for the words first, showing "Transcribing...".
   */
  async function finishVoice() {
    if (closing.current) return new Promise<void>(() => undefined);
    closing.current = true;
    await voice.stop();
    if (voiceAfterClose || voice.phase === "idle") return;
    await voice.settled();
    // One render for the parent to take the words in, so it saves them.
    await new Promise((resolve) => setTimeout(resolve, 50));
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
        onPress={close}
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
                onPress={close}
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

              {listening ? (
                <View
                  style={[styles.recording, typing && styles.recordingTyping]}
                  accessibilityLiveRegion="polite"
                >
                  {voice.phase === "recording" ? (
                    <View style={styles.recordingDot} />
                  ) : (
                    <ActivityIndicator size="small" color={FG} />
                  )}
                  <Text style={styles.recordingText} numberOfLines={1}>
                    {voice.phase === "transcribing"
                      ? TRANSCRIBING_LABEL
                      : voice.phase === "starting"
                        ? "Starting the mic..."
                        : `Recording ${formatElapsed(voice.elapsedMs)}`}
                  </Text>
                  {voice.phase === "recording" && !typing ? (
                    <Text style={styles.recordingLimit} numberOfLines={1}>
                      {`max ${formatElapsed(VOICE_NOTE_MAX_SECONDS * 1000)}`}
                    </Text>
                  ) : null}
                  {voice.phase === "recording" ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Stop recording"
                      accessibilityHint="Stops and adds your words to the note"
                      onPress={() => void voice.stop()}
                      style={styles.stop}
                    >
                      <Icon icon={Square} size="sm" color={FG} />
                      <Text style={styles.stopText}>Stop</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : !typing ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={VOICE_NOTE_LABEL}
                  accessibilityHint="Records a spoken note. Tap Stop when finished."
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
                  <Text style={[styles.hint, { color: FG }]} numberOfLines={voiceMessage ? 2 : 1}>
                    {voiceMessage ?? DICTATION_HINT}
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

              {typing && dictating && !voiceMessage && layout.typingThumb > 40 ? (
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

              {!typing && voiceMessage ? (
                <Text style={styles.voiceMessage} accessibilityLiveRegion="polite">
                  {voiceMessage}
                </Text>
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
/** Recording, as every phone's recorder shows it. */
const RECORDING_RED = "#dc2626";

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
  recording: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: HIT_TARGET,
    borderRadius: radius.pill,
    paddingLeft: spacing.lg,
    paddingRight: 4,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  recordingTyping: { paddingLeft: spacing.md },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: RECORDING_RED },
  recordingText: { flexShrink: 1, color: FG, fontSize: 16, fontWeight: "800" },
  recordingLimit: { flex: 1, color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: "600" },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: "auto",
    minHeight: HIT_TARGET - 8,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: RECORDING_RED,
  },
  stopText: { color: FG, fontSize: 15, fontWeight: "800" },
  voiceMessage: { color: "#fde68a", fontSize: 13, fontWeight: "600" },
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
