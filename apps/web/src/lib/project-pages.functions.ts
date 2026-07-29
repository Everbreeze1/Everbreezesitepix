import { rpcOp } from "./sitepix-api";

export interface DocumentTreeFolder {
  id: string;
  name: string;
  createdAt: string;
}
export interface DocumentTreePage {
  id: string;
  kind: "page";
  folderId: string | null;
  title: string;
  updatedAt: string;
}
export interface DocumentTreeFile {
  id: string;
  kind: "file";
  folderId: string | null;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  createdAt: string;
}
export interface DocumentTree {
  folders: DocumentTreeFolder[];
  pages: DocumentTreePage[];
  files: DocumentTreeFile[];
}

export interface ProjectPage {
  id: string;
  project_id: string;
  folder_id: string | null;
  title: string;
  content_html: string;
  header_html: string | null;
  footer_html: string | null;
  share_token: string;
  revoked_at: string | null;
  updated_at: string;
}

export const listProjectDocumentTree = rpcOp<{ projectId: string }, DocumentTree>(
  "listProjectDocumentTree",
);

export const createDocumentFolder = rpcOp<
  { projectId: string; name: string },
  { folder: DocumentTreeFolder }
>("createDocumentFolder");

export const renameDocumentFolder = rpcOp<{ folderId: string; name: string }, { ok: true }>(
  "renameDocumentFolder",
);

export const deleteDocumentFolder = rpcOp<{ folderId: string }, { ok: true }>("deleteDocumentFolder");

export const moveDocument = rpcOp<
  { kind: "page" | "file"; id: string; folderId: string | null },
  { ok: true }
>("moveDocument");

export const createProjectPage = rpcOp<
  {
    projectId: string;
    folderId?: string | null;
    title?: string;
    template?: "daily_log" | "summary" | "blank";
  },
  { page: { id: string; title: string; content_html: string; updated_at: string } }
>("createProjectPage");

export const getProjectPage = rpcOp<{ pageId: string }, { page: ProjectPage }>("getProjectPage");

export const updateProjectPage = rpcOp<
  {
    pageId: string;
    title?: string;
    contentHtml?: string;
    headerHtml?: string | null;
    footerHtml?: string | null;
  },
  { ok: true }
>("updateProjectPage");

export const deleteProjectPage = rpcOp<{ pageId: string }, { ok: true }>("deleteProjectPage");

export const setProjectPageShare = rpcOp<
  { pageId: string; enable: boolean },
  { shareToken: string }
>("setProjectPageShare");

export interface PublicProjectPage {
  status: "ok" | "not_found" | "revoked";
  page: {
    title: string;
    contentHtml: string;
    headerHtml: string | null;
    footerHtml: string | null;
    updatedAt: string;
  } | null;
}
export const getPublicProjectPage = rpcOp<{ token: string }, PublicProjectPage>(
  "getPublicProjectPage",
);

export const generatePagePdf = rpcOp<{ pageId: string }, { pdfBase64: string; filename: string }>(
  "generatePagePdf",
  { idempotent: true },
);

export const getPublicProjectPagePdf = rpcOp<{ token: string }, { pdfBase64: string; filename: string }>(
  "getPublicProjectPagePdf",
);
