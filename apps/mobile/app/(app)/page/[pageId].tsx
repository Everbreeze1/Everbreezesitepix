import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPage, savePage, setPageShare } from "@/api/pages";
import { isShareLive, openShareSheet, publicUrl } from "@/api/sharing";
import {
  appendBlocks,
  appendHtml,
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
import { ChevronDown, ChevronUp, Library, Link2, Plus, TriangleAlert, Trash2 } from "@/ui/icons";
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
  SnippetSheet,
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
  const [snippetsOpen, setSnippetsOpen] = useState(false);

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

  /**
   * Add a snippet's markup straight to the end of the page.
   *
   * Saved immediately rather than staged in the composer, because the composer
   * holds plain blocks and this is markup that could not survive being turned
   * into one. `appendHtml` never reads the existing page, so this is exactly as
   * safe as appending typed text.
   */
  const appendSnippetHtml = useCallback(
    (html: string) => {
      if (!page) return;
      save.mutate({ contentHtml: appendHtml(page.content_html, html) });
    },
    [page, save],
  );

  /**
   * Turn this document's public link on or off.
   *
   * The token is minted once and kept, so switching sharing back on restores the
   * SAME URL rather than invalidating one already sent to a client. That is why
   * this toggles rather than mints, and why turning it off says the link stops
   * working rather than that it has been deleted.
   */
  const share = useMutation({
    mutationFn: (enable: boolean) => setPageShare(pageId!, enable),
    onSuccess: async (token, enable) => {
      void queryClient.invalidateQueries({ queryKey });
      setFailure(null);
      if (!enable) return;
      const url = publicUrl("pages", token);
      if (!url) {
        setFailure("Sharing is not set up for this workspace, so there is no link to send.");
        return;
      }
      await openShareSheet(url, title || "Document");
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not change the link."),
  });

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
        {/*
          Sharing sits above the composer because it is about the document as it
          stands, not about what is being added to it. A live link is stated
          plainly: the page is on the open internet with no login in front of it.
        */}
        <SectionHeader title="Share" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          {isShareLive(page.share_token, page.revoked_at) ? (
            <>
              <Badge label="Link is live" tone="warning" icon={Link2} variant="soft" />
              <Text variant="caption" tone="muted">
                Anyone holding the link can read this document without signing in.
              </Text>
              <ButtonRow>
                <Button
                  label="Send the link"
                  icon={Link2}
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    const url = publicUrl("pages", page.share_token);
                    if (url) void openShareSheet(url, title || "Document");
                  }}
                />
                <Button
                  label="Stop sharing"
                  variant="secondary"
                  size="sm"
                  disabled={share.isPending}
                  onPress={() => share.mutate(false)}
                />
              </ButtonRow>
            </>
          ) : (
            <>
              <Text variant="caption" tone="muted">
                {/*
                  Said before the tap. The same token comes back if sharing is
                  turned on again later, which is why stopping is safe but is
                  not the same as never having shared.
                */}
                Creating a link puts this document on the open internet for anyone holding it.
              </Text>
              <Button
                label={share.isPending ? "Creating" : "Share a link"}
                icon={Link2}
                variant="secondary"
                fullWidth
                disabled={share.isPending}
                onPress={() => share.mutate(true)}
              />
            </>
          )}
        </View>

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
            {/*
              The library is worth more here than it is on the web. Retyping a
              standing safety note is tedious on a keyboard and genuinely
              expensive on a phone, standing on a job in gloves.
            */}
            <Button
              label="Snippets"
              icon={Library}
              variant="secondary"
              size="sm"
              onPress={() => setSnippetsOpen(true)}
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

      <SnippetSheet
        visible={snippetsOpen}
        onClose={() => setSnippetsOpen(false)}
        // Loaded into the composer rather than saved, so it can be edited
        // before it goes in. That is most of the value of a snippet: it is a
        // starting point, not a stamp.
        onInsertBlocks={(inserted) => setDraft((cur) => [...cur, ...inserted])}
        onInsertHtml={appendSnippetHtml}
        // Only offered when there is something to save. Serialised from the
        // composer, so what gets stored is what is on screen.
        saveableHtml={
          meaningfulBlocks(draft).length > 0 ? serialiseBlocks(meaningfulBlocks(draft)) : undefined
        }
      />
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
