import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPage, savePage } from "@/api/pages";
import {
  appendBlocks,
  BLOCK_LABELS,
  emptyBlock,
  insertBlock,
  meaningfulBlocks,
  moveBlock,
  pagePreview,
  parsePage,
  refusalMessage,
  removeBlock,
  serialiseBlocks,
  setBlockKind,
  setBlockText,
  type Block,
  type BlockKind,
} from "@/api/doc-blocks";
import { spacing } from "@/theme";
import { ChevronDown, ChevronUp, Plus, TriangleAlert, Trash2 } from "@/ui/icons";
import {
  Badge,
  Button,
  ButtonRow,
  Card,
  Chip,
  ErrorState,
  Field,
  IconButton,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * One project page.
 *
 * The screen has two modes and which one it offers is decided by the document,
 * not by the person:
 *
 * **Edit**, when `parsePage` could read the whole page into blocks and rebuild
 * it exactly. That is true of pages created here and of simple pages, and it is
 * the only case where writing the whole document back is safe.
 *
 * **Append**, always. Adding to the end never reads what is already there, so
 * it cannot lose a table, a logo or styled text. This is the mode that matters
 * on a phone: composing a document is desk work, adding today's entry to one is
 * not, and every page made from a seeded template lands here because those
 * contain markup the block model refuses.
 *
 * Saving always sends `expectedUpdatedAt`. Without it two people editing one
 * page means the second save silently overwrites the first, with no error and
 * nothing to notice.
 */
export default function PageScreen() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [draft, setDraft] = useState<Block[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const queryKey = useMemo(() => ["project-page", pageId], [pageId]);

  const query = useQuery({
    queryKey,
    queryFn: () => getPage(pageId!),
    enabled: Boolean(pageId),
  });
  const page = query.data ?? null;

  const parsed = useMemo(() => parsePage(page?.content_html ?? ""), [page?.content_html]);
  const canEdit = parsed.refusal === null;

  /*
   * Seed once. Re-seeding on a background refetch would throw away whatever is
   * half-typed, which on a phone happens every time the app returns to the
   * foreground.
   */
  useEffect(() => {
    if (loaded || !page) return;
    setTitle(page.title);
    setBlocks(parsed.blocks);
    setLoaded(true);
  }, [page, parsed.blocks, loaded]);

  const save = useMutation({
    mutationFn: (args: { title?: string; contentHtml?: string }) =>
      savePage({
        pageId: pageId!,
        // The copy the screen loaded. A rejection means somebody else has
        // changed the page since, which is information rather than an error.
        expectedUpdatedAt: page!.updated_at,
        ...args,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      setFailure(null);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "That did not save.";
      setFailure(
        /conflict|modified|stale|updated/i.test(message)
          ? "Somebody else changed this page while you had it open. Pull down to load their version, then make your change again."
          : message,
      );
    },
  });

  /** Write the whole document back. Only reachable when the round trip is exact. */
  const saveBody = useCallback(() => {
    const keep = meaningfulBlocks(blocks);
    save.mutate({ contentHtml: serialiseBlocks(keep) });
    setBlocks(keep.length ? keep : [emptyBlock()]);
  }, [blocks, save]);

  /** Add to the end without reading what is there. Safe on every page. */
  const appendDraft = useCallback(() => {
    if (!page) return;
    const keep = meaningfulBlocks(draft);
    if (keep.length === 0) return;
    save.mutate({ contentHtml: appendBlocks(page.content_html, keep) });
    setDraft([]);
  }, [draft, page, save]);

  if (query.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Page" }} />
        <SkeletonList rows={6} />
      </>
    );
  }

  if (query.error || !page) {
    return (
      <>
        <Stack.Screen options={{ title: "Page" }} />
        <ErrorState
          title="Could not load this page"
          message={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: title || "Page" }} />

      <Screen
        scroll
        padded={false}
        refreshing={query.isRefetching}
        onRefresh={() => {
          // Reloading is how somebody recovers from a conflict, so it has to
          // re-seed rather than leave the stale draft in place.
          setLoaded(false);
          void query.refetch();
        }}
        bottomInset={spacing.xxl}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            onBlur={() => {
              const trimmed = title.trim();
              if (!trimmed || trimmed === page.title) return;
              save.mutate({ title: trimmed });
            }}
            returnKeyType="done"
          />

          {failure ? (
            <Badge label={failure} tone="danger" variant="soft" icon={TriangleAlert} />
          ) : null}
        </View>

        {canEdit ? (
          <>
            <SectionHeader title="Page" />
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
              {blocks.length === 0 ? (
                <Text variant="caption" tone="muted">
                  This page is empty. Add the first block.
                </Text>
              ) : (
                blocks.map((block, index) => (
                  <BlockEditor
                    key={block.id}
                    block={block}
                    first={index === 0}
                    last={index === blocks.length - 1}
                    onText={(text) => setBlocks((cur) => setBlockText(cur, block.id, text))}
                    onKind={(kind) => setBlocks((cur) => setBlockKind(cur, block.id, kind))}
                    onMove={(by) => setBlocks((cur) => moveBlock(cur, block.id, by))}
                    onRemove={() => setBlocks((cur) => removeBlock(cur, block.id))}
                    onCommit={saveBody}
                  />
                ))
              )}

              <ButtonRow>
                <Button
                  label="Add block"
                  icon={Plus}
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    setBlocks((cur) =>
                      insertBlock(cur, cur.length ? cur[cur.length - 1].id : null, "paragraph"),
                    )
                  }
                />
                <Button label="Save" size="sm" disabled={save.isPending} onPress={saveBody} />
              </ButtonRow>
            </View>
          </>
        ) : (
          <>
            {/*
              Read-only, and it says why. The alternative is letting somebody
              type into a page whose save would delete a table they cannot see
              from here.
            */}
            <SectionHeader title="This page is read-only here" />
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
              <Card>
                <View style={{ gap: spacing.sm }}>
                  <Badge label="Cannot edit on the phone" tone="warning" icon={TriangleAlert} />
                  <Text variant="body">{refusalMessage(parsed.refusal)}</Text>
                </View>
              </Card>

              <Text variant="caption" tone="muted">
                {pagePreview(page.content_html, 400)}
              </Text>
            </View>
          </>
        )}

        {/*
          Appending is offered on every page, including the read-only ones. It
          never reads the existing content, so it cannot lose any of it, and it
          is the thing a phone is actually for.
        */}
        <SectionHeader title="Add to the end" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          {draft.length === 0 ? (
            <Text variant="caption" tone="muted">
              Add today's entry without touching anything above it.
            </Text>
          ) : (
            draft.map((block, index) => (
              <BlockEditor
                key={block.id}
                block={block}
                first={index === 0}
                last={index === draft.length - 1}
                onText={(text) => setDraft((cur) => setBlockText(cur, block.id, text))}
                onKind={(kind) => setDraft((cur) => setBlockKind(cur, block.id, kind))}
                onMove={(by) => setDraft((cur) => moveBlock(cur, block.id, by))}
                onRemove={() => setDraft((cur) => removeBlock(cur, block.id))}
              />
            ))
          )}

          <ButtonRow>
            <Button
              label="Add block"
              icon={Plus}
              variant="secondary"
              size="sm"
              onPress={() =>
                setDraft((cur) =>
                  insertBlock(cur, cur.length ? cur[cur.length - 1].id : null, "paragraph"),
                )
              }
            />
            <Button
              label="Append"
              size="sm"
              disabled={save.isPending || meaningfulBlocks(draft).length === 0}
              onPress={appendDraft}
            />
          </ButtonRow>
        </View>
      </Screen>
    </>
  );
}

