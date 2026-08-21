import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import { chatComplete } from "../ai/service";
import { cleanCaption, markdownToHtml } from "@sitepix/shared";
import { photoEvidenceHtml, type GeneratedPhoto } from "./page-generate";
import { existingPageTitles, projectDocumentTitle, uniqueDocumentTitle } from "./page-title";
import { stripPhotoGallery } from "../walkthroughs/summaries";

/**
 * The comprehensive Report: the whole job, not one walkthrough.
 *
 * "This one isn't tied to a single walkthrough - it should pull from tags and
 * metadata across all photos on the job, generate in seconds, come out clean
 * and organized, and include client info."
 *
 * The other report the product makes is drafted from a set of photos the user
 * picks. This one picks nothing: it reads the job. Every photo that has not
 * been trashed, with its phase, its tags, its capture date and whatever the
 * technician typed on it, plus the client fields off the project itself.
 *
 * **"generate in seconds" is a design constraint, not a hope.** One model call,
 * over a digest the server builds locally - counts, date span, tag tallies, the
 * captions that say something. Sending a hundred photo records and asking for
 * per-photo prose is what makes a report take a minute; this asks for the
 * narrative only and lets the deterministic half do the organising.
 *
 * **It reads the walkthrough summaries too.** "The comprehensive longer Report
 * that contains all meta data including all walkthrough summery data". Those
 * summaries are the only place on a job where somebody said what was actually
 * happening, so a whole-job report that ignored them would be a report written
 * from filenames and tag counts while the real account of the work sat one
 * table over. They are quoted into the report and fed to the drafter as
 * context.
 */

/** Photos read for the digest. A job with more than this is summarised from a sample. */
const MAX_PHOTOS_SCANNED = 400;
/** Captions handed to the model. Enough to characterise the job, not a transcript. */
const MAX_CAPTIONS_IN_PROMPT = 60;
/** Walkthrough write-ups folded in. A job with more is summarised from these. */
const MAX_SUMMARIES_INCLUDED = 12;
/** Per write-up, so one long one cannot crowd out the rest of the prompt. */
const MAX_SUMMARY_CHARS = 4000;

export const comprehensiveReportInputSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  /** How the evidence pages are laid out. Falls back to the author's default. */
  photosPerPage: z.number().int().min(1).max(4).optional(),
});

interface PhotoRecord {
  id: string;
  caption: string | null;
  phase: string | null;
  takenAt: string | null;
  tags: string[];
}

/** "3 August 2026", or "" when there is no date to print. */
function longDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * What the job looks like, in numbers, before anything is written about it.
 *
 * Computed here rather than asked of the model: a count is a fact and a model
 * asked for one will sometimes produce a plausible different number.
 */
export function digestPhotos(photos: PhotoRecord[]) {
  const dates = photos
    .map((p) => p.takenAt)
    .filter((d): d is string => !!d)
    .sort();
  const byPhase = new Map<string, number>();
  const byTag = new Map<string, number>();
  for (const p of photos) {
    const phase = (p.phase ?? "untagged").trim() || "untagged";
    byPhase.set(phase, (byPhase.get(phase) ?? 0) + 1);
    for (const t of p.tags) byTag.set(t, (byTag.get(t) ?? 0) + 1);
  }
  const captions = photos
    .map((p) => cleanCaption(p.caption))
    .filter((c): c is string => !!c)
    .slice(0, MAX_CAPTIONS_IN_PROMPT);

  return {
    total: photos.length,
    firstAt: dates[0] ?? null,
    lastAt: dates[dates.length - 1] ?? null,
    /** Distinct calendar days work was documented on. */
    days: new Set(dates.map((d) => d.slice(0, 10))).size,
    phases: [...byPhase.entries()].sort((a, b) => b[1] - a[1]),
    tags: [...byTag.entries()].sort((a, b) => b[1] - a[1]),
    captions,
    captioned: photos.filter((p) => cleanCaption(p.caption)).length,
  };
}

