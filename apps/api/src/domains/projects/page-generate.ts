import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import { summarizePhotosReportService, draftReportNarrativeService } from "../ai/service";
import { cleanCaption } from "@sitepix/shared";

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
 * Captions are run through `cleanCaption` first: uploads default the caption to
 * the source filename (`IMG_1234.JPG`, `sitepix-178155…jpg`), which is not
 * information — printing it made documents read as though every photo were
 * annotated when none were. A photo with nothing real recorded says so plainly
 * instead of showing its filename.
 */
function captionLineHtml(photos: GeneratedPhoto[], startIndex: number): string {
  return photos
    .map((p, i) => {
      const n = startIndex + i;
      const real = cleanCaption(p.caption);
      const text = real
        ? `<em>${escapeHtml(real)}</em>`
        : `<em style="color: rgb(156,163,175)">No information was recorded for this photo.</em>`;
      return `<p><strong>Photo ${n}</strong> &ndash; ${text}</p>`;
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

/**
 * Title page for a generated report — the same shape as the seeded "Pre-Built
 * Report" templates: rules top and bottom, oversized centred title, muted
 * address/date, and a Spacer paragraph sized to push the body onto page two.
 * (See apps/web/src/lib/tiptap-spacer.ts — an empty `<p style="height:…">` is
 * deliberate blank space that the PDF renderer honours.)
 */
function coverPageHtml(args: {
  title: string;
  projectName: string;
  address: string;
  today: string;
  author: string;
}): string {
  const line = (text: string, color: string, size?: string) =>
    text
      ? `<p style="text-align:center"><span style="${size ? `font-size: ${size}; ` : ""}color: ${color}">${escapeHtml(text)}</span></p>`
      : "";
  return (
    `<hr>` +
    `<h1 style="text-align:center"><span style="font-size: 34px">${escapeHtml(args.projectName || args.title)}</span></h1>` +
    line(args.address, "rgb(107,114,128)") +
    line(args.today, "rgb(156,163,175)") +
    `<p style="height: 420px"></p>` +
    (args.author
      ? `<p style="text-align:center"><span style="font-size: 12px; color: rgb(156,163,175)">Prepared by ${escapeHtml(args.author)}</span></p>`
      : "") +
    `<hr>`
  );
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
  let contentHtml = "";
  let aiFailed: string | null = null;

  if (data.template === "report") {
    // Formal, client-facing: title page, opening summary, photo sections,
    // closing conclusion.
    let summary = "";
    let conclusion = "";
    try {
      const res = await draftReportNarrativeService(ctx, { photoIds: data.photoIds, title });
      summary = markdownToHtml(res.summary);
      conclusion = markdownToHtml(res.conclusion);
    } catch (e: any) {
      aiFailed = e?.message ?? "AI unavailable";
    }
    contentHtml =
      coverPageHtml({ title, projectName, address, today, author }) +
      `<h2>Executive Summary</h2>` +
      (summary || `<p></p>`) +
      sectionedReportHtml(photos) +
      `<h2>Conclusion</h2>` +
      (conclusion || `<p></p>`);
  } else {
    // Site log: the technician's own quick record. Compact header, terse
    // bullets, photos — deliberately not dressed up as a client deliverable.
    let bodyHtml = "";
    try {
      const res = await summarizePhotosReportService(ctx, {
        photoIds: data.photoIds,
        title,
        mode: data.template === "summary" ? "summary" : "daily_log",
      });
      // The prompt is told not to emit a title, but strip one defensively —
      // the page already has a title field.
      bodyHtml = markdownToHtml(res.markdown ?? "").replace(/^<h1>.*?<\/h1>/, "");
    } catch (e: any) {
      aiFailed = e?.message ?? "AI unavailable";
      bodyHtml = `<h2>What was done</h2><ul><li><p></p></li></ul>`;
    }
    const meta = [
      projectName ? `<strong>${escapeHtml(projectName)}</strong>` : "",
      address ? escapeHtml(address) : "",
      escapeHtml(today),
      author ? escapeHtml(author) : "",
    ]
      .filter(Boolean)
      .join(" &middot; ");
    contentHtml =
      `<p><span style="color: rgb(107,114,128)">${meta}</span></p>` +
      bodyHtml +
      photoGridHtml(photos);
  }

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
