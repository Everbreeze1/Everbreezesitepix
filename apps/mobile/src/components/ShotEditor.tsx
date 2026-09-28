import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { fileGeneratedPdf } from "@/api/pdf-export";
import { ShotAnnotator, type ShotAnnotatorTool } from "@/components/ShotAnnotator";
import { ShotCropper } from "@/components/ShotCropper";
import { ScanCropper } from "@/components/ScanCropper";
import { TagPickerSheet } from "@/components/TagPickerSheet";
import { jpegFileToPdfBase64 } from "@/components/scan-pdf";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { Icon, type LucideIcon } from "@/ui";
import { Check, Crop, FileText, Pencil, RotateCcw, Ruler, StickyNote, Tag, X } from "@/ui/icons";

export type EditableShot = {
  uri: string;
  width?: number | null;
  height?: number | null;
  scan?: boolean;
  caption?: string;
  tags?: string[];
};

export type ShotPatch = Partial<
  Pick<EditableShot, "uri" | "width" | "height" | "caption" | "tags">
>;

/**
 * One shot, before it is saved: web's post-capture preview.
 *
 * Retake, Annotate, Measure (Pro/Team, on a supported iPhone), Crop, Tags and
 * a description, and for a scan, Save as PDF. Every edit goes back to the batch through `onChange`,
 * so the shot still queues offline with the rest when the batch is saved.
 *
 * A full-screen view rather than a Modal, so the annotator, cropper and tag
 * sheet it opens are the only modals on screen: iOS will not stack a modal on
 * a modal that is already presenting.
 */
export function ShotEditor({
  shot,
  projectId,
  userId,
  existingTags,
  canMeasure,
  onChange,
  onRetake,
  onClose,
}: {
  shot: EditableShot;
  projectId: string;
  userId: string | null;
  existingTags: string[];
  canMeasure: boolean;
  onChange: (patch: ShotPatch) => void;
  onRetake: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [annotating, setAnnotating] = useState<ShotAnnotatorTool | null>(null);
  const [cropping, setCropping] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  /** The description field, folded away until asked for so the photo keeps the screen. */
  const [noteOpen, setNoteOpen] = useState(Boolean(shot.caption?.trim()));

  const tags = shot.tags ?? [];

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
  }[] = [
    { id: "retake", label: "Retake", icon: RotateCcw, onPress: onRetake },
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
    {
      id: "tags",
      label: "Tags",
      icon: Tag,
      onPress: () => setTagsOpen(true),
      badge: tags.length,
    },
    {
      id: "note",
      label: "Note",
      icon: StickyNote,
      onPress: () => setNoteOpen((open) => !open),
      active: noteOpen,
    },
    ...(shot.scan
      ? [{ id: "pdf", label: "PDF", icon: FileText, onPress: () => void saveAsPdf() }]
      : []),
  ];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
    >
      <View style={styles.imageWrap}>
        <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
        {tags.length > 0 ? (
          <View style={[styles.tagOverlay, { top: insets.top + 64 }]} pointerEvents="none">
            {tags.map((tag) => (
              <View key={tag} style={styles.tagPill}>
                <Text style={styles.tagPillText}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {shot.scan ? (
          <View style={[styles.scanBadge, { backgroundColor: theme.colors.primary }]}>
            <Text style={[styles.scanBadgeText, { color: theme.colors.primaryForeground }]}>
              SCAN
            </Text>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.topBar,
          {
            top: insets.top + spacing.sm,
            left: insets.left + spacing.lg,
            right: insets.right + spacing.lg,
          },
        ]}
        pointerEvents="box-none"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the batch"
          onPress={onClose}
          hitSlop={8}
          style={styles.roundButton}
        >
          <Icon icon={X} size="md" color="#fff" />
        </Pressable>
      </View>

      <View
        style={[
          styles.bottom,
          {
            bottom: insets.bottom + spacing.lg,
            left: insets.left + spacing.lg,
            right: insets.right + spacing.lg,
          },
        ]}
        pointerEvents="box-none"
      >
        {message ? (
          <Text style={[styles.message, message.error && styles.messageError]}>{message.text}</Text>
        ) : null}

        {noteOpen ? (
          <TextInput
            value={shot.caption ?? ""}
            onChangeText={(caption) => onChange({ caption })}
            placeholder="Add a description (optional)"
            placeholderTextColor="rgba(255,255,255,0.5)"
            multiline
            style={styles.description}
            accessibilityLabel="Photo description"
          />
        ) : null}

        <View style={styles.toolbarWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolbar}
          >
            {actions.map((action) => (
              <Pressable
                key={action.id}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                accessibilityState={
                  action.active !== undefined ? { selected: action.active } : undefined
                }
                onPress={action.onPress}
                disabled={pdfBusy && action.id === "pdf"}
                style={[styles.toolButton, action.active && styles.toolButtonActive]}
              >
                {action.id === "pdf" && pdfBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Icon icon={action.icon} size="md" color="#fff" />
                )}
                <Text style={styles.toolText}>{action.label}</Text>
                {action.badge ? (
                  <View style={[styles.badge, { backgroundColor: theme.colors.primary }]}>
                    <Text style={[styles.badgeText, { color: theme.colors.primaryForeground }]}>
                      {action.badge}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done"
          onPress={onClose}
          style={styles.doneButton}
        >
          <Icon icon={Check} size="md" color="#18130d" />
          <Text style={styles.doneText}>Done</Text>
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  imageWrap: { ...StyleSheet.absoluteFill },
  tagOverlay: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
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
    position: "absolute",
    right: spacing.lg,
    top: 60,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  scanBadgeText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  topBar: { position: "absolute", flexDirection: "row" },
  roundButton: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    borderRadius: HIT_TARGET / 2,
    backgroundColor: "rgba(24, 20, 16, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  /* Floats over the photo, centred and capped so a tablet gets the same bar. */
  bottom: {
    position: "absolute",
    alignItems: "center",
    gap: spacing.sm,
  },
  toolbarWrap: {
    maxWidth: 560,
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
  description: {
    alignSelf: "stretch",
    maxWidth: 560,
    color: "#fff",
    fontSize: 15,
    backgroundColor: "rgba(10, 8, 6, 0.6)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    minHeight: HIT_TARGET,
    maxHeight: 96,
  },
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