const COMPREHENSIVE_SYSTEM =
  "You are SitePix AI writing a formal, client-facing project REPORT covering an entire job. " +
  "Produce EXACTLY these Markdown sections and nothing else:\n" +
  "## Executive Summary\n<3-5 full sentences: the scope of the work documented, over what period, and what the record shows overall>\n\n" +
  "## Work Documented\n<3-6 bullets organising what the photo record covers, grouped by the labels and phases given>\n\n" +
  "## Conclusion\n<2-3 full sentences closing the report out>\n\n" +
  "Write in complete, professional prose. Do NOT invent a photo count, a date, or a label that is not in the figures given - " +
  "those are supplied and are correct. Do NOT include a title or photo-by-photo notes. " +
  "STYLE RULES: neutral and factual. Never call anything 'critical', a 'code violation' or a 'safety hazard'. " +
  "Never invent defects, findings, recommendations or risks the source material does not state. " +
  "If the material is thin, be brief rather than embellishing. " +
  "Never write an em dash; use a comma, a colon or a plain hyphen.";

/**
 * A summary's prose, ready to be reused.
 *
 * The cleaning is not optional. This reads `walkthrough_summaries.markdown`
 * straight from the table, which bypasses the repair `toSummary` performs on
 * every other read - so a summary written before the split arrives with its
 * original `# Title` and its `## Photos` gallery of `![](photo:id)` refs still
 * attached. `markdownToHtml` has no image support, so those refs came out as
 * literal "![Photo 1](photo:76edc...)" text in the middle of a document meant
 * for a client, beneath a duplicate of the title already printed above it.
 */
function summaryProse(markdown: string | null): string {
  return stripPhotoGallery(markdown ?? "").slice(0, MAX_SUMMARY_CHARS);
}

/**
 * A summary's own headings, turned into bold lead-ins.
 *
 * Kept rather than flattened away: "Overview" and "Key Points" are how the
 * write-up is organised, and dropping them left the section reading as an
 * unbroken wall with two orphan words in it.
 *
 * Bold rather than a deeper heading because there is no deeper heading to use.
 * `markdownToHtml` recognises `#{1,3}` and nothing beyond it
 * (packages/shared/src/markdown-rich.ts), so `####` is not a heading at all -
 * it renders as the literal text "#### Overview" - and `###` would collide with
 * the `<h3>` this report already gives each summary.
 */
