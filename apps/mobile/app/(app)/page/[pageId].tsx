import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readableErrorMessage } from "@everlumen/shared";
import { View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { exportPagePdf, getPage, savePage, setPageShare } from "@/api/pages";
import { isShareLive, openShareSheet, publicUrl } from "@/api/sharing";
import { serialiseBlocks } from "@/api/doc-blocks";
import { docHtml, parseDoc, type DocBlock } from "@/api/rich-doc";
import { FormattedTextEditor } from "@/components/FormattedTextEditor";
import { spacing } from "@/theme";
import { FileText, Library, Link2, Save, TriangleAlert } from "@/ui/icons";
import {
  Badge,
  Button,
  ButtonRow,
  ErrorState,
  Field,
  Screen,
  SectionHeader,
  SkeletonList,
  SnippetSheet,
  Text,
} from "@/ui";

/**
 * One project page.
 *
 * The body is edited in place with `FormattedTextEditor`, in the web's own
 * storage format: the HTML its TipTap editor writes. Headings, lists, bold,
 * italic and links are edited here; tables, photos, checklists and anything
 * else the phone cannot draw are locked blocks that are written back exactly as
 * they were (see `rich-doc.ts`). So a page made from a rich template is
 * editable on the phone, and saving it cannot lose the parts that are not.
 *
 * Saving always sends `expectedUpdatedAt`, and takes the new one from the
 * answer for the next save. Without it two people editing one page means the
 * second save silently overwrites the first.
 */
export default function PageScreen() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<DocBlock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  /** The HTML last loaded or saved: a save is only sent when the body differs. */
  const savedHtml = useRef("");
  /** The title last loaded or saved. */
  const savedTitle = useRef("");
  /** The `updated_at` the next save must match. */
  const version = useRef<string | null>(null);
  /** A save was asked for while one was in flight: run it once that lands. */
  const again = useRef(false);

  const queryKey = useMemo(() => ["project-page", pageId], [pageId]);

  const query = useQuery({
    queryKey,
    queryFn: () => getPage(pageId!),
    enabled: Boolean(pageId),
  });
  const page = query.data ?? null;

  /*
   * Seed once. Re-seeding on a background refetch would throw away whatever is
   * half-typed, which on a phone happens every time the app returns to the
   * foreground.
   */
  useEffect(() => {
    if (loaded || !page) return;
    const parsed = parseDoc(page.content_html);
    setTitle(page.title);
    setBlocks(parsed);
    // Compared in the phone's own serialisation, so opening a page and leaving
    // it untouched never writes it back.
    savedHtml.current = docHtml(parsed);
    savedTitle.current = page.title;
    version.current = page.updated_at;
    setLoaded(true);
  }, [page, loaded]);

  const save = useMutation({
    mutationFn: (args: { title?: string; contentHtml?: string }) =>
      savePage({
        pageId: pageId!,
        // A rejection means somebody else has changed the page since, which is
        // information rather than an error.
        expectedUpdatedAt: version.current ?? page!.updated_at,
        ...args,
      }),
    onSuccess: (result, args) => {
      if (result.updatedAt) version.current = result.updatedAt;
      if (args.contentHtml !== undefined) savedHtml.current = args.contentHtml;
      if (args.title !== undefined) savedTitle.current = args.title;
      void queryClient.invalidateQueries({ queryKey });
      setFailure(null);
      if (again.current) {
        again.current = false;
        // After this render, so it reads the latest text and the new version.
        setTimeout(() => commitRef.current(), 0);
      }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "That did not save.";
      setFailure(
        /conflict|modified|stale|updated|changed by someone/i.test(message)
          ? "Somebody else changed this page while you had it open. Pull down to load their version, then make your change again."
          : message,
      );
    },
  });

  /**
   * Write back whatever differs from what was last saved, title and body in one
   * call. One at a time: two saves in flight would each carry the same version
   * token, and the second would be refused as somebody else's change.
   */
  const commit = useCallback(() => {
    if (!loaded) return;
    if (save.isPending) {
      again.current = true;
      return;
    }
    const args: { title?: string; contentHtml?: string } = {};
    const html = docHtml(blocks);
    if (html !== savedHtml.current) args.contentHtml = html;
    const trimmed = title.trim();
    if (trimmed && trimmed !== savedTitle.current) args.title = trimmed;
    if (args.title === undefined && args.contentHtml === undefined) return;
    save.mutate(args);
  }, [blocks, loaded, save, title]);

  // Leaving the screen saves, so a change made only with the toolbar (which
  // never blurs a field) is not lost to the back button.
  const commitRef = useRef<() => void>(() => {});
  commitRef.current = commit;
  useFocusEffect(useCallback(() => () => commitRef.current(), []));

  const dirty =
    loaded &&
    (docHtml(blocks) !== savedHtml.current ||
      (title.trim() !== "" && title.trim() !== savedTitle.current));
  const lockedParts = useMemo(() => blocks.some((b) => b.kind === "raw"), [blocks]);

  /** A snippet goes in at the end as its HTML; anything uneditable stays locked. */
  const insertSnippetHtml = useCallback((html: string) => {
    setBlocks((cur) => [...cur, ...parseDoc(html)]);
  }, []);

  /**
   * Turn this document's public link on or off.
   *
   * The token is minted once and kept, so switching sharing back on restores the
   * SAME URL rather than invalidating one already sent to a client. That is why
   * this toggles rather than mints, and why turning it off says the link stops
   * working rather than that it has been deleted.
   */
  const exportPdf = useMutation({
    mutationFn: async () => {
      const page = query.data;
      if (!page) throw new Error("The document is still loading");
      return exportPagePdf({ pageId: page.id, projectId: page.project_id });
    },
    onSuccess: async (result) => {
      // The export files itself into this project's Documents, so the tree has
      // to be refetched or the new file is not there until the person leaves
      // the project and comes back.
      const project = query.data?.project_id;
      if (project) await queryClient.invalidateQueries({ queryKey: ["document-tree", project] });
      await WebBrowser.openBrowserAsync(result.url);
    },
  });

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
      {/*
        "Page", not the record's own name: it is already in the Title field
        below, the nav bar truncates it to a prefix that identifies nothing, and
        reading the live field state renamed the screen on every keystroke. The
        loading and error states above always said "Page"; only this one
        disagreed.
      */}
      <Stack.Screen options={{ title: "Page" }} />

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
            onBlur={commit}
            returnKeyType="done"
          />

          {failure ? (
            <Badge label={failure} tone="danger" variant="soft" icon={TriangleAlert} />
          ) : null}
        </View>

        <SectionHeader title="Page" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {lockedParts ? (
            // Said once, above the document, as well as on each locked card.
            <Text variant="caption" tone="muted">
              Tables, photos and other parts made on the web are locked here and kept exactly as
              they are. Everything else can be edited.
            </Text>
          ) : null}

          <FormattedTextEditor
            blocks={blocks}
            onChange={setBlocks}
            onCommit={commit}
            placeholder="Start writing"
          />

          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Button
              label="Snippets"
              icon={Library}
              variant="secondary"
              size="sm"
              onPress={() => setSnippetsOpen(true)}
            />
            <Text variant="caption" tone="muted" style={{ flex: 1, textAlign: "right" }}>
              {save.isPending ? "Saving" : dirty ? "Not saved yet" : "Saved"}
            </Text>
            {/* The primary action sits on the right, on a phone and a tablet alike. */}
            <Button
              label="Save"
              icon={Save}
              size="sm"
              disabled={save.isPending || !dirty}
              onPress={commit}
            />
          </View>
        </View>

        {/*
          Export and sharing are about the document as it stands. A live link is
          stated plainly: the page is on the open internet with no login in front
          of it.
        */}
        <SectionHeader title="Export" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <Button
            label={exportPdf.isPending ? "Building the PDF" : "Export as PDF"}
            icon={FileText}
            variant="secondary"
            fullWidth
            disabled={exportPdf.isPending}
            onPress={() => exportPdf.mutate()}
          />
          <Text variant="caption" tone="muted">
            {/*
              Includes the locked parts the phone cannot edit, which is the
              point: the document a technician hands somebody on site is the
              whole of it.
            */}
            Saved into this job's Documents, then opened. A phone has no downloads folder, so filing
            it is what makes it findable later.
          </Text>
          {exportPdf.error ? (
            <Text variant="caption" tone="destructive">
              {exportPdf.error instanceof Error
                ? readableErrorMessage(exportPdf.error, "Could not export this page as a PDF.")
                : "Could not export this document."}
            </Text>
          ) : null}
        </View>

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
      </Screen>

      <SnippetSheet
        visible={snippetsOpen}
        onClose={() => setSnippetsOpen(false)}
        insertsFormatted
        onInsertBlocks={(inserted) => insertSnippetHtml(serialiseBlocks(inserted))}
        onInsertHtml={insertSnippetHtml}
        // The whole body, in the web's format, so a standing note written here
        // can be saved for next time.
        saveableHtml={docHtml(blocks) || undefined}
      />
    </>
  );
}
