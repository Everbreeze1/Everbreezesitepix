import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTextSnippet,
  deleteTextSnippet,
  listTextSnippets,
  updateTextSnippet,
  type TextSnippet,
} from "@/api/snippets";
import {
  filterSnippets,
  insertPlan,
  librarySummary,
  snippetBodyError,
  snippetPreview,
  snippetTitleError,
  suggestedTitle,
} from "@/api/snippets-view";
import type { Block } from "@/api/doc-blocks";
import { radius, spacing, useTheme } from "@/theme";
import { Library, PenLine, Plus, Trash2, TriangleAlert } from "./icons";
import { Badge } from "./Badge";
import { Button, IconButton } from "./Button";
import { Field } from "./Field";
import { Icon } from "./Icon";
import { EmptyState, SkeletonList } from "./State";
import { SearchField } from "./PageHeader";
import { Sheet } from "./Sheet";
import { Text } from "./Text";

/**
 * The snippet library, opened from a document.
 *
 * Reusable text a crew does not want to retype: a standing safety note, the
 * wording for a handover, the lines at the top of every commissioning sheet.
 * Four ops have existed for it all along and the phone called none of them,
 * which is backwards - retyping the same paragraph is far more expensive on a
 * phone keyboard than on a desk.
 *
 * Inserting is where the care goes, and it splits in two by the snippet rather
 * than by the person. See `insertPlan`: a snippet the block model can rebuild
 * is loaded into the composer so it can be edited first, and one holding a
 * table or styled text is appended verbatim, with the consequence said out loud
 * rather than discovered. Nothing is quietly reformatted.
 */
