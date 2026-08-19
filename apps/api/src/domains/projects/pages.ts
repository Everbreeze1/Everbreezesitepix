import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../../lib/supabase";
import { isMissingColumn } from "../../lib/postgrest";
import type { AuthedContext } from "../../lib/user-context";
import { sanitizePageHtml } from "./sanitize-page-html";
import {
  copyDocumentTitle,
  existingPageTitles,
  projectDocumentTitle,
  uniqueDocumentTitle,
} from "./page-title";
import { classifyPage, parseFilesUnder, type FilingBucket } from "./page-filing";

const IMG_TAG_RE = /<img\b[^>]*\bdata-photo-id="([0-9a-fA-F-]{36})"[^>]*>/g;

/** Unfilled template photo slots - an inline SVG data URI and never a real photo. */
const PHOTO_SLOT_RE = /<img\b[^>]*src="data:image\/svg\+xml[^"]*"[^>]*>/gi;

/**
 * Drops unfilled photo slots. They are authoring affordances ("click to add"),
 * not deliverable content, so anything a client sees - a shared link or an
 * exported PDF - must never show them.
 */
export function stripPhotoSlots(html: string): string {
  return html.replace(PHOTO_SLOT_RE, "");
}

/** Rewrites every `<img data-photo-id="...">` tag's `src` to a fresh signed URL - never persist signed URLs, they expire. */
export async function resolvePageImages(
  html: string,
  supabase: SupabaseClient<any>,
  /**
   * Restricts resolution to one project's photos.
   *
   * REQUIRED on any path that passes the service-role client. The ids come
   * from `data-photo-id` attributes inside author-controlled HTML, which is
   * stored with no validation of those ids at all - so on the public share
   * route the service role would happily sign any photo in the system whose
   * id an author pasted into their document, bypassing the `photos` RLS
   * entirely. Scoping to the page's own project makes a pasted foreign id
   * resolve to nothing instead.
   */
  projectId?: string,
): Promise<string> {
  const ids = Array.from(new Set(Array.from(html.matchAll(IMG_TAG_RE), (m) => m[1])));
  if (!ids.length) return html;

  let query = supabase.from("photos").select("id, storage_path, image_url").in("id", ids);
  if (projectId) query = query.eq("project_id", projectId);
  const { data: rows } = await query;
  const urlById = new Map<string, string>();
  await Promise.all(
    ((rows as Array<{ id: string; storage_path: string; image_url: string | null }>) ?? []).map(
      async (r) => {
        if (r.image_url) {
          urlById.set(r.id, r.image_url);
          return;
        }
        const { data: s } = await supabase.storage
          .from("site-photos")
          .createSignedUrl(r.storage_path, 60 * 60);
        if (s?.signedUrl) urlById.set(r.id, s.signedUrl);
      },
    ),
  );

  return html.replace(IMG_TAG_RE, (tag, photoId) => {
    const url = urlById.get(photoId);
    if (!url) return tag;
    return /\bsrc="[^"]*"/.test(tag)
      ? tag.replace(/\bsrc="[^"]*"/, `src="${url}"`)
      : tag.replace("<img", `<img src="${url}"`);
  });
}

// ============================================================
// Folders
// ============================================================

export const createDocumentFolderInputSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});
export async function createDocumentFolderService(
  ctx: AuthedContext,
  data: z.infer<typeof createDocumentFolderInputSchema>,
) {
  const { data: row, error } = await (ctx.supabase as any)
    .from("project_document_folders")
    .insert({ project_id: data.projectId, name: data.name, created_by: ctx.userId })
    .select("id, project_id, name, created_at")
    .single();
  if (error) throw new Error(error.message);
  return { folder: row };
}

export const renameDocumentFolderInputSchema = z.object({
  folderId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});
