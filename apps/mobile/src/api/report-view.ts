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

export function reportTitleError(title: string): string | null {
  const value = title.trim();
  if (!value) return "Give the report a title.";
  if (value.length > 200) return "Keep the title under 200 characters.";
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
