import { useCallback, useMemo, useState } from "react";
import { ActionRail } from "@/components/ActionRail";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
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
  type DocumentFile,
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
import { ProjectSubPageHeader } from "@/components/ProjectSubPageHeader";
import { TemplatePickerSheet } from "@/ui/TemplatePickerSheet";
import { spacing, useTheme } from "@/theme";
import {
  Copy,
  FileText,
  FolderInput,
  FolderPlus,
  Folders,
  LayoutTemplate,
  Paperclip,
  PenLine,
  Plus,
  RefreshCw,
  Trash2,
} from "@/ui/icons";
import {
  ActionSheet,
  Button,
  ButtonRow,
  Card,
  CardGrid,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  ItemCard,
  KebabButton,
  SkeletonList,
  StatusChip,
  Text,
  useCardPage,
  type SheetAction,
} from "@/ui";

/** Which kebab is open: the page's own, or one document's, file's or folder's. */
type MenuTarget =
  | { kind: "screen" }
  | { kind: "page"; page: DocumentPage }
  | { kind: "file"; file: DocumentFile }
  | { kind: "folder"; group: FolderGroup };

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
  const theme = useTheme();
  const { inset } = useCardPage();
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const queryKey = useMemo(() => ["document-tree", id], [id]);
  const [templatePicker, setTemplatePicker] = useState(false);

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
  /*
   * Memoised on the tree so `?? []` does not mint a new array each render and
   * rebuild the grouping below on every keystroke in a folder name field.
   */
  const pages = useMemo(() => tree?.pages ?? [], [tree]);
  const files = useMemo(() => tree?.files ?? [], [tree]);
  const folders = useMemo(() => tree?.folders ?? [], [tree]);

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

  const summary =
    pages.length + files.length === 0
      ? null
      : [
          `${pages.length} page${pages.length === 1 ? "" : "s"}`,
          files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"}` : null,
          folders.length > 0 ? `${folders.length} folder${folders.length === 1 ? "" : "s"}` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  const openPage = (pageId: string) =>
    router.push({ pathname: "/page/[pageId]", params: { pageId } });

  /** The sheet behind whichever kebab was tapped: the page's, a file's or a folder's. */
  const menuActions: SheetAction[] =
    menu?.kind === "page"
      ? [
          {
            label: "Move to a folder",
            icon: FolderInput,
            onPress: () => promptMove("page", menu.page.id, menu.page.folderId, menu.page.title),
          },
          { label: "Make a copy", icon: Copy, onPress: () => confirmDuplicate(menu.page) },
          {
            label: "Delete this page",
            icon: Trash2,
            destructive: true,
            onPress: () => confirmDelete(menu.page),
          },
        ]
      : menu?.kind === "file"
        ? [
            {
              label: "Move to a folder",
              icon: FolderInput,
              onPress: () =>
                promptMove("file", menu.file.id, menu.file.folderId, menu.file.fileName),
            },
          ]
        : menu?.kind === "folder"
          ? [
              {
                label: "Rename",
                icon: PenLine,
                onPress: () => startRename(menu.group.id!, menu.group.name),
              },
              {
                label: "Delete folder",
                icon: Trash2,
                destructive: true,
                onPress: () => confirmDeleteFolder(menu.group),
              },
            ]
          : [
              {
                label: "Start from a template",
                icon: LayoutTemplate,
                onPress: () => setTemplatePicker(true),
              },
              { label: "New folder", icon: FolderPlus, onPress: startNewFolder },
              { label: "Refresh", icon: RefreshCw, onPress: () => void query.refetch() },
            ];

  const menuTitle =
    menu?.kind === "page"
      ? titleWithinProject(menu.page.title, projectQuery.data?.name)
      : menu?.kind === "file"
        ? menu.file.fileName
        : menu?.kind === "folder"
          ? menu.group.name
          : "Documents";

  return (
    <>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ProjectSubPageHeader
          projectId={id}
          title="Documents"
          summary={summary}
          actions={<KebabButton onPress={() => setMenu({ kind: "screen" })} />}
        />

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: inset,
            paddingTop: spacing.lg,
            // Room for the floating New page button.
            paddingBottom: 120,
            gap: spacing.md,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
              tintColor={theme.colors.mutedForeground}
              colors={[theme.colors.primary]}
            />
          }
        >
          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}

          {/*
            Making a folder opens a field here, at the top where the kebab that
            asked for it is, rather than under a list it would scroll away with.
          */}
          {newFolder !== null ? (
            <Card>
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
            </Card>
          ) : null}

          {query.isLoading ? (
            <SkeletonList rows={5} />
          ) : query.error ? (
            <ErrorState
              title="Could not load documents"
              message={query.error instanceof Error ? query.error.message : undefined}
              onRetry={() => void query.refetch()}
            />
          ) : pages.length === 0 && files.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents yet"
              body="A page is the write-up that stays with the job: a method statement, a handover note, a running site diary you add to as you go."
              action={{ label: "New page", onPress: () => create.mutate(), icon: Plus }}
              secondaryAction={{
                label: "Start from a template",
                onPress: () => setTemplatePicker(true),
              }}
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
                      <Card>
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
                      </Card>
                    ) : (
                      <FolderHeading
                        name={group.name}
                        count={groupCount(group)}
                        onMenu={() => setMenu({ kind: "folder", group })}
                      />
                    )
                  ) : groups.length > 1 ? (
                    <FolderHeading name={group.name} count={groupCount(group)} />
                  ) : null}

                  {group.pages.length === 0 && group.files.length === 0 ? (
                    <Text variant="caption" tone="muted">
                      Empty
                    </Text>
                  ) : (
                    <CardGrid>
                      {group.pages.map((page) => (
                        <ItemCard
                          key={page.id}
                          icon={FileText}
                          /*
                           * Names share a long project prefix, so the half a
                           * narrow title truncates is the half that identifies
                           * them. `titleWithinProject` drops the prefix.
                           */
                          title={titleWithinProject(page.title, projectQuery.data?.name)}
                          meta={`Edited ${relativeTime(page.updatedAt)}`}
                          onPress={() => openPage(page.id)}
                          onMenu={() => setMenu({ kind: "page", page })}
                          menuLabel={`More actions for ${page.title}`}
                        />
                      ))}
                      {group.files.map((file) => (
                        <ItemCard
                          key={file.id}
                          icon={Paperclip}
                          iconTone="muted"
                          title={file.fileName}
                          meta={`Uploaded ${relativeTime(file.createdAt)}`}
                          /*
                            Listed, not opened. These are PDFs and spreadsheets
                            and a viewer is separate work, but omitting them
                            would make this screen quietly disagree with the
                            web about what is on the job.
                          */
                          status={<StatusChip label="Web" />}
                          onMenu={() => setMenu({ kind: "file", file })}
                          menuLabel={`More actions for ${file.fileName}`}
                        />
                      ))}
                    </CardGrid>
                  )}
                </View>
              ))}

              {files.length > 0 ? (
                <Text variant="caption" tone="muted">
                  Uploaded files open on the web for now.
                </Text>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>

      {/* Hidden while the empty state offers New page. */}
      {query.isLoading || pages.length + files.length === 0 ? null : (
        <ActionRail
          actions={[
            {
              key: "new-page",
              icon: Plus,
              label: "New page",
              disabled: create.isPending,
              onPress: () => create.mutate(),
            },
          ]}
        />
      )}

      <ActionSheet
        visible={menu !== null}
        onClose={() => setMenu(null)}
        title={menuTitle}
        actions={menuActions}
      />

      <TemplatePickerSheet
        visible={templatePicker}
        projectId={id!}
        onClose={() => setTemplatePicker(false)}
        onCreated={(page) => {
          setTemplatePicker(false);
          // The tree has a new row in it, and the person expects to land on the
          // document they just made rather than back at the list.
          void queryClient.invalidateQueries({ queryKey });
          router.push({ pathname: "/page/[pageId]", params: { pageId: page.id } });
        }}
      />
    </>
  );
}

/** A folder's name over its cards, with its own kebab for rename and delete. */
function FolderHeading({
  name,
  count,
  onMenu,
}: {
  name: string;
  count: number;
  onMenu?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        marginTop: spacing.sm,
        minHeight: 32,
      }}
    >
      <Icon icon={Folders} size="sm" tone="muted" />
      <Text variant="overline" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
        {name.toUpperCase()}
      </Text>
      {count > 0 ? (
        <Text variant="overline" tone="muted">
          {count}
        </Text>
      ) : null}
      <View style={{ flex: 1 }} />
      {onMenu ? (
        <KebabButton
          accessibilityLabel={`Folder actions for ${name}`}
          onPress={onMenu}
          surface={false}
        />
      ) : null}
    </View>
  );
}
