import { rpcOp } from "./sitepix-api";

export interface DocumentTreeFolder {
  id: string;
  name: string;
  createdAt: string;
}
/**
 * Which of the project's lists a page belongs to.
 *
 * Decided on the server (apps/api/src/domains/projects/page-filing.ts) so the
 * Reports tab, the Documents tab and the tab counts can never disagree about
 * what a report is. Invoices are a Documents category, not a tab of their own.
 *
 * "daily_log" is in neither tab. The Reports tab holds the two outward-facing
 * artefacts - the AI Summary and the Report - and a Daily Log is the
 * technician's internal record, surfaced in the Capture flow where it is
 * written rather than filed among things a client sees.
 */
export type FilingBucket = "report" | "daily_log" | "invoice" | "document";

export interface DocumentTreePage {
  id: string;
  kind: "page";
  folderId: string | null;
  title: string;
  updatedAt: string;
  /** Document template this came from, for the blueprint badge. */
  sourceTemplateId: string | null;
  /**
   * Reports tab or Documents tab. Optional so a browser still holding the
   * previous bundle against a newer API, or the reverse, degrades to filing
   * everything under Documents instead of emptying both lists.
   */
  bucket?: FilingBucket;
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
  /**
   * The document template this page was created from, bare uuid, or null for a
   * blank page and for the AI-generated kinds. What lets the editor offer to
   * update that template instead of only ever adding another one beside it.
   */
  sourceTemplateId: string | null;
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

export const deleteDocumentFolder = rpcOp<{ folderId: string }, { ok: true }>(
  "deleteDocumentFolder",
);

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
    /**
     * The `updated_at` this client last saw. Send it and a save that would
     * overwrite someone else's concurrent edit is rejected with a 409 instead of
     * silently winning. Omit it to keep last-write-wins.
     */
    expectedUpdatedAt?: string;
  },
  { ok: true; updatedAt?: string }
>("updateProjectPage");

export const deleteProjectPage = rpcOp<{ pageId: string }, { ok: true }>("deleteProjectPage");

export const duplicateProjectPage = rpcOp<
  { pageId: string },
  { page: { id: string; title: string; updated_at: string } }
>("duplicateProjectPage");

export const generateProjectPage = rpcOp<
  {
    projectId: string;
    folderId?: string | null;
    /*
     * "summary" is intentionally absent: a Summary is filed under Walkthroughs
     * now (generateWalkthroughSummary), not as a project page. "daily_log" is
     * absent too, and for a different reason - nobody generates one by hand any
     * more; the capture flow writes it via `autoDailyLog` below. Both stay in
     * the server enum so existing pages and any direct RPC caller keep working.
     */
    template: "report";
    photoIds: string[];
    title?: string;
    /** Report only - the Daily Log is single-column by design. */
    photosPerPage?: 1 | 2 | 3 | 4;
  },
  { page: { id: string; title: string; updated_at: string }; aiFailed: string | null }
>("generateProjectPage", { idempotent: true });

/**
 * Every field a Daily Log needs to render, without opening the page.
 *
 * The client's ask was that the log be "a lightweight, always-available result
 * right there in the Capture flow", so the Capture-flow card shows the bullets
 * themselves. Reading `content_html` in the browser to find them would mean
 * shipping the whole document body to draw four lines of text.
 */
export interface DailyLogSummary {
  pageId: string;
  title: string;
  /**
   * When the log was started, as an absolute instant.
   *
   * There is no `day` field, and that is the point: "which calendar day is
   * this" has no server-side answer. The API runs in UTC, so a log started at
   * 6:30pm in California belongs to a day the server has already left. The
   * browser resolves this instant against its own clock instead.
   */
  createdAt: string;
  updatedAt: string;
  entries: string[];
  photoCount: number;
}

export interface AutoDailyLogResult extends Omit<DailyLogSummary, "createdAt"> {
  /** True when this call started today's log rather than appending to it. */
  created: boolean;
  aiFailed: string | null;
}

/**
 * Append a finished capture session to today's Daily Log, creating it on the
 * day's first session.
 *
 * `tzOffsetMinutes` decides what "today" means and is not optional in practice:
 * without it the server groups on its own UTC day, which merges an evening job
 * and the next morning's into one log for anyone west of Greenwich.
 *
 * Idempotent so a retried upload cannot log the same session twice.
 */
export const autoDailyLog = rpcOp<
  {
    projectId: string;
    photoIds: string[];
    source?: "camera" | "upload";
    tzOffsetMinutes?: number;
  },
  AutoDailyLogResult
>("autoDailyLog", { idempotent: true });

export const listProjectDailyLogs = rpcOp<{ projectId: string }, DailyLogSummary[]>(
  "listProjectDailyLogs",
);

export interface DocumentTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  /** Trade grouping for built-ins ("Field Reports", …); null for team templates. */
  category: string | null;
  isExample: boolean;
  fields: string[];
  updatedAt: string;
}

export const listDocumentTemplates = rpcOp<undefined, { templates: DocumentTemplateSummary[] }>(
  "listDocumentTemplates",
);

export const getDocumentTemplate = rpcOp<
  { templateId: string },
  { id: string; name: string; html: string; fields: string[] }
>("getDocumentTemplate");

/** Where an empty field's value would come from, so the input can say so. */
export type TemplateFieldSource = "auto" | "settings" | "manual";

export interface TemplateFieldPreview {
  token: string;
  label: string;
  /** Resolved from the project/company. null means it has to be typed in. */
  value: string | null;
  source: TemplateFieldSource;
}

export const previewDocumentTemplate = rpcOp<
  { templateId: string; projectId: string },
  {
    id: string;
    name: string;
    html: string;
    fields: TemplateFieldPreview[];
    /**
     * The project's name and the template's, already numbered past anything the
     * project holds. The template's own name alone is what used to be stored,
     * and it said nothing about which job the document belonged to.
     */
    suggestedTitle: string;
  }
>("previewDocumentTemplate");

export const createPageFromTemplate = rpcOp<
  {
    projectId: string;
    templateId: string;
    folderId?: string | null;
    /** Omitted lets the server name it after the project and the template. */
    title?: string;
    resolveTokens?: boolean;
    /** Values for the fields the project cannot fill in by itself, keyed by token. */
    values?: Record<string, string>;
  },
  { page: { id: string; title: string; updated_at: string } }
>("createPageFromTemplate");

export const savePageAsTemplate = rpcOp<
  { pageId: string; name: string },
  { template: { id: string; name: string } }
>("savePageAsTemplate");

/** Folds this document's layout back into the template it was created from. */
export const updateTemplateFromPage = rpcOp<
  { pageId: string },
  { template: { id: string; name: string } }
>("updateTemplateFromPage");

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

export const getPublicProjectPagePdf = rpcOp<
  { token: string },
  { pdfBase64: string; filename: string }
>("getPublicProjectPagePdf");
