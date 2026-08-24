import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import { summarizePhotosReportService } from "../ai/service";
import { cleanCaption, markdownToHtml } from "@everlumen/shared";
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

/** Recent logs scanned to find today's. More than a day's worth, cheaply. */
const RECENT_LOGS_SCANNED = 8;
/** Days of history the Capture-flow card can show. */
const RECENT_LOGS_LISTED = 14;

/** Thumbnail strip width - four across on a page, small on purpose. */
const LOG_PHOTO_WIDTH = "23%";
const LOG_PHOTO_HEIGHT = 130;

export const autoDailyLogInputSchema = z.object({
  projectId: z.string().uuid(),
  /** The photos this capture session added, in the order they were taken. */
  photoIds: z.array(z.string().uuid()).min(1).max(MAX_SESSION_PHOTOS),
  /** "camera" | "upload" - only used to word the section heading. */
  source: z.enum(["camera", "upload"]).optional(),
  /**
   * The caller's `Date.prototype.getTimezoneOffset()`: minutes to subtract from
   * UTC to get their wall clock (Sacramento in summer sends 420).
   *
   * Load-bearing, not decoration. "Daily" has to mean the technician's day, and
   * the API runs in UTC: a 6:30pm job in California is already tomorrow to the
   * server, so grouping on the server's clock filed Wednesday evening's photos
   * into Thursday's log and then appended Thursday morning's to the same page.
   * Two work days merged into one, seven hours out of every twenty-four.
   *
   * Absent falls back to 0, which is the server's own clock - the old behaviour,
   * and correct for a caller that really is on UTC.
   */
  tzOffsetMinutes: z.number().int().min(-840).max(840).optional(),
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

/**
 * The calendar day an instant falls on, in a named offset, as `YYYY-MM-DD`.
 *
 * Shifting the instant and then reading its UTC fields is the whole trick: it
 * gives the wall-clock date in that zone without needing a timezone database,
 * and without the process's own `TZ` getting a vote. `getFullYear()` and
 * friends would read the server's zone, which is exactly the bug.
 *
 * Fixed-offset, so it does not know that a zone's offset changes at a DST
 * boundary. The caller sends today's offset and the comparison is against logs
 * from the last day or two, so the only way to be wrong is a capture session
 * spanning the hour the clocks move - where either answer is defensible.
 */
export function dayKeyInZone(value: string | Date, offsetMinutes: number): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/**
 * A `YYYY-MM-DD` day key as the date a person would write.
 *
 * Formatted through UTC deliberately: the key already carries the technician's
 * calendar day, so letting the server's zone interpret it again would shift it
 * straight back by one.
 */
function readableDay(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString(undefined, { timeZone: "UTC" });
}

/** Wall-clock `HH:MM` in the same offset, for the section heading. */
function timeInZone(value: Date, offsetMinutes: number): string {
  const shifted = new Date(value.getTime() - offsetMinutes * 60_000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
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
 * One capture session, as a block of page HTML.
 *
 * Exported because this is the string-munging half of the module and the half
 * that shows up in the technician's document: a heading, the model's bullets,
 * and the photos. Everything around it is database calls.
 *
 * The heading is the timestamp, so the model's own "What was done" heading is
 * dropped - stacked under "14:32 - Photos captured" it rendered two full-size
 * headings in a row saying the same thing. A later heading the model emits
 * ("Follow-ups") is kept, because that one carries what the timestamp does not.
 *
 * `entries` is only used when the model gave us nothing: it is the
 * deterministic floor the caller worked out, and the session gets logged either
 * way.
 */
export function sessionSectionHtml(args: {
  /** Wall-clock `HH:MM` in the technician's zone. */
  time: string;
  source?: "camera" | "upload";
  /** The model's Markdown, or "" when it was unavailable. */
  markdown: string;
  entries: string[];
  photoIds: string[];
}): string {
  const verb = args.source === "upload" ? "Photos uploaded" : "Photos captured";
  const heading = `<h2>${escapeHtml(args.time)} - ${verb}</h2>`;

  // The prompt is told not to emit a title, but an h1 is stripped defensively:
  // the page already has a title field.
  const body = args.markdown.trim()
    ? markdownToHtml(args.markdown)
        .replace(/^<h1>.*?<\/h1>/, "")
        .replace(/^<h2>\s*What was done\s*<\/h2>/i, "")
    : `<ul>${args.entries.map((e) => `<li><p>${escapeHtml(e)}</p></li>`).join("")}</ul>`;

  return heading + body + photoStripHtml(args.photoIds);
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
  const tz = data.tzOffsetMinutes ?? 0;
  const today = dayKeyInZone(now, tz);

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
   * 4B" is still today's log.
   */
  const { data: recentRows } = await (ctx.supabase as any)
    .from("project_pages")
    .select("id, created_at")
    .eq("project_id", data.projectId)
    .eq("source_template", "daily_log")
    .order("created_at", { ascending: false })
    .limit(RECENT_LOGS_SCANNED);

  /*
   * Deliberately two queries. Only today's body is going to be appended to, and
   * `content_html` is the largest column on the table - selecting it for every
   * daily log the project has ever held, to read one of them, put the cost of
   * this call on a busy job's whole history.
   *
   * Newest-first with a small limit, then the OLDEST of today's matches: a
   * project that somehow holds two logs for one day keeps appending to the
   * first rather than forking a second timeline.
   */
  const todayRows = ((recentRows as any[]) ?? []).filter(
    (row) => dayKeyInZone(row.created_at, tz) === today,
  );
  const existingId = todayRows.length ? todayRows[todayRows.length - 1].id : null;
  let existing: { id: string; content_html: string | null } | null = null;
  if (existingId) {
    const { data: row } = await (ctx.supabase as any)
      .from("project_pages")
      .select("id, content_html")
      .eq("id", existingId)
      .maybeSingle();
    existing = (row as any) ?? null;
  }

  /*
   * Captions the technician already typed in the field.
   *
   * Scoped to the project as well as to the ids. RLS alone would let a caller
   * name photos from another job they happen to have access to and have them
   * written into this job's log - not a data leak, since they can read both,
   * but it would file one site's work under another's, which is the filing
   * mistake this whole feature exists to stop making.
   *
   * `.in()` returns rows in arbitrary order, so re-key and walk photoIds to
   * keep capture order.
   */
  const { data: photoRows } = await (ctx.supabase as any)
    .from("photos")
    .select("id, caption")
    .eq("project_id", data.projectId)
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

  const sectionHtml = sessionSectionHtml({
    time: timeInZone(now, tz),
    source: data.source,
    markdown,
    entries,
    photoIds,
  });

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
    projectDocumentTitle(projectName, `Daily Log - ${readableDay(today)}`),
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
  /**
   * No `day` field, on purpose.
   *
   * The server cannot say which calendar day a log belongs to without knowing
   * whose calendar - and `createdAt` is an absolute instant the browser can
   * resolve against its own clock for free. A day computed here would be the
   * server's day, which is the mistake this whole module now avoids.
   */
  createdAt: string;
  updatedAt: string;
  /** Bullets across the whole day, oldest section first. */
  entries: string[];
  photoCount: number;
}

/**
 * Strip the log body back to its bullet lines, for the Capture-flow card.
 *
 * Exported for test. It parses whatever HTML is in the column, which includes
 * bodies written by generators that predate this module and bodies a technician
 * has since edited by hand in the rich text editor.
 */
export function entriesFromHtml(html: string | null | undefined): string[] {
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
    // Two weeks of history. The card shows one log and a collapsed list of
    // earlier days, and every row costs a `content_html` read.
    .limit(RECENT_LOGS_LISTED);
  if (error) throw new Error(error.message);

  return ((rows as any[]) ?? []).map((row) => ({
    pageId: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    entries: entriesFromHtml(row.content_html),
    photoCount: (String(row.content_html ?? "").match(/data-photo-id=/g) ?? []).length,
  }));
}
