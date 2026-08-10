import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../../lib/supabase";
import type { AuthedContext } from "../../lib/user-context";
import { sanitizePageHtml } from "./sanitize-page-html";

const IMG_TAG_RE = /<img\b[^>]*\bdata-photo-id="([0-9a-fA-F-]{36})"[^>]*>/g;

/** Unfilled template photo slots — an inline SVG data URI and never a real photo. */
const PHOTO_SLOT_RE = /<img\b[^>]*src="data:image\/svg\+xml[^"]*"[^>]*>/gi;

/**
 * Drops unfilled photo slots. They are authoring affordances ("click to add"),
 * not deliverable content, so anything a client sees — a shared link or an
 * exported PDF — must never show them.
 */
export function stripPhotoSlots(html: string): string {
  return html.replace(PHOTO_SLOT_RE, "");
}

/** Rewrites every `<img data-photo-id="...">` tag's `src` to a fresh signed URL — never persist signed URLs, they expire. */
export async function resolvePageImages(
  html: string,
  supabase: SupabaseClient<any>,
): Promise<string> {
  const ids = Array.from(new Set(Array.from(html.matchAll(IMG_TAG_RE), (m) => m[1])));
  if (!ids.length) return html;

  const { data: rows } = await supabase
    .from("photos")
    .select("id, storage_path, image_url")
    .in("id", ids);
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
// Unified tree — folders + pages + files for a project's Documents tab
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
      .select("id, folder_id, title, updated_at")
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
// Field tokens — {{company}}, {{project_name}}, {{project_address}}, {{date}}
// in header/footer, resolved at read time (never persisted resolved, so
// renaming the project or company later updates every page automatically).
// ============================================================

/**
 * Human-readable stand-in for a known token with no data behind it yet, e.g.
 * `[Company name]`. Reads as a normal mail-merge placeholder (the convention
 * Word/Docs use) rather than `{{company}}`, which looks like leaked template
 * source to anyone previewing the document.
 */
const PLACEHOLDER_LABELS: Record<string, string> = {
  company: "Company name",
  company_name: "Company name",
  company_address: "Company address",
  company_phone: "Company phone",
  project_name: "Project name",
  project_address: "Project address",
  prepared_by: "Prepared by",
  date: "Date",
};

/**
 * Resolves `{{token}}` merge fields against live project/company data. A
 * *known* token with no data behind it renders as `[Field name]`. A token
 * that isn't recognized at all is left verbatim as `{{token}}` — that case
 * means the template itself is wrong (typo, or references a field we don't
 * support), which is worth surfacing differently than "just needs filling in".
 */
async function loadTokenValues(
  projectId: string,
  createdBy: string,
): Promise<Record<string, string | null | undefined>> {
  const admin = getSupabaseAdmin();
  const [{ data: project }, { data: profile }] = await Promise.all([
    (admin as any)
      .from("projects")
      .select("name, street, city, state")
      .eq("id", projectId)
      .maybeSingle(),
    (admin as any)
      .from("profiles")
      .select("full_name, company, company_address, company_phone")
      .eq("id", createdBy)
      .maybeSingle(),
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
    prepared_by: profile?.full_name,
    date: today,
  };
}

export async function resolvePageTokens(
  html: string | null,
  projectId: string,
  createdBy: string,
): Promise<string | null> {
  if (!html || !html.includes("{{")) return html;
  const values = await loadTokenValues(projectId, createdBy);

  return html.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (!(key in values)) return match;
    const value = values[key];
    if (value) return value;
    return `[${PLACEHOLDER_LABELS[key] ?? key}]`;
  });
}

/** @deprecated Use {@link resolvePageTokens} — kept as the original call-site name. */
export const resolveHeaderFooterTokens = resolvePageTokens;

// ============================================================
// Click-to-fill placeholders
//
// Templates express blanks two ways, and both used to reach the editor as raw
// bracket text the user had to select and delete before typing:
//   [Client Name]      — hand-filled, becomes an editable FillField box
//   {{project_name}}   — merge field, becomes a read-only MergeToken pill
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
 * migration. Only text between tags is touched, never attribute values — so
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
 * Expresses `{{token}}` as a token pill carrying its resolved value, for the
 * editor. Unknown tokens are left verbatim so a template typo stays visible.
 */
export async function tokensToPills(
  html: string | null,
  projectId: string,
  createdBy: string,
): Promise<string | null> {
  if (!html || !html.includes("{{")) return html;
  const values = await loadTokenValues(projectId, createdBy);
  return html.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (!(key in values)) return match;
    const value = values[key];
    const label = value || PLACEHOLDER_LABELS[key] || key;
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
    return `<h1>${projectName} — Summary</h1><p><strong>Date:</strong> ${today}</p><p></p>`;
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
  const title =
    data.title?.trim() ||
    (data.template === "daily_log"
      ? `Daily Log - ${new Date().toLocaleDateString()}`
      : data.template === "summary"
        ? `Summary - ${new Date().toLocaleDateString()}`
        : "Untitled");

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
      "id, project_id, folder_id, created_by, title, content_html, header_html, footer_html, share_token, revoked_at, updated_at",
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
    // then wrote straight back — baking today's company name in permanently
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
    tokens[key] = { label: value || PLACEHOLDER_LABELS[key] || key, empty: !value };
  }
  return {
    page: { ...row, content_html: contentHtml, header_html: headerHtml, footer_html: footerHtml },
    tokens,
  };
}

export const updateProjectPageInputSchema = z.object({
  pageId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  contentHtml: z.string().max(2_000_000).optional(),
  headerHtml: z.string().max(50_000).nullable().optional(),
  footerHtml: z.string().max(50_000).nullable().optional(),
});
export async function updateProjectPageService(
  ctx: AuthedContext,
  data: z.infer<typeof updateProjectPageInputSchema>,
) {
  const patch: Record<string, unknown> = {};
  if (data.title !== undefined) patch.title = data.title;
  // Store the canonical `{{token}}` form, never the resolved pill — otherwise
  // the first autosave would bake today's company name into the document and
  // the merge field would stop tracking project/profile changes.
  if (data.contentHtml !== undefined) patch.content_html = pillsToTokens(data.contentHtml);
  if (data.headerHtml !== undefined) patch.header_html = pillsToTokens(data.headerHtml);
  if (data.footerHtml !== undefined) patch.footer_html = pillsToTokens(data.footerHtml);
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await (ctx.supabase as any)
    .from("project_pages")
    .update(patch)
    .eq("id", data.pageId);
  if (error) throw new Error(error.message);
  return { ok: true };
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

  const { data: row, error } = await (ctx.supabase as any)
    .from("project_pages")
    .insert({
      project_id: source.project_id,
      folder_id: source.folder_id,
      created_by: ctx.userId,
      title: `Copy of ${source.title}`,
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

  const supa = admin as unknown as SupabaseClient<any>;
  const [contentHtml, headerHtml, footerHtml] = await Promise.all([
    resolvePageImages(row.content_html, supa).then(stripPhotoSlots),
    resolveHeaderFooterTokens(row.header_html, row.project_id, row.created_by).then((h) =>
      h ? resolvePageImages(h, supa).then(stripPhotoSlots) : h,
    ),
    resolveHeaderFooterTokens(row.footer_html, row.project_id, row.created_by).then((h) =>
      h ? resolvePageImages(h, supa).then(stripPhotoSlots) : h,
    ),
  ]);
  /*
   * Sanitise on the way out to anonymous visitors. `content_html` is only
   * length-validated on write, so whatever an authenticated author PUTs is
   * stored verbatim — and the public share route injects it with
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
