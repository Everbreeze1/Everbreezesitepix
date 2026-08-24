import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import {
  resolvePageTokens,
  bracketsToFillFields,
  loadTokenValues,
  fieldLabel,
  tokenSource,
  documentTemplateId,
  type TokenSource,
} from "./pages";
import { sanitizePageHtml } from "./sanitize-page-html";
import { projectDocumentTitle, titleContext, uniqueDocumentTitle } from "./page-title";

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
 * Replaces every real project photo with a generic numbered placeholder slot -
 * same art the seeded templates ship with - so saving a page as a template
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

/**
 * Empties every click-to-type blank, keeping its label.
 *
 * A page's fill fields hold that job's answers: the client's name, the project
 * number, the day's weather. `stripPhotosToSlots` already refuses to carry the
 * project's photos into a reusable template, and carrying its typed answers is
 * the same leak in text form - it is what made a saved template open with the
 * previous customer's details already filled in.
 *
 * The node's content is `text*` (tiptap-fill-field.ts), so there is no nesting
 * and the first `</span>` is always the right one to stop at.
 */
export function blankFillFields(html: string): string {
  return html.replace(
    /(<span\b[^>]*\bdata-fill-field\b[^>]*>)[\s\S]*?(<\/span>)/gi,
    (_m, open: string, close: string) => `${open}${close}`,
  );
}

/**
 * Fields whose value is worth swapping back into a merge token when a document
 * becomes a template. Deliberately not the whole set:
 *
 *   `company` duplicates `company_name`, so listing both would leave the second
 *   one with nothing to match.
 *   `date` is excluded because a document's dates are the visit's, not today's,
 *   and turning them into `{{date}}` would silently restamp them on every use.
 */
const TEMPLATISE_TOKENS = [
  "project_address",
  "project_name",
  "company_address",
  "company_phone",
  "company_name",
  "prepared_by",
] as const;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Both spellings a value can have in the document body. A company called
 * "Northwind Heating & Air" was merged in as `Heating &amp; Air`, so matching
 * only the raw string would leave that one name behind in every template.
 */
function textVariants(value: string): string[] {
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped === value ? [value] : [escaped, value];
}

/**
 * Puts the source project's own details back into merge fields.
 *
 * A page written for a real job says "Meghan", "2229 Zittel Drive, Folsom, CA",
 * "Mike" - generated reports especially, which never held a token to begin
 * with. Saved as-is, the "template" is a copy of one job, and applying it to the
 * next one produced a document about the previous customer. Swapping the values
 * the page was built from back to `{{tokens}}` is what makes it reusable rather
 * than a duplicate, and it is what the resolver then refills per project.
 *
 * Guards against eating ordinary prose: only values of four characters or more,
 * only between tags so no attribute is rewritten, and only on a word boundary -
 * a company called "ACE" must not rewrite the word "acetone". Longest value
 * first, so an address is matched whole before the city inside it.
 */
