import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { ReportRow } from "./report-view";

/**
 * Project reports: the thing a client actually receives.
 *
 * The report is the product. Everything else the app does (photos, checklists,
 * walkthroughs) exists so that this can be produced, and until now it was the
 * one artifact the phone could neither make nor read. That is backwards for a
 * crew who finish a job at four in the afternoon and would rather send the
 * write-up from the van than from a desk the next morning.
 *
 * Rows are ordinary RLS reads and writes, matching the web. Only the AI summary
 * goes through `/v1/rpc`, because it costs money on our Gemini key and is gated
 * on an active subscription server-side.
 */

const REPORT_FIELDS =
  "id, project_id, title, summary, photo_ids, include_project_info, share_token, allow_download, revoked_at, created_at, updated_at";

export async function listProjectReports(projectId: string): Promise<ReportRow[]> {
  const { data, error } = await supabase
    .from("project_reports")
    .select(REPORT_FIELDS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as ReportRow[]) ?? [];
}

export async function getReport(id: string): Promise<ReportRow | null> {
  const { data, error } = await supabase
    .from("project_reports")
    .select(REPORT_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ReportRow) ?? null;
}

export async function createReport(args: {
  projectId: string;
  title: string;
  summary: string | null;
  photoIds: string[];
}): Promise<ReportRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("project_reports")
    .insert({
      project_id: args.projectId,
      title: args.title,
      summary: args.summary,
      photo_ids: args.photoIds,
      // `created_by` is NOT NULL with no default on this table, unlike some of
      // the newer ones. Omitting it fails the insert rather than defaulting.
      created_by: userId,
    } as never)
    .select(REPORT_FIELDS)
    .single();
  if (error) throw new Error(error.message);
  return data as ReportRow;
}

export async function saveReport(
  id: string,
  patch: {
    title?: string;
    summary?: string | null;
    photo_ids?: string[];
    include_project_info?: boolean;
    allow_download?: boolean;
    revoked_at?: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from("project_reports")
    .update(patch as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteReport(id: string): Promise<void> {
  const { error } = await supabase.from("project_reports").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Ask the model to write the summary from the chosen photos.
 *
 * Returns prose to put in the box, not something saved directly: the person
 * reads it, edits it, and it is their report that goes to the client. A draft
 * written straight into the record would be the model signing off work it did
 * not do.
 */
export async function draftReportSummary(
  photoIds: string[],
  title?: string,
): Promise<string | null> {
  const result = await api.rpc<{ summary?: string; text?: string }>("summarizePhotosReport", {
    photoIds,
    ...(title ? { title } : {}),
  });
  // The op has been through more than one response shape. Reading both and
  // defaulting to null means an unexpected one leaves the box untouched rather
  // than filling it with "undefined".
  return result?.summary ?? result?.text ?? null;
}
