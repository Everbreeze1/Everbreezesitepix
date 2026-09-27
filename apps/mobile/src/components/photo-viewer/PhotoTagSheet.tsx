import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { createLibraryTag, type LibraryTag } from "@/api/photo-viewer";
import { normalizeTag, TAG_PRESET_COLORS } from "@/api/photo-viewer-view";
import { HIT_TARGET, radius, spacing, typography } from "@/theme";
import { Check, Plus, Search } from "@/ui/icons";
import { TAG_LIBRARY_KEY, TagPill, useTagLibrary } from "./TagPill";
import { viewerColors as c } from "./viewer-theme";

/**
 * Tag this photo: web's `PhotoTagPopoverBody`, as a sheet.
 *
 * Searches the workspace tag library, shows the photo's tags first with a
 * tick, toggles on tap, and creates a new tag (with a colour) from whatever was
 * typed when nothing matches. Tags live in the shared `tags` table, so one made
 * here is offered on every other job and on the web.
 *
 * Dark like the rest of the viewer, the way web opens its picker with `dark`
 * over the lightbox.
 */
export function PhotoTagSheet({
  visible,
  photoTags,
  userId,
  onToggle,
  onClose,
}: {
  visible: boolean;
  photoTags: string[];
  userId: string | null;
  onToggle: (name: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const library = useTagLibrary(visible);
  const [q, setQ] = useState("");
  const [color, setColor] = useState<string>(TAG_PRESET_COLORS[4]);
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const tags = useMemo(() => library.data ?? [], [library.data]);
  const query = q.trim();
  const norm = normalizeTag(query);

  const rows = useMemo(() => {
    const needle = query.toLowerCase();
    const match = (tag: LibraryTag) => !needle || tag.name.toLowerCase().includes(needle);
    /*
     * Tags on the photo that the library does not know (written before the
     * library existed, or by an older client) still show, so they can be
     * taken off.
     */
    const known = new Set(tags.map((tag) => tag.name));
    const orphans: LibraryTag[] = photoTags
      .filter((name) => !known.has(name))
      .map((name) => ({ id: `orphan:${name}`, name, color: null }));
    const all = [...tags, ...orphans].filter(match);
    const selected = all
      .filter((tag) => photoTags.includes(tag.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const unselected = all.filter((tag) => !photoTags.includes(tag.name));
    return { selected, unselected };
  }, [tags, photoTags, query]);

  const exactExists = tags.some((tag) => tag.name.toLowerCase() === norm);

  async function create() {
    if (!norm || creating) return;
    const existing = tags.find((tag) => tag.name.toLowerCase() === norm);
    if (existing) {
      setQ("");
      if (!photoTags.includes(existing.name)) onToggle(existing.name);
      return;
    }
    setCreating(true);
    setFailure(null);
    try {
      const created = await createLibraryTag(norm, color, userId);
      queryClient.setQueryData<LibraryTag[]>(TAG_LIBRARY_KEY, (prev) =>
        [...(prev ?? []).filter((tag) => tag.id !== created.id), created].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setQ("");
      if (!photoTags.includes(created.name)) onToggle(created.name);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not create that tag.");
    } finally {
      setCreating(false);
    }
  }

  const renderRow = (tag: LibraryTag) => {
    const on = photoTags.includes(tag.name);
    return (
      <Pressable
        key={tag.id}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={tag.name}
        onPress={() => onToggle(tag.name)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.sm,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.sm,
          borderRadius: radius.md,
          minHeight: HIT_TARGET,
          backgroundColor: pressed ? c.raised : "transparent",
        })}
      >
        <TagPill name={tag.name} size="sm" />
        <Check size={18} color={c.primary} strokeWidth={2.5} style={{ opacity: on ? 1 : 0 }} />
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close tags"
          onPress={onClose}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}
        />
        <View
          style={{
            backgroundColor: c.chrome,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            borderWidth: 1,
            borderColor: c.border,
            padding: spacing.lg,
            paddingBottom: Math.max(insets.bottom, spacing.lg),
            gap: spacing.md,
            maxHeight: "85%",
            width: "100%",
            maxWidth: 560,
            alignSelf: "center",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={[typography.heading, { color: c.foreground, flex: 1 }]}>
              Tag this photo
            </Text>
            {photoTags.length > 0 ? (
              <Text style={[typography.caption, { color: c.muted }]}>
                {photoTags.length} selected
              </Text>
            ) : null}
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              borderWidth: 1,
              borderColor: c.input,
              borderRadius: radius.md,
              paddingHorizontal: spacing.md,
              minHeight: HIT_TARGET,
            }}
          >
            <Search size={16} color={c.muted} />
            <TextInput
              value={q}
              onChangeText={(next) => {
                setQ(next);
                setFailure(null);
              }}
              placeholder="Search or create new tag"
              placeholderTextColor={c.faint}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={32}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (query && !exactExists) void create();
              }}
              style={[typography.body, { flex: 1, color: c.foreground, paddingVertical: 8 }]}
              accessibilityLabel="Search or create a tag"
            />
          </View>

          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">
            {library.isLoading ? (
              <ActivityIndicator color={c.muted} style={{ paddingVertical: spacing.lg }} />
            ) : library.error ? (
              <Text style={[typography.caption, { color: c.destructive }]}>
                The tag library could not be loaded.{" "}
                <Text
                  style={{ textDecorationLine: "underline" }}
                  onPress={() => void library.refetch()}
                >
                  Try again
                </Text>
              </Text>
            ) : rows.selected.length + rows.unselected.length === 0 ? (
              <Text style={[typography.caption, { color: c.muted, paddingVertical: spacing.sm }]}>
                {query ? `No tags match "${query}"` : "No tags yet. Type a name to create one."}
              </Text>
            ) : (
              <View>
                {!query && rows.selected.length > 0 ? (
                  <Text style={[typography.overline, { color: c.muted, paddingBottom: 4 }]}>
                    SELECTED
                  </Text>
                ) : null}
                {rows.selected.map(renderRow)}
                {rows.unselected.map(renderRow)}
              </View>
            )}
          </ScrollView>

          {query && !exactExists ? (
            <View
              style={{
                gap: spacing.sm,
                borderTopWidth: 1,
                borderTopColor: c.border,
                paddingTop: spacing.md,
              }}
            >
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {TAG_PRESET_COLORS.map((swatch) => (
                  <Pressable
                    key={swatch}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: swatch === color }}
                    accessibilityLabel={`Tag colour ${swatch}`}
                    onPress={() => setColor(swatch)}
                    hitSlop={6}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: swatch,
                      borderWidth: 2,
                      borderColor: swatch === color ? c.foreground : "transparent",
                    }}
                  />
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={creating || !norm}
                onPress={() => void create()}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: spacing.xs,
                  minHeight: HIT_TARGET,
                  borderRadius: radius.md,
                  backgroundColor: c.primary,
                  opacity: creating || !norm ? 0.5 : pressed ? 0.85 : 1,
                })}
              >
                {creating ? (
                  <ActivityIndicator color={c.primaryForeground} />
                ) : (
                  <>
                    <Plus size={16} color={c.primaryForeground} strokeWidth={2.5} />
                    <Text style={[typography.bodyStrong, { color: c.primaryForeground }]}>
                      Create &quot;{norm}&quot;
                    </Text>
                  </>
                )}
              </Pressable>
              <Text style={[typography.caption, { color: c.muted }]}>
                Tags are shared across your whole workspace. Tap several to apply more than one.
              </Text>
            </View>
          ) : null}

          {failure ? (
            <Text style={[typography.caption, { color: c.destructive }]}>{failure}</Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => ({
              minHeight: HIT_TARGET,
              borderRadius: radius.md,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? c.glassPressed : c.raised,
            })}
          >
            <Text style={[typography.bodyStrong, { color: c.foreground }]}>Done</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
