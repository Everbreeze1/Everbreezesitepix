import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../../lib/supabase";
import type { AuthedContext } from "../../lib/user-context";

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
export async function resolvePageImages(html: string, supabase: SupabaseClient<any>): Promise<string> {
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
    return /\bsrc="[^"]*"/.test(tag) ? tag.replace(/\bsrc="[^"]*"/, `src="${url}"`) : tag.replace("<img", `<img src="${url}"`);
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
export async function moveDocumentService(ctx: AuthedContext, data: z.infer<typeof moveDocumentInputSchema>) {
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
): Promise<{ folders: DocumentTreeFolder[]; pages: DocumentTreePage[]; files: DocumentTreeFile[] }> {
  const [{ data: folderRows, error: fErr }, { data: pageRows, error: pErr }, { data: fileRows, error: dErr }] =
    await Promise.all([
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
    folders: ((folderRows as any[]) ?? []).map((f) => ({ id: f.id, name: f.name, createdAt: f.created_at })),
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
 * Resolves `{{token}}` merge fields against live project/company data.
 * Unknown tokens are deliberately left verbatim so the author can see what
 * still needs filling in (matching how document templates preview them).
 */
export async function resolvePageTokens(
  html: string | null,
  projectId: string,
  createdBy: string,
): Promise<string | null> {
  if (!html || !html.includes("{{")) return html;
  const admin = getSupabaseAdmin();
  const [{ data: project }, { data: profile }] = await Promise.all([
    (admin as any).from("projects").select("name, street, city, state").eq("id", projectId).maybeSingle(),
    (admin as any)
      .from("profiles")
      .select("full_name, company, company_address, company_phone")
      .eq("id", createdBy)
      .maybeSingle(),
  ]);
  const address = project ? [project.street, project.city, project.state].filter(Boolean).join(", ") : "";
  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  const values: Record<string, string | null | undefined> = {
    company: profile?.company,
    company_name: profile?.company,
    company_address: profile?.company_address,
    company_phone: profile?.company_phone,
    project_name: project?.name,
    project_address: address,
    prepared_by: profile?.full_name,
    date: today,
  };

  return html.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, rawKey: string) => {
    const value = values[rawKey.toLowerCase()];
    return value ? value : match;
  });
}

/** @deprecated Use {@link resolvePageTokens} — kept as the original call-site name. */
export const resolveHeaderFooterTokens = resolvePageTokens;

// ============================================================
// Pages
// ============================================================

function blankTemplateHtml(kind: string | undefined, projectName: string, address: string): string {
  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
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
  const address = project ? [project.street, project.city, project.state].filter(Boolean).join(", ") : "";
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
export async function getProjectPageService(ctx: AuthedContext, data: z.infer<typeof getProjectPageInputSchema>) {
  const { data: row, error } = await (ctx.supabase as any)
    .from("project_pages")
    .select(
      "id, project_id, folder_id, created_by, title, content_html, header_html, footer_html, share_token, revoked_at, updated_at",
    )
    .eq("id", data.pageId)
    .single();
  if (error || !row) throw new Error("Page not found");
  const [contentHtml, headerHtml, footerHtml] = await Promise.all([
    resolvePageImages(row.content_html, ctx.supabase),
    resolveHeaderFooterTokens(row.header_html, row.project_id, row.created_by).then((h) =>
      h ? resolvePageImages(h, ctx.supabase) : h,
    ),
    resolveHeaderFooterTokens(row.footer_html, row.project_id, row.created_by).then((h) =>
      h ? resolvePageImages(h, ctx.supabase) : h,
    ),
  ]);
  return {
    page: { ...row, content_html: contentHtml, header_html: headerHtml, footer_html: footerHtml },
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
  if (data.contentHtml !== undefined) patch.content_html = data.contentHtml;
  if (data.headerHtml !== undefined) patch.header_html = data.headerHtml;
  if (data.footerHtml !== undefined) patch.footer_html = data.footerHtml;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await (ctx.supabase as any).from("project_pages").update(patch).eq("id", data.pageId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const deleteProjectPageInputSchema = z.object({ pageId: z.string().uuid() });
export async function deleteProjectPageService(
  ctx: AuthedContext,
  data: z.infer<typeof deleteProjectPageInputSchema>,
) {
  const { error } = await (ctx.supabase as any).from("project_pages").delete().eq("id", data.pageId);
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

export const setProjectPageShareInputSchema = z.object({ pageId: z.string().uuid(), enable: z.boolean() });
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
    .select("project_id, created_by, title, content_html, header_html, footer_html, revoked_at, updated_at")
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
  return {
    status: "ok",
    page: { title: row.title, contentHtml, headerHtml, footerHtml, updatedAt: row.updated_at },
  };
}
