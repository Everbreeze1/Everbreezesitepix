import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import { summarizePhotosReportService } from "../ai/service";
import { cleanCaption, markdownToHtml } from "@sitepix/shared";
import { DAILY_LOG_INTERNAL_NOTICE } from "./page-filing";
import { existingPageTitles, projectDocumentTitle, uniqueDocumentTitle } from "./page-title";

/**
 * The Daily Log: the technician's own record, written for them rather than by
 * them.
 *
 * The other two AI artefacts are things a user goes and asks for - an AI
 * Summary of a walkthrough, a Report to hand a client. The Daily Log is not.
 * "Auto-generate Daily Log the moment a technician finishes a Capture/photo
 * upload session, surfaced as a lightweight, always-available result right
 * there in the Capture flow rather than something requiring a trip to Reports
 * to manually generate." So there is no menu item for it and no picker: the
 * capture flow calls this when the upload finishes, and the log is simply
 * there.
 *
 * Three consequences shape the whole module:
 *
 * 1. **One page per project per day, appended to.** A technician makes several
 *    trips to the van and back; each is a capture session, and each firing off
 *    its own page would leave a project with six "Daily Log" rows for one day.
 *    A session adds a timestamped section to today's page instead.
 *
 * 2. **Append, never rewrite.** Regenerating the whole body from every photo
 *    of the day would be a better summary and would also silently delete
 *    whatever the technician typed into it since the last upload. Their own
 *    record is the one document in this product that must never lose an edit
 *    to an automatic write.
 *
 * 3. **Plain, not polished.** No cover page, no executive summary, no photo
 *    cards. Terse bullets and thumbnails. The AI voice is `SITE_LOG_SYSTEM`,
 *    which is already exactly this register.
 */

/** Photos read per session. The capture flow batches, so this is generous. */
const MAX_SESSION_PHOTOS = 60;

/** Thumbnail strip width - four across on a page, small on purpose. */
const LOG_PHOTO_WIDTH = "23%";
const LOG_PHOTO_HEIGHT = 130;

export const autoDailyLogInputSchema = z.object({
  projectId: z.string().uuid(),
  /** The photos this capture session added, in the order they were taken. */
  photoIds: z.array(z.string().uuid()).min(1).max(MAX_SESSION_PHOTOS),
  /** "camera" | "upload" - only used to word the section heading. */
  source: z.enum(["camera", "upload"]).optional(),
});

