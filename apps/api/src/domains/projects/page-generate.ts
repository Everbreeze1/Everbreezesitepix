import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import { summarizePhotosReportService } from "../ai/service";

/**
 * Minimal Markdown → HTML for the constrained subset our AI prompts emit
 * (headings, bullets, bold/italic, paragraphs). Deliberately not a general
 * Markdown parser — adding one would mean a new runtime dependency for a
 * handful of block types we fully control via the system prompt.
 */
export function markdownToHtml(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const inline = (s: string) =>
    escape(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+?)\*/g, "$1<em>$2</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");

  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li><p>${inline(bullet[1])}</p></li>`);
      continue;
    }

    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li><p>${inline(numbered[1])}</p></li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(line.trim())}</p>`);
  }
  closeList();
  return out.join("");
}

/**
 * Photos are persisted as `data-photo-id` only — `src` is re-signed on every
 * read (see resolvePageImages), because signed storage URLs expire.
 *
 * Laid out two per row at 48% width (matching the seeded "Pre-Built Report"
 * templates and apps/web/src/lib/tiptap-photo-slot.ts) rather than one flat
 * unstyled column, so AI-generated pages read as a clean photo grid instead
 * of a stack of full-width images.
 */
const PHOTOS_PER_ROW = 2;
const PHOTO_ROW_WIDTH = "48%";
const PHOTO_ROW_HEIGHT = 280;

/** A selected photo plus the metadata already captured in the field. */
export interface GeneratedPhoto {
  id: string;
  caption: string | null;
}

/**
 * A caption line per photo, directly beneath its row.
 *
 * Seeded from the photo's own caption so field metadata carries into the
 * document instead of being retyped; photos without one get a visible prompt
 * so there is an obvious place to write a comment. Numbering matches the
 * "Photo N" convention the seeded templates use.
 */
function captionLineHtml(photos: GeneratedPhoto[], startIndex: number): string {
  return photos
    .map((p, i) => {
      const n = startIndex + i;
      const text = p.caption?.trim()
        ? escapeHtml(p.caption.trim())
        : `<span style="color: rgb(156,163,175)">Add a comment</span>`;
      return `<p><em><strong>Photo ${n}</strong> &ndash; ${text}</em></p>`;
    })
    .join("");
}

function photoRowHtml(photos: GeneratedPhoto[], startIndex: number): string {
  if (!photos.length) return "";
  const width = photos.length > 1 ? PHOTO_ROW_WIDTH : "70%";
  const imgs = photos
    .map((p) => `<img data-photo-id="${p.id}" src="" width="${width}" height="${PHOTO_ROW_HEIGHT}">`)
    .join("");
  return `<p>${imgs}</p>` + captionLineHtml(photos, startIndex);
}

/** Splits photos into PHOTOS_PER_ROW-wide rows. */
function photoGridHtml(photos: GeneratedPhoto[]): string {
  const rows: string[] = [];
  for (let i = 0; i < photos.length; i += PHOTOS_PER_ROW) {
    rows.push(photoRowHtml(photos.slice(i, i + PHOTOS_PER_ROW), i + 1));
  }
  return rows.join("");
}

/**
 * Splits photos into numbered sections of PHOTOS_PER_ROW each — heading,
 * italic summary line, and a body prompt — mirroring the structure of the
 * seeded report templates (see supabase/migrations/*_document_template_00*.sql)
 * so a "Report" quick-created here looks the same as a pre-built one.
 */
