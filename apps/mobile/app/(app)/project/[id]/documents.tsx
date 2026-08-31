import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime, titleWithinProject } from "@everlumen/shared";
import {
  createDocumentFolder,
  createPage,
  deleteDocumentFolder,
  deletePage,
  duplicatePage,
  listDocumentTree,
  moveDocument,
  renameDocumentFolder,
  type DocumentFolder,
  type DocumentPage,
} from "@/api/pages";
import { getProject } from "@/api/projects";
import {
  deleteFolderWarning,
  duplicateNotice,
  folderNameError,
  groupByFolder,
  groupCount,
  moveTargets,
  type FolderGroup,
} from "@/api/folders-view";
import { spacing } from "@/theme";
import {
  Copy,
  FileText,
  FolderInput,
  FolderPlus,
  Paperclip,
  PenLine,
  Plus,
  Trash2,
} from "@/ui/icons";
import {
  Badge,
  Button,
  ButtonRow,
  EmptyState,
  ErrorState,
  Field,
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

  /*
   * The job's name, only so the rows can stop repeating it.
   *
   * Pages here are auto-named after the project, so the list rendered as five
   * identical "20 Charlcote Crescent - Site visit ..." rows with the part that
   * tells them apart truncated away. Cheap: the project screen has already
   * fetched this, so it is a cache read rather than a request.
   */
  const projectQuery = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id!),
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

  const folders = tree?.folders ?? [];

  /**
   * Documents arranged under their folders.
   *
   * The rule lives in `folders-view.ts` and is tested there: the top level
   * always exists, an empty folder is still shown, and a document whose folder
   * has been deleted falls back to the top rather than vanishing from a screen
   * that is the only place it could be filed again.
   */
  const groups = useMemo(() => groupByFolder(folders, pages, files), [folders, pages, files]);

  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<{ id: string; name: string } | null>(null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey });
  }

  const addFolder = useMutation({
    mutationFn: (name: string) => createDocumentFolder(id!, name),
    onSuccess: () => {
      setNewFolder(null);
      setFailure(null);
      refresh();
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not make that folder."),
  });

  const renameFolder = useMutation({
    mutationFn: (args: { folderId: string; name: string }) =>
      renameDocumentFolder(args.folderId, args.name),
    onSuccess: refresh,
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not rename that folder."),
  });

  const removeFolder = useMutation({
    mutationFn: (folderId: string) => deleteDocumentFolder(folderId),
    onSuccess: refresh,
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not delete that folder."),
  });

  const move = useMutation({
    mutationFn: (args: { kind: "page" | "file"; id: string; folderId: string | null }) =>
      moveDocument(args.kind, args.id, args.folderId),
    onSuccess: refresh,
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not move that document."),
  });

  const startNewFolder = useCallback(() => {
    setFailure(null);
    setNewFolder("");
  }, []);

  const saveNewFolder = useCallback(() => {
    const name = newFolder ?? "";
    // Duplicate names are refused here and not by the server: there is no
    // unique constraint, so two folders called "Certificates" is legal and
    // impossible to work with.
    const bad = folderNameError(name, folders);
    if (bad) {
      setFailure(bad);
      return;
    }
    addFolder.mutate(name);
  }, [newFolder, folders, addFolder]);

  /*
   * Renaming is an inline field, not `Alert.prompt`.
   *
   * `Alert.prompt` is iOS-only: on Android it is undefined, so the optional
   * call would silently do nothing and the button would look broken on the
   * platform this app is mostly tested on. The repo already refuses native
   * dialogs on the web for a related reason, and it applies harder here.
   */
  const startRename = useCallback((folderId: string, name: string) => {
    setFailure(null);
    setEditingFolder({ id: folderId, name });
  }, []);

  const saveRename = useCallback(() => {
    if (!editingFolder) return;
    const bad = folderNameError(
      editingFolder.name,
      folders.filter((f) => f.id !== editingFolder.id),
    );
    if (bad) {
      setFailure(bad);
      return;
    }
    renameFolder.mutate({ folderId: editingFolder.id, name: editingFolder.name });
    setEditingFolder(null);
  }, [editingFolder, folders, renameFolder]);

  const confirmDeleteFolder = useCallback(
    (group: FolderGroup) => {
      Alert.alert("Delete folder", deleteFolderWarning(group), [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => group.id && removeFolder.mutate(group.id),
        },
      ]);
    },
    [removeFolder],
  );

  /** Offer the folders this document is not already in, plus the top level. */
  const promptMove = useCallback(
    (kind: "page" | "file", docId: string, currentFolderId: string | null, title: string) => {
      const targets = moveTargets(folders, currentFolderId);
      if (targets.length === 0) {
        setFailure("Make a folder first, then you can file documents into it.");
        return;
      }
      Alert.alert(`Move "${title}"`, undefined, [
        ...targets.map((target) => ({
          text: target.name,
          onPress: () => move.mutate({ kind, id: docId, folderId: target.id }),
        })),
        { text: "Cancel", style: "cancel" as const },
      ]);
    },
    [folders, move],
  );

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

  /**
   * Copy a document.
   *
   * The phone's answer to "start today's log from yesterday's". A copy rather
   * than a template instantiation, because a page made from a seeded template
   * is read-only here the moment it exists - whereas a copy is editable exactly
   * as far as its original was.
   */
  const duplicate = useMutation({
    mutationFn: (pageId: string) => duplicatePage(pageId),
    onSuccess: (page) => {
      void queryClient.invalidateQueries({ queryKey });
      router.push({ pathname: "/page/[pageId]", params: { pageId: page.id } });
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not copy that page."),
  });

  const confirmDuplicate = useCallback(
    (page: DocumentPage) => {
      Alert.alert(
        `Copy "${page.title}"?`,
        // Both halves are things people assume wrongly: a copy of a shared
        // document is not shared, and a copy of a report is not a report.
        duplicateNotice(false, page.bucket === "report"),
        [
          { text: "Cancel", style: "cancel" },
          { text: "Make a copy", onPress: () => duplicate.mutate(page.id) },
        ],
      );
    },
    [duplicate],
  );

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
                {/*
                  Grouped by folder rather than one flat list.

                  `groupByFolder` decides the arrangement and is tested in
                  `folders-view.ts`: the top level always exists, an empty
                  folder still shows (otherwise making one looks like it
                  failed), and a document whose folder was deleted falls back to
                  the top rather than disappearing off the only screen it could
                  be filed from again.
                */}
                {groups.map((group) => (
                  <View key={group.id ?? "top"} style={{ gap: spacing.sm }}>
                    {group.id ? (
                      editingFolder?.id === group.id ? (
                        <View style={{ gap: spacing.sm }}>
                          <Field
                            label="Folder name"
                            value={editingFolder.name}
                            onChangeText={(name) =>
                              setEditingFolder((cur) => (cur ? { ...cur, name } : cur))
                            }
                          />
                          <ButtonRow>
                            <Button
                              label="Cancel"
                              variant="secondary"
                              size="sm"
                              onPress={() => setEditingFolder(null)}
                            />
                            <Button label="Save" size="sm" onPress={saveRename} />
                          </ButtonRow>
                        </View>
                      ) : (
                        <View
                          style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
                        >
                          <SectionHeader
                            title={group.name}
                            count={groupCount(group) || undefined}
                          />
                          <View style={{ flex: 1 }} />
                          <IconButton
                            icon={PenLine}
                            surface={false}
                            size="sm"
                            accessibilityLabel={`Rename ${group.name}`}
                            onPress={() => startRename(group.id!, group.name)}
                          />
                          <IconButton
                            icon={Trash2}
                            tone="destructive"
                            surface={false}
                            size="sm"
                            accessibilityLabel={`Delete ${group.name}`}
                            onPress={() => confirmDeleteFolder(group)}
                          />
                        </View>
                      )
                    ) : groups.length > 1 ? (
                      <SectionHeader title={group.name} count={groupCount(group) || undefined} />
                    ) : null}

                    {group.pages.length === 0 && group.files.length === 0 ? (
                      <Text variant="caption" tone="muted">
                        Empty
                      </Text>
                    ) : (
                      <ListGroup>
                        {group.pages.map((page, index) => (
                          <View key={page.id}>
                            {index > 0 ? <RowDivider /> : null}
                            <ListRow
                              icon={FileText}
                              title={titleWithinProject(page.title, projectQuery.data?.name)}
                              subtitle={relativeTime(page.updatedAt)}
                              right={
                                <View style={{ flexDirection: "row", alignItems: "center" }}>
                                  <IconButton
                                    icon={FolderInput}
                                    surface={false}
                                    accessibilityLabel={`Move ${page.title}`}
                                    onPress={() =>
                                      promptMove("page", page.id, page.folderId, page.title)
                                    }
                                  />
                                  <IconButton
                                    icon={Copy}
                                    surface={false}
                                    accessibilityLabel={`Copy ${page.title}`}
                                    onPress={() => confirmDuplicate(page)}
                                  />
                                  <IconButton
                                    icon={Trash2}
                                    tone="destructive"
                                    surface={false}
                                    accessibilityLabel={`Delete ${page.title}`}
                                    onPress={() => confirmDelete(page)}
                                  />
                                </View>
                              }
                              onPress={() =>
                                router.push({
                                  pathname: "/page/[pageId]",
                                  params: { pageId: page.id },
                                })
                              }
                            />
                          </View>
                        ))}

                        {group.files.map((file, index) => (
                          <View key={file.id}>
                            {index > 0 || group.pages.length > 0 ? <RowDivider /> : null}
                            <ListRow
                              icon={Paperclip}
                              title={file.fileName}
                              subtitle={relativeTime(file.createdAt)}
                              right={
                                <IconButton
                                  icon={FolderInput}
                                  surface={false}
                                  accessibilityLabel={`Move ${file.fileName}`}
                                  onPress={() =>
                                    promptMove("file", file.id, file.folderId, file.fileName)
                                  }
                                />
                              }
                            />
                          </View>
                        ))}
                      </ListGroup>
                    )}
                  </View>
                ))}

                {newFolder !== null ? (
                  <View style={{ gap: spacing.sm }}>
                    <Field
                      label="New folder"
                      value={newFolder}
                      onChangeText={setNewFolder}
                      placeholder="Certificates"
                    />
                    <ButtonRow>
                      <Button
                        label="Cancel"
                        variant="secondary"
                        size="sm"
                        onPress={() => setNewFolder(null)}
                      />
                      <Button
                        label={addFolder.isPending ? "Making" : "Make folder"}
                        size="sm"
                        disabled={addFolder.isPending}
                        onPress={saveNewFolder}
                      />
                    </ButtonRow>
                  </View>
                ) : (
                  <Button
                    label="New folder"
                    icon={FolderPlus}
                    variant="secondary"
                    fullWidth
                    onPress={startNewFolder}
                  />
                )}

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
                        title={file.fileName}
                        subtitle={relativeTime(file.createdAt)}
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
