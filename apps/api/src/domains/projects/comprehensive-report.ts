import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import { chatComplete, WORK_VOICE_RULES } from "../ai/service";
import { cleanCaption, markdownToHtml } from "@everlumen/shared";
import { coverPageHtml, photoEvidenceHtml, type GeneratedPhoto } from "./page-generate";
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
 * **It reads the walkthrough summaries, and writes from them.** Those summaries
 * are the only place on a job where somebody said out loud what was actually
 * happening, so a whole-job report that ignored them would be written from
 * filenames and tag counts while the real account of the work sat one table
 * over. They reach the drafter as source material and come back folded into its
 * three sections.
 *
 * **They are never reprinted.** "Full Project Report is also listing the
 * walkthrough summaries in series in the same report. Walkthrough Summary and
 * Full Project Report are completely separate things. Full project report
 * gathers all meta data including AI summaries and writes a polished client
 * facing document." A Summary is its own document with its own page and its own
 * share link; quoting each one under its own heading turned the back half of
 * this report into a stack of other documents, and a stack of summaries is not
 * a report however few of them survive the filtering below. The write-ups go to
 * the model, not to the page.
 *
 * **The current one, per walkthrough. Not the whole table.**
 * `walkthrough_summaries` gains a row per generation, so reading it by project
 * hands back every write-up ever made on the job - which is how "the 194
 * Daniels Drive report shows four near-identical Summary blocks in its body
 * instead of one" happened. Nothing is quoted any more and the filtering still
 * matters: four accounts of one walk in the context is what makes a narrative
 * describe four visits. `currentSummaries` reduces those rows to the current
 * summary of each thing summarised, before the prompt sees them.
 */

/** Photos read for the digest. A job with more than this is summarised from a sample. */
const MAX_PHOTOS_SCANNED = 400;
/** Captions handed to the model. Enough to characterise the job, not a transcript. */
const MAX_CAPTIONS_IN_PROMPT = 60;
/**
 * Summary rows read before they are reduced to the current one of each.
 *
 * Higher than the number that can survive: superseded rows are read only to be
 * dropped, and a walkthrough whose summary has been regenerated a dozen times
 * would otherwise spend the whole allowance on copies of one write-up.
 */
const MAX_SUMMARY_ROWS_SCANNED = 200;
/** Walkthrough write-ups folded in, once the superseded ones are dropped. */
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
    .map((p) => {
      const caption = cleanCaption(p.caption);
      if (!caption) return null;
      /*
       * The phase rides with the note rather than being tallied separately.
       * "Attic unit before service" and "Condenser after replacement" are the
       * same sentence shape and only the phase says which one is evidence that
       * the work was finished.
       */
      const phase = (p.phase ?? "").trim().toLowerCase();
      return phase && phase !== "untagged" ? `[${phase}] ${caption}` : caption;
    })
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

/**
 * The whole-job Report's voice.
 *
 * Three of these sections used to ask for the wrong thing, and the client named
 * every symptom: "keeps saying This was photo documentation for a Contactor
 * Replacement. Instead it should say, a Contactor was replaced (...) The
 * conclusion is too short and it should also convey what has been done."
 *
 * The Executive Summary asked for "the scope of the work documented (...) what
 * the record shows", the middle section was NAMED "Work Documented" and asked
 * for "what the photo record covers", and the Conclusion asked for two or three
 * sentences of closing with no instruction to say what the job had achieved. A
 * model given those briefs writes about documentation, at length, and then stops
 * short exactly where the customer wants the summary of work. It was doing as it
 * was told.
 *
 * So: the section is Work Performed, the bullets lead with the component and the
 * action, the Conclusion is four to six sentences and has to restate the work,
 * and `WORK_VOICE_RULES` bans the documentation framing outright.
 */