export async function renameDocumentFolderService(
  ctx: AuthedContext,
  data: z.infer<typeof renameDocumentFolderInputSchema>,
) {
  const { error } = await (ctx.supabase as any)
    .from("project_document_folders")
    .update({ name: data.name })
    .eq("id", data.folderId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const deleteDocumentFolderInputSchema = z.object({ folderId: z.string().uuid() });
export async function deleteDocumentFolderService(
  ctx: AuthedContext,
  data: z.infer<typeof deleteDocumentFolderInputSchema>,
) {
  const { error } = await (ctx.supabase as any)
    .from("project_document_folders")
    .delete()
    .eq("id", data.folderId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const moveDocumentInputSchema = z.object({
  kind: z.enum(["page", "file"]),
  id: z.string().uuid(),
  folderId: z.string().uuid().nullable(),
});
export async function moveDocumentService(
  ctx: AuthedContext,
  data: z.infer<typeof moveDocumentInputSchema>,
) {
  const table = data.kind === "page" ? "project_pages" : "project_documents";
  const { error } = await (ctx.supabase as any)
    .from(table)
    .update({ folder_id: data.folderId })
    .eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ============================================================
// Unified tree - folders + pages + files for a project's Documents tab
// ============================================================

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
  /**
   * The document template this page was created from, bare uuid.
   *
   * `project_pages.source_template` stores either a template kind ("daily_log",
   * "summary") or `document_template:<uuid>` (page-templates.ts:175). Only the
   * latter can map back to a blueprint, so the prefix is stripped here and
   * anything else becomes null - the client should never have to know that
   * encoding.
   */
  sourceTemplateId: string | null;
  /**
   * Which list this page belongs to - see page-filing.ts.
   *
   * Resolved here rather than in the browser because it needs the document
   * template's `filesUnder`, and shipping every template's body to the client
   * so it could work that out for itself would be a much larger payload for a
   * question the server can answer in one extra query.
   */
  bucket: FilingBucket;
}

/** `document_template:<uuid>` → `<uuid>`; every other encoding → null. */
export function documentTemplateId(sourceTemplate: string | null | undefined): string | null {
  if (typeof sourceTemplate !== "string") return null;
  const m = sourceTemplate.match(/^document_template:([0-9a-fA-F-]{36})$/);
  return m ? m[1] : null;
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

export const listProjectDocumentTreeInputSchema = z.object({ projectId: z.string().uuid() });
export async function listProjectDocumentTreeService(
  ctx: AuthedContext,
  data: z.infer<typeof listProjectDocumentTreeInputSchema>,
): Promise<{
  folders: DocumentTreeFolder[];
  pages: DocumentTreePage[];
  files: DocumentTreeFile[];
}> {
  const [
    { data: folderRows, error: fErr },
    { data: pageRows, error: pErr },
    { data: fileRows, error: dErr },
  ] = await Promise.all([
    (ctx.supabase as any)
      .from("project_document_folders")
      .select("id, name, created_at")
      .eq("project_id", data.projectId)
      .order("name", { ascending: true }),
    (ctx.supabase as any)
      .from("project_pages")
      .select("id, folder_id, title, updated_at, source_template")
      .eq("project_id", data.projectId)
      .order("updated_at", { ascending: false }),
    (ctx.supabase as any)
      .from("project_documents")
      .select("id, folder_id, file_name, mime_type, size_bytes, created_at")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false }),
  ]);
  if (fErr) throw new Error(fErr.message);
  if (pErr) throw new Error(pErr.message);
  if (dErr) throw new Error(dErr.message);

  /*
   * One query for the templates this project's pages actually came from, not
   * every template the team owns. A project with thirty pages made from three
   * templates asks for three rows.
   *
   * A page whose template has since been deleted simply gets no entry, and
   * `classifyPage` files it as a document rather than guessing - see the note
   * there. The lookup is also allowed to fail without taking the tab down:
   * losing it means pages fall back to their source_template alone, so the AI
   * output still reaches Reports and template pages land in Documents, which
   * is a degraded list rather than an error screen.
   */
  const templateIds = [
    ...new Set(
      ((pageRows as any[]) ?? [])
        .map((p) => documentTemplateId(p.source_template))
        .filter((id): id is string => id !== null),
    ),
  ];
  const filesUnderById = new Map<string, FilingBucket>();
  if (templateIds.length > 0) {
    const { data: tplRows, error: tErr } = await (ctx.supabase as any)
      .from("document_templates")
      .select("id, body")
      .in("id", templateIds);
    if (tErr) {
      console.warn("[document-tree] template filing lookup failed", { message: tErr.message });
    } else {
      for (const t of (tplRows as any[]) ?? []) {
        filesUnderById.set(t.id as string, parseFilesUnder(t.body));
      }
    }
  }

  return {
    folders: ((folderRows as any[]) ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      createdAt: f.created_at,
    })),
    pages: ((pageRows as any[]) ?? []).map((p) => ({
      id: p.id,
      kind: "page" as const,
      folderId: p.folder_id,
      title: p.title,
      updatedAt: p.updated_at,
      sourceTemplateId: documentTemplateId(p.source_template),
      bucket: classifyPage(
        p.source_template,
        (() => {
          const id = documentTemplateId(p.source_template);
          return id ? (filesUnderById.get(id) ?? null) : null;
        })(),
      ),
    })),
    files: ((fileRows as any[]) ?? []).map((f) => ({
      id: f.id,
      kind: "file" as const,
      folderId: f.folder_id,
      fileName: f.file_name,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      createdAt: f.created_at,
    })),
  };
}

// ============================================================
// Field tokens - {{company}}, {{project_name}}, {{project_address}}, {{date}}
// in header/footer, resolved at read time (never persisted resolved, so
// renaming the project or company later updates every page automatically).
// ============================================================

/**
 * Human-readable stand-in for a token with no value behind it yet, e.g.
 * `[Company name]`. Reads as a normal mail-merge placeholder (the convention
 * Word/Docs use) rather than `{{company}}`, which looks like leaked template
 * source to anyone previewing the document.
 *
 * This map is also the list of fields a template may reference - see
 * {@link SUPPORTED_TOKENS}, which `tests/document-template-library.test.ts`
 * checks the whole library against.
 */
const PLACEHOLDER_LABELS: Record<string, string> = {
  company: "Company name",
  company_name: "Company name",
  company_address: "Company address",
  company_phone: "Company phone",
  project_name: "Project name",
  project_address: "Project address",
  project_number: "Project number",
  client_name: "Client name",
  client_contact: "Client contact",
  prepared_by: "Prepared by",
  /*
   * The author's job title, under two names.
   *
   * `job_title` is the one the Fields panel inserts, because a template that
   * reads `{{job_title}}` next to a chip labelled "Job title" is a template
   * somebody can debug by reading it. `prepared_by_title` is what every
   * template authored before that shipped with - the seed migrations, the
   * built-in presets, and whatever a team has already written for itself - so
   * it stays a first-class token rather than degrading to a
   * `[Prepared by title]` blank.
   *
   * Same shape as `company` / `company_name` above: two spellings, one label,
   * one value behind both.
   */
  job_title: "Job title",
  prepared_by_title: "Job title",
  weather: "Weather",
  date: "Date",
};

/**
 * Tokens no table holds a value for. They are asked for when the document is
 * created ("Use in a project") and typed into it afterwards, so they resolve to
 * a click-to-type blank rather than to a merge pill that could never fill
 * itself in.
 *
 * Only the weather is left. It is genuinely per-visit - the same job has a
 * different answer on Tuesday - so storing it on the project would be wrong,
 * and asking once per document is the right amount of asking.
 *
 * The client's name, contact, project number and job title used to be in here
 * too, which meant retyping all four on every document for the same job. They
 * have columns now (20260823000000_project_client_fields.sql) and merge like
 * any other field.
 */
const PROMPT_TOKENS = new Set(["weather"]);

/** Fields a template is allowed to reference: everything with a label. */
export const SUPPORTED_TOKENS: ReadonlySet<string> = new Set(Object.keys(PLACEHOLDER_LABELS));

/** `Project number` for a field we know, `Some other field` for anything else. */
export function fieldLabel(token: string): string {
  const known = PLACEHOLDER_LABELS[token];
  if (known) return known;
  const words = token.replace(/_+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : token;
}

/** Where a field's value comes from, so an empty one can say so. */
export type TokenSource = "auto" | "settings" | "manual";

/** Fields that live on the profile, so an empty one is fixed in Settings once. */
const SETTINGS_TOKENS = new Set([
  "company",
  "company_name",
  "company_address",
  "company_phone",
  "prepared_by",
  "job_title",
  "prepared_by_title",
]);

export function tokenSource(token: string): TokenSource {
  if (SETTINGS_TOKENS.has(token)) return "settings";
  if (SUPPORTED_TOKENS.has(token) && !PROMPT_TOKENS.has(token)) return "auto";
  return "manual";
}

/**
 * True when the column simply is not there yet.
 *
 * Re-exported from lib/postgrest rather than defined here. This file had its own
 * copy that knew only SQLSTATE 42703, which is what Postgres raises for a select
 * list naming a column it has not got. Current PostgREST answers a WRITE naming an
 * unknown column from its own schema cache instead, as PGRST204, and never reaches
 * Postgres at all - so the two spellings disagreed about the same situation, and
 * the version in lib/postgrest is the one that learned it the hard way.
 *
 * `selectWithFallback` below only reads, so the narrow copy happened to work here.
 * One spelling means the next caller does not have to find that out.
 */
export { isMissingColumn };

/*
 * The client/job columns are read through a fallback.
 *
 * They arrive in 20260823000000_project_client_fields.sql, and migrations here
 * are applied by hand against the live database. Selecting a column that is not
 * there yet is not a soft failure - PostgREST answers 42703 and the whole call
 * throws, which would take document creation down for everyone until someone
 * ran the SQL. This repo has been there already: restore_missing_columns.sql
 * exists because live code referenced columns the database did not have.
 *
 * So ask for the new columns, and if the database has never heard of them, fall
 * back to the set that has always existed. Deliberately NOT cached in a
 * module-level flag: the cost is one wasted round trip per call, only in the
 * window before the migration lands, and in exchange applying the migration
 * takes effect immediately instead of after an API restart.
 *
 * Both helpers can be deleted, and their selects inlined, once the migration is
 * applied everywhere.
 */
async function selectWithFallback(
  admin: any,
  table: string,
  id: string,
  extended: string,
  base: string,
): Promise<Record<string, any> | null> {
  const first = await admin.from(table).select(extended).eq("id", id).maybeSingle();
  if (!isMissingColumn(first.error)) return first.data;
  const fallback = await admin.from(table).select(base).eq("id", id).maybeSingle();
  return fallback.data;
}

/**
 * The subset of {@link PLACEHOLDER_LABELS} that resolves from stored data.
 * A token absent from the result has nothing behind it and has to be typed.
 */
export async function loadTokenValues(
  projectId: string,
  createdBy: string,
): Promise<Record<string, string | null | undefined>> {
  const admin = getSupabaseAdmin();
  const [project, profile] = await Promise.all([
    selectWithFallback(
      admin,
      "projects",
      projectId,
      "name, street, city, state, client_name, client_contact, project_number",
      "name, street, city, state",
    ),
    selectWithFallback(
      admin,
      "profiles",
      createdBy,
      "full_name, company, company_address, company_phone, job_title",
      "full_name, company, company_address, company_phone",
    ),
  ]);
  const address = project
    ? [project.street, project.city, project.state].filter(Boolean).join(", ")
    : "";
  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    company: profile?.company,
    company_name: profile?.company,
    company_address: profile?.company_address,
    company_phone: profile?.company_phone,
    project_name: project?.name,
    project_address: address,
    project_number: project?.project_number,
    client_name: project?.client_name,
    client_contact: project?.client_contact,
    prepared_by: profile?.full_name,
    job_title: profile?.job_title,
    prepared_by_title: profile?.job_title,
    date: today,
  };
}

/**
 * Resolves `{{token}}` merge fields against stored project/company data, plus
 * any values supplied for this one use - the "Use in a project" step collects
 * the fields nothing can auto-fill (weather, client name, project number).
 *
 * Anything still without a value becomes `[Field name]`, which
 * `bracketsToFillFields` turns into a click-to-type blank. Nothing is left as
 * `{{token}}`: a curly-brace token in a finished document reads as leaked
 * template source, and the person it reads that way to is the customer.
 */
export async function resolvePageTokens(
  html: string | null,
  projectId: string,
  createdBy: string,
  overrides: Record<string, string> = {},
): Promise<string | null> {
  if (!html || !html.includes("{{")) return html;
  const values = await loadTokenValues(projectId, createdBy);

  return html.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const value = overrides[key]?.trim() || values[key];
    // Escaped rather than spliced in raw: these are user-controlled strings
    // going into HTML, and a project named `Smith & Sons <Roofing>` used to
    // break the document it was merged into. `tokensToPills` already escapes.
    return value ? escapeHtmlText(value) : `[${fieldLabel(key)}]`;
  });
}

