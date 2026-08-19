/**
 * Where a project page files: Reports, Invoices, or Documents.
 *
 * The client's complaint was that generated reports and stored paperwork were
 * the same list: "Right now Reports get mixed with Documents. This problem was
 * starting us in the face along time." Splitting them needs one rule about
 * what a report is, and it needs to be the same rule everywhere - the project
 * tab counts, the two lists, and anything that later wants to ask "is this a
 * report". That rule lives here and nowhere else.
 *
 * Two inputs decide it, in order:
 *
 * 1. `project_pages.source_template`. The AI writes a literal kind there -
 *    "daily_log", "report", "summary" - and those three are reports by
 *    definition. Nobody has to configure anything for the thing the client
 *    actually asked for to work.
 *
 * 2. Otherwise the page came from a document template, and the template says
 *    where its pages file. `style` cannot answer this: every one of the 43
 *    seeded templates carries `style: 'report'`, so it is a constant and
 *    discriminates nothing. `filesUnder` is a separate field, set per template
 *    in Templates > Documents, and it defaults to "report" because in this
 *    product nearly every template is a field report - a site visit report, a
 *    punch list, a condition survey. The handful that are not (a timesheet, an
 *    invoice) get switched once and every page made from them follows.
 *
 * A blank page belongs to nobody, so it files as a document.
 */

/** The three lists a page can belong to. Invoices are a Documents category. */
export type FilingBucket = "report" | "invoice" | "document";

/**
 * `source_template` values the AI writes for its own output.
 *
 * These are reports whatever any template says, because no template was
 * involved: `page-generate.ts` writes the bare kind. "summary" is included for
 * completeness - a summary normally becomes a walkthroughs row rather than a
 * page, but the encoding is documented as possible in `pages.ts` and a report
 * list that silently dropped one would be a worse bug than a redundant branch.
 */
const AI_REPORT_SOURCES = new Set(["report", "daily_log", "summary"]);

/**
 * A document template's filing bucket, from its jsonb `body`.
 *
 * Defaults to "report" on anything unrecognised, including a body that has
 * never been given the field. That default is the migration: every existing
 * template starts filing under Reports, which is where all but a few of them
 * belong, and the exceptions are one click each.
 */
export function parseFilesUnder(body: unknown): FilingBucket {
  if (body && typeof body === "object") {
    const raw = (body as Record<string, unknown>).filesUnder;
    if (raw === "invoice" || raw === "document" || raw === "report") return raw;
  }
  return "report";
}

/**
 * Which list a page belongs to.
 *
 * `templateFilesUnder` is the bucket of the document template the page was
 * made from, or null when the page was not made from one (blank page, or a
 * template that has since been deleted). A deleted template leaves the page
 * filed as a document rather than guessing, so it stays reachable in storage
 * instead of appearing in a report list it may have nothing to do with.
 */
export function classifyPage(
  sourceTemplate: string | null | undefined,
  templateFilesUnder: FilingBucket | null,
): FilingBucket {
  if (typeof sourceTemplate === "string" && AI_REPORT_SOURCES.has(sourceTemplate)) return "report";
  return templateFilesUnder ?? "document";
}

/** Reports tab shows this bucket; Documents shows the other two. */
export function isReportBucket(bucket: FilingBucket): boolean {
  return bucket === "report";
}