export function valuesToTokens(
  html: string,
  values: Record<string, string | null | undefined>,
): string {
  const pairs = TEMPLATISE_TOKENS.map((token) => [token, (values[token] ?? "").trim()] as const)
    .filter(([, value]) => value.length >= 4)
    .sort((a, b) => b[1].length - a[1].length);
  if (!pairs.length) return html;

  return html.replace(/>([^<]+)</g, (whole, text: string) => {
    let out = text;
    for (const [token, value] of pairs) {
      for (const variant of textVariants(value)) {
        out = out.replace(new RegExp(`(?<!\\w)${escapeRe(variant)}(?!\\w)`, "g"), `{{${token}}}`);
      }
    }
    return out === text ? whole : `>${out}<`;
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

/** `document_templates.body` is `{ style, html, description, category, copiedFrom }` (see DocumentTemplatesManager). */
function parseBody(body: unknown): {
  html: string;
  description: string | null;
  category: string | null;
  /** The built-in this row is the team's own version of, if it is one. */
  copiedFrom: string | null;
} {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    return {
      html: typeof b.html === "string" ? b.html : "",
      description: typeof b.description === "string" && b.description ? b.description : null,
      category: typeof b.category === "string" && b.category ? b.category : null,
      copiedFrom: typeof b.copiedFrom === "string" && b.copiedFrom ? b.copiedFrom : null,
    };
  }
  return { html: "", description: null, category: null, copiedFrom: null };
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

  const rows = ((data as any[]) ?? []).map((t) => ({ row: t, parsed: parseBody(t.body) }));

  /*
   * Built-ins the team has made their own version of.
   *
   * Editing an example is a copy underneath - RLS will not let anyone write to
   * a row shared by every company - and showing both the copy and the original
   * is how this picker used to read as duplicated. The team's row stands in for
   * the example instead, exactly as it does on the Templates page, so a crew
   * scrolling their trade sees one card per document.
   *
   * The query above already excludes archived rows, so an archived version
   * shadows nothing and the example comes back on its own.
   */
  const shadowed = new Set(
    rows
      .filter((r) => r.row.team_id !== null && r.parsed.copiedFrom)
      .map((r) => r.parsed.copiedFrom),
  );

  const templates: DocumentTemplateSummary[] = rows
    .filter(({ row }) => !(row.team_id === null && shadowed.has(row.id)))
    .map(({ row, parsed }) => ({
      id: row.id,
      name: row.name,
      description: parsed.description,
      category: parsed.category,
      isExample: row.team_id === null,
      fields: (row.fields as string[]) ?? [],
      updatedAt: row.updated_at,
    }));

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
    /*
     * Sanitized on READ, not just on write.
     *
     * A template body is authored HTML that came from a project page, and page
     * HTML is stored raw - sanitizePageHtml was only ever applied on the public
     * share path (pages.ts:632). So a team member could save a page containing
     * script-bearing markup as a template, and every teammate who opened the
     * "Use template" preview would execute it: ChoosePageTemplateDialog.tsx:133
     * renders this exact string with dangerouslySetInnerHTML, and templates are
     * shared team-wide.
     *
     * Sanitizing here rather than only at the insert also disarms rows that are
     * already in the table - a write-side fix alone would leave any existing
     * payload live forever.
     */
    html: sanitizePageHtml(parseBody(row.body).html),
    fields: (row.fields as string[]) ?? [],
  };
}

/** One merge field in a template, paired with what a given project fills it with. */
export interface TemplateFieldPreview {
  token: string;
  label: string;
  /** Resolved from stored data. null means nothing can auto-fill it. */
  value: string | null;
  source: TokenSource;
}

export const previewDocumentTemplateInputSchema = z.object({
  templateId: z.string().uuid(),
  projectId: z.string().uuid(),
});

/**
 * Everything the "Use in a project" step needs to show the finished document
 * before it creates one: the template body, and every merge field in it paired
 * with the value this project resolves it to.
 *
 * Resolution lives here rather than in the dialog on purpose. The web app has
 * its own list of placeholders (DocumentTemplatesManager's `PLACEHOLDERS`) that
 * matched the resolver's only by coincidence, and the coincidence is what put
 * `{{weather}}` in a document handed to a customer.
 */
export async function previewDocumentTemplateService(
  ctx: AuthedContext,
  data: z.infer<typeof previewDocumentTemplateInputSchema>,
): Promise<{
  id: string;
  name: string;
  html: string;
  fields: TemplateFieldPreview[];
  /** What the document will be called, so the dialog can show and edit it. */
  suggestedTitle: string;
}> {
  const template = await getDocumentTemplateService(ctx, { templateId: data.templateId });

  /*
   * The project has to be checked here, not left to the write.
   *
   * `createPageFromTemplateService` resolves against the project too, but it
   * only ever puts the result into a `project_pages` insert that RLS then
   * rejects - so a foreign project id fails and returns nothing. This call
   * hands the resolved values straight back, so an unchecked project id would
   * be a read of someone else's project name and site address. Reading through
   * `ctx.supabase` lets RLS answer it: visible means allowed, including to a
   * teammate, which is exactly the rule the picker in front of this uses.
   *
   * `titleContext` reads that row through the same client, so the check below
   * is the same check, and it comes back with the two things the suggested
   * document title is built from at no extra round trip.
   */
  const { project, taken } = await titleContext(ctx, data.projectId);
  if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });

  const values = await loadTokenValues(data.projectId, ctx.userId);

  const tokens = Array.from(
    new Set(
      Array.from(template.html.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi), (m) => m[1].toLowerCase()),
    ),
  );
  return {
    id: template.id,
    name: template.name,
    suggestedTitle: uniqueDocumentTitle(projectDocumentTitle(project.name, template.name), taken),
    /*
     * Bracket blanks are converted here as well, so the preview is the document
     * rather than a near-miss of it: `createPageFromTemplateService` runs the
     * same call, and a `[Client Name]` left as literal text would preview as
     * words and then arrive as a box. Merge tokens are deliberately left in
     * place - the dialog substitutes those live as their boxes are typed into.
     */
    html: bracketsToFillFields(template.html) ?? template.html,
    fields: tokens.map((token) => ({
      token,
      label: fieldLabel(token),
      value: values[token] || null,
      source: tokenSource(token),
    })),
  };
}