export interface AutoDailyLogResult {
  pageId: string;
  title: string;
  updatedAt: string;
  /** True when this call created today's page rather than appending to it. */
  created: boolean;
  /** Bullets from THIS session, as plain lines, for the Capture-flow card. */
  entries: string[];
  photoCount: number;
  /** Non-null when the AI was unavailable and the section fell back to a stub. */
  aiFailed: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Local calendar day of an ISO timestamp, as `YYYY-MM-DD`. */
function localDayKey(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The banner that opens every Daily Log page.
 *
 * Rendered into the body rather than drawn only by the editor chrome, because
 * the body is what gets printed, exported to PDF and pasted into an email. A
 * label that exists only on screen is a label that comes off the moment the
 * document leaves the app, which is the exact moment it matters.
 */
function internalNoticeHtml(): string {
  return (
    `<div data-panel="meta">` +
    `<p><span class="panel-label">Daily Log</span>${escapeHtml(DAILY_LOG_INTERNAL_NOTICE)}</p>` +
    `</div>`
  );
}

/** The session's photos as a compact thumbnail strip. */
function photoStripHtml(photoIds: string[]): string {
  if (!photoIds.length) return "";
  const imgs = photoIds
    .map(
      (id) =>
        `<img data-photo-id="${id}" src="" width="${LOG_PHOTO_WIDTH}" height="${LOG_PHOTO_HEIGHT}">`,
    )
    .join("");
  return `<p>${imgs}</p>`;
}

/**
 * Pull the bullet text back out of the Markdown the model returned, for the
 * Capture-flow card.
 *
 * The card shows the log without opening it, so it needs lines rather than
 * HTML. Headings are dropped - "What was done" is the card's own framing - and
 * the bullet markers with them.
 */
function bulletLines(markdown: string): string[] {
  return (markdown ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*+]\s+/.test(line))
    .map((line) =>
      line
        .replace(/^[-*+]\s+/, "")
        .replace(/\*\*/g, "")
        .trim(),
    )
    .filter(Boolean);
}

/**
 * Append this capture session to today's Daily Log for the project, creating
 * the page on the day's first session.
 *
 * Never throws on AI failure: the technician finished their upload and the log
 * is a side effect of that, so a model outage must leave them with a section
 * listing what they added rather than with an error toast over a successful
 * upload.
 */
export async function autoDailyLogService(
  ctx: AuthedContext,
  data: z.infer<typeof autoDailyLogInputSchema>,
): Promise<AutoDailyLogResult> {
  const now = new Date();
  const today = localDayKey(now);

  const { data: project } = await (ctx.supabase as any)
    .from("projects")
    .select("name")
    .eq("id", data.projectId)
    .maybeSingle();
  const projectName = (project?.name as string | null) ?? "";

  /*
   * Today's log, if the technician has already been on site today.
   *
   * Matched on the created_at day rather than on the title: the title is
   * editable from the moment the page opens, and a log renamed "Tuesday - unit
   * 4B" is still today's log. Ordered oldest-first so a project that somehow
   * holds two for one day keeps appending to the first rather than forking.
   */
  const { data: existingRows } = await (ctx.supabase as any)
    .from("project_pages")
    .select("id, title, content_html, created_at")
    .eq("project_id", data.projectId)
    .eq("source_template", "daily_log")
    .order("created_at", { ascending: true });

  const existing = ((existingRows as any[]) ?? []).find(
    (row) => localDayKey(row.created_at) === today,
  );

  // Captions the technician already typed in the field. `.in()` returns rows in
  // arbitrary order, so re-key and walk photoIds to keep capture order.
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
  // Only photos that really exist and really belong to a project this caller
  // can read: RLS answers both questions by simply not returning the row.
  const photoIds = data.photoIds.filter((id) => captionById.has(id));
  if (!photoIds.length) throw new Error("No photos to log");

  let markdown = "";
  let aiFailed: string | null = null;
  try {
    const res = await summarizePhotosReportService(ctx, {
      photoIds,
      title: projectName ? `${projectName} daily log` : undefined,
      mode: "daily_log",
    });
    markdown = res.markdown ?? "";
  } catch (e: any) {
    aiFailed = e?.message ?? "AI unavailable";
  }

  let entries = bulletLines(markdown);
  if (!entries.length) {
    /*
     * The deterministic floor. Captions the technician typed are real record;
     * where there are none, the honest line is the count, not an invented
     * activity. Either way the session is logged.
     */
    const captions = photoIds
      .map((id) => cleanCaption(captionById.get(id) ?? null))
      .filter((c): c is string => !!c);
    entries = captions.length
      ? captions
      : [`${photoIds.length} ${photoIds.length === 1 ? "photo" : "photos"} captured on site`];
  }

  const time = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const verb = data.source === "upload" ? "Photos uploaded" : "Photos captured";
  const sectionHtml =
    `<h2>${escapeHtml(time)} - ${verb}</h2>` +
    (markdown.trim()
      ? // The prompt is told not to emit a title, but strip one defensively.
        markdownToHtml(markdown).replace(/^<h1>.*?<\/h1>/, "")
      : `<ul>${entries.map((e) => `<li><p>${escapeHtml(e)}</p></li>`).join("")}</ul>`) +
    photoStripHtml(photoIds);

  if (existing) {
    const { data: updated, error } = await (ctx.supabase as any)
      .from("project_pages")
      .update({ content_html: `${existing.content_html ?? ""}${sectionHtml}` })
      .eq("id", existing.id)
      .select("id, title, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      pageId: updated.id,
      title: updated.title,
      updatedAt: updated.updated_at,
      created: false,
      entries,
      photoCount: photoIds.length,
      aiFailed,
    };
  }

  const title = uniqueDocumentTitle(
    projectDocumentTitle(projectName, `Daily Log - ${now.toLocaleDateString()}`),
    await existingPageTitles(ctx, data.projectId),
  );
  const { data: created, error } = await (ctx.supabase as any)
    .from("project_pages")
    .insert({
      project_id: data.projectId,
      folder_id: null,
      created_by: ctx.userId,
      title,
      content_html: internalNoticeHtml() + sectionHtml,
      source_template: "daily_log",
    })
    .select("id, title, updated_at")
    .single();
  if (error) throw new Error(error.message);

  return {
    pageId: created.id,
    title: created.title,
    updatedAt: created.updated_at,
    created: true,
    entries,
    photoCount: photoIds.length,
    aiFailed,
  };
}

export const listProjectDailyLogsInputSchema = z.object({ projectId: z.string().uuid() });

export interface DailyLogSummary {
  pageId: string;
  title: string;
  /** Local calendar day the log covers, `YYYY-MM-DD`. */
  day: string;
  createdAt: string;
  updatedAt: string;
  /** Bullets across the whole day, oldest section first. */
  entries: string[];
  photoCount: number;
}

/** Strip the log body back to its bullet lines, for the Capture-flow card. */
function entriesFromHtml(html: string | null | undefined): string[] {
  const out: string[] = [];
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html ?? "")) !== null) {
    const text = m[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * The project's daily logs, newest day first, with enough of each to render the
 * Capture-flow card without opening the page.
 *
 * Separate from `listProjectDocumentTree` on purpose: that call answers "what
 * paperwork does this project hold", and a daily log is deliberately in neither
 * of its two lists.
 */
export async function listProjectDailyLogsService(
  ctx: AuthedContext,
  data: z.infer<typeof listProjectDailyLogsInputSchema>,
): Promise<DailyLogSummary[]> {
  const { data: rows, error } = await (ctx.supabase as any)
    .from("project_pages")
    .select("id, title, content_html, created_at, updated_at")
    .eq("project_id", data.projectId)
    .eq("source_template", "daily_log")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);

  return ((rows as any[]) ?? []).map((row) => ({
    pageId: row.id,
    title: row.title,
    day: localDayKey(row.created_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    entries: entriesFromHtml(row.content_html),
    photoCount: (String(row.content_html ?? "").match(/data-photo-id=/g) ?? []).length,
  }));
}
