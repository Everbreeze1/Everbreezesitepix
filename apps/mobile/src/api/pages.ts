import { randomUUID } from "expo-crypto";
import { AI_TIMEOUT_MS } from "@everlumen/api-client";
import { api } from "@/lib/api";
import { fileGeneratedPdf } from "./pdf-export";

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

/**
 * Turn a document's public link on or off.
 *
 * The last of the shareable records to reach the phone, and the one that
 * mattered most once the whole-job report landed: that report IS a page, so
 * without this the hand-over document could be written from the van and not
 * sent from it.
 *
 * The token is minted when the page is created and never changes. Switching
 * sharing off stamps `revoked_at` rather than destroying it, so turning it back
 * on restores the SAME URL - a link already sent to a client keeps working
 * rather than silently becoming a 404 that nobody is told about.
 */
export async function setPageShare(pageId: string, enable: boolean): Promise<string | null> {
  const result = await api.rpc<{ shareToken?: string | null }>("setProjectPageShare", {
    pageId,
    enable,
  });
  return result?.shareToken ?? null;
}

/**
 * Copy a document, contents and all.
 *
 * The phone's answer to "start today's log from yesterday's", and deliberately
 * a copy rather than a template instantiation: creating a page from a seeded
 * template produces markup the phone editor refuses, so it would be read-only
 * the moment it existed. Copying a page that already exists sidesteps that
 * entirely - whatever the original was editable as, the copy is too.
 *
 * Two things the server does NOT carry over, both of which matter enough to say
 * on screen:
 *
 *   the share token   a copy of a shared document is not itself public, which
 *                     is the safe direction and the one people assume wrongly.
 *   `source_template` so a copy of a report is a plain document rather than a
 *                     second report filed under the Reports tab.
 *
 * The title is numbered against the project's existing ones by
 * `uniqueDocumentTitle`, so duplicating twice does not leave two rows both
 * called "Copy of X".
 */
export async function duplicatePage(pageId: string): Promise<DocumentPageSummary> {
  const result = await api.rpc<{ page?: { id: string; title: string; updated_at: string } }>(
    "duplicateProjectPage",
    { pageId },
  );
  const page = result?.page;
  if (!page?.id) throw new Error("The copy could not be made.");
  return { id: page.id, title: page.title, updatedAt: page.updated_at };
}

/** The three fields `duplicateProjectPage` answers with. */
export type DocumentPageSummary = { id: string; title: string; updatedAt: string };

/**
 * Render a document to a PDF and file it under the project's documents.
 *
 * The one export a phone genuinely needs: a signed-off method statement or a
 * handover certificate is something a technician has to hand somebody on site,
 * and until now that meant "open a laptop". The filing rules, and why an export
 * is filed rather than downloaded, live in `pdf-export.ts`.
 *
 * Works on read-only pages too, which is the point. A page built from a rich
 * template cannot be restructured on the phone, but it can be appended to,
 * shared, and now handed over as a PDF - so the phone covers the whole of what
 * the document is actually for, even where it cannot edit the body.
 */
export async function exportPagePdf(args: {
  pageId: string;
  projectId: string;
}): Promise<{ url: string; filename: string }> {
  const rendered = await api.rpc<{ pdfBase64?: string; filename?: string }>(
    "generatePagePdf",
    { pageId: args.pageId },
    /*
     * Long timeout and a key, for the same two reasons as the site log export:
     * the server embeds the page's images before it answers, and the op is
     * registered idempotent, which does nothing unless the key is sent.
     */
    { idempotencyKey: randomUUID(), timeoutMs: AI_TIMEOUT_MS },
  );
  if (!rendered?.pdfBase64) throw new Error("The PDF came back empty");

  return fileGeneratedPdf({
    projectId: args.projectId,
    pdfBase64: rendered.pdfBase64,
    filename: rendered.filename || "document.pdf",
  });
}

/**
 * The seeded document templates: a handover certificate, a method statement, a
 * daily record, and whatever the team has saved of its own.
 *
 * Worth having on the phone even though authoring templates is desk work,
 * because the thing a technician needs on site is the finished document. Until
 * now, starting one from the company template meant opening a laptop.
 */
export type DocumentTemplate = {
  id: string;
  name: string;
  description: string | null;
  /** Trade grouping. Team-saved templates have none. */
  category: string | null;
  /** A built-in shared across every team, rather than one this team wrote. */
  isExample: boolean;
  /** The merge tokens the body carries, before any are resolved. */
  fields: string[];
  updatedAt: string;
};

export async function listDocumentTemplates(): Promise<DocumentTemplate[]> {
  const result = await api.rpc<{ templates?: DocumentTemplate[] }>("listDocumentTemplates", {});
  return result?.templates ?? [];
}

/** One merge token, and what this project resolves it to. */
export type TemplateField = {
  token: string;
  label: string;
  /** null means nothing stored can fill it: weather, a client's own reference. */
  value: string | null;
};

export type TemplatePreview = {
  id: string;
  name: string;
  html: string;
  fields: TemplateField[];
  suggestedTitle: string;
};

/**
 * The finished document, before one exists.
 *
 * Two things come back that the phone cannot work out for itself. The resolved
 * field values, so somebody can see what the project filled in and type the
 * rest; and the body HTML, which is what lets this screen tell the truth about
 * whether the result will be editable here - see `templateEditability`.
 *
 * Resolution is deliberately the server's job. The web app kept its own list of
 * placeholders that matched the resolver's only by coincidence, and the
 * coincidence is what put wrong values in documents.
 */
export async function previewDocumentTemplate(args: {
  templateId: string;
  projectId: string;
}): Promise<TemplatePreview> {
  /*
   * Fields written out rather than spreading `args`. `tests/mobile-rpc-request-shapes`
   * reads this call site against the service's own zod schema, and a spread is
   * opaque to it - which is exactly how a required field went missing once
   * before and rejected every photo share.
   */
  const result = await api.rpc<TemplatePreview>("previewDocumentTemplate", {
    templateId: args.templateId,
    projectId: args.projectId,
  });
  if (!result?.id) throw new Error("The server answered, but with no template in it.");
  return result;
}

/*
 * No idempotency key, deliberately, and this is checked rather than assumed:
 * `createPageFromTemplate` is registered with plain `authed(...)` and no
 * `{ idempotent: true }`, so the server does not dedupe it. Sending a key would
 * be inert - `beginIdempotency` returns `{ kind: "skip" }` for an op that never
 * opted in - and a comment saying otherwise would be worse than none.
 *
 * A double tap is therefore prevented where it actually can be: the button is
 * disabled while the mutation is in flight.
 */
export async function createPageFromTemplate(args: {
  projectId: string;
  templateId: string;
  title?: string;
  /** Typed answers for the tokens the project could not resolve. */
  values?: Record<string, string>;
}): Promise<DocumentPageSummary> {
  const result = await api.rpc<{ page?: DocumentPageSummary }>("createPageFromTemplate", {
    projectId: args.projectId,
    templateId: args.templateId,
    ...(args.title ? { title: args.title } : {}),
    values: args.values ?? {},
  });
  const page = result?.page;
  if (!page?.id) throw new Error("The document was not created.");
  return page;
}
