import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import { summarizePhotosReportService, draftReportNarrativeService } from "../ai/service";
import {
  PHOTO_ROW_HEIGHT,
  cleanCaption,
  markdownToHtml,
  photoPageGroups,
  photoWidthFor,
} from "@sitepix/shared";
import { existingPageTitles, projectDocumentTitle, uniqueDocumentTitle } from "./page-title";
import { DAILY_LOG_INTERNAL_NOTICE } from "./page-filing";

/**
 * Minimal Markdown → HTML for the constrained subset our AI prompts emit.
 * It lives in @sitepix/shared now, because the walkthrough PDF needs the same
 * conversion to draw a summary's headings and bullets. Re-exported so this
 * module's existing importers do not have to care where it moved to.
 */
export { markdownToHtml };

/**
 * Photos are persisted as `data-photo-id` only - `src` is re-signed on every
 * read (see resolvePageImages), because signed storage URLs expire.
 *
 * Each photo now gets its own shaded card rather than sharing a two-up row,
 * so the image leads and its byline + description sit with it as one designed
 * block. Kept below full width so a portrait phone photo doesn't dominate the
 * page; `object-fit: cover` (styles.css) crops it to the box.
 */
const SINGLE_PHOTO_WIDTH = "62%";
const SINGLE_PHOTO_HEIGHT = 300;

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
 * The one-line form, for a card that holds several photos: byline and caption
 * on the same line, so four photos do not cost eight paragraphs underneath.
 */
function captionLineHtml(photo: GeneratedPhoto, n: number): string {
  const date = formatPhotoDate(photo.takenAt);
  const byline = [`Photo ${n}`, date].filter(Boolean).join(" &middot; ");
  const real = cleanCaption(photo.caption);
  return (
    `<p><span class="panel-caption">${byline}</span>` +
    (real ? ` ${escapeHtml(real)}` : "") +
    `</p>`
  );
}

/**
 * One photo per shaded card: the image sits above its own byline and
 * description, so the picture leads and its details read as a designed unit
 * rather than a loose caption line floating under a grid.
 */
