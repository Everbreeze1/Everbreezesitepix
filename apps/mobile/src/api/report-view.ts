/**
 * Reading and building a report, as rules.
 *
 * Import-free so it can be tested. The sharing rules are the ones that matter:
 * a report is the one thing in this product that gets sent to somebody outside
 * the workspace, and getting "is this link live" wrong in either direction is a
 * real problem. Saying a revoked link works has somebody send a dead URL to a
 * client; saying a live link is dead has them revoke and reissue for nothing,
 * breaking the link the client already has.
 */

export type ReportRow = {
  id: string;
  project_id: string;
  title: string;
  summary: string | null;
  photo_ids: string[] | null;
  include_project_info: boolean;
  share_token: string | null;
  allow_download: boolean;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The photo ids on a report, whatever the column holds. */
export function reportPhotoIds(report: Pick<ReportRow, "photo_ids">): string[] {
  return Array.isArray(report.photo_ids)
    ? report.photo_ids.filter((id) => typeof id === "string")
    : [];
}

/**
 * Whether the public link currently works.
 *
 * `share_token` is `NOT NULL DEFAULT gen_random_uuid()`, so every report has
 * one from the moment it exists and the token's presence says nothing about
 * whether sharing is on. `revoked_at` is the switch. Reading the token as the
 * signal, which is the obvious mistake, reports every report ever created as
 * publicly readable.
 */
export function isReportShared(report: Pick<ReportRow, "share_token" | "revoked_at">): boolean {
  return Boolean(report.share_token) && !report.revoked_at;
}

/**
 * The patch that turns sharing on or off.
 *
 * Turning it back on clears `revoked_at` rather than minting a new token, so a
 * link somebody sent last month starts working again. That is deliberate and it
 * cuts both ways: revoking is not a way to invalidate a leaked link forever,
 * because un-revoking restores it. A permanent kill is deleting the report.
 */
export function shareTogglePatch(enable: boolean, now: () => Date = () => new Date()) {
  return { revoked_at: enable ? null : now().toISOString() };
}

/** What the share row says about itself. */
export function shareStatusLabel(report: Pick<ReportRow, "share_token" | "revoked_at">): string {
  return isReportShared(report)
    ? "Anyone with the link can read this"
    : "Not shared. Turn it on to get a link.";
}

/** The column's ceiling, shared by both kinds of report. */
export const MAX_REPORT_TITLE = 200;

export function reportTitleError(title: string): string | null {
  const value = title.trim();
  if (!value) return "Give the report a title.";
  if (value.length > MAX_REPORT_TITLE) {
    return `Keep the title under ${MAX_REPORT_TITLE} characters.`;
  }
  return null;
}

/**
 * A default title for a new report.
 *
 * The project name and the date, because a project accumulates them and three
 * called "Report" is a list nobody can navigate. Local date parts rather than
 * `toISOString`, which names a report written at 9pm after the following day.
 */
export function defaultReportTitle(projectName: string, now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const name = projectName.trim();
  return name ? `${name} ${date}` : `Report ${date}`;
}

/** The line under a report in the list. */
export function reportSummaryLine(report: ReportRow): string {
  const photos = reportPhotoIds(report).length;
  const parts = [`${photos} photo${photos === 1 ? "" : "s"}`];
  if (!report.summary?.trim()) parts.push("no write-up yet");
  if (isReportShared(report)) parts.push("shared");
  return parts.join(" · ");
}

/**
 * Whether a report is worth sending.
 *
 * A report with no photos and no summary is an empty page with a letterhead.
 * The screen offers to share it anyway, because it is the person's call, but it
 * says this first: the failure mode is somebody sending a blank report to a
 * client and finding out from the client.
 */
export function isReportEmpty(report: ReportRow): boolean {
  return reportPhotoIds(report).length === 0 && !report.summary?.trim();
}

/* ----------------------------------------------- the whole-job report ----- */

/**
 * How many photographs go on each page of evidence.
 *
 * The server's bound is 1 to 4 and it rejects anything else, so these are the
 * only four values worth offering. One per page is a document somebody reads;
 * four is a contact sheet with a caption. Two is the default because it is the
 * one that survives being printed.
 */
export const PHOTOS_PER_PAGE_CHOICES = [1, 2, 3, 4] as const;
export const DEFAULT_PHOTOS_PER_PAGE = 2;

/**
 * The whole-job report's title rule, which is NOT `reportTitleError`.
 *
 * Deliberately a second function rather than a shared one: a built report needs
 * a title because a person is naming it, and `comprehensiveReportInputSchema`
 * marks it `.optional()` because the service writes its own when none is given.
 * Folding them together would either force a title the server does not want or
 * stop asking for one the builder does.
 */
export function comprehensiveTitleError(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_REPORT_TITLE) {
    return `That title is ${trimmed.length - MAX_REPORT_TITLE} characters too long.`;
  }
  return null;
}

