import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import type { PhotoPhase } from "@/api/photos";
import { fileGeneratedPdf } from "@/api/pdf-export";
import { ShotAnnotator, type ShotAnnotatorTool } from "@/components/ShotAnnotator";
import { ShotCropper } from "@/components/ShotCropper";
import { ScanCropper } from "@/components/ScanCropper";
import { TagPickerSheet } from "@/components/TagPickerSheet";
import { jpegFileToPdfBase64 } from "@/components/scan-pdf";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { Icon, type LucideIcon } from "@/ui";
import {
  Camera,
  Crop,
  FileText,
  Mic,
  Pencil,
  RotateCcw,
  Ruler,
  Share2,
  StickyNote,
  Tag,
  Trash2,
} from "@/ui/icons";

export type EditableShot = {
  uri: string;
  width?: number | null;
  height?: number | null;
  scan?: boolean;
  caption?: string;
  tags?: string[];
  /** Before/None/After. Left out for a scan, which never takes one. */
  phase?: PhotoPhase;
};

export type ShotPatch = Partial<
  Pick<EditableShot, "uri" | "width" | "height" | "caption" | "tags">
>;

/** The Before/None/After toggle, worded as the camera's. */
const PHASES: { id: PhotoPhase; label: string }[] = [
  { id: "before", label: "BEFORE" },
  { id: "untagged", label: "None" },
  { id: "after", label: "AFTER" },
];

/**
 * The photo just taken, opened the moment the shutter fires: everything that
 * can be done to that one photo, over the photo itself.
 *
 * Jon (2026-09-29): "Once i snap a photo the edit window should open with all
 * edit and sharing capabilities for that photo i just took." The photo is
 * already saved (queued) when this opens, so nothing here is a Save step:
 * every change goes back to the camera through `onChange` and lands on that
 * shot's queued photo, and "Back to camera" is one tap to the next shot.
 *
 * Before/None/After, voice note and caption (the keyboard-safe note editor,
 * opened by `onNote`), tags, annotate, measure (Pro/Team, supported iPhone),
 * crop, share, retake, delete, and for a scan, Save as PDF.
 *
 * An overlay drawn over the live camera rather than a screen of its own, so
 * the camera underneath stays running and is ready the instant this closes.
 * Not a Modal either, so the annotator, cropper and tag sheet it opens are the
 * only modals on screen: iOS will not stack a modal on a modal that is already
 * presenting. On a tablet the tools sit in a column on the right, where the
 * hand holding it reaches.
 */
