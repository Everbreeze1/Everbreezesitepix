import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  mergeReportIndex,
  type BuiltReportInput,
  type ReportIndexItem,
  type ReportPageInput,
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