const COMPREHENSIVE_SYSTEM =
  "You are Everlumen AI writing a formal, client-facing project REPORT covering an entire job. " +
  "Produce EXACTLY these Markdown sections and nothing else:\n" +
  "## Executive Summary\n<3-5 full sentences: what work was carried out on this job, on which equipment, " +
  "over what period. Lead with the work itself>\n\n" +
  "## Work Performed\n<3-6 bullets. Each names a component and what was done to it, and where the material " +
  "gives a date, when: '- Contactor replaced, 12 August', '- Control board replaced', " +
  "'- Condenser coil cleaned'. Group related work together. These bullets are the heart of the report>\n\n" +
  "## Conclusion\n<4-6 full sentences restating what was completed on this job, naming the components " +
  "involved, plus any next steps the material states. This is what a customer reads to see what they paid " +
  "for, so it must say what was done. If the material genuinely supports less, write less rather than " +
  "padding - but never close on a sentence about documentation>\n\n" +
  "Write in complete, professional prose. Do NOT invent a photo count, a date, or a label that is not in the figures given - " +
  "those are supplied and are correct. The figures are context for you, not the story of the job: do not recite them back. " +
  "Do NOT include a title or photo-by-photo notes. " +
  "You may also be given the field write-ups from this job's walkthroughs. They are SOURCE MATERIAL, not content: " +
  "take the components, the work and the dates out of them and fold that into the three sections above, alongside " +
  "what the notes say. Never reproduce a write-up, never give a visit a section or a heading of its own, and never " +
  "tell the reader to see a summary elsewhere - this report is the whole of what they receive. Where the write-ups " +
  "and the notes cover the same work, say it once. " +
  WORK_VOICE_RULES +
  " STYLE RULES: neutral and factual. Never call anything 'critical', a 'code violation' or a 'safety hazard'. " +
  "Never invent defects, findings, recommendations or risks the source material does not state. " +
  "Say less rather than padding: a longer Conclusion must come from more work having been done, never from " +
  "restating the same work in more words. " +
  "Never write an em dash; use a comma, a colon or a plain hyphen.";

/**
 * A summary's prose, ready to hand to the drafter.
 *
 * The cleaning is not optional. This reads `walkthrough_summaries.markdown`
 * straight from the table, which bypasses the repair `toSummary` performs on
 * every other read - so a summary written before the split arrives with its
 * original `# Title` and its `## Photos` gallery of `![](photo:id)` refs still
 * attached. Back when the write-ups were quoted into the document those refs
 * reached the client as literal "![Photo 1](photo:76edc...)" text; they now
 * reach the model instead, where a block of image refs is both noise and an
 * invitation to write about the photographs rather than about the work.
 */
export function summaryProse(markdown: string | null): string {
  return stripPhotoGallery(markdown ?? "").slice(0, MAX_SUMMARY_CHARS);
}

/**
 * The minimum of a summary row this file needs to choose between two of them.
 *
 * Structural, not the full row: the service reads more columns than this and
 * the tests build rows with fewer, and neither should have to match a shape
 * that only exists to be compared.
 */
export interface SummaryRowForSelection {
  id: string;
  walkthrough_id?: string | null;
  photo_notes?: unknown;
  markdown?: string | null;
  created_at?: string | null;
}