/**
 * One block: a kind picker, a text field, and the controls to move or drop it.
 *
 * A plain multiline `TextInput` rather than anything rich, which is the whole
 * point of the block model: the OS already handles a text field well, and
 * selection-based formatting with a finger is the worst interaction in mobile
 * software.
 */
function BlockEditor({
  block,
  first,
  last,
  onText,
  onKind,
  onMove,
  onRemove,
  onCommit,
}: {
  block: Block;
  first: boolean;
  last: boolean;
  onText: (text: string) => void;
  onKind: (kind: BlockKind) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onCommit?: () => void;
}) {
  return (
    <Card>
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, flex: 1 }}>
            {(Object.keys(BLOCK_LABELS) as BlockKind[]).map((kind) => (
              <Chip
                key={kind}
                label={BLOCK_LABELS[kind]}
                selected={block.kind === kind}
                onPress={() => onKind(kind)}
              />
            ))}
          </View>
          {/*
            Disabled at the ends rather than hidden, so the control count does
            not change as a block moves and shove everything sideways.
          */}
          <IconButton
            icon={ChevronUp}
            tone="muted"
            surface={false}
            accessibilityLabel="Move up"
            disabled={first}
            onPress={() => onMove(-1)}
          />
          <IconButton
            icon={ChevronDown}
            tone="muted"
            surface={false}
            accessibilityLabel="Move down"
            disabled={last}
            onPress={() => onMove(1)}
          />
          <IconButton
            icon={Trash2}
            tone="destructive"
            surface={false}
            accessibilityLabel="Remove this block"
            onPress={onRemove}
          />
        </View>

        <Field
          value={block.text}
          onChangeText={onText}
          // On blur, like every long-lived field in this app: a write per
          // keystroke is a write per keystroke on one bar of signal.
          onBlur={onCommit}
          placeholder={
            block.kind === "heading"
              ? "Section heading"
              : block.kind === "bullet"
                ? "One point"
                : "Write here"
          }
          multiline
          rows={block.kind === "heading" ? 1 : 3}
        />
      </View>
    </Card>
  );
}
