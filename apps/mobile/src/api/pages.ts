import { api } from "@/lib/api";

/**
 * Project pages: the documents on a job.
 *
 * All through `/v1/rpc`. `listProjectDocumentTree` assembles folders, pages and
 * uploaded files in one call and resolves which template each page came from;
 * `createProjectPage` reads the project's name and address to fill the heading
 * of a new page. Neither is a client query.
 *
 * The interesting part of this feature is not here, it is in `doc-blocks.ts`:
 * what the phone is allowed to do to a page written by the web editor.
 */

/*
 * The three tree shapes are camelCase, and the phone declared snake_case.
 *
 * `listProjectDocumentTree` does not return rows: it maps them, explicitly, to
 * `DocumentTreeFolder` / `DocumentTreePage` / `DocumentTreeFile`. Reading
 * `file.file_name` off that payload is `undefined`, not an error, so the
 * Documents tab drew every uploaded file with NO TITLE, and every page with a
 * blank timestamp and no folder name. It read as a styling fault.
 *
 * `PageDetail` below is deliberately NOT camelCase: `getProjectPage` really
 * does return the raw row. Two ops over the same table with two conventions is
 * the trap here, and converting both to match would have broken the editor.
 */
export type DocumentFolder = { id: string; name: string; createdAt: string };

export type DocumentPage = {
  id: string;
  kind: "page";
  folderId: string | null;
  title: string;
  updatedAt: string;
  /** The bare template uuid, with the server's `document_template:` prefix stripped. */
  sourceTemplateId: string | null;
  /** Which list this page files under. Resolved server-side. */
  bucket: string;
};

export type DocumentFile = {
  id: string;
  kind: "file";
  folderId: string | null;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

export type DocumentTree = {
  folders: DocumentFolder[];
  pages: DocumentPage[];
  files: DocumentFile[];
};

export type PageDetail = {
  id: string;
  project_id: string;
  folder_id: string | null;
  title: string;
  content_html: string;
  header_html: string | null;
  footer_html: string | null;
  share_token: string | null;
  revoked_at: string | null;
  updated_at: string;
  source_template: string | null;
};

export async function listDocumentTree(projectId: string): Promise<DocumentTree> {
  const result = await api.rpc<Partial<DocumentTree>>("listProjectDocumentTree", { projectId });
  return {
    folders: result?.folders ?? [],
    pages: result?.pages ?? [],
    files: result?.files ?? [],
  };
}

/**
 * One page.
 *
 * The op answers `{ page, tokens }`, not the row. Reading `result.id` gets
 * `undefined` and throws "Page not found" on every page that exists, which is
 * what it did until the response was checked against the service rather than
 * guessed at. `tokens` is the merge-token list the web editor uses and the
 * phone has no use for.
 */
export async function getPage(pageId: string): Promise<PageDetail> {
  const result = await api.rpc<{ page?: PageDetail }>("getProjectPage", { pageId });
  const page = result?.page;
  /*
   * Deliberately NOT the same wording the server uses.
   *
   * `getProjectPageService` throws "Page not found" when its own read misses,
   * and this used to throw the identical string when the response shape was
   * unexpected. Two different failures reading the same on screen means the
   * only way to tell them apart is to read both source files, which is exactly
   * what somebody debugging at 4pm on a site does not have.
   */
  if (!page?.id) throw new Error("The server answered, but with no page in it.");
  return page;
}

/**
 * A new page.
 *
 * `template` is the server's own small set (`daily_log`, `summary`, `blank`),
 * not the seeded document-template library. Those produce rich HTML the phone
 * cannot edit, so offering them here would create a page that is read-only the
 * moment it exists. `blank` is what a phone should make.
 */
export async function createPage(args: {
  projectId: string;
  title?: string;
  template?: "daily_log" | "summary" | "blank";
}): Promise<{ id: string }> {
  // `{ page: row }`, like `getProjectPage`. Not `{ id }`.
  const result = await api.rpc<{ page?: { id?: string } }>("createProjectPage", {
    projectId: args.projectId,
    ...(args.title ? { title: args.title } : {}),
    template: args.template ?? "blank",
  });
  const id = result?.page?.id;
  if (!id) throw new Error("The page was not created.");
  return { id };
}

/**
 * Save a page.
 *
 * `expectedUpdatedAt` is optimistic concurrency and is not optional in
 * practice: without it, two people editing one document means the second save
 * silently overwrites the first, with no error and no conflict. The server
 * comment on the op says exactly that. Always pass the `updated_at` the screen
 * loaded, and treat a rejection as "somebody else changed this" rather than as
 * a failure to retry.
 */
export async function savePage(args: {
  pageId: string;
  expectedUpdatedAt: string;
  title?: string;
  contentHtml?: string;
}): Promise<void> {
  await api.rpc("updateProjectPage", {
    pageId: args.pageId,
    expectedUpdatedAt: args.expectedUpdatedAt,
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.contentHtml !== undefined ? { contentHtml: args.contentHtml } : {}),
  });
}

export async function deletePage(pageId: string): Promise<void> {
  await api.rpc("deleteProjectPage", { pageId });
}

/**
 * Folders on a job's Documents tab.
 *
 * Four existing ops the phone never called. Nothing was hidden without them -
 * the tree returns every page and file whatever folder it sits in, and the
 * screen already prints the folder name - so this is reorganising rather than
 * access, which is why it came last.
 *
 * Not queued through the outbox. Filing is a tidying-up act done deliberately,
 * and a folder that silently appeared twenty minutes later when signal returned
 * would be a surprise rather than a service.
 */

export async function createDocumentFolder(
  projectId: string,
  name: string,
): Promise<DocumentFolder> {
  const result = await api.rpc<{ folder?: Record<string, unknown> }>("createDocumentFolder", {
    projectId,
    name: name.trim(),
  });
  /*
   * The one op in this group that answers with a ROW rather than a mapped
   * shape: `.select("id, project_id, name, created_at").single()`. So it is
   * snake_case where `listProjectDocumentTree` is camelCase, and normalising it
   * here is what stops a freshly made folder rendering differently from every
   * other one until the next refetch.
   */
  const row = (result.folder ?? {}) as { id?: string; name?: string; created_at?: string };
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? name.trim()),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export async function renameDocumentFolder(folderId: string, name: string): Promise<void> {
  await api.rpc("renameDocumentFolder", { folderId, name: name.trim() });
}

/**
 * Remove a folder.
 *
 * What happens to what was inside it is the database's business, not this
 * function's: the service deletes the folder row and nothing else. Whether the
 * pages come with it or fall back to the top level depends on
 * `project_pages.folder_id`, which this repo does not declare, so the screen
 * says the honest thing rather than promising either.
 */
export async function deleteDocumentFolder(folderId: string): Promise<void> {
  await api.rpc("deleteDocumentFolder", { folderId });
}

/** Move a page or an uploaded file. A null folder means the top level. */
export async function moveDocument(
  kind: "page" | "file",
  id: string,
  folderId: string | null,
): Promise<void> {
  await api.rpc("moveDocument", { kind, id, folderId });
}
