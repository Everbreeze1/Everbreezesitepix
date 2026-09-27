import { AI_TIMEOUT_MS } from "@everlumen/api-client";
import {
  getReportStarter,
  parseReportTemplateStructure,
  REPORT_STARTERS,
  type ReportStarter,
} from "@everlumen/shared";
import { api } from "@/lib/api";
import { signPhotoUrls, type PhotoListItem } from "./photos";
import { supabase } from "@/lib/supabase";
import {
  clampPhotosPerPage,
  normaliseIdList,
  normaliseSectionPhotos,
  type CoverOptions,
  type PhotosPerPage,
  type ReportSection,
  type SectionPhoto,
} from "./report-builder-view";
import type { ReportRow } from "./report-view";

/**
 * The report builder's reads and writes, the same rows the web's
 * `ReportBuilderPage` and `NewReportDialog` touch.
 *
 * Straight through RLS, as the web does it: `project_reports` for the cover and
 * settings, `project_report_sections` for the body. The PDF and the public page
 * are rendered from these rows server-side, so what is saved here is exactly
 * what the client receives.
 */

export type BuiltReport = ReportRow &
  CoverOptions & {
    subtitle: string | null;
    photos_per_page: PhotosPerPage;
    cover_photo_ids: string[];
  };

const BUILT_FIELDS =
  "id, project_id, title, summary, subtitle, photo_ids, include_project_info, share_token, allow_download, revoked_at, created_at, updated_at, cover_enabled, cover_show_project_name, cover_show_address, cover_show_date, cover_show_author, photos_per_page, cover_photo_ids";

function toBuilt(row: Record<string, unknown>): BuiltReport {
  return {
    ...(row as unknown as ReportRow),
    subtitle: (row.subtitle as string | null) ?? null,
    photos_per_page: clampPhotosPerPage(row.photos_per_page),
    cover_photo_ids: normaliseIdList(row.cover_photo_ids),
    cover_enabled: row.cover_enabled !== false,
    cover_show_project_name: row.cover_show_project_name !== false,
    cover_show_address: row.cover_show_address !== false,
    cover_show_date: row.cover_show_date !== false,
    cover_show_author: row.cover_show_author !== false,
  };
}

export async function getBuiltReport(id: string): Promise<BuiltReport | null> {
  const { data, error } = await supabase
    .from("project_reports")
    .select(BUILT_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toBuilt(data as Record<string, unknown>) : null;
}

export type BuiltReportPatch = Partial<
  CoverOptions & {
    title: string;
    subtitle: string | null;
    summary: string | null;
    photo_ids: string[];
    photos_per_page: PhotosPerPage;
    cover_photo_ids: string[];
    allow_download: boolean;
    revoked_at: string | null;
  }
>;

export async function patchBuiltReport(id: string, patch: BuiltReportPatch): Promise<void> {
  const { error } = await supabase
    .from("project_reports")
    .update(patch as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------ sections ---- */

export async function listReportSections(reportId: string): Promise<ReportSection[]> {
  const { data, error } = await supabase
    .from("project_report_sections")
    .select("id, report_id, position, title, body, photos")
    .eq("report_id", reportId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    id: row.id as string,
    report_id: row.report_id as string,
    position: (row.position as number) ?? 0,
    title: (row.title as string) ?? "",
    body: (row.body as string | null) ?? null,
    photos: normaliseSectionPhotos(row.photos),
  }));
}

export async function addReportSection(args: {
  reportId: string;
  position: number;
  title?: string;
}): Promise<ReportSection> {
  const { data, error } = await supabase
    .from("project_report_sections")
    .insert({
      report_id: args.reportId,
      position: args.position,
      title: args.title ?? "New section",
      body: "",
      photos: [],
    } as never)
    .select("id, report_id, position, title, body, photos")
    .single();
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    report_id: row.report_id as string,
    position: row.position as number,
    title: (row.title as string) ?? "",
    body: (row.body as string | null) ?? null,
    photos: normaliseSectionPhotos(row.photos),
  };
}