function demoteHeadings(markdown: string): string {
  return markdown.replace(/^#{1,6}\s*(.+?)\s*$/gm, "**$1**");
}

/**
 * Headings removed entirely, for prompt context only.
 *
 * A model handed source text containing "## Conclusion" tends to echo that
 * structure back instead of writing the sections it was asked for.
 */
function flattenHeadings(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `## Heading` body out of the model's Markdown. */
function section(markdown: string, heading: string): string {
  const re = new RegExp(`^#{1,3}\\s*${heading}\\s*$([\\s\\S]*?)(?=^#{1,3}\\s|$(?![\\s\\S]))`, "im");
  return re.exec(markdown ?? "")?.[1]?.trim() ?? "";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The masthead block: who the job is for, and what it is. */
function clientPanelHtml(fields: Array<[string, string]>): string {
  const rows = fields
    .filter(([, v]) => v)
    .map(
      ([label, v]) =>
        `<p><span class="panel-label">${escapeHtml(label)}</span>${escapeHtml(v)}</p>`,
    )
    .join("");
  return rows ? `<div data-panel="meta">${rows}</div>` : "";
}

/** The figures, as a block the reader can check the prose against. */
function figuresHtml(d: ReturnType<typeof digestPhotos>): string {
  const span =
    d.firstAt && d.lastAt && d.firstAt.slice(0, 10) !== d.lastAt.slice(0, 10)
      ? `${longDate(d.firstAt)} to ${longDate(d.lastAt)}`
      : longDate(d.firstAt);
  const rows: Array<[string, string]> = [
    ["Photos on file", String(d.total)],
    ["Documented", span],
    ["Days on site", d.days ? String(d.days) : ""],
    [
      "Labels",
      d.tags
        .slice(0, 8)
        .map(([t, n]) => `${t} (${n})`)
        .join(", "),
    ],
    [
      "Phases",
      d.phases
        .filter(([p]) => p !== "untagged")
        .map(([p, n]) => `${p} (${n})`)
        .join(", "),
    ],
  ];
  return clientPanelHtml(rows);
}

/**
 * The walkthrough write-ups, quoted into the report.
 *
 * Reproduced rather than merely referenced: this document is the one a client
 * receives, and "see the walkthrough summary" is not something they can act on.
 * Each keeps its own heading and its date so the report reads as a record of
 * visits rather than one undifferentiated wall of prose.
 */
function walkthroughSummariesHtml(
  summaries: Array<{ title: string; markdown: string | null; created_at: string }>,
): string {
  if (!summaries.length) return "";
  return (
    `<h2>Walkthrough Summaries</h2>` +
    summaries
      .map((r) => {
        const when = longDate(r.created_at);
        return (
          `<h3>${escapeHtml(r.title)}${when ? ` &middot; ${escapeHtml(when)}` : ""}</h3>` +
          markdownToHtml(demoteHeadings(summaryProse(r.markdown)))
        );
      })
      .join("")
  );
}

/**
 * Build the whole-job report and file it under Reports.
 *
 * Writes a `project_pages` row with `source_template: "report"`, which is what
 * puts it in the Reports tab - the same filing rule every other report follows,
 * so this needed no new bucket.
 */
export async function generateComprehensiveReportService(
  ctx: AuthedContext,
  data: z.infer<typeof comprehensiveReportInputSchema>,
) {
  const { data: project } = await (ctx.supabase as any)
    .from("projects")
    .select("*")
    .eq("id", data.projectId)
    .maybeSingle();
  if (!project) throw new Error("Project not found or access denied");

  // Every photo still on the job, newest last so the evidence reads forward.
  const { data: photoRows, error: photoErr } = await (ctx.supabase as any)
    .from("photos")
    .select("id, caption, phase, tags, taken_at, created_at")
    .eq("project_id", data.projectId)
    .is("deleted_at", null)
    .order("taken_at", { ascending: true, nullsFirst: false })
    .limit(MAX_PHOTOS_SCANNED);
  if (photoErr) throw new Error(photoErr.message);

  const rows = (photoRows as any[]) ?? [];
  if (!rows.length) throw new Error("This job has no photos to report on yet");

  /*
   * Labels live in two places: the `tags` array on the photo and the
   * `photo_tags` join table. Both are read, because a job labelled through the
   * tag picker and one labelled on upload would otherwise produce different
   * reports for the same work.
   */
  const tagsByPhoto = new Map<string, string[]>();
  const { data: tagRows } = await (ctx.supabase as any)
    .from("photo_tags")
    .select("photo_id, tags(name)")
    .in(
      "photo_id",
      rows.map((r) => r.id),
    );
  for (const row of (tagRows as any[]) ?? []) {
    const name = (row as any).tags?.name;
    if (!name) continue;
    const list = tagsByPhoto.get(row.photo_id) ?? [];
    list.push(name);
    tagsByPhoto.set(row.photo_id, list);
  }

  const photos: PhotoRecord[] = rows.map((r) => ({
    id: r.id,
    caption: r.caption ?? null,
    phase: r.phase ?? null,
    takenAt: r.taken_at ?? r.created_at ?? null,
    tags: Array.from(
      new Set([...(Array.isArray(r.tags) ? r.tags : []), ...(tagsByPhoto.get(r.id) ?? [])]),
    ).filter((t) => typeof t === "string" && t.trim()),
  }));

  const digest = digestPhotos(photos);
  const address = [project.street, project.city, project.state, project.zip]
    .filter(Boolean)
    .join(", ");

  /*
   * Every write-up already made on this job, newest last so the report reads
   * forward through the work.
   *
   * Read on the caller's own client: if RLS will not show them a summary, it
   * does not belong in a document issued in their name.
   */
  const { data: summaryRows } = await (ctx.supabase as any)
    .from("walkthrough_summaries")
    .select("id, title, markdown, created_at, walkthrough_id")
    .eq("project_id", data.projectId)
    .order("created_at", { ascending: true })
    .limit(MAX_SUMMARIES_INCLUDED);
  const summaries = ((summaryRows as any[]) ?? []).filter((r) => (r.markdown ?? "").trim());

  // One call, over the digest. See the note at the top about "in seconds".
  let summary = "";
  let work = "";
  let conclusion = "";
  let aiFailed: string | null = null;
  try {
    const markdown = await chatComplete(
      COMPREHENSIVE_SYSTEM,
      `Project: ${project.name ?? "(unnamed)"}
${address ? `Address: ${address}\n` : ""}${project.client_name ? `Client: ${project.client_name}\n` : ""}${
        project.project_number ? `Job number: ${project.project_number}\n` : ""
      }
FIGURES (these are correct - use them, do not invent others):
- Photos on file: ${digest.total}
- Documented between: ${longDate(digest.firstAt) || "unknown"} and ${longDate(digest.lastAt) || "unknown"}
- Distinct days on site: ${digest.days}
- Phase breakdown: ${digest.phases.map(([p, n]) => `${p}: ${n}`).join(", ") || "none recorded"}
- Labels used: ${digest.tags.map(([t, n]) => `${t}: ${n}`).join(", ") || "none"}
- Photos carrying a written note: ${digest.captioned} of ${digest.total}

Notes the technicians typed on site:
${digest.captions.map((c) => `- ${c}`).join("\n") || "(none)"}

Walkthrough write-ups on this job (${summaries.length}):
${summaries.map((r) => `### ${r.title}\n${flattenHeadings(summaryProse(r.markdown))}`).join("\n\n") || "(none)"}

Write the three Markdown sections only.`,
    );
    summary = section(markdown, "Executive Summary");
    work = section(markdown, "Work Documented");
    conclusion = section(markdown, "Conclusion");
  } catch (e: any) {
    if (e?.status === 403) throw e;
    aiFailed = e?.message ?? "AI unavailable";
    console.error("[comprehensive-report] AI draft failed", { message: aiFailed });
  }

  const { data: profile } = await (ctx.supabase as any)
    .from("profiles")
    .select("*")
    .eq("id", ctx.userId)
    .maybeSingle();
  const perPage = Math.min(
    4,
    Math.max(
      1,
      Math.round(Number(data.photosPerPage ?? profile?.report_photos_per_page ?? 2) || 2),
    ),
  ) as 1 | 2 | 3 | 4;

  const evidence: GeneratedPhoto[] = photos.map((p) => ({
    id: p.id,
    caption: p.caption,
    takenAt: p.takenAt,
  }));

  const title =
    data.title?.trim() ||
    uniqueDocumentTitle(
      projectDocumentTitle(project.name, `Project Report - ${new Date().toLocaleDateString()}`),
      await existingPageTitles(ctx, data.projectId),
    );

  /*
   * Client info leads, because "include client info" is what makes this the
   * document somebody hands over rather than an internal tally.
   */
  const contentHtml =
    clientPanelHtml([
      ["Project", project.name ?? ""],
      ["Client", project.client_name ?? ""],
      ["Contact", project.client_contact ?? ""],
      ["Job number", project.project_number ?? ""],
      ["Location", address],
      ["Prepared by", profile?.full_name ?? ""],
      ["Issued", new Date().toLocaleDateString(undefined, { dateStyle: "long" } as never)],
    ]) +
    figuresHtml(digest) +
    /*
     * A heading with nothing under it is worse than no heading.
     *
     * When the model is unreachable these three sections come back empty, and
     * printing `<h2>Executive Summary</h2><p></p>` puts a blank promise on a
     * document somebody hands to a client. Omitted instead: the report still
     * carries the client details, the figures and the photographic record, and
     * the caller is told through `aiFailed` so it can say the text is missing.
     */
    (summary ? `<h2>Executive Summary</h2>` + markdownToHtml(summary) : "") +
    (work ? `<h2>Work Documented</h2>` + markdownToHtml(work) : "") +
    walkthroughSummariesHtml(summaries) +
    photoEvidenceHtml(evidence, perPage) +
    (conclusion ? `<h2>Conclusion</h2>` + markdownToHtml(conclusion) : "");

  const { data: page, error } = await (ctx.supabase as any)
    .from("project_pages")
    .insert({
      project_id: data.projectId,
      folder_id: null,
      created_by: ctx.userId,
      title,
      content_html: contentHtml,
      // The same kind every other generated report uses, so page-filing.ts
      // puts it in the Reports tab without a new rule.
      source_template: "report",
    })
    .select("id, title, updated_at")
    .single();
  if (error) throw new Error(error.message);

  return { page, aiFailed, photoCount: digest.total, summaryCount: summaries.length };
}