export const createPageFromTemplateInputSchema = z.object({
  projectId: z.string().uuid(),
  templateId: z.string().uuid(),
  folderId: z.string().uuid().nullable().optional(),
  /**
   * What to call the document. Omitted means "decide for me", which is what the
   * blueprint apply and any older client send; `projectDocumentTitle` then names
   * it after the project and the template rather than the template alone.
   *
   * The same limits as every other page title, so a name accepted here cannot
   * be one the editor's rename would refuse.
   */
  title: z.string().trim().min(1).max(200).optional(),
  /** When false the page keeps `{{tokens}}` literal so they can be filled in later. */
  resolveTokens: z.boolean().default(true),
  /**
   * Values typed in the "Use in a project" step, keyed by token. They win over
   * whatever the project resolves to, and they are the only source for the
   * fields nothing stores: weather, client name, project number, job title.
   */
  values: z.record(z.string().max(500)).default({}),
});

export async function createPageFromTemplateService(
  ctx: AuthedContext,
  data: z.infer<typeof createPageFromTemplateInputSchema>,
) {
  const template = await getDocumentTemplateService(ctx, { templateId: data.templateId });

  const resolved = data.resolveTokens
    ? ((await resolvePageTokens(template.html, data.projectId, ctx.userId, data.values)) ??
      template.html)
    : template.html;
  // `[Client Name]` style blanks become click-to-type fields at this point, so
  // the seeded SQL templates gain them without every migration being rewritten.
  const contentHtml = bracketsToFillFields(resolved) ?? resolved;

  /*
   * A title the caller typed is used exactly as typed, numbering included: two
   * documents they deliberately named the same is their filing decision, and
   * silently appending "(2)" to a name somebody just entered is the app arguing
   * with them. Only the name this file invents is made unique.
   */
  let title = data.title;
  if (!title) {
    const { project, taken } = await titleContext(ctx, data.projectId);
    title = uniqueDocumentTitle(projectDocumentTitle(project?.name, template.name), taken);
  }

  const { data: row, error } = await (ctx.supabase as any)
    .from("project_pages")
    .insert({
      project_id: data.projectId,
      folder_id: data.folderId ?? null,
      created_by: ctx.userId,
      title,
      content_html: contentHtml,
      source_template: `document_template:${template.id}`,
    })
    .select("id, title, content_html, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return { page: row };
}

/**
 * A project page turned back into a reusable body.
 *
 * Keep the layout (photo rows, section structure) but never carry this
 * project's actual photos, typed-in answers or merged-in details into a
 * reusable template - see the three helpers, each of which strips one of them.
 * Sanitize on the way in as well, so the stored template is clean rather than
 * merely rendered clean. Read-side sanitizing (getDocumentTemplateService)
 * covers rows written before this; this stops new ones being written at all.
 *
 * Shared by both routes out of a document - saving a new template and updating
 * the one it came from - so the two can never disagree about what a template is
 * allowed to contain.
 */
async function templateBodyFromPage(page: {
  content_html: string;
  project_id: string;
  created_by: string;
}): Promise<{ html: string; fields: string[] }> {
  const sourceValues = await loadTokenValues(page.project_id, page.created_by);
  const html = sanitizePageHtml(
    valuesToTokens(blankFillFields(stripPhotosToSlots(page.content_html)), sourceValues),
  );
  const fields = Array.from(
    new Set(Array.from(html.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi), (m) => m[1].toLowerCase())),
  ).sort();
  return { html, fields };
}

