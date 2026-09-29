import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { signReportPhotos } from "./report-builder";
import {
  mergeReportIndex,
  pagesForProject,
  reportBlueprintNames,
  reportThumbPhotoIds,
  type BlueprintSources,
  type BuiltReportInput,
  type ReportCardSource,
  type ReportIndexItem,
  type ReportPageInput,
  type ReportSectionPhotos,
} from "./report-index-view";

/**
 * Every report in the workspace, across projects, for the Reports screen.
 *
 * The same two reads the web's `/reports` page makes (`ReportsIndexPage`):
 * `project_reports` straight through RLS, and `listReportPages` for the report
 * pages, whose filing rules (which template files under Reports) live in the
 * service and are not worth copying to the phone.
 *
 * The pages call is allowed to fail on its own, as the web allows it: losing
 * the page reports is a shorter list, not a broken screen, and a built report
 * somebody is looking for should not be hidden by an outage in the other half.
 */
export async function listAllReports(): Promise<ReportIndexItem[]> {
  const [builtResult, pages] = await Promise.all([
    supabase
      .from("project_reports")
      .select("id, project_id, title, summary, share_token, revoked_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(500),
    api
      .rpc<{ reports?: ReportPageInput[] }>("listReportPages", {})
      .then((result) => result?.reports ?? [])
      .catch((error: unknown) => {
        console.warn("[reports] report pages unavailable", {
          message: error instanceof Error ? error.message : String(error),
        });
        return [] as ReportPageInput[];
      }),
  ]);
  if (builtResult.error) throw new Error(builtResult.error.message);
  const rows = (builtResult.data as BuiltReportInput[]) ?? [];

  /*
   * Names by a second query, not an embed, for the reason `listGalleryPhotoPage`
   * gives. Deleted projects are dropped here as the pages service drops them,
   * so a report on a binned job does not linger in one half of the list only.
   */
  const names = new Map<string, string | null>();
  const deleted = new Set<string>();
  const projectIds = Array.from(new Set(rows.map((row) => row.project_id)));
  // Chunked: PostgREST echoes `.in()` ids in a header that overflows near 400.
  for (let i = 0; i < projectIds.length; i += 200) {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, deleted_at")
      .in("id", projectIds.slice(i, i + 200));
    // A failure costs the job names, not the reports.
    if (error) continue;
    type Row = { id: string; name: string | null; deleted_at: string | null };
    for (const project of (data as Row[]) ?? []) {
      if (project.deleted_at) deleted.add(project.id);
      else names.set(project.id, project.name);
    }
  }
  const built = rows.filter((row) => !deleted.has(row.project_id));

  return mergeReportIndex(built, pages, names);
}

/**
 * One job's report pages: the whole-job report, reports from selected photos,
 * and documents from report templates. The web's project Reports tab lists
 * exactly these; the built reports are read separately.
 */
export async function listProjectReportPages(projectId: string): Promise<ReportIndexItem[]> {
  const result = await api.rpc<{ reports?: ReportPageInput[] }>("listReportPages", {});
  return pagesForProject(result?.reports ?? [], projectId);
}

/** What a report card draws beside its words: a photo and a blueprint chip. */
export type ReportCardExtras = {
  /** Signed thumbnail URL per built report id. */
  thumbs: Record<string, string>;
  /** Blueprint name per built report id, for the ones a blueprint produced. */
  blueprints: Record<string, string>;
};

/**
 * Thumbnails and blueprint chips for a list of built reports, as the web's
 * Reports page resolves them.
 *
 * Its own query, after the list, so the words draw at once and the pictures
 * fill in. Every step is best-effort: a card without its photo or chip is
 * still a card, and nothing here may stand between somebody and a report.
 *
 * `source_template` is asked for and dropped if the database does not have it
 * yet, for the reason the web gives: PostgREST refuses the whole select over
 * one unknown column, and losing the chip is better than losing the photos.
 */
export async function listReportCardExtras(reportIds: string[]): Promise<ReportCardExtras> {
  const ids = Array.from(new Set(reportIds));
  if (ids.length === 0) return { thumbs: {}, blueprints: {} };

  const rows: ReportCardSource[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const withSource = await supabase
      .from("project_reports")
      .select("id, project_id, cover_photo_ids, source_template")
      .in("id", slice);
    if (!withSource.error) {
      rows.push(...((withSource.data as ReportCardSource[]) ?? []));
      continue;
    }
    const plain = await supabase
      .from("project_reports")
      .select("id, project_id, cover_photo_ids")
      .in("id", slice);
    if (!plain.error) rows.push(...((plain.data as ReportCardSource[]) ?? []));
  }

  const coverless = rows
    .filter((row) => !Array.isArray(row.cover_photo_ids) || row.cover_photo_ids.length === 0)
    .map((row) => row.id);
  const sections: ReportSectionPhotos[] = [];
  for (let i = 0; i < coverless.length; i += 200) {
    const { data, error } = await supabase
      .from("project_report_sections")
      .select("report_id, position, photos")
      .in("report_id", coverless.slice(i, i + 200))
      .order("position", { ascending: true });
    if (!error) sections.push(...((data as ReportSectionPhotos[]) ?? []));
  }

  const photoFor = reportThumbPhotoIds(rows, sections);
  let signed: Record<string, string> = {};
  try {
    signed = await signReportPhotos(Array.from(photoFor.values()));
  } catch (error) {
    console.warn("[reports] thumbnails unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const thumbs: Record<string, string> = {};
  for (const [reportId, photoId] of photoFor) {
    if (signed[photoId]) thumbs[reportId] = signed[photoId];
  }

  let blueprints: Record<string, string> = {};
  const projectIds = Array.from(new Set(rows.map((row) => row.project_id))).slice(0, 200);
  if (rows.some((row) => row.source_template) && projectIds.length > 0) {
    try {
      const result = await api.rpc<{ status?: string; byProject?: BlueprintSources }>(
        "listBlueprintItemSources",
        { projectIds },
      );
      if (result?.status === "ok") blueprints = reportBlueprintNames(rows, result.byProject ?? {});
    } catch (error) {
      console.warn("[reports] blueprint sources unavailable", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { thumbs, blueprints };
}
