import { AI_TIMEOUT_MS } from "@everlumen/api-client";
import {
  buildTaskReportSections,
  getReportStarter,
  indexTaskPhotoItems,
  isMissingTaskPhotoItems,
  parseReportTemplateStructure,
  REPORT_STARTERS,
  TASK_PHOTO_ITEM_COLUMNS,
  TASK_PHOTO_ITEMS_TABLE,
  taskPhotoProgress,
  type ReportStarter,
  type TaskForReport,
  type TaskPhotoItem,
  type TaskPhotoStateForReport,
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
import {
  ATTACHED_SECTION_TITLE,
  sectionPhotosFor,
  type AttachablePhoto,
} from "./photo-selection-view";

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
    /** Who wrote it: the cover's "Prepared by" and the letterhead are theirs. */
    created_by: string | null;
  };

const BUILT_FIELDS =
  "id, project_id, created_by, title, summary, subtitle, photo_ids, include_project_info, share_token, allow_download, revoked_at, created_at, updated_at, cover_enabled, cover_show_project_name, cover_show_address, cover_show_date, cover_show_author, photos_per_page, cover_photo_ids";

function toBuilt(row: Record<string, unknown>): BuiltReport {
  return {
    ...(row as unknown as ReportRow),
    subtitle: (row.subtitle as string | null) ?? null,
    photos_per_page: clampPhotosPerPage(row.photos_per_page),
    cover_photo_ids: normaliseIdList(row.cover_photo_ids),
    created_by: (row.created_by as string | null) ?? null,
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

/**
 * The letterhead and byline a report prints: its author's name and company
 * details, from the author's profile, as the public page reads them.
 *
 * Null when the profile cannot be read (another member's row hidden by RLS,
 * or no author on an old row): the reader then draws a plain header rather
 * than failing the whole report over its letterhead.
 */
export type ReportLetterhead = {
  authorName: string | null;
  company: {
    name: string | null;
    logoUrl: string | null;
    phone: string | null;
    address: string | null;
  };
};

export async function getReportLetterhead(
  createdBy: string | null,
): Promise<ReportLetterhead | null> {
  if (!createdBy) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, company, company_logo_url, company_phone, company_address")
    .eq("id", createdBy)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as Record<string, string | null>;
  return {
    authorName: row.full_name ?? null,
    company: {
      name: row.company ?? null,
      logoUrl: row.company_logo_url ?? null,
      phone: row.company_phone ?? null,
      address: row.company_address ?? null,
    },
  };
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

/* ------------------------------------------------------ work from tasks ---- */

/** A task that can go into a report: it carries photos, and how far along they are. */
export type ReportableTask = TaskForReport & { progressLabel: string };

export type ReportableTasks = {
  tasks: ReportableTask[];
  /**
   * Each task's per-photo state (done or open, and the note), for the
   * captions. A plain object rather than a Map: query results are persisted
   * as JSON, and a Map comes back from that as an empty object.
   */
  states: Record<string, TaskPhotoStateForReport[]>;
};

/**
 * The job's tasks that carry photos, for the web's "Add work from tasks".
 *
 * Only tasks with photos: a section with a heading and no evidence under it
 * is a line the reader has to take on faith. The per-photo items are allowed
 * to be missing on an older database, as on the web, which leaves every
 * photo captioned with the task's standing instead of its note.
 */
export async function listReportableTasks(projectId: string): Promise<ReportableTasks> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, description, status, photo_ids, due_date, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = ((data as unknown as TaskForReport[] | null) ?? []).filter(
    (task) => (task.photo_ids?.length ?? 0) > 0,
  );

  let items = new Map<string, Map<string, TaskPhotoItem>>();
  if (rows.length > 0) {
    const { data: itemRows, error: itemError } = await supabase
      .from(TASK_PHOTO_ITEMS_TABLE as never)
      .select(TASK_PHOTO_ITEM_COLUMNS)
      .in(
        "task_id",
        rows.map((task) => task.id),
      );
    if (itemError && !isMissingTaskPhotoItems(itemError)) throw new Error(itemError.message);
    if (!itemError) items = indexTaskPhotoItems((itemRows as unknown as TaskPhotoItem[]) ?? []);
  }

  const states: Record<string, TaskPhotoStateForReport[]> = {};
  items.forEach((byPhoto, taskId) => {
    states[taskId] = [...byPhoto.values()].map((item) => ({
      photo_id: item.photo_id,
      status: item.status,
      note: item.note,
    }));
  });

  return {
    tasks: rows.map((task) => ({
      ...task,
      progressLabel: taskPhotoProgress(task.photo_ids, items.get(task.id) ?? null).shortLabel,
    })),
    states,
  };
}

/**
 * Add one section per chosen task, after the report's existing sections.
 * Each photo is captioned with what was done to it.
 */
export async function addTaskSections(args: {
  reportId: string;
  afterPosition: number;
  tasks: TaskForReport[];
  states: Record<string, TaskPhotoStateForReport[]>;
  includeOutstanding: boolean;
}): Promise<number> {
  const built = buildTaskReportSections(args.tasks, new Map(Object.entries(args.states)), {
    doneOnly: !args.includeOutstanding,
  });
  if (built.length === 0) return 0;
  const rows = built.map((section, index) => ({
    report_id: args.reportId,
    position: args.afterPosition + 1 + index,
    title: section.title,
    body: section.body,
    photos: section.photos,
  }));
  const { error } = await supabase.from("project_report_sections").insert(rows as never);
  if (error) throw new Error(error.message);
  return built.length;
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
  /**
   * Photos to file in the new report, as the web's New report dialog does
   * from a selection: one "Photos" section after the starter's sections.
   */
  attachPhotos?: readonly AttachablePhoto[];
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

  const sections: { title: string; body: string; photos: SectionPhoto[] }[] = (
    args.start.kind === "starter"
      ? args.start.starter.sections.map((heading) => ({ title: heading, body: "" }))
      : args.start.kind === "saved"
        ? args.start.template.headings.map((heading, i) => ({
            title: heading,
            body: (args.start as { template: SavedReportTemplate }).template.bodies[i] ?? "",
          }))
        : []
  ).map((s) => ({ ...s, photos: [] as SectionPhoto[] }));
  if (args.attachPhotos?.length) {
    sections.push({
      title: ATTACHED_SECTION_TITLE,
      body: "",
      photos: sectionPhotosFor(args.attachPhotos),
    });
  }

  let warning: string | null = null;
  if (sections.length) {
    const { error: sectionError } = await supabase.from("project_report_sections").insert(
      sections.map((s, i) => ({
        report_id: report.id,
        position: i,
        title: s.title,
        body: s.body,
        photos: s.photos,
      })) as never,
    );
    if (sectionError) {
      warning = args.attachPhotos?.length
        ? `The report was created, but its sections and photos did not save: ${sectionError.message}`
        : `The report was created, but its sections did not save: ${sectionError.message}`;
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
