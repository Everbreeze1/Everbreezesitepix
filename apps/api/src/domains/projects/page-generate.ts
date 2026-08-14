import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import { summarizePhotosReportService, draftReportNarrativeService } from "../ai/service";
import { cleanCaption } from "@sitepix/shared";

/**
 * Minimal Markdown → HTML for the constrained subset our AI prompts emit
 * (headings, bullets, bold/italic, paragraphs). Deliberately not a general
 * Markdown parser - adding one would mean a new runtime dependency for a
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
 * Photos are persisted as `data-photo-id` only - `src` is re-signed on every
 * read (see resolvePageImages), because signed storage URLs expire.
 *
 * Each photo now gets its own shaded card rather than sharing a two-up row,
 * so the image leads and its byline + description sit with it as one designed
 * block. Kept below full width so a portrait phone photo doesn't dominate the
 * page; `object-fit: cover` (styles.css) crops it to the box.
 */
const PHOTO_ROW_WIDTH = "62%";
const PHOTO_ROW_HEIGHT = 300;

/** A selected photo plus the metadata already captured in the field. */
export interface GeneratedPhoto {
  id: string;
  caption: string | null;
  /** When the shot was taken, for the card's byline. */
  takenAt: string | null;
}

/** "3 August 2026" - the byline date on a photo card. */
function formatPhotoDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * The caption block beneath a photo inside its card: a small-caps byline
 * ("PHOTO 3 · 3 AUGUST 2026") above the description.
 *
 * Captions are run through `cleanCaption` first: uploads default the caption to
 * the source filename (`IMG_1234.JPG`, `sitepix-178155…jpg`), which is not
 * information - printing it made documents read as though every photo were
 * annotated when none were. A photo with nothing real recorded says so plainly
 * instead of showing its filename.
 */
function captionBlockHtml(photo: GeneratedPhoto, n: number): string {
  const date = formatPhotoDate(photo.takenAt);
  const byline = [`Photo ${n}`, date].filter(Boolean).join(" &middot; ");
  const real = cleanCaption(photo.caption);
  const body = real
    ? `<p>${escapeHtml(real)}</p>`
    : `<p><em style="color: rgb(156,163,175)">No information was recorded for this photo.</em></p>`;
  return `<p><span class="panel-caption">${byline}</span></p>` + body;
}

/**
 * One photo per shaded card: the image sits above its own byline and
 * description, so the picture leads and its details read as a designed unit
 * rather than a loose caption line floating under a grid.
 */
function photoCardHtml(photo: GeneratedPhoto, n: number): string {
  const img = `<img data-photo-id="${photo.id}" src="" width="${PHOTO_ROW_WIDTH}" height="${PHOTO_ROW_HEIGHT}">`;
  return panelHtml("photo", `<p>${img}</p>` + captionBlockHtml(photo, n));
}

/** `<div data-panel="…">` - the InfoPanel node (apps/web/src/lib/tiptap-info-panel.ts). */
function panelHtml(variant: "meta" | "photo", inner: string): string {
  return `<div data-panel="${variant}">${inner}</div>`;
}

/**
 * The document masthead: project, location, date and author as labelled
 * fields inside a shaded block, rather than one dim run-on line.
 */
function metaPanelHtml(fields: Array<[string, string]>): string {
  const rows = fields
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<p><span class="panel-label">${escapeHtml(label)}</span>${escapeHtml(value)}</p>`,
    )
    .join("");
  return rows ? panelHtml("meta", rows) : "";
}

/** Every photo as its own card, in the order the user picked them. */
function photoGridHtml(photos: GeneratedPhoto[]): string {
  return photos.map((p, i) => photoCardHtml(p, i + 1)).join("");
}

/**
 * The evidence body of a formal report: a heading per photo card so each
 * observation is independently referenceable, with room under it for the
 * author's own findings.
 */
function sectionedReportHtml(photos: GeneratedPhoto[]): string {
  return photos
    .map((p, i) => {
      const n = i + 1;
      return `<h2>Observation ${n}</h2>` + photoCardHtml(p, n) + `<p></p>`;
    })
    .join("");
}

/**
 * Title page for a generated report - the same shape as the seeded "Pre-Built
 * Report" templates: rules top and bottom, oversized centred title, muted
 * address/date, and a Spacer paragraph sized to push the body onto page two.
 * (See apps/web/src/lib/tiptap-spacer.ts - an empty `<p style="height:…">` is
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
 * Creates a page whose body is drafted by AI from the selected photos -
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
    .select("id, caption, taken_at, created_at")
    .in("id", data.photoIds);
  type PhotoRow = { id: string; caption: string | null; taken_at: string | null; created_at: string | null };
  const rowById = new Map<string, PhotoRow>(
    ((photoRows as PhotoRow[]) ?? []).map((r) => [r.id, r]),
  );
  const photos: GeneratedPhoto[] = data.photoIds.map((id) => {
    const row = rowById.get(id);
    return {
      id,
      caption: row?.caption ?? null,
      // Fall back to upload time when the camera recorded no EXIF timestamp,
      // so a card always carries a date rather than an empty byline.
      takenAt: row?.taken_at ?? row?.created_at ?? null,
    };
  });

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
    // bullets, photos - deliberately not dressed up as a client deliverable.
    let bodyHtml = "";
    try {
      const res = await summarizePhotosReportService(ctx, {
        photoIds: data.photoIds,
        title,
        mode: data.template === "summary" ? "summary" : "daily_log",
      });
      // The prompt is told not to emit a title, but strip one defensively -
      // the page already has a title field.
      bodyHtml = markdownToHtml(res.markdown ?? "").replace(/^<h1>.*?<\/h1>/, "");
    } catch (e: any) {
      aiFailed = e?.message ?? "AI unavailable";
      bodyHtml = `<h2>What was done</h2><ul><li><p></p></li></ul>`;
    }
    contentHtml =
      metaPanelHtml([
        ["Project", projectName],
        ["Location", address],
        ["Date", today],
        ["Prepared by", author],
      ]) +
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