export async function patchReportSection(
  id: string,
  patch: Partial<{ title: string; body: string | null; photos: SectionPhoto[]; position: number }>,
): Promise<void> {
  const { error } = await supabase
    .from("project_report_sections")
    .update(patch as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteReportSection(id: string): Promise<void> {
  const { error } = await supabase.from("project_report_sections").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Write every position; throws if any write failed so the screen can roll back. */
export async function saveSectionOrder(
  sections: ReadonlyArray<{ id: string; position: number }>,
): Promise<void> {
  const results = await Promise.all(
    sections.map((s) =>
      supabase
        .from("project_report_sections")
        .update({ position: s.position } as never)
        .eq("id", s.id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}

/* --------------------------------------------------- creating a report ---- */

export type SavedReportTemplate = {
  id: string;
  name: string;
  subtitle: string | null;
  headings: string[];
  bodies: string[];
};

/** The team's own report templates, as NewReportDialog lists them. */
export async function listSavedReportTemplates(): Promise<SavedReportTemplate[]> {
  const { data, error } = await supabase
    .from("report_templates")
    .select("id, name, subtitle, sections, archived")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = {
    id: string;
    name: string | null;
    subtitle: string | null;
    sections: unknown;
    archived: boolean;
  };
  return ((data as Row[]) ?? [])
    .filter((row) => !row.archived)
    .map((row) => {
      const parsed = parseReportTemplateStructure(row.sections);
      return {
        id: row.id,
        name: row.name ?? "Untitled template",
        subtitle: row.subtitle ?? null,
        headings: parsed.items.map((item) => item.heading),
        bodies: parsed.items.map((item) => item.body),
      };
    })
    .filter((template) => template.headings.length > 0);
}

export const reportStarters: readonly ReportStarter[] = REPORT_STARTERS;
export { getReportStarter };

export type BuiltReportStart =
  | { kind: "blank" }
  | { kind: "starter"; starter: ReportStarter }
  | { kind: "saved"; template: SavedReportTemplate };

/**
 * Create a hand-built report the way NewReportDialog does: the row with its
 * cover settings, then the starting sections in one insert.
 *
 * A failed section insert leaves a usable empty report rather than nothing, so
 * it is returned as a warning instead of thrown: the person is on their way to
 * the editor, where they can add the headings by hand.
 */
export async function createBuiltReport(args: {
  projectId: string;
  title: string;
  subtitle: string | null;
  photosPerPage: PhotosPerPage;
  cover: CoverOptions;
  start: BuiltReportStart;
}): Promise<{ report: BuiltReport; warning: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("project_reports")
    .insert({
      project_id: args.projectId,
      created_by: userId,
      title: args.title,
      subtitle: args.subtitle,
      summary: null,
      photo_ids: [],
      include_project_info: true,
      allow_download: true,
      photos_per_page: args.photosPerPage,
      ...args.cover,
    } as never)
    .select(BUILT_FIELDS)
    .single();
  if (error) throw new Error(error.message);
  const report = toBuilt(data as Record<string, unknown>);

  const sections =
    args.start.kind === "starter"
      ? args.start.starter.sections.map((heading) => ({ title: heading, body: "" }))
      : args.start.kind === "saved"
        ? args.start.template.headings.map((heading, i) => ({
            title: heading,
            body: (args.start as { template: SavedReportTemplate }).template.bodies[i] ?? "",
          }))
        : [];

  let warning: string | null = null;
  if (sections.length) {
    const { error: sectionError } = await supabase.from("project_report_sections").insert(
      sections.map((s, i) => ({
        report_id: report.id,
        position: i,
        title: s.title,
        body: s.body,
        photos: [],
      })) as never,
    );
    if (sectionError) {
      warning = `The report was created, but its sections did not save: ${sectionError.message}`;
    }
  }
  return { report, warning };
}

/* ------------------------------------------------- AI generated pages ---- */

/**
 * "Report from selected photos": the service drafts a client-ready document
 * (title page, summary, photo sections, conclusion) from the chosen photos and
 * files it as a report page. `aiFailed` is set when the model was unreachable;
 * the page is still made from a structured scaffold.
 */
export async function generatePhotoReportPage(args: {
  projectId: string;
  photoIds: string[];
  photosPerPage: PhotosPerPage;
  idempotencyKey: string;
}): Promise<{ pageId: string; title: string | null; aiFailed: string | null }> {
  const result = await api.rpc<{
    page?: { id?: string; title?: string };
    aiFailed?: string | null;
  }>(
    "generateProjectPage",
    {
      projectId: args.projectId,
      folderId: null,
      template: "report",
      photoIds: args.photoIds,
      photosPerPage: args.photosPerPage,
    },
    { idempotencyKey: args.idempotencyKey, timeoutMs: AI_TIMEOUT_MS },
  );
  const pageId = result?.page?.id;
  if (!pageId) throw new Error("The report was not created.");
  return { pageId, title: result?.page?.title ?? null, aiFailed: result?.aiFailed ?? null };
}

/** The public PDF for a built report. Works only while its link is on. */
export function builtReportPdfUrl(shareToken: string | null): string | null {
  const token = (shareToken ?? "").trim();
  if (!token) return null;
  return api.urls.reportPdf(token);
}

/**
 * The plan facts the template gate reads. Its own small call rather than
 * `getMyTeam` from team.ts, whose mapped result drops `isInternal`, and an
 * internal team reading as Starter would see every template padlocked.
 */
export async function getTemplateGateFacts(): Promise<{
  plan: string | null;
  isActive: boolean;
  isInternal: boolean;
}> {
  const result = await api.rpc<{ plan?: string; isActive?: boolean; isInternal?: boolean }>(
    "getMyTeam",
  );
  return {
    plan: result?.plan ?? null,
    isActive: Boolean(result?.isActive),
    isInternal: Boolean(result?.isInternal),
  };
}

/**
 * Signed URLs for photos a report already places, by id.
 *
 * The pickers load the newest photos on the job; a report can hold older ones,
 * and without this they drew as empty tiles.
 */
export async function signReportPhotos(ids: readonly string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return {};
  const rows: PhotoListItem[] = [];
  // Chunked: PostgREST echoes `.in()` ids in a header that overflows near 400.
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await supabase
      .from("photos")
      .select("id, caption, storage_path, thumb_path, image_url, created_at, taken_at, phase, tags")
      .in("id", unique.slice(i, i + 200));
    if (error) throw new Error(error.message);
    rows.push(...((data as PhotoListItem[]) ?? []));
  }
  return signPhotoUrls(rows);
}