/** @deprecated Use {@link resolvePageTokens} - kept as the original call-site name. */
export const resolveHeaderFooterTokens = resolvePageTokens;

// ============================================================
// Click-to-fill placeholders
//
// Templates express blanks two ways, and both used to reach the editor as raw
// bracket text the user had to select and delete before typing:
//   [Client Name]      - hand-filled, becomes an editable FillField box
//   {{project_name}}   - merge field, becomes a read-only MergeToken pill
//
// The database always stores the canonical `{{token}}` form, so PDF/share
// rendering and "renaming the project updates every page" keep working; the
// pill is only how it's expressed to the editor, and is converted back on save.
// ============================================================

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Rewrites literal `[Placeholder]` runs into editable fill-field spans.
 *
 * Applied to template HTML at the moment a page is created from it, so the
 * seeded SQL templates gain click-to-type fields without rewriting every
 * migration. Only text between tags is touched, never attribute values - so
 * `alt="Photo slot 1"` and inline styles are left alone.
 */
export function bracketsToFillFields(html: string | null): string | null {
  if (!html || !html.includes("[")) return html;
  return html.replace(/>([^<]+)</g, (whole, text: string) => {
    if (!text.includes("[")) return whole;
    const replaced = text.replace(/\[([^[\]<>]{1,60})\]/g, (m, label: string) => {
      const clean = label.trim();
      if (!clean) return m;
      return `<span data-fill-field data-label="${escapeAttr(clean)}"></span>`;
    });
    return `>${replaced}<`;
  });
}