export function ShotEditor({
  shot,
  projectId,
  userId,
  existingTags,
  canMeasure,
  wide = false,
  status,
  onChange,
  onPhaseChange,
  onNote,
  onShare,
  onRetake,
  onDelete,
  onClose,
}: {
  shot: EditableShot;
  projectId: string;
  userId: string | null;
  existingTags: string[];
  canMeasure: boolean;
  /** A tablet: tools in a column on the right. */
  wide?: boolean;
  /** A short line over the photo, such as "Saved" or a failed save. */
  status?: { text: string; error?: boolean } | null;
  onChange: (patch: ShotPatch) => void;
  onPhaseChange?: (phase: PhotoPhase) => void;
  /** Opens the note editor: "voice" straight into dictation, "type" for the keyboard. */
  onNote: (start: "voice" | "type") => void;
  onShare?: () => void;
  onRetake: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [annotating, setAnnotating] = useState<ShotAnnotatorTool | null>(null);
  const [cropping, setCropping] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const tags = shot.tags ?? [];
  const caption = shot.caption?.trim() ?? "";

  /*
   * Android's Back is "back to camera", never out of the camera. The note
   * editor, when it is open over this, registers after it and so answers
   * first; the annotator, cropper and tag sheet are Modals and take Back
   * themselves.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  /*
   * Filed into the project's Documents, which is how every PDF the phone makes
   * is kept (see `fileGeneratedPdf`), then opened so it can be viewed or sent.
   * Needs a connection, unlike the photo itself, which still queues offline.
   */
  async function saveAsPdf() {
    if (pdfBusy) return;
    setPdfBusy(true);
    setMessage(null);
    try {
      const pdfBase64 = await jpegFileToPdfBase64(shot.uri);
      const result = await fileGeneratedPdf({
        projectId,
        pdfBase64,
        filename: `scan-${Date.now()}.pdf`,
      });
      setMessage({ text: "PDF saved to this project's Documents", error: false });
      await WebBrowser.openBrowserAsync(result.url);
    } catch (e) {
      setMessage({
        text: e instanceof Error ? e.message : "Could not make the PDF",
        error: true,
      });
    } finally {
      setPdfBusy(false);
    }
  }

  /*
   * Web's post-capture toolbar: each tool an icon over a short word, on one
   * translucent bar over the photo.
   */
  const actions: {
    id: string;
    label: string;
    icon: LucideIcon;
    onPress: () => void;
    badge?: number;
    active?: boolean;
    danger?: boolean;
  }[] = [
    { id: "voice", label: "Voice", icon: Mic, onPress: () => onNote("voice") },
    {
      id: "note",
      label: "Note",
      icon: StickyNote,
      onPress: () => onNote("type"),
      active: caption.length > 0,
    },
    {
      id: "tags",
      label: "Tags",
      icon: Tag,
      onPress: () => setTagsOpen(true),
      badge: tags.length,
    },
    { id: "annotate", label: "Annotate", icon: Pencil, onPress: () => setAnnotating("pen") },
    ...(canMeasure
      ? [
          {
            id: "measure",
            label: "Measure",
            icon: Ruler,
            onPress: () => setAnnotating("measure"),
          },
        ]
      : []),
    { id: "crop", label: "Crop", icon: Crop, onPress: () => setCropping(true) },
    ...(onShare ? [{ id: "share", label: "Share", icon: Share2, onPress: onShare }] : []),
    ...(shot.scan
      ? [{ id: "pdf", label: "PDF", icon: FileText, onPress: () => void saveAsPdf() }]
      : []),
    { id: "retake", label: "Retake", icon: RotateCcw, onPress: onRetake },
    ...(onDelete
      ? [{ id: "delete", label: "Delete", icon: Trash2, onPress: onDelete, danger: true }]
      : []),
  ];

  const toolButtons = actions.map((action) => (
    <Pressable
      key={action.id}
      accessibilityRole="button"
      accessibilityLabel={
        action.id === "retake" ? "Retake: delete this photo and shoot again" : action.label
      }
      accessibilityState={action.active !== undefined ? { selected: action.active } : undefined}
      onPress={action.onPress}
      disabled={pdfBusy && action.id === "pdf"}
      style={[styles.toolButton, action.active && styles.toolButtonActive]}
    >
      {action.id === "pdf" && pdfBusy ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Icon icon={action.icon} size="md" color={action.danger ? DANGER_FG : "#fff"} />
      )}
      <Text style={[styles.toolText, action.danger && { color: DANGER_FG }]}>{action.label}</Text>
      {action.badge ? (
        <View style={[styles.badge, { backgroundColor: theme.colors.primary }]}>
          <Text style={[styles.badgeText, { color: theme.colors.primaryForeground }]}>
            {action.badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  ));

  const shownMessage =
    message ?? (status ? { text: status.text, error: Boolean(status.error) } : null);

  const phaseRow =
    onPhaseChange && !shot.scan ? (
      <View style={styles.phaseRow} accessibilityRole="radiogroup">
        {PHASES.map((option) => {
          const active = (shot.phase ?? "untagged") === option.id;
          const isNone = option.id === "untagged";
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={isNone ? "No before or after tag" : `Tag as ${option.label}`}
              onPress={() => onPhaseChange(active && !isNone ? "untagged" : option.id)}
              hitSlop={4}
              style={[
                styles.phasePill,
                active &&
                  (isNone
                    ? styles.phaseNoneActive
                    : option.id === "after"
                      ? { backgroundColor: theme.colors.primary }
                      : styles.phasePillActive),
              ]}
            >
              <Text
                style={[
                  isNone ? styles.phaseNoneText : styles.phaseText,
                  active &&
                    !isNone &&
                    (option.id === "after"
                      ? { color: theme.colors.primaryForeground }
                      : styles.phaseTextActive),
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    ) : null;

  return (
    <View style={styles.root}>
      <View style={styles.imageWrap}>
        <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
      </View>

      <View
        style={[
          styles.topArea,
          {
            top: insets.top + spacing.sm,
            left: insets.left + spacing.lg,
            right: insets.right + spacing.lg + (wide ? RAIL_WIDTH + spacing.sm : 0),
          },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.topBar} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to camera"
            onPress={onClose}
            hitSlop={8}
            style={styles.backPill}
          >
            <Icon icon={Camera} size="sm" color="#fff" />
            <Text style={styles.backPillText}>Camera</Text>
          </Pressable>
          {shot.scan ? (
            <View style={[styles.scanBadge, { backgroundColor: theme.colors.primary }]}>
              <Text style={[styles.scanBadgeText, { color: theme.colors.primaryForeground }]}>
                SCAN
              </Text>
            </View>
          ) : null}
        </View>
        {phaseRow}
        {tags.length > 0 ? (
          <View style={styles.tagOverlay} pointerEvents="none">
            {tags.map((tag) => (
              <View key={tag} style={styles.tagPill}>
                <Text style={styles.tagPillText}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* On a tablet, the tools in a column on the right-hand side. */}
      {wide ? (
        <View
          style={[
            styles.rail,
            {
              top: insets.top + spacing.sm,
              bottom: insets.bottom + spacing.lg,
              right: insets.right + spacing.lg,
            },
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.railContent}
            showsVerticalScrollIndicator={false}
          >
            {toolButtons}
          </ScrollView>
        </View>
      ) : null}

      <View
        style={[
          styles.bottom,
          {
            bottom: insets.bottom + spacing.lg,
            left: insets.left + spacing.lg,
            right: insets.right + spacing.lg + (wide ? RAIL_WIDTH + spacing.sm : 0),
          },
        ]}
        pointerEvents="box-none"
      >
        {shownMessage ? (
          <Text style={[styles.message, shownMessage.error && styles.messageError]}>
            {shownMessage.text}
          </Text>
        ) : null}

        {caption ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Note: ${caption}. Edit`}
            onPress={() => onNote("type")}
            style={styles.captionLine}
          >
            <Text style={styles.captionText} numberOfLines={2}>
              {caption}
            </Text>
          </Pressable>
        ) : null}

        {wide ? null : (
          <View style={styles.toolbarWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.toolbar}
            >
              {toolButtons}
            </ScrollView>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to camera"
          accessibilityHint="The photo is already saved"
          onPress={onClose}
          style={styles.doneButton}
        >
          <Icon icon={Camera} size="md" color="#18130d" />
          <Text style={styles.doneText}>Back to camera</Text>
        </Pressable>
      </View>

      <ShotAnnotator
        visible={annotating !== null}
        uri={shot.uri}
        width={shot.width}
        height={shot.height}
        canMeasure={canMeasure}
        initialTool={annotating ?? "pen"}
        onCancel={() => setAnnotating(null)}
        onDone={(result) => {
          setAnnotating(null);
          onChange(result);
        }}
      />

      {/*
        A scan crops the way web's Scan mode does, by its four corners with the
        page straightened; a photo keeps the rectangular crop. The scan already
        has its document look, so it is not applied twice.
      */}
      <ScanCropper
        visible={cropping && Boolean(shot.scan)}
        uri={shot.uri}
        enhance={false}
        onCancel={() => setCropping(false)}
        onApply={({ note, ...result }) => {
          setCropping(false);
          onChange(result);
          setMessage({ text: note ?? "Page straightened", error: false });
        }}
      />

      <ShotCropper
        visible={cropping && !shot.scan}
        uri={shot.uri}
        width={shot.width}
        height={shot.height}
        onCancel={() => setCropping(false)}
        onApply={(result) => {
          setCropping(false);
          onChange(result);
          setMessage({ text: "Cropped", error: false });
        }}
      />

      <TagPickerSheet
        visible={tagsOpen}
        existing={existingTags}
        selected={tags}
        userId={userId}
        onChange={(next) => onChange({ tags: next })}
        onClose={() => setTagsOpen(false)}
      />
    </View>
  );
}

const RAIL_WIDTH = 84;
const DANGER_FG = "#ff8a80";
const SELECTED_FILL = "#ece8e3";
const SELECTED_FG = "#18130d";

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: "#000" },
  imageWrap: { ...StyleSheet.absoluteFill },
  topArea: { position: "absolute", gap: spacing.sm },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: "rgba(24, 20, 16, 0.7)",
  },
  backPillText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  tagOverlay: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  tagPill: {
    backgroundColor: "rgba(10, 8, 6, 0.82)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  tagPillText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  scanBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  scanBadgeText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  phaseRow: {
    flexDirection: "row",
    alignSelf: "center",
    alignItems: "center",
    gap: spacing.xs,
    padding: 4,
    backgroundColor: "rgba(10, 8, 6, 0.72)",
    borderRadius: radius.pill,
  },
  phasePill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  phasePillActive: { backgroundColor: SELECTED_FILL },
  phaseNoneActive: { backgroundColor: "rgba(255,255,255,0.15)" },
  phaseText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  phaseNoneText: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontWeight: "600" },
  phaseTextActive: { color: SELECTED_FG },
  rail: {
    position: "absolute",
    width: RAIL_WIDTH,
    justifyContent: "center",
    backgroundColor: "rgba(10, 8, 6, 0.6)",
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    overflow: "hidden",
  },
  railContent: { flexGrow: 1, justifyContent: "center", gap: spacing.xs, padding: 6 },
  /* Floats over the photo, centred and capped so a tablet gets the same bar. */
  bottom: {
    position: "absolute",
    alignItems: "center",
    gap: spacing.sm,
  },
  captionLine: {
    alignSelf: "stretch",
    maxWidth: 560,
    backgroundColor: "rgba(10, 8, 6, 0.6)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  captionText: { color: "#fff", fontSize: 14 },
  toolbarWrap: {
    maxWidth: "100%",
    backgroundColor: "rgba(10, 8, 6, 0.6)",
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    overflow: "hidden",
  },
  toolbar: { gap: spacing.xs, padding: 6 },
  toolButton: {
    minWidth: 62,
    minHeight: 56,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  toolButtonActive: { backgroundColor: "rgba(255,255,255,0.18)" },
  toolText: { color: "#fff", fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  badge: {
    position: "absolute",
    top: 2,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, fontWeight: "800" },
  doneButton: {
    flexDirection: "row",
    gap: spacing.xs,
    backgroundColor: "#ffffff",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    minHeight: HIT_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: { color: "#18130d", fontSize: 15, fontWeight: "700" },
  message: {
    alignSelf: "center",
    color: "#fff",
    backgroundColor: "rgba(16, 120, 80, 0.92)",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  messageError: { backgroundColor: "rgba(180,35,24,0.9)" },
});
