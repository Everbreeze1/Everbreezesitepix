import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "@/lib/supabase";
import { HIT_TARGET, radius, spacing, typography, useLayout, useTheme } from "@/theme";

/**
 * A tag name the way web stores it: lower case, spaces to hyphens, 32 chars.
 * Same rule as `createPhotoTag` on the project page, so a tag made on the
 * phone and the same word typed on web are one tag, not two.
 */
export function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32);
}

/**
 * Make sure the tag exists in the workspace tag library, so its colour is
 * shared everywhere, as web's `ensureGlobalTag` does. Best effort: a tag that
 * is only on the photo is still a working tag, so a failure here is ignored.
 */
async function ensureWorkspaceTag(name: string, userId: string | null) {
  try {
    const { data: existing } = await supabase
      .from("tags")
      .select("name")
      .ilike("name", name)
      .maybeSingle();
    if (existing) return;
    await supabase.from("tags").insert({ name, created_by: userId });
  } catch {
    // The photo keeps the tag either way.
  }
}

/**
 * The camera's tag picker, web's "Tag this photo" sheet: tap existing tags to
 * toggle them, or type a new one.
 *
 * Dark whatever the app scheme, because it opens over the camera.
 */
export function TagPickerSheet({
  visible,
  title = "Tag this photo",
  existing,
  selected,
  userId,
  onChange,
  onClose,
}: {
  visible: boolean;
  title?: string;
  existing: string[];
  selected: string[];
  userId: string | null;
  onChange: (tags: string[]) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  // Inner lists shrink on a phone held on its side, so they fit in the sheet.
  const layout = useLayout();
  const [draft, setDraft] = useState("");

  // Tags just created or picked that the project has never used still show.
  const all = Array.from(new Set([...existing, ...selected])).sort();

  function toggle(tag: string) {
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  }

  function create() {
    const name = normalizeTagName(draft);
    if (!name) return;
    if (!selected.includes(name)) onChange([...selected, name]);
    setDraft("");
    void ensureWorkspaceTag(name, userId);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close tags" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.anchor}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { backgroundColor: theme.colors.chrome }]}>
          <Text style={[typography.heading, styles.title]}>{title}</Text>
          <ScrollView
            style={{ maxHeight: layout.listMaxHeight(260) }}
            contentContainerStyle={styles.chips}
          >
            {all.length === 0 ? (
              <Text style={styles.empty}>No tags yet. Add one below.</Text>
            ) : (
              all.map((tag) => {
                const on = selected.includes(tag);
                return (
                  <Pressable
                    key={tag}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    onPress={() => toggle(tag)}
                    style={[
                      styles.chip,
                      on && { backgroundColor: theme.colors.primary, borderColor: "transparent" },
                    ]}
                  >
                    <Text
                      style={[styles.chipText, on && { color: theme.colors.primaryForeground }]}
                    >
                      {tag}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View style={styles.createRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Create new tag"
              placeholderTextColor="rgba(255,255,255,0.45)"
              autoCapitalize="none"
              maxLength={32}
              returnKeyType="done"
              onSubmitEditing={create}
              style={[styles.input, typography.body]}
              accessibilityLabel="New tag name"
            />
            <Pressable
              accessibilityRole="button"
              disabled={!draft.trim()}
              onPress={create}
              style={[
                styles.addButton,
                { backgroundColor: theme.colors.primary, opacity: draft.trim() ? 1 : 0.5 },
              ]}
            >
              <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
                Add
              </Text>
            </Pressable>
          </View>

          <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}>
            <Text style={[typography.bodyStrong, { color: "#18130d" }]}>Done</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.5)" },
  anchor: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl + spacing.lg,
    gap: spacing.lg,
  },
  title: { color: "#fff" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  empty: { color: "rgba(255,255,255,0.6)", fontSize: 14 },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 36,
    justifyContent: "center",
  },
  chipText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  createRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: {
    flex: 1,
    color: "#fff",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: HIT_TARGET,
  },
  addButton: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: HIT_TARGET,
    justifyContent: "center",
  },
  done: {
    backgroundColor: "#ece8e3",
    borderRadius: radius.md,
    minHeight: HIT_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
});
