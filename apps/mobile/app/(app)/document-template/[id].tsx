import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  copyDocTemplate,
  deleteDocTemplate,
  listDocTemplates,
  openDocTemplate,
  saveDocTemplate,
  setDocTemplateArchived,
  setDocTemplateFiling,
} from "@/api/document-template-admin";
import { copyName, FILING_OPTIONS, isExample } from "@/api/document-template-view";
import { docHtml, parseDoc, type DocBlock } from "@/api/rich-doc";
import { storedCategory, tradeOf } from "@/api/template-library-view";
import { getMyTeam } from "@/api/team";
import { FormattedTextEditor } from "@/components/FormattedTextEditor";
import {
  canManageLibrary,
  confirmDelete,
  errorText,
  TradeChips,
} from "@/components/TemplateLibraryParts";
import { spacing } from "@/theme";
import {
  Archive,
  Copy,
  EllipsisVertical,
  FolderInput,
  Pencil,
  Save,
  Tag,
  Trash2,
} from "@/ui/icons";
import {
  ActionSheet,
  Badge,
  Chip,
  ErrorState,
  Field,
  IconButton,
  Screen,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * One document template, edited in place.
 *
 * The body is the web's own TipTap HTML, edited with the same
 * `FormattedTextEditor` as a project page: headings, paragraphs and lists are
 * editable, and tables, photo slots and fill-in fields are locked blocks kept
 * byte for byte. `{{placeholders}}` are ordinary text and can be typed.
 *
 * Saving follows the page editor: when a field loses focus and when the screen
 * is left, never per keystroke. A built-in example opens read-only; editing it
 * makes the company's own version first, and a copy that is left without a
 * single change is deleted again, so browsing never leaves a twin behind.
 */
export default function DocumentTemplateScreen() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const queryClient = useQueryClient();

  const [menuOpen, setMenuOpen] = useState(false);
  const [filingOpen, setFilingOpen] = useState(false);
  const [name, setName] = useState("");
  const [blocks, setBlocks] = useState<DocBlock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const savedHtml = useRef("");
  const savedName = useRef("");
  const everSaved = useRef(false);

  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });
  const teamId = teamQuery.data?.team?.id ?? null;
  const canManage = canManageLibrary(teamQuery.data?.myRole, teamQuery.isSuccess);
  const listQuery = useQuery({
    queryKey: ["doc-templates-admin", teamId],
    queryFn: () => listDocTemplates(teamId),
    enabled: teamQuery.isSuccess || teamQuery.isError,
  });
  const bodyQuery = useQuery({
    queryKey: ["doc-template-body", id],
    queryFn: () => openDocTemplate(id!),
    enabled: Boolean(id),
    // The body is seeded once; a refetch must not overwrite what is being typed.
    staleTime: Infinity,
  });

  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const row = rows.find((r) => r.id === id) ?? null;
  const example = row ? isExample(row) : false;
  const editable = canManage && !example && Boolean(row);

  useEffect(() => {
    if (loaded || !bodyQuery.data || !row) return;
    const parsed = parseDoc(bodyQuery.data.html);
    setBlocks(parsed);
    setName(row.name);
    savedHtml.current = docHtml(parsed);
    savedName.current = row.name;
    setLoaded(true);
  }, [bodyQuery.data, row, loaded]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["doc-templates-admin"] });
    void queryClient.invalidateQueries({ queryKey: ["blueprint-library"] });
    // The in-project picker lists the same library through the API.
    void queryClient.invalidateQueries({ queryKey: ["document-templates"] });
  }, [queryClient]);

  const save = useMutation({
    mutationFn: (args: { name: string; html: string }) =>
      saveDocTemplate(id!, args.name, args.html),
    onSuccess: (_result, args) => {
      savedHtml.current = args.html;
      savedName.current = args.name;
      setFailure(null);
      invalidate();
    },
    onError: (error) => setFailure(errorText(error, "That did not save.")),
  });

  const dirty =
    loaded &&
    (docHtml(blocks) !== savedHtml.current ||
      (name.trim() !== "" && name.trim() !== savedName.current));

  const commit = useCallback(() => {
    if (!loaded || !editable || save.isPending) return;
    const html = docHtml(blocks);
    const trimmed = name.trim() || savedName.current;
    if (html === savedHtml.current && trimmed === savedName.current) return;
    everSaved.current = true;
    save.mutate({ name: trimmed, html });
  }, [blocks, editable, loaded, name, save]);

  // Leaving saves, so a change made only with the toolbar is not lost.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useFocusEffect(useCallback(() => () => commitRef.current(), []));

  /*
   * A copy made to be edited, and left without one change, is deleted again:
   * the web's rule, so looking inside an example never adds a card.
   */
  const isFresh = fresh === "1";
  useEffect(
    () => () => {
      if (isFresh && !everSaved.current && id) {
        void deleteDocTemplate(id).finally(() =>
          queryClient.invalidateQueries({ queryKey: ["doc-templates-admin"] }),
        );
      }
    },
    [id, isFresh, queryClient],
  );

  const copy = useMutation({
    mutationFn: () => {
      if (!row) throw new Error("Template not loaded");
      const taken = rows.filter((r) => r.id !== row.id).map((r) => r.name);
      return copyDocTemplate({ source: row, name: copyName(row, taken), teamId });
    },
    onSuccess: async (newId) => {
      invalidate();
      // The editor reads its row from the list, so the list must hold it first.
      await queryClient.refetchQueries({ queryKey: ["doc-templates-admin"] });
      router.replace({ pathname: "/document-template/[id]", params: { id: newId, fresh: "1" } });
    },
    onError: (error) => setFailure(errorText(error, "Could not copy that template.")),
  });

  const run = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      invalidate();
      setFailure(null);
    },
    onError: (error) => setFailure(errorText(error, "That did not save.")),
  });

  const remover = useMutation({
    mutationFn: () => deleteDocTemplate(id!),
    onSuccess: () => {
      invalidate();
      if (router.canGoBack()) router.back();
      else router.replace("/document-templates");
    },
    onError: (error) => setFailure(errorText(error, "Could not delete that template.")),
  });

  if (
    listQuery.isLoading ||
    bodyQuery.isLoading ||
    teamQuery.isLoading ||
    (!row && listQuery.isFetching)
  ) {
    return (
      <>
        <Stack.Screen options={{ title: "Document template" }} />
        <SkeletonList rows={6} />
      </>
    );
  }

  if (bodyQuery.error || listQuery.error || !row) {
    const error = bodyQuery.error ?? listQuery.error;
    return (
      <>
        <Stack.Screen options={{ title: "Document template" }} />
        <ErrorState
          title="Could not open this template"
          message={error ? errorText(error, "") : "It may have been deleted."}
          onRetry={() => {
            void bodyQuery.refetch();
            void listQuery.refetch();
          }}
        />
      </>
    );
  }

  const lockedParts = blocks.some((b) => b.kind === "raw");

  return (
    <>
      <Stack.Screen
        options={{
          title: "Document template",
          headerRight: () =>
            !canManage ? null : example ? (
              <IconButton
                icon={Pencil}
                accessibilityLabel="Edit a copy"
                surface={false}
                tone="primary"
                disabled={copy.isPending}
                onPress={() => copy.mutate()}
              />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <IconButton
                  icon={Save}
                  accessibilityLabel="Save template"
                  surface={false}
                  tone="primary"
                  disabled={!dirty || save.isPending}
                  onPress={commit}
                />
                <IconButton
                  icon={EllipsisVertical}
                  accessibilityLabel="More template actions"
                  surface={false}
                  tone="muted"
                  onPress={() => setMenuOpen(true)}
                />
              </View>
            ),
        }}
      />

      <Screen scroll padded={false} bottomInset={spacing.xxl}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            editable={editable}
            onBlur={commit}
            returnKeyType="done"
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            <Badge label={tradeOf(row.category)} tone="neutral" variant="outline" />
            <Badge
              label={`Files under ${FILING_OPTIONS.find((o) => o.id === row.filesUnder)?.label ?? "Reports"}`}
              tone="neutral"
              variant="soft"
            />
            {example ? <Badge label="Example" tone="neutral" variant="soft" /> : null}
            {row.archived ? <Badge label="Archived" tone="neutral" variant="outline" /> : null}
          </View>
          {example ? (
            <Text variant="caption" tone="muted">
              This example is shared with every company, so it cannot be changed here. Edit a copy
              to make your company&apos;s own version; it takes the example&apos;s place in your
              library.
            </Text>
          ) : lockedParts ? (
            <Text variant="caption" tone="muted">
              Tables, photo slots and fill-in fields are locked here and kept exactly as they are.
              Headings, paragraphs and lists can be edited, and placeholders such as
              {" {{project_name}} "}can be typed.
            </Text>
          ) : null}
          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}
          <Text variant="caption" tone="muted" style={{ textAlign: "right" }}>
            {editable ? (save.isPending ? "Saving" : dirty ? "Not saved yet" : "Saved") : ""}
          </Text>

          <FormattedTextEditor
            blocks={blocks}
            onChange={setBlocks}
            onCommit={commit}
            editable={editable}
            placeholder="Write the template"
          />
        </View>
      </Screen>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={row.name}
        actions={[
          { label: "Trade and filing", icon: Tag, onPress: () => setFilingOpen(true) },
          {
            label: "Duplicate",
            icon: Copy,
            disabled: copy.isPending,
            onPress: () => {
              commit();
              copy.mutate();
            },
          },
          {
            label: row.archived ? "Restore" : "Archive",
            icon: Archive,
            onPress: () => run.mutate(() => setDocTemplateArchived(row.id, !row.archived)),
          },
          {
            label: "Delete",
            icon: Trash2,
            destructive: true,
            onPress: () =>
              confirmDelete(
                `Delete "${row.name}"?`,
                row.copiedFrom
                  ? "Pages already made from it are untouched, and the built-in example it replaced comes back. This cannot be undone."
                  : "Pages already made from it are untouched. Blueprints using it will show the section as missing. This cannot be undone.",
                "Delete template",
                () => {
                  everSaved.current = true;
                  remover.mutate();
                },
              ),
          },
        ]}
      />

      <Sheet visible={filingOpen} onClose={() => setFilingOpen(false)} title="Trade and filing">
        <View style={{ gap: spacing.lg }}>
          <TradeChips
            value={tradeOf(row.category)}
            onChange={(trade) =>
              run.mutate(() => setDocTemplateFiling(row.id, { category: storedCategory(trade) }))
            }
          />
          <View style={{ gap: spacing.sm }}>
            <Text variant="caption" tone="muted">
              Pages made from it file under
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {FILING_OPTIONS.map((option) => (
                <Chip
                  key={option.id}
                  label={option.label}
                  icon={FolderInput}
                  selected={row.filesUnder === option.id}
                  onPress={() =>
                    run.mutate(() => setDocTemplateFiling(row.id, { filesUnder: option.id }))
                  }
                />
              ))}
            </View>
            <Text variant="caption" tone="muted">
              {FILING_OPTIONS.find((o) => o.id === row.filesUnder)?.hint}
            </Text>
          </View>
        </View>
      </Sheet>
    </>
  );
}
