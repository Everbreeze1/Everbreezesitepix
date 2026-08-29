import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import { createPage, deletePage, listDocumentTree, type DocumentPage } from "@/api/pages";
import { spacing } from "@/theme";
import { FileText, Paperclip, Plus, Trash2 } from "@/ui/icons";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * A project's documents.
 *
 * Pages are editable here, to the extent the block model allows (see
 * `doc-blocks.ts`). Uploaded files are listed but not opened: they are PDFs and
 * spreadsheets, and a viewer for them is a separate piece of work. Listing them
 * anyway matters, because a document list that silently omits half the
 * documents is worse than one that says "6 files, open them on the web".
 */
export default function ProjectDocumentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const queryKey = useMemo(() => ["document-tree", id], [id]);

  const query = useQuery({
    queryKey,
    queryFn: () => listDocumentTree(id!),
    enabled: Boolean(id),
  });

  const tree = query.data;
  const pages = tree?.pages ?? [];
  const files = tree?.files ?? [];

  /**
   * Folder name by id, so a page can say where it lives without a second read.
   *
   * The `?? []` lives inside the memo rather than above it: a fresh array
   * literal per render changes the memo's dependency identity every time, which
   * rebuilds the map on every keystroke anywhere on the screen.
   */
  const folderName = useMemo(() => {
    const map = new Map<string, string>();
    for (const folder of query.data?.folders ?? []) map.set(folder.id, folder.name);
    return map;
  }, [query.data]);

  const create = useMutation({
    // Blank, deliberately. The seeded document templates produce HTML full of
    // tables, images and styled spans, which the phone editor correctly refuses
    // to touch: making one here would create a page that is read-only the
    // moment it exists.
    mutationFn: () => createPage({ projectId: id!, template: "blank" }),
    onSuccess: (page) => {
      void queryClient.invalidateQueries({ queryKey });
      router.push({ pathname: "/page/[pageId]", params: { pageId: page.id } });
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not create that page."),
  });

  const remove = useMutation({
    mutationFn: (pageId: string) => deletePage(pageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not delete that page."),
  });

  const confirmDelete = useCallback(
    (page: DocumentPage) => {
      Alert.alert(`Delete "${page.title}"?`, "This cannot be undone.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => remove.mutate(page.id) },
      ]);
    },
    [remove],
  );

  return (
    <>
      <Stack.Screen options={{ title: "Documents" }} />

      <Screen
        scroll
        padded={false}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        bottomInset={spacing.xxl}
      >
        {query.isLoading ? (
          <SkeletonList rows={5} />
        ) : query.error ? (
          <ErrorState
            title="Could not load documents"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
            {failure ? (
              <Text variant="caption" tone="destructive">
                {failure}
              </Text>
            ) : null}

            {pages.length === 0 && files.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No documents yet"
                body="A page is the write-up that stays with the job: a method statement, a handover note, a running site diary you add to as you go."
                action={{ label: "New page", onPress: () => create.mutate(), icon: Plus }}
              />
            ) : (
              <>
                {pages.length > 0 ? (
                  <ListGroup>
                    {pages.map((page, index) => (
                      <View key={page.id}>
                        {index > 0 ? <RowDivider /> : null}
                        <ListRow
                          icon={FileText}
                          title={page.title}
                          subtitle={[
                            page.folder_id ? folderName.get(page.folder_id) : null,
                            relativeTime(page.updated_at),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          right={
                            <IconButton
                              icon={Trash2}
                              tone="destructive"
                              surface={false}
                              accessibilityLabel={`Delete ${page.title}`}
                              onPress={() => confirmDelete(page)}
                            />
                          }
                          onPress={() =>
                            router.push({ pathname: "/page/[pageId]", params: { pageId: page.id } })
                          }
                        />
                      </View>
                    ))}
                  </ListGroup>
                ) : null}

                <Button
                  label="New page"
                  icon={Plus}
                  variant="secondary"
                  fullWidth
                  disabled={create.isPending}
                  onPress={() => create.mutate()}
                />
              </>
            )}

            {files.length > 0 ? (
              <>
                <SectionHeader title={`Files (${files.length})`} />
                {/*
                  Listed, not opened. These are PDFs and spreadsheets and a
                  viewer is separate work, but omitting them would make this
                  screen quietly disagree with the web about what is on the job.
                */}
                <ListGroup>
                  {files.map((file, index) => (
                    <View key={file.id}>
                      {index > 0 ? <RowDivider /> : null}
                      <ListRow
                        icon={Paperclip}
                        iconTone="muted"
                        title={file.file_name}
                        subtitle={relativeTime(file.created_at)}
                        right={<Badge label="Web" tone="neutral" variant="outline" />}
                      />
                    </View>
                  ))}
                </ListGroup>
                <Text variant="caption" tone="muted">
                  Uploaded files open on the web for now.
                </Text>
              </>
            ) : null}
          </View>
        )}
      </Screen>
    </>
  );
}