export const savePageAsTemplateInputSchema = z.object({
  pageId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
});

/** "Save as a new template" from the page editor's ··· menu. */
export async function savePageAsTemplateService(
  ctx: AuthedContext,
  data: z.infer<typeof savePageAsTemplateInputSchema>,
) {
  const { data: page, error: pageErr } = await (ctx.supabase as any)
    .from("project_pages")
    .select("content_html, project_id, created_by")
    .eq("id", data.pageId)
    .single();
  if (pageErr || !page) throw new Error("Page not found");

  const { data: membership } = await (ctx.supabase as any)
    .from("team_members")
    .select("team_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();

  const { html, fields } = await templateBodyFromPage(page);

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

export const updateTemplateFromPageInputSchema = z.object({ pageId: z.string().uuid() });

/**
 * Fold this document's layout back into the template it was created from.
 *
 * The missing verb, and the last of the duplication the client reported. A crew
 * that improved a template while filling it in on a job had exactly one way to
 * keep the improvement: "Save as a new template". So the library grew a near
 * copy every time anyone tidied a heading, and the original stayed wrong -
 * "then another template is created ... creating duplicates is a big mess".
 *
 * Overwrites the body only. Name, style, trade and description are the
 * library's, not this page's, so a document retitled for one customer cannot
 * rename the template every other job starts from.
 *
 * Refused on a built-in: those are shared by every team and RLS rejects the
 * write anyway, so it says so rather than failing as a permissions error.
 */
export async function updateTemplateFromPageService(
  ctx: AuthedContext,
  data: z.infer<typeof updateTemplateFromPageInputSchema>,
) {
  const { data: page, error: pageErr } = await (ctx.supabase as any)
    .from("project_pages")
    .select("content_html, project_id, created_by, source_template")
    .eq("id", data.pageId)
    .single();
  if (pageErr || !page) throw new Error("Page not found");

  const templateId = documentTemplateId(page.source_template as string | null);
  if (!templateId) throw new Error("This document wasn't created from a template.");

  const { data: template } = await (ctx.supabase as any)
    .from("document_templates")
    .select("id, name, team_id, body")
    .eq("id", templateId)
    .maybeSingle();
  if (!template)
    throw new Error(
      "The template this came from no longer exists. Save this as a new template instead.",
    );
  if (template.team_id === null)
    throw new Error(
      "Example templates are shared with every company and can't be changed. Save this as a new template instead.",
    );

  const { html, fields } = await templateBodyFromPage(page);
  /*
   * Spread rather than rebuilt: `body` carries the style, the trade the card is
   * filed under and the picker's description alongside the html, and none of
   * those are this page's to decide.
   */
  const body = {
    ...(template.body && typeof template.body === "object" ? template.body : {}),
    html,
  };
  const { error } = await (ctx.supabase as any)
    .from("document_templates")
    .update({ body, fields })
    .eq("id", templateId);
  if (error) throw new Error(error.message);
  return { template: { id: templateId, name: template.name as string } };
}
