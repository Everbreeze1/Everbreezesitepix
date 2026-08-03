import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import { resolvePageTokens, bracketsToFillFields } from "./pages";

const REAL_PHOTO_IMG_RE = /<img\b[^>]*\bdata-photo-id="[0-9a-fA-F-]{36}"[^>]*>/g;

/** Matches the placeholder art in the seeded templates / apps/web/src/lib/tiptap-photo-slot.ts. */
function slotSvg(label: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='280'>` +
    `<rect x='0.5' y='0.5' width='219' height='279' rx='6' fill='rgb(244,245,247)' ` +
    `stroke='rgb(203,208,216)' stroke-dasharray='5 4'/>` +
    `<text x='110' y='132' font-family='sans-serif' font-size='14' font-weight='700' ` +
    `fill='rgb(107,114,128)' text-anchor='middle'>${label}</text>` +
    `<text x='110' y='152' font-family='sans-serif' font-size='11' ` +
    `fill='rgb(156,163,175)' text-anchor='middle'>Click to add</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Replaces every real project photo with a generic numbered placeholder slot —
 * same art the seeded templates ship with — so saving a page as a template
 * never leaks that project's photos to whoever else picks up the template.
 * Width/height are carried over from the original tag so the layout (a 2-up
 * or 4-up photo row) survives unchanged; only the pixels are removed.
 */
function stripPhotosToSlots(html: string): string {
  let n = 0;
  return html.replace(REAL_PHOTO_IMG_RE, (tag) => {
    n += 1;
    const width = /\bwidth="([^"]*)"/.exec(tag)?.[1] ?? "48%";
    const height = /\bheight="([^"]*)"/.exec(tag)?.[1] ?? "280";
    return `<img src="${slotSvg(`Photo ${n}`)}" width="${width}" height="${height}" alt="Photo slot ${n}">`;
  });
}

export interface DocumentTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  /**
   * Trade grouping ("Field Reports", "Roofing & Exterior", …). Built-in
   * templates carry this instead of encoding the category in the name; a
   * team's own saved templates have none.
   */
  category: string | null;
  /** null team_id = a built-in example template shared across all teams. */
  isExample: boolean;
  fields: string[];
  updatedAt: string;
}

/** `document_templates.body` is `{ style, html, description, category }` (see DocumentTemplatesManager). */
function parseBody(body: unknown): {
  html: string;
  description: string | null;
  category: string | null;
} {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    return {
      html: typeof b.html === "string" ? b.html : "",
      description: typeof b.description === "string" && b.description ? b.description : null,
      category: typeof b.category === "string" && b.category ? b.category : null,
    };
  }
  return { html: "", description: null, category: null };
}

export async function listDocumentTemplatesService(
  ctx: AuthedContext,
): Promise<{ templates: DocumentTemplateSummary[] }> {
  const { data, error } = await (ctx.supabase as any)
    .from("document_templates")
    .select("id, name, body, fields, team_id, archived, updated_at")
    .eq("archived", false)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);

  const templates: DocumentTemplateSummary[] = ((data as any[]) ?? []).map((t) => {
    const parsed = parseBody(t.body);
    return {
      id: t.id,
      name: t.name,
      description: parsed.description,
      category: parsed.category,
      isExample: t.team_id === null,
      fields: (t.fields as string[]) ?? [],
      updatedAt: t.updated_at,
    };
  });

  // The team's own templates first (most recently touched at the top), then
  // the built-ins grouped by trade category, alphabetical within each.
  templates.sort((a, b) => {
    if (a.isExample !== b.isExample) return a.isExample ? 1 : -1;
    if (a.isExample) {
      const cat = (a.category ?? "").localeCompare(b.category ?? "");
      if (cat !== 0) return cat;
      return a.name.localeCompare(b.name);
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return { templates };
}

export const getDocumentTemplateInputSchema = z.object({ templateId: z.string().uuid() });

/** Full body, for the "preview before Use Template" step. */
export async function getDocumentTemplateService(
  ctx: AuthedContext,
  data: z.infer<typeof getDocumentTemplateInputSchema>,
): Promise<{ id: string; name: string; html: string; fields: string[] }> {
  const { data: row, error } = await (ctx.supabase as any)
    .from("document_templates")
    .select("id, name, body, fields")
    .eq("id", data.templateId)
    .single();
  if (error || !row) throw new Error("Template not found");
  return {
    id: row.id,
    name: row.name,
    html: parseBody(row.body).html,
    fields: (row.fields as string[]) ?? [],
  };
}

export const createPageFromTemplateInputSchema = z.object({
  projectId: z.string().uuid(),
  templateId: z.string().uuid(),
  folderId: z.string().uuid().nullable().optional(),
  /** When false the page keeps `{{tokens}}` literal so they can be filled in later. */
  resolveTokens: z.boolean().default(true),
});

export async function createPageFromTemplateService(
  ctx: AuthedContext,
  data: z.infer<typeof createPageFromTemplateInputSchema>,
) {
  const template = await getDocumentTemplateService(ctx, { templateId: data.templateId });

  const resolved = data.resolveTokens
    ? ((await resolvePageTokens(template.html, data.projectId, ctx.userId)) ?? template.html)
    : template.html;
  // `[Client Name]` style blanks become click-to-type fields at this point, so
  // the seeded SQL templates gain them without every migration being rewritten.
  const contentHtml = bracketsToFillFields(resolved) ?? resolved;

  const { data: row, error } = await (ctx.supabase as any)
    .from("project_pages")
    .insert({
      project_id: data.projectId,
      folder_id: data.folderId ?? null,
      created_by: ctx.userId,
      title: template.name,
      content_html: contentHtml,
      source_template: `document_template:${template.id}`,
    })
    .select("id, title, content_html, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return { page: row };
}

export const savePageAsTemplateInputSchema = z.object({
  pageId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
});

/** "Save as a New Template" from the page editor — mirrors CompanyCam's ··· menu action. */
export async function savePageAsTemplateService(
  ctx: AuthedContext,
  data: z.infer<typeof savePageAsTemplateInputSchema>,
) {
  const { data: page, error: pageErr } = await (ctx.supabase as any)
    .from("project_pages")
    .select("content_html")
    .eq("id", data.pageId)
    .single();
  if (pageErr || !page) throw new Error("Page not found");

  const { data: membership } = await (ctx.supabase as any)
    .from("team_members")
    .select("team_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();

  // Keep the layout (photo rows, section structure) but never carry this
  // project's actual photos into a reusable template.
  const html = stripPhotosToSlots(page.content_html as string);
  const fields = Array.from(
    new Set(Array.from(html.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi), (m) => m[1].toLowerCase())),
  ).sort();

  const { data: row, error } = await (ctx.supabase as any)
    .from("document_templates")
    .insert({
      name: data.name,
      team_id: membership?.team_id ?? null,
      created_by: ctx.userId,
      body: { style: "report", html, description: "" },
      fields,
    })
    .select("id, name")
    .single();
  if (error) throw new Error(error.message);
  return { template: row };
}
