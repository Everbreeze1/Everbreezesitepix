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

export type DocumentFolder = { id: string; name: string; created_at: string };

export type DocumentPage = {
  id: string;
  folder_id: string | null;
  title: string;
  updated_at: string;
  source_template: string | null;
};

export type DocumentFile = {
  id: string;
  folder_id: string | null;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
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

export async function getPage(pageId: string): Promise<PageDetail> {
  const result = await api.rpc<PageDetail>("getProjectPage", { pageId });
  if (!result?.id) throw new Error("Page not found");
  return result;
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
  const result = await api.rpc<{ id?: string; pageId?: string }>("createProjectPage", {
    projectId: args.projectId,
    ...(args.title ? { title: args.title } : {}),
    template: args.template ?? "blank",
  });
  const id = result?.id ?? result?.pageId;
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