function sectionedReportHtml(photos: GeneratedPhoto[]): string {
  const sections: string[] = [];
  for (let i = 0; i < photos.length; i += PHOTOS_PER_ROW) {
    const n = sections.length + 1;
    sections.push(
      `<h2>Section ${n}</h2><p><em>Section summary</em></p>` +
        `<p>Click to add important info or findings.</p>` +
        photoRowHtml(photos.slice(i, i + PHOTOS_PER_ROW), i + 1),
    );
  }
  return sections.join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const generateProjectPageInputSchema = z.object({
  projectId: z.string().uuid(),
  folderId: z.string().uuid().nullable().optional(),
  template: z.enum(["daily_log", "summary", "report"]),
  photoIds: z.array(z.string().uuid()).min(1).max(50),
  title: z.string().trim().min(1).max(200).optional(),
});

/**
 * Creates a page whose body is drafted by AI from the selected photos —
 * the "Daily Log" / "Summary" flow. Falls back to a structured scaffold if the
 * AI is unavailable so the user always ends up with a usable page.
 */
export async function generateProjectPageService(
  ctx: AuthedContext,
  data: z.infer<typeof generateProjectPageInputSchema>,
) {
  const { data: project } = await (ctx.supabase as any)
    .from("projects")
    .select("name, street, city, state")
    .eq("id", data.projectId)
    .maybeSingle();

  const projectName = project?.name ?? "";
  const address = project
    ? [project.street, project.city, project.state].filter(Boolean).join(", ")
    : "";
  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const { data: profile } = await (ctx.supabase as any)
    .from("profiles")
    .select("full_name")
    .eq("id", ctx.userId)
    .maybeSingle();
  const author = profile?.full_name ?? "";

  const defaultTitle =
    data.template === "daily_log"
      ? `Daily Log - ${new Date().toLocaleDateString()}`
      : data.template === "summary"
        ? `Summary - ${new Date().toLocaleDateString()}`
        : `Report - ${new Date().toLocaleDateString()}`;
  const title = data.title?.trim() || defaultTitle;

  // Captions already recorded in the field become the document's comment
  // lines. `.in()` returns rows in arbitrary order, so re-key by id and walk
  // photoIds to preserve the order the user picked them in.
  const { data: photoRows } = await (ctx.supabase as any)
    .from("photos")
    .select("id, caption")
    .in("id", data.photoIds);
  const captionById = new Map<string, string | null>(
    ((photoRows as Array<{ id: string; caption: string | null }>) ?? []).map((r) => [
      r.id,
      r.caption,
    ]),
  );
  const photos: GeneratedPhoto[] = data.photoIds.map((id) => ({
    id,
    caption: captionById.get(id) ?? null,
  }));

  // AI is best-effort: a generation failure must not cost the user their page.
  let bodyHtml = "";
  let aiFailed: string | null = null;
  if (data.template === "report") {
    bodyHtml = sectionedReportHtml(photos);
  } else {
    try {
      const res = await summarizePhotosReportService(ctx, { photoIds: data.photoIds, title });
      const html = markdownToHtml(res.markdown ?? "");
      // The AI emits its own `# Title` heading; the page already has a title field.
      bodyHtml = html.replace(/^<h1>.*?<\/h1>/, "");
    } catch (e: any) {
      aiFailed = e?.message ?? "AI unavailable";
      bodyHtml = `<h2>Overview</h2><p></p>`;
    }
    bodyHtml += photoGridHtml(photos);
  }

  const header =
    data.template === "daily_log"
      ? `<p><strong>Project Name:</strong> ${escapeHtml(projectName)}</p>` +
        `<p><strong>Project Address:</strong> ${escapeHtml(address)}</p>` +
        `<p><strong>Summary Date:</strong> ${escapeHtml(today)}</p>` +
        (author ? `<p><strong>Takers:</strong> ${escapeHtml(author)}</p>` : "")
      : "";

  const footer =
    data.template === "daily_log"
      ? `<h2>Remaining To-Dos</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Add a to-do here</p></li></ul>` +
        `<h2>Notes</h2><p>Add any additional notes here.</p>`
      : "";

  const contentHtml = header + bodyHtml + footer;

  const { data: row, error } = await (ctx.supabase as any)
    .from("project_pages")
    .insert({
      project_id: data.projectId,
      folder_id: data.folderId ?? null,
      created_by: ctx.userId,
      title,
      content_html: contentHtml,
      source_template: data.template,
    })
    .select("id, title, content_html, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return { page: row, aiFailed };
}