export function SnippetSheet({
  visible,
  onClose,
  onInsertBlocks,
  onInsertHtml,
  /** The composer's current content, offered as something to save. */
  saveableHtml,
}: {
  visible: boolean;
  onClose: () => void;
  onInsertBlocks: (blocks: Block[]) => void;
  onInsertHtml: (html: string) => void;
  saveableHtml?: string;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [title, setTitle] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["text-snippets"],
    queryFn: listTextSnippets,
    enabled: visible,
    staleTime: 60_000,
  });

  const snippets = query.data ?? [];
  const shown = useMemo(() => filterSnippets(snippets, search), [snippets, search]);

  const save = useMutation({
    mutationFn: () => createTextSnippet({ title, contentHtml: saveableHtml ?? "" }),
    onSuccess: (snippet) => {
      queryClient.setQueryData<TextSnippet[]>(["text-snippets"], (prev) => [
        snippet,
        ...(prev ?? []),
      ]);
      setSaving(false);
      setTitle("");
      setFormError(null);
    },
    onError: (error: unknown) =>
      setFormError(error instanceof Error ? error.message : "Could not save that."),
  });

  const remove = useMutation({
    mutationFn: (snippetId: string) => deleteTextSnippet(snippetId),
    onMutate: async (snippetId: string) => {
      await queryClient.cancelQueries({ queryKey: ["text-snippets"] });
      const previous = queryClient.getQueryData<TextSnippet[]>(["text-snippets"]);
      queryClient.setQueryData<TextSnippet[]>(["text-snippets"], (prev) =>
        (prev ?? []).filter((s) => s.id !== snippetId),
      );
      return { previous };
    },
    onError: (error: unknown, _id, context) => {
      // Put it back. A snippet that vanishes and stays vanished after a failed
      // delete reads as deleted, and the library is shared with the crew.
      if (context?.previous) queryClient.setQueryData(["text-snippets"], context.previous);
      Alert.alert("Could not delete", error instanceof Error ? error.message : "Please try again.");
    },
  });

  /**
   * Rename a snippet in place.
   *
   * The library is team-shared and names are how anybody finds anything in it,
   * so a snippet saved in a hurry as "Standard 3" needs to be fixable from the
   * phone rather than only from a desk. Inline rather than a native prompt:
   * `Alert.prompt` does not exist on Android.
   */
  const rename = useMutation({
    mutationFn: (args: { id: string; title: string }) =>
      updateTextSnippet({ snippetId: args.id, title: args.title }),
    onSuccess: (_ok, args) => {
      queryClient.setQueryData<TextSnippet[]>(["text-snippets"], (prev) =>
        (prev ?? []).map((s) => (s.id === args.id ? { ...s, title: args.title.trim() } : s)),
      );
      setRenaming(null);
      setFormError(null);
    },
    onError: (error: unknown) =>
      setFormError(error instanceof Error ? error.message : "Could not rename that."),
  });

  function saveRename() {
    if (!renaming) return;
    const bad = snippetTitleError(renaming.title);
    if (bad) {
      setFormError(bad);
      return;
    }
    rename.mutate(renaming);
  }

  function startSave() {
    const bad = snippetBodyError(saveableHtml ?? "");
    if (bad) {
      setFormError(bad);
      return;
    }
    setTitle(suggestedTitle(saveableHtml ?? ""));
    setFormError(null);
    setSaving(true);
  }

  function confirmSave() {
    const bad = snippetTitleError(title) ?? snippetBodyError(saveableHtml ?? "");
    if (bad) {
      setFormError(bad);
      return;
    }
    save.mutate();
  }

  function insert(snippet: TextSnippet) {
    const plan = insertPlan(snippet);
    if (plan.mode === "blocks") {
      onInsertBlocks(plan.blocks);
      onClose();
      return;
    }
    // Said before it happens, not after. The page stops being editable on the
    // phone once this markup is in it, and that is worth a sentence.
    Alert.alert("Add this snippet?", plan.caveat ?? "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Add to end",
        onPress: () => {
          onInsertHtml(snippet.content_html);
          onClose();
        },
      },
    ]);
  }

  function confirmDelete(snippet: TextSnippet) {
    Alert.alert(`Delete "${snippet.title}"?`, "It will go for everybody on your team.", [
      { text: "Keep", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(snippet.id) },
    ]);
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Snippets"
      subtitle={query.isLoading ? undefined : librarySummary(snippets.length, shown.length)}
      footer={
        saveableHtml ? (
          saving ? (
            <View style={{ gap: spacing.sm }}>
              <Field
                label="Name this snippet"
                value={title}
                onChangeText={(next) => {
                  setTitle(next);
                  if (formError) setFormError(null);
                }}
                placeholder="Standard safety note"
                error={formError ?? undefined}
              />
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  style={{ flex: 1 }}
                  onPress={() => {
                    setSaving(false);
                    setFormError(null);
                  }}
                />
                <Button
                  label={save.isPending ? "Saving" : "Save"}
                  style={{ flex: 1 }}
                  disabled={save.isPending}
                  onPress={confirmSave}
                />
              </View>
            </View>
          ) : (
            <View style={{ gap: spacing.xs }}>
              <Button
                label="Save what you have written as a snippet"
                icon={Plus}
                variant="secondary"
                fullWidth
                onPress={startSave}
              />
              {formError ? (
                <Text variant="caption" tone="destructive">
                  {formError}
                </Text>
              ) : null}
            </View>
          )
        ) : undefined
      }
    >
      <View style={{ gap: spacing.sm }}>
        {snippets.length > 4 ? (
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Search snippets"
            accessibilityLabel="Search snippets"
          />
        ) : null}

        {query.isLoading ? (
          <SkeletonList rows={3} />
        ) : query.error ? (
          <View style={{ gap: spacing.sm, paddingVertical: spacing.md }}>
            <Badge label="Could not load" tone="danger" icon={TriangleAlert} variant="soft" />
            <Text variant="body" tone="muted">
              {query.error instanceof Error ? query.error.message : "Something went wrong."}
            </Text>
            <Button label="Try again" variant="secondary" onPress={() => void query.refetch()} />
          </View>
        ) : snippets.length === 0 ? (
          <EmptyState
            icon={Library}
            title="No snippets yet"
            body="Write something in the composer, then save it here to reuse it on any document."
          />
        ) : shown.length === 0 ? (
          <EmptyState icon={Library} title="Nothing matches" body="Try a different word." />
        ) : (
          <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
            <View style={{ gap: spacing.sm }}>
              {shown.map((snippet) => {
                const plan = insertPlan(snippet);
                return (
                  <View
                    key={snippet.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: spacing.sm,
                      padding: spacing.md,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.card,
                    }}
                  >
                    {renaming?.id === snippet.id ? (
                      <View style={{ flex: 1, gap: spacing.sm }}>
                        <Field
                          label="Snippet name"
                          value={renaming.title}
                          onChangeText={(title) =>
                            setRenaming((cur) => (cur ? { ...cur, title } : cur))
                          }
                        />
                        <View style={{ flexDirection: "row", gap: spacing.sm }}>
                          <Button
                            label="Cancel"
                            variant="secondary"
                            size="sm"
                            style={{ flex: 1 }}
                            onPress={() => {
                              setRenaming(null);
                              setFormError(null);
                            }}
                          />
                          <Button
                            label={rename.isPending ? "Saving" : "Save"}
                            size="sm"
                            style={{ flex: 1 }}
                            disabled={rename.isPending}
                            onPress={saveRename}
                          />
                        </View>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Insert ${snippet.title}`}
                        onPress={() => insert(snippet)}
                        style={({ pressed }) => ({ flex: 1, gap: 2, opacity: pressed ? 0.6 : 1 })}
                      >
                        <Text variant="bodyStrong" numberOfLines={1}>
                          {snippet.title}
                        </Text>
                        <Text variant="caption" tone="muted" numberOfLines={2}>
                          {snippetPreview(snippet)}
                        </Text>
                        {plan.mode === "html" ? (
                          // Flagged in the list rather than only at the moment of
                          // insertion, so somebody choosing between two snippets
                          // can see which one costs them the phone editor.
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: spacing.xs,
                              paddingTop: 2,
                            }}
                          >
                            <Icon icon={TriangleAlert} size="sm" tone="safety" />
                            <Text variant="caption" tone="muted">
                              Adds formatting the phone cannot edit
                            </Text>
                          </View>
                        ) : null}
                      </Pressable>
                    )}

                    {renaming?.id === snippet.id ? null : (
                      <IconButton
                        icon={PenLine}
                        surface={false}
                        size="sm"
                        accessibilityLabel={`Rename ${snippet.title}`}
                        onPress={() => {
                          setFormError(null);
                          setRenaming({ id: snippet.id, title: snippet.title });
                        }}
                      />
                    )}

                    <IconButton
                      icon={Trash2}
                      accessibilityLabel={`Delete ${snippet.title}`}
                      tone="destructive"
                      surface={false}
                      size="sm"
                      onPress={() => confirmDelete(snippet)}
                    />
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
      </View>
    </Sheet>
  );
}
