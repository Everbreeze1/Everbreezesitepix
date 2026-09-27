/**
 * The workspace's reports as one list, as rules.
 *
 * Import-free so it can be tested. Reports live in two tables, the same split
 * the web's `/reports` page lists across: the older builder (`project_reports`,
 * photos plus a written summary) and report pages (`project_pages` filed under
 * Reports, which is what the whole-job report and report templates produce).
 * The phone lists both, so a report written on the web is not missing here.
 *
 * Neither table has a review or sign-off state. What the data does say is
 * whether a built report has a write-up yet, and whether its public link is
 * live, so the sections and pills are drawn from exactly that and nothing
 * more: "Draft" is a built report with no summary, "Shared" is a live link,
 * "Link off" is a revoked one.
 */

export type ReportIndexStatus = "draft" | "shared" | "link_off";

export type ReportIndexItem = {
  kind: "report" | "page";
  id: string;
  projectId: string;
  projectName: string | null;
  title: string;
  updatedAt: string;
  status: ReportIndexStatus;
};

/** A `project_reports` row, as much of it as the index needs. */
export type BuiltReportInput = {
  id: string;
  project_id: string;
  title: string;
  summary: string | null;
  share_token: string | null;
  revoked_at: string | null;
  updated_at: string;
};

/** A row from `listReportPages`, which answers in camelCase. */
export type ReportPageInput = {
  id: string;
  projectId: string;
  projectName: string | null;
  title: string;
  updatedAt: string;
  shareToken: string | null;
  revokedAt: string | null;
};

/**
 * Status of a built report.
 *
 * Draft first: a report with no write-up is not finished whatever its link
 * says, and every report's link is live from the moment it exists
 * (`share_token` defaults on insert), so "shared" alone would call every blank
 * report sent.
 */
export function builtReportStatus(
  report: Pick<BuiltReportInput, "summary" | "share_token" | "revoked_at">,
): ReportIndexStatus {
  if (!report.summary?.trim()) return "draft";
  return report.share_token && !report.revoked_at ? "shared" : "link_off";
}

/** Both tables folded into one list, newest change first. */
export function mergeReportIndex(
  built: BuiltReportInput[],
  pages: ReportPageInput[],
  projectNames: ReadonlyMap<string, string | null>,
): ReportIndexItem[] {
  const items: ReportIndexItem[] = [
    ...built.map((report) => ({
      kind: "report" as const,
      id: report.id,
      projectId: report.project_id,
      projectName: projectNames.get(report.project_id) ?? null,
      title: report.title,
      updatedAt: report.updated_at,
      status: builtReportStatus(report),
    })),
    ...pages.map((page) => ({
      kind: "page" as const,
      id: page.id,
      projectId: page.projectId,
      projectName: page.projectName,
      title: page.title,
      updatedAt: page.updatedAt,
      status: (page.shareToken && !page.revokedAt ? "shared" : "link_off") as ReportIndexStatus,
    })),
  ];
  return items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export type ReportIndexSection = { key: string; title: string; items: ReportIndexItem[] };

/**
 * Drafts first, then this week's, then the rest.
 *
 * Drafts lead because they are the ones somebody still has to do something
 * with; the rest is a record. "This week" is a rolling seven days rather than
 * since Monday, so a report finished on Friday does not vanish into "Earlier"
 * over the weekend. Empty sections are dropped rather than drawn as a heading
 * with nothing under it.
 */
export function groupReportIndex(
  items: ReportIndexItem[],
  now: Date = new Date(),
): ReportIndexSection[] {
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const drafts = items.filter((item) => item.status === "draft");
  const rest = items.filter((item) => item.status !== "draft");
  const recent = rest.filter((item) => Date.parse(item.updatedAt) >= weekAgo);
  const earlier = rest.filter((item) => !(Date.parse(item.updatedAt) >= weekAgo));
  return [
    { key: "drafts", title: "Needs a write-up", items: drafts },
    { key: "week", title: "Updated this week", items: recent },
    { key: "earlier", title: "Earlier", items: earlier },
  ].filter((section) => section.items.length > 0);
}

/** The pill's words. Short states only: a badge truncates to one line. */
export function reportStatusLabel(status: ReportIndexStatus): string {
  return status === "draft" ? "Draft" : status === "shared" ? "Shared" : "Link off";
}

/**
 * The line under a report's title: the job, then when it last changed.
 *
 * "today" and "yesterday" in words, as the design has them, and a short date
 * after that. Local time, because the person reading it is where the work is.
 */
export function reportIndexSubtitle(
  item: Pick<ReportIndexItem, "projectName" | "updatedAt" | "status">,
  now: Date = new Date(),
): string {
  const at = new Date(item.updatedAt);
  const parts: string[] = [];
  if (item.projectName?.trim()) parts.push(item.projectName.trim());
  if (!Number.isNaN(at.getTime())) {
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((day(now) - day(at)) / (24 * 60 * 60 * 1000));
    const when =
      diff === 0
        ? "today"
        : diff === 1
          ? "yesterday"
          : at.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
            });
    parts.push(item.status === "draft" && diff <= 1 ? `drafted ${when}` : when);
  }
  return parts.join(" · ");
}