/**
 * Expresses `{{token}}` the way the editor should show it:
 *
 *  - a merge field with stored data behind it becomes a read-only pill carrying
 *    its resolved value, empty-styled while the setting is still blank, so
 *    filling that setting in later updates every page at once;
 *  - a prompt field, and anything the label map does not recognise, becomes a
 *    click-to-type blank. There is nothing to merge from, so a pill would be a
 *    box the user can look at but never fill.
 *
 * The second branch also repairs documents created before the resolver knew
 * these fields: they hold a literal `{{weather}}`, and reopening one now turns
 * it into the blank it should always have been.
 */
export async function tokensToPills(
  html: string | null,
  projectId: string,
  createdBy: string,
): Promise<string | null> {
  if (!html || !html.includes("{{")) return html;
  const values = await loadTokenValues(projectId, createdBy);
  return html.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (!(key in values)) {
      return `<span data-fill-field data-label="${escapeAttr(fieldLabel(key))}"></span>`;
    }
    const value = values[key];
    const label = value || fieldLabel(key);
    const empty = value ? "" : ` data-empty="true"`;
    return `<span data-token="${escapeAttr(key)}" data-label="${escapeAttr(label)}"${empty}>${escapeHtmlText(label)}</span>`;
  });
}

/** Converts token pills back to `{{token}}` before persisting, keeping merges live. */
export function pillsToTokens(html: string | null): string | null {
  if (!html || !html.includes("data-token")) return html;
  return html.replace(
    /<span\b[^>]*\bdata-token="([a-z0-9_]+)"[^>]*>.*?<\/span>/gi,
    (_m, token: string) => `{{${token}}}`,
  );
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ============================================================
// Pages
// ============================================================

function blankTemplateHtml(kind: string | undefined, projectName: string, address: string): string {
  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  if (kind === "daily_log") {
    return `<p><strong>Project Name:</strong> ${projectName}</p><p><strong>Project Address:</strong> ${address}</p><p><strong>Date:</strong> ${today}</p><h2>Overview</h2><p></p>`;
  }
  if (kind === "summary") {
    return `<h1>${projectName} - Summary</h1><p><strong>Date:</strong> ${today}</p><p></p>`;
  }
  return "";
}

export const createProjectPageInputSchema = z.object({
  projectId: z.string().uuid(),
  folderId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  template: z.enum(["daily_log", "summary", "blank"]).optional(),
});
export async function createProjectPageService(
  ctx: AuthedContext,
  data: z.infer<typeof createProjectPageInputSchema>,
) {
  const { data: project } = await (ctx.supabase as any)
    .from("projects")
    .select("name, street, city, state")
    .eq("id", data.projectId)
    .maybeSingle();
  const address = project
    ? [project.street, project.city, project.state].filter(Boolean).join(", ")
    : "";
  const contentHtml = blankTemplateHtml(data.template, project?.name ?? "", address);
  /*
   * The project leads here too, so a blank page is not the fourth "Untitled" in
   * the list and the PDF it exports to is not `Untitled.pdf`. The word itself
   * stays: it is the app saying this document has no name yet, and that is
   * still true of a page nobody has typed a title into.
   *
   * Same helper as the template and AI routes - one rule for what a document in
   * a project is called, applied wherever one gets made.
   */
  const kind =
    data.template === "daily_log"
      ? `Daily Log - ${new Date().toLocaleDateString()}`
      : data.template === "summary"
        ? `Summary - ${new Date().toLocaleDateString()}`
        : "Untitled";
  const title =
    data.title?.trim() ||
    uniqueDocumentTitle(
      projectDocumentTitle(project?.name, kind),
      await existingPageTitles(ctx, data.projectId),
    );

  const { data: row, error } = await (ctx.supabase as any)
    .from("project_pages")
    .insert({
      project_id: data.projectId,
      folder_id: data.folderId ?? null,
      created_by: ctx.userId,
      title,
      content_html: contentHtml,
      source_template: data.template ?? null,
    })
    .select("id, title, content_html, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return { page: row };
}

export const getProjectPageInputSchema = z.object({ pageId: z.string().uuid() });
export async function getProjectPageService(
  ctx: AuthedContext,
  data: z.infer<typeof getProjectPageInputSchema>,
) {
  const { data: row, error } = await (ctx.supabase as any)
    .from("project_pages")
    .select(
      "id, project_id, folder_id, created_by, title, content_html, header_html, footer_html, share_token, revoked_at, updated_at, source_template",
    )
    .eq("id", data.pageId)
    .single();
  if (error || !row) throw new Error("Page not found");
  const [contentHtml, headerHtml, footerHtml] = await Promise.all([
    // Body merge fields become editable-document pills rather than raw
    // `{{token}}` source; updateProjectPage converts them back on save.
    tokensToPills(row.content_html, row.project_id, row.created_by).then((h) =>
      resolvePageImages(h ?? row.content_html, ctx.supabase),
    ),
    // Header/footer get pills for the same reason, and to fix a real data
    // loss: these used to resolve to plain text, which the editor's autosave
    // then wrote straight back - baking today's company name in permanently
    // and silently killing the merge field.
    tokensToPills(row.header_html, row.project_id, row.created_by).then((h) =>
      h ? resolvePageImages(h, ctx.supabase) : h,
    ),
    tokensToPills(row.footer_html, row.project_id, row.created_by).then((h) =>
      h ? resolvePageImages(h, ctx.supabase) : h,
    ),
  ]);
  // Resolved values so "Insert field" can drop in a pill showing the real
  // company/project name immediately, instead of raw `{{token}}` source.
  const tokenValues = await loadTokenValues(row.project_id, row.created_by);
  const tokens: Record<string, { label: string; empty: boolean }> = {};
  for (const [key, value] of Object.entries(tokenValues)) {
    tokens[key] = { label: value || fieldLabel(key), empty: !value };
  }
  return {
    page: {
      ...row,
      content_html: contentHtml,
      header_html: headerHtml,
      footer_html: footerHtml,
      // Decoded here so the editor can offer "Update <template>" instead of
      // only ever "Save as a new template" - see updateTemplateFromPageService.
      // The raw `source_template` encoding stays an API detail.
      sourceTemplateId: documentTemplateId(row.source_template),
    },
    tokens,
  };
}

export const updateProjectPageInputSchema = z.object({
  pageId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  contentHtml: z.string().max(2_000_000).optional(),
  headerHtml: z.string().max(50_000).nullable().optional(),
  footerHtml: z.string().max(50_000).nullable().optional(),
  /**
   * The `updated_at` the client last saw, used as an optimistic-concurrency
   * token. When supplied, the write only lands if the row has not moved since.
   *
   * Optional on purpose: older clients (and the mobile app) omit it and keep the
   * previous last-write-wins behaviour rather than breaking. `updated_at` is
   * safe to use as a version because a trigger maintains it -
   * `trg_project_pages_updated_at` in 20260729010000_project_pages.sql.
   */
  expectedUpdatedAt: z.string().optional(),
});
export async function updateProjectPageService(
  ctx: AuthedContext,
  data: z.infer<typeof updateProjectPageInputSchema>,
) {
  const patch: Record<string, unknown> = {};
  if (data.title !== undefined) patch.title = data.title;
  // Store the canonical `{{token}}` form, never the resolved pill - otherwise
  // the first autosave would bake today's company name into the document and
  // the merge field would stop tracking project/profile changes.
  if (data.contentHtml !== undefined) patch.content_html = pillsToTokens(data.contentHtml);
  if (data.headerHtml !== undefined) patch.header_html = pillsToTokens(data.headerHtml);
  if (data.footerHtml !== undefined) patch.footer_html = pillsToTokens(data.footerHtml);
  if (Object.keys(patch).length === 0) return { ok: true };

  /*
   * Optimistic concurrency.
   *
   * These pages are team-shared documents and the editor autosaves, so two
   * people with the same page open would each write their whole document back
   * over the other's - no error, no conflict, the loser's paragraphs simply
   * gone at the next autosave. Nobody finds out until a client asks where a
   * section went.
   *
   * Scoping the UPDATE by the `updated_at` the client loaded means a stale
   * write matches zero rows instead of clobbering. Returning the row lets us
   * tell "you were stale" apart from "that page is gone" and hand the caller a
   * fresh token for the next save.
   */
  let q = (ctx.supabase as any).from("project_pages").update(patch).eq("id", data.pageId);
  if (data.expectedUpdatedAt) q = q.eq("updated_at", data.expectedUpdatedAt);

  const { data: rows, error } = await q.select("id, updated_at");
  if (error) throw new Error(error.message);

  const updated = (rows as Array<{ id: string; updated_at: string }> | null) ?? [];
  if (updated.length === 0) {
    if (!data.expectedUpdatedAt) throw new Error("Page not found");
    // The row exists but has moved on - someone else saved first.
    throw Object.assign(
      new Error(
        "This page was changed by someone else while you were editing. Reload to get their changes before saving again.",
      ),
      { status: 409 },
    );
  }

  return { ok: true, updatedAt: updated[0].updated_at };
}

export const deleteProjectPageInputSchema = z.object({ pageId: z.string().uuid() });
export async function deleteProjectPageService(
  ctx: AuthedContext,
  data: z.infer<typeof deleteProjectPageInputSchema>,
) {
  const { error } = await (ctx.supabase as any)
    .from("project_pages")
    .delete()
    .eq("id", data.pageId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const duplicateProjectPageInputSchema = z.object({ pageId: z.string().uuid() });
export async function duplicateProjectPageService(
  ctx: AuthedContext,
  data: z.infer<typeof duplicateProjectPageInputSchema>,
) {
  const { data: source, error: fetchError } = await (ctx.supabase as any)
    .from("project_pages")
    .select("project_id, folder_id, title, content_html, header_html, footer_html")
    .eq("id", data.pageId)
    .single();
  if (fetchError || !source) throw new Error("Page not found");

  /*
   * Capped, and numbered against what the project already holds. Duplicating the
   * same document twice used to leave two rows both called "Copy of X", which is
   * the confusion this whole rule exists to remove, one level in.
   */
  const title = uniqueDocumentTitle(
    copyDocumentTitle(source.title),
    await existingPageTitles(ctx, source.project_id),
  );

  const { data: row, error } = await (ctx.supabase as any)
    .from("project_pages")
    .insert({
      project_id: source.project_id,
      folder_id: source.folder_id,
      created_by: ctx.userId,
      title,
      content_html: source.content_html,
      header_html: source.header_html,
      footer_html: source.footer_html,
    })
    .select("id, title, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return { page: row };
}

export const setProjectPageShareInputSchema = z.object({
  pageId: z.string().uuid(),
  enable: z.boolean(),
});
export async function setProjectPageShareService(
  ctx: AuthedContext,
  data: z.infer<typeof setProjectPageShareInputSchema>,
) {
  const { data: row, error } = await (ctx.supabase as any)
    .from("project_pages")
    .update({ revoked_at: data.enable ? null : new Date().toISOString() })
    .eq("id", data.pageId)
    .select("share_token")
    .single();
  if (error) throw new Error(error.message);
  return { shareToken: row.share_token as string };
}

// ============================================================
// Public share
// ============================================================

export const publicProjectPageInputSchema = z.object({ token: z.string().uuid() });
export async function getPublicProjectPageService(
  data: z.infer<typeof publicProjectPageInputSchema>,
): Promise<{
  status: "ok" | "not_found" | "revoked";
  page: {
    title: string;
    contentHtml: string;
    headerHtml: string | null;
    footerHtml: string | null;
    updatedAt: string;
  } | null;
}> {
  const admin = getSupabaseAdmin();
  const { data: row } = await (admin as any)
    .from("project_pages")
    .select(
      "project_id, created_by, title, content_html, header_html, footer_html, revoked_at, updated_at",
    )
    .eq("share_token", data.token)
    .maybeSingle();
  if (!row) return { status: "not_found", page: null };
  if (row.revoked_at) return { status: "revoked", page: null };

  /*
   * Trashing the project revokes its shared pages too.
   *
   * `project_pages` has no `deleted_at` of its own - a page dies with its
   * project, via the ON DELETE CASCADE - but soft-deleting the project only
   * sets `projects.deleted_at`, and nothing on this path looked at it. So a
   * document shared with a client kept serving in full after the job was
   * deleted.
   */
  const { data: proj } = await (admin as any)
    .from("projects")
    .select("deleted_at")
    .eq("id", row.project_id)
    .maybeSingle();
  if (proj?.deleted_at) return { status: "revoked", page: null };

  const supa = admin as unknown as SupabaseClient<any>;
  // `supa` is the service-role client, so every resolution here is scoped to
  // this page's own project - otherwise a `data-photo-id` the author pasted in
  // by hand would be signed regardless of who owns the photo.
  const [contentHtml, headerHtml, footerHtml] = await Promise.all([
    /*
     * The body's merge fields resolve here too, not only the header and footer.
     *
     * The editor stores the canonical `{{token}}` form (see `pillsToTokens`), so
     * any page that has been opened and autosaved once carries them in its body -
     * and this is the copy the customer opens. They printed as `{{company_name}}`,
     * which is template source, in the one place it must never appear.
     */
    resolvePageTokens(row.content_html, row.project_id, row.created_by)
      .then((h) => resolvePageImages(h ?? row.content_html, supa, row.project_id))
      .then(stripPhotoSlots),
    resolveHeaderFooterTokens(row.header_html, row.project_id, row.created_by).then((h) =>
      h ? resolvePageImages(h, supa, row.project_id).then(stripPhotoSlots) : h,
    ),
    resolveHeaderFooterTokens(row.footer_html, row.project_id, row.created_by).then((h) =>
      h ? resolvePageImages(h, supa, row.project_id).then(stripPhotoSlots) : h,
    ),
  ]);
  /*
   * Sanitise on the way out to anonymous visitors. `content_html` is only
   * length-validated on write, so whatever an authenticated author PUTs is
   * stored verbatim - and the public share route injects it with
   * `dangerouslySetInnerHTML`. Cleaning here fixes every row already in the
   * database, not just future writes.
   */
  return {
    status: "ok",
    page: {
      title: row.title,
      contentHtml: sanitizePageHtml(contentHtml ?? ""),
      headerHtml: sanitizePageHtml(headerHtml ?? null),
      footerHtml: sanitizePageHtml(footerHtml ?? null),
      updatedAt: row.updated_at,
    },
  };
}