function photoCardHtml(photo: GeneratedPhoto, n: number): string {
  const img = `<img data-photo-id="${photo.id}" src="" width="${SINGLE_PHOTO_WIDTH}" height="${SINGLE_PHOTO_HEIGHT}">`;
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
 * The evidence body of a formal report.
 *
 * At one photo per page this is a heading and a card per photo, with a blank
 * paragraph under each for the author's own findings - the layout somebody who
 * asked for one-up actually wants, where each observation is separately
 * referenceable.
 *
 * At any other density the photos are grouped a page at a time under a single
 * "Photographic record" heading, each group a card holding its rows of images
 * with one caption line per photo. That is the change behind the complaint: a
 * heading and a full-width card per photo meant the PDF renderer only ever had
 * one image to lay out at a time, so a report came back at one picture per
 * sheet no matter how many photos went into it.
 *
 * The row arithmetic is @sitepix/shared's, in "photos" mode: every step of the
 * setting has to fit more on a sheet than the step below it. Measured on a
 * rendered PDF, the editor's 2x2-at-four-up rule broke that - four-up came out
 * at 248pt wide, four to a sheet, which is two-up's layout and less dense than
 * three-up's six. Slots keep the grid because an empty box is a tap target
 * first; finished evidence does not need to be tappable.
 */
export function photoEvidenceHtml(photos: GeneratedPhoto[], perPage: 1 | 2 | 3 | 4): string {
  // No heading over nothing. The picker requires a photo, so this is a guard
  // against a future caller rather than a path users reach.
  if (!photos.length) return "";

  if (perPage === 1) {
    return photos
      .map((p, i) => `<h2>Photo ${i + 1}</h2>` + photoCardHtml(p, i + 1) + `<p></p>`)
      .join("");
  }

  const width = photoWidthFor(perPage, "photos");
  let n = 0;
  const cards = photoPageGroups(photos, perPage, "photos").map((rows) => {
    const imgRows = rows
      .map(
        (row) =>
          `<p>${row
            .map(
              (p) =>
                `<img data-photo-id="${p.id}" src="" width="${width}" height="${PHOTO_ROW_HEIGHT}">`,
            )
            .join("")}</p>`,
      )
      .join("");
    const captions = rows
      .flat()
      .map((p) => captionLineHtml(p, ++n))
      .join("");
    return panelHtml("photo", imgRows + captions);
  });
  return `<h2>Photographic record</h2>` + cards.join("") + `<p></p>`;
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
  /**
   * Report only: how many photos are grouped onto a page of the evidence body,
   * using the shared row rule (four-up is a 2x2 grid). Omitted falls back to
   * `profiles.report_photos_per_page`, then to 2.
   *
   * The Daily Log and the Summary are single-column by design - they are the
   * technician's own record, read on a phone - so they ignore this.
   */
  photosPerPage: z.number().int().min(1).max(4).optional(),
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

  // `select("*")` rather than naming the two columns: PostgREST fails the whole
  // select when one column is unknown, so naming `report_photos_per_page`
  // before 20260821000000_report_photos_per_page_default.sql has been applied
  // would take `full_name` down with it and silently drop the author from every
  // generated cover page.
  const { data: profile } = await (ctx.supabase as any)
    .from("profiles")
    .select("*")
    .eq("id", ctx.userId)
    .maybeSingle();
  const author = profile?.full_name ?? "";

  // Caller's choice, else the author's saved default, else two up.
  const rawPerPage = data.photosPerPage ?? profile?.report_photos_per_page ?? 2;
  const photosPerPage = Math.min(4, Math.max(1, Math.round(Number(rawPerPage) || 2))) as
    | 1
    | 2
    | 3
    | 4;

  /*
   * A generated document is the most client-facing thing this app produces and
   * it was the worst named: "Report - 8/17/2026" says nothing about which site
   * it covers, and `renderPagePdf` turns exactly this string into the download
   * filename, so a customer received `Report_-_8_17_2026.pdf`. Two jobs visited
   * the same morning produced the same filename twice.
   *
   * `projectDocumentTitle` puts the site in front of it, and the numbering
   * covers the second daily log of one day - the date alone cannot tell those
   * apart. Same rule as a document created from a template, deliberately: the
   * two sit in the same list.
   */
  const kind =
    data.template === "daily_log"
      ? `Daily Log - ${new Date().toLocaleDateString()}`
      : data.template === "summary"
        ? `Summary - ${new Date().toLocaleDateString()}`
        : `Report - ${new Date().toLocaleDateString()}`;
  const title =
    data.title?.trim() ||
    uniqueDocumentTitle(
      projectDocumentTitle(projectName, kind),
      await existingPageTitles(ctx, data.projectId),
    );

  // Captions already recorded in the field become the document's comment
  // lines. `.in()` returns rows in arbitrary order, so re-key by id and walk
  // photoIds to preserve the order the user picked them in.
  const { data: photoRows } = await (ctx.supabase as any)
    .from("photos")
    .select("id, caption, taken_at, created_at")
    .in("id", data.photoIds);
  type PhotoRow = {
    id: string;
    caption: string | null;
    taken_at: string | null;
    created_at: string | null;
  };
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
      photoEvidenceHtml(photos, photosPerPage) +
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
        /*
         * A Daily Log is the technician's own record and is labelled as such
         * inside the document, not only around it - the body is what gets
         * exported to PDF and pasted into an email, which is exactly when the
         * distinction stops being obvious. Same constant the automatic
         * generator and the two UI surfaces use.
         *
         * This branch is the older, hand-generated path; nothing in the product
         * still points at it, because the capture flow writes daily logs now
         * (see daily-log.ts). It keeps the label anyway rather than leaving one
         * unlabelled route into the same document.
         */
        ...(data.template === "daily_log"
          ? ([["Visibility", DAILY_LOG_INTERNAL_NOTICE]] as Array<[string, string]>)
          : []),
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