export function photosPerPageError(value: number): string | null {
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    return "Pick between one and four photos a page.";
  }
  return null;
}

/**
 * What the report came out as, in one line.
 *
 * Counts rather than adjectives, because the number is the thing somebody
 * checks: a whole-job report built from four photographs means somebody is
 * about to send a client a document with four photographs in it.
 */
export function reportBuiltSummary(result: { photoCount: number; summaryCount: number }): string {
  const photos = `${result.photoCount} photo${result.photoCount === 1 ? "" : "s"}`;
  if (result.summaryCount === 0) return `Built from ${photos}.`;
  const walks = `${result.summaryCount} walkthrough write-up${result.summaryCount === 1 ? "" : "s"}`;
  return `Built from ${photos} and ${walks}.`;
}

/**
 * What to warn about after a report is generated, or null.
 *
 * `aiFailed` is not a failure of the report - it is still produced, and still
 * carries the client details, the figures and the photographic record. What it
 * loses is the three WRITTEN sections, which the service omits rather than
 * printing empty headings. Somebody about to send this to a client needs to
 * know which half is missing, in those words.
 */
export function reportAiWarning(result: { aiFailed: string | null }): string | null {
  if (!result.aiFailed) return null;
  return "The written sections could not be generated, so this report has the photos, figures and client details but no summary text. Generate it again when the AI service is reachable.";
}

/**
 * Whether a generated report is worth opening at all.
 *
 * A report over a job with no photographs is a cover page and a set of client
 * details. The service will produce one and it is not an error, but saying so
 * beforehand is kinder than letting somebody find out by sending it.
 */
export function emptyJobWarning(photoCount: number): string | null {
  if (photoCount > 0) return null;
  return "There are no photos on this job yet, so the report will have no photographic record in it.";
}

/**
 * The clock time on a report, for telling two of them apart.
 *
 * Reports are titled from their date, so two written on the same day carry the
 * same name. On the phone their subtitles match too - same photo count, same
 * "no write-up yet", same "2w ago" - which leaves two rows that are identical
 * in every visible respect, each with its own delete button.
 *
 * That is not a theoretical hazard. Two reports on this workspace were created
 * 32 minutes apart on 29 July and render as the same row twice.
 *
 * Local time, because the person reading it is standing where the work
 * happened, and 24-hour because "00:33" is unambiguous where "12:33 AM" invites
 * a second look.
 */
export function reportClockTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * Which reports in a list need their time shown.
 *
 * Only the ones that would otherwise be indistinguishable. Stamping a time on
 * every row would be noise on the common case, where the title already says
 * which report this is.
 */
export function ambiguousReportIds(
  reports: ReadonlyArray<{ id: string; title: string }>,
): Set<string> {
  const byTitle = new Map<string, string[]>();
  for (const report of reports) {
    const key = report.title.trim();
    byTitle.set(key, [...(byTitle.get(key) ?? []), report.id]);
  }
  const ambiguous = new Set<string>();
  for (const ids of byTitle.values()) {
    if (ids.length > 1) for (const id of ids) ambiguous.add(id);
  }
  return ambiguous;
}