/** Prose reduced to comparable words, so two spellings of one body match. */
function proseFingerprint(markdown: string | null | undefined): string {
  return summaryProse(markdown ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * What a summary row is a summary OF.
 *
 * Rows sharing a key are the same write-up written more than once, so only the
 * latest of them is current:
 *
 * - a recorded walk, by `walkthrough_id`. Regenerating a walkthrough's summary
 *   inserts a row rather than replacing one, and the Summary page itself shows
 *   the newest, so a Report quoting an older one would quote text the author
 *   cannot find anywhere in the product.
 * - a set of photos, by the photo ids in `photo_notes`. A summary written from
 *   photos has no walkthrough to key on; run twice over the same selection it
 *   is one summary drafted twice, not two accounts of the job.
 * - anything left, by its prose, which at worst keeps a row that deserved
 *   keeping and at best drops a duplicate of one already in hand.
 */
function summaryGroupKey(row: SummaryRowForSelection): string {
  if (row.walkthrough_id) return `walkthrough:${row.walkthrough_id}`;
  const photoIds = summaryPhotoIds(row);
  if (photoIds.size) return `photos:${[...photoIds].sort().join(",")}`;
  const prose = proseFingerprint(row.markdown);
  return prose ? `prose:${prose}` : `summary:${row.id}`;
}

/** The distinct photos a summary was drafted from. Empty when it names none. */
function summaryPhotoIds(row: SummaryRowForSelection): Set<string> {
  if (!Array.isArray(row.photo_notes)) return new Set();
  return new Set(
    (row.photo_notes as any[])
      .map((n) => n?.photoId)
      .filter((id): id is string => typeof id === "string" && !!id),
  );
}

/**
 * A write-up drafted again after the selection grew.
 *
 * The exact-set key above catches Generate pressed twice over the same photos.
 * It does not catch the other half of the same habit, which is the one the
 * client hit: "It's generating the old version of summery. The updated summery
 * currently generating is good." Tick two more photos, press Generate again,
 * and the new row keys on a different set - so the report printed the
 * superseded write-up and the good one, with the superseded one leading
 * because the section reads forward through the job.
 *
 * Containment is the test, not overlap. `older` goes only when every photo it
 * was drafted from is also in `newer`, which is what redrafting after adding
 * photos looks like and is not what two accounts of one job look like: photos
 * of the roof and photos of the basement are disjoint sets and both survive,
 * and a later focused brief over three of nine photos does not swallow the
 * nine-photo write-up it was narrowed out of.
 *
 * Walkthroughs never take part. A recorded walk is a visit with its own date
 * and its own place in the record, so it can neither supersede nor be
 * superseded by a summary somebody wrote from photos that happen to cover it.
 * That case is already handled, one rule further down, by the prose.
 */
function supersedes(newer: SummaryRowForSelection, older: SummaryRowForSelection): boolean {
  if (newer.walkthrough_id || older.walkthrough_id) return false;
  const olderIds = summaryPhotoIds(older);
  if (!olderIds.size) return false;
  const newerIds = summaryPhotoIds(newer);
  if (newerIds.size < olderIds.size) return false;
  for (const id of olderIds) if (!newerIds.has(id)) return false;
  return true;
}

/**
 * When a summary was written, as a number.
 *
 * Parsed rather than compared as text. `timestamptz` reaches this as whatever
 * PostgREST renders, which is not one fixed spelling: an offset can arrive as
 * `Z` or as `+00:00`, and fractional seconds are present only when they are
 * non-zero. Lexicographically `...:00Z` sorts after `...:00.5+00:00`, so
 * comparing the strings puts the earlier row last exactly when two rows land in
 * the same second - which is what a regenerate-twice does.
 *
 * An unparseable or absent date sorts oldest. It cannot be treated as newest:
 * that would let a row with no date supersede the summary the author is looking
 * at.
 */
function summaryTime(row: SummaryRowForSelection): number {
  const t = Date.parse(row.created_at ?? "");
  return Number.isNaN(t) ? 0 : t;
}

/** Newest first, with the id breaking a tie so the result never depends on input order. */
function newestFirst(a: SummaryRowForSelection, b: SummaryRowForSelection): number {
  return summaryTime(b) - summaryTime(a) || b.id.localeCompare(a.id);
}

/**
 * The current summary of each thing summarised, oldest first.
 *
 * The Report is a project-level document and it is right for it to draw on the
 * write-ups; it is not right for it to reprint the table. Given four rows that
 * are four generations of one walkthrough's summary, this returns the fourth,
 * and the Report carries one block where it used to carry four.
 *
 * Three rules, narrowest first: the same thing summarised twice (`summaryGroupKey`),
 * the same thing summarised again over a wider selection (`supersedes`), and the
 * same body arriving under two keys (the prose). Each only ever drops a row that
 * a later row already covers, so a job's write-ups can be reduced but never lost.
 *
 * Exported and pure so the rule is testable without a database: the filtering
 * is the whole fix, and a fix living inside a query is a fix nothing can pin.
 */
export function currentSummaries<T extends SummaryRowForSelection>(rows: T[]): T[] {
  const currentByGroup = new Map<string, T>();
  for (const row of rows) {
    const key = summaryGroupKey(row);
    const held = currentByGroup.get(key);
    if (!held || newestFirst(row, held) < 0) currentByGroup.set(key, row);
  }

  /*
   * Two more passes, both newest first so the copy that survives is the current
   * one, then back to oldest first for the caller.
   *
   * The selection, first. A redraft over a selection that has since grown keys
   * differently from the row it replaces, so the exact-set key above cannot see
   * it; `supersedes` can, and it is checked against what has already been kept,
   * every one of which is newer than the row being judged.
   *
   * Then the prose. Two groups can still hold the same body: a walkthrough
   * summarised, then the same photos summarised again on their own, gives one
   * row keyed by the walk and one keyed by the photos.
   */
  const claimedBy = new Map<string, string | null>();
  const kept: T[] = [];
  for (const row of [...currentByGroup.values()].sort(newestFirst)) {
    if (kept.some((newer) => supersedes(newer, row))) continue;
    const prose = proseFingerprint(row.markdown);
    if (prose) {
      const holder = claimedBy.get(prose);
      /*
       * Two different walks that happen to read the same are still two visits,
       * and each carries its own title and date in the report. That is not a
       * curiosity: a summary the drafter could not write falls back to fixed
       * text, so two walks documented on a day the model was unreachable have
       * identical bodies, and dropping one of them would silently take a walk
       * off a report that lists the rest.
       */
      const bothWalkthroughs = !!row.walkthrough_id && !!holder;
      if (holder !== undefined && !bothWalkthroughs) continue;
      if (holder === undefined) claimedBy.set(prose, row.walkthrough_id ?? null);
    }
    kept.push(row);
  }
  return kept.reverse();
}

/**
 * Headings removed entirely, because prompt context is all a write-up is now.
 *
 * A model handed source text containing "## Conclusion" tends to echo that
 * structure back instead of writing the sections it was asked for.
 */
export function flattenHeadings(markdown: string): string {
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

/**
 * The figures, as a block the reader can check the prose against.
 *
 * No count of walkthroughs here, though the write-ups no longer appear on the
 * page and one was tried. Nothing this file can reach is the number a label
 * like that would promise: the summary rows say how many walks were summarised
 * and are capped, and a walk recorded but never summarised is invisible here
 * either way. A figure a client cannot reconcile is worse than no figure, and
 * "Days on site" already answers how much time the job took.
 */
function figuresHtml(d: ReturnType<typeof digestPhotos>): string {
  const span =
    d.firstAt && d.lastAt && d.firstAt.slice(0, 10) !== d.lastAt.slice(0, 10)
      ? `${longDate(d.firstAt)} to ${longDate(d.lastAt)}`
      : longDate(d.firstAt);
  const rows: Array<[string, string]> = [
    ["Photos on file", String(d.total)],
    ["Work period", span],
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
 * When each walk actually happened, by walkthrough id.
 *
 * `started_at` first, falling back to the row's own `created_at`; a summary
 * whose walkthrough has since been deleted, or one written from photos with no
 * walk at all, is not in the map and keeps its own date. Read on the caller's
 * client like everything else here: a walk RLS will not show them cannot date a
 * document issued in their name.
 */
async function walkthroughVisitDates(
  ctx: AuthedContext,
  walkthroughIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(walkthroughIds)];
  const dates = new Map<string, string>();
  if (!ids.length) return dates;
  const { data } = await (ctx.supabase as any)
    .from("walkthroughs")
    .select("id, started_at, created_at")
    .in("id", ids);
  for (const row of ((data as any[]) ?? []) as any[]) {
    const when = row.started_at ?? row.created_at;
    if (when) dates.set(row.id, when);
  }
  return dates;
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
   * The current write-up for each walkthrough on this job, oldest first so the
   * report reads forward through the work.
   *
   * Newest rows first out of the table and `currentSummaries` after it, because
   * what has to be dropped is the superseded copies, not the recent ones: this
   * table gains a row every time somebody regenerates a summary, and quoting
   * all of them is what put four near-identical blocks in one report.
   * `photo_notes` is selected for the same reason - it is how a summary written
   * from photos alone, which has no `walkthrough_id` to key on, is recognised
   * as another run over the same selection.
   *
   * Read on the caller's own client: if RLS will not show them a summary, it
   * does not belong in a document issued in their name.
   */
  const { data: summaryRows } = await (ctx.supabase as any)
    .from("walkthrough_summaries")
    .select("id, title, markdown, created_at, walkthrough_id, photo_notes")
    .eq("project_id", data.projectId)
    .order("created_at", { ascending: false })
    .limit(MAX_SUMMARY_ROWS_SCANNED);
  const current = currentSummaries(
    ((summaryRows as any[]) ?? []).filter((r) => (r.markdown ?? "").trim()),
  );
  // `currentSummaries` returns oldest first, so the tail is the recent work: a
  // job with more walkthroughs than the cap keeps those rather than whatever
  // happened to be documented first.
  const summaries = current.slice(-MAX_SUMMARIES_INCLUDED);

  /*
   * Dated by the visit and ordered by it, so the drafter reads the job forward
   * and can date the work by when it was done rather than by when its write-up
   * was last redone. A summary regenerated three weeks after the walk carries
   * that later `created_at`, and a date the model repeats is one a customer
   * checks against the invoice.
   *
   * The cap above is by row age, which is a different question from reading
   * order: it decides which walks make it in, this decides what order they sit
   * in once they have.
   */
  const visitDates = await walkthroughVisitDates(
    ctx,
    summaries.map((r) => r.walkthrough_id).filter((id): id is string => !!id),
  );
  const dated = summaries
    .map((r) => ({
      ...r,
      documentedAt: (r.walkthrough_id ? visitDates.get(r.walkthrough_id) : null) ?? r.created_at,
    }))
    .sort((a, b) => String(a.documentedAt ?? "").localeCompare(String(b.documentedAt ?? "")));

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
- Work carried out between: ${longDate(digest.firstAt) || "unknown"} and ${longDate(digest.lastAt) || "unknown"}
- Distinct days on site: ${digest.days}
- Phase breakdown: ${digest.phases.map(([p, n]) => `${p}: ${n}`).join(", ") || "none recorded"}
- Labels used: ${digest.tags.map(([t, n]) => `${t}: ${n}`).join(", ") || "none"}
- Photos carrying a written note: ${digest.captioned} of ${digest.total}

What the technicians recorded doing on site (these are your source for the work performed):
${digest.captions.map((c) => `- ${c}`).join("\n") || "(none)"}

Field write-ups from the walkthroughs on this job (${dated.length}), oldest first. SOURCE MATERIAL: fold what they say into the three sections. Do not reproduce them and do not give any visit a section of its own:
${
  dated
    .map((r, i) => {
      const when = longDate(r.documentedAt);
      return `Write-up ${i + 1} of ${dated.length}${when ? `, ${when}` : ""}:\n${flattenHeadings(summaryProse(r.markdown))}`;
    })
    .join("\n\n") || "(none)"
}

Write the three Markdown sections only.`,
    );
    summary = section(markdown, "Executive Summary");
    work = section(markdown, "Work Performed");
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
   * The title page, then the client info.
   *
   * "The project full report with the title page has disappeared." It opened on
   * a panel of field labels, which is how an internal tally opens, not how the
   * document somebody hands to a customer does - and the other report the
   * product makes has had a cover since it was written. Same `coverPageHtml`,
   * so the two cannot drift into looking like different products; the subtitle
   * is what tells them apart on the page.
   *
   * The panel under it carries the client and nothing else. It used to open the
   * document and so had to say what the document was about: project, location,
   * who prepared it, when it was issued. The cover says all four now, a few
   * centimetres higher, and printing them again immediately underneath is how
   * a title page reads as a header somebody forgot to delete. What is left is
   * the half a cover page has nowhere to put, which is also the half the
   * client asked for: "include client info".
   *
   * Safe to drop unconditionally, not only when the cover is full: every one
   * of the four is printed by the cover under exactly the condition that would
   * have made it non-empty here, and `clientPanelHtml` already omits a row
   * whose value is empty.
   */
  const contentHtml =
    coverPageHtml({
      title,
      projectName: project.name ?? "",
      address,
      today: new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      author: profile?.full_name ?? "",
      subtitle: "Full Project Report",
    }) +
    clientPanelHtml([
      ["Client", project.client_name ?? ""],
      ["Contact", project.client_contact ?? ""],
      ["Job number", project.project_number ?? ""],
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
     *
     * That is also the whole of what a failed draft costs the walkthroughs.
     * Their write-ups are input to these three sections rather than a section
     * of their own, so a report drafted while the provider was down carries no
     * account of the visits - which is correct, and is not a reason to fall
     * back on pasting the summaries in: the author regenerates and gets the
     * document they asked for.
     */
    (summary ? `<h2>Executive Summary</h2>` + markdownToHtml(summary) : "") +
    (work ? `<h2>Work Performed</h2>` + markdownToHtml(work) : "") +
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
