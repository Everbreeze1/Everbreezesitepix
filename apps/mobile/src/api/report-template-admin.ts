import type { ReportTemplateStructure } from "@everlumen/shared";
import { supabase } from "@/lib/supabase";
import { currentUserId } from "./blueprint-admin";
import { starterStructure, type ReportTemplateRow } from "./report-template-view";

/**
 * Managing report templates: the same `report_templates` reads and writes as
 * the web's `ReportTemplatesManager`. Direct RLS, no op involved.
 */

const db = (table: string): any => supabase.from(table as never);

const FIELDS = "id, team_id, name, subtitle, sections, archived, created_at, category";
// `category` arrives with 20260829000000; a database without it still lists.
const LEGACY_FIELDS = "id, team_id, name, subtitle, sections, archived, created_at";

function toRow(r: any): ReportTemplateRow {
  return {
    id: String(r.id),
    teamId: (r.team_id as string | null) ?? null,
    name: String(r.name ?? "Untitled report"),
    subtitle: (r.subtitle as string | null) ?? null,
    sections: r.sections,
    archived: Boolean(r.archived),
    category: (r.category as string | null) ?? null,
    createdAt: String(r.created_at ?? ""),
  };
}

export async function listReportTemplates(): Promise<ReportTemplateRow[]> {
  const full = await db("report_templates").select(FIELDS).order("created_at", { ascending: true });
  if (!full.error) return ((full.data as any[]) ?? []).map(toRow);
  const legacy = await db("report_templates")
    .select(LEGACY_FIELDS)
    .order("created_at", { ascending: true });
  if (legacy.error) throw new Error(legacy.error.message);
  return ((legacy.data as any[]) ?? []).map(toRow);
}

export async function createReportTemplate(args: {
  name: string;
  subtitle: string | null;
  teamId: string | null;
}): Promise<string> {
  const userId = await currentUserId();
  const { data, error } = await db("report_templates")
    .insert({
      name: args.name,
      subtitle: args.subtitle,
      sections: starterStructure(),
      team_id: args.teamId,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create that template");
  return String(data.id);
}

export async function updateReportTemplate(
  id: string,
  patch: {
    name?: string;
    subtitle?: string | null;
    structure?: ReportTemplateStructure;
    category?: string | null;
  },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.subtitle !== undefined) row.subtitle = patch.subtitle;
  if (patch.structure !== undefined) row.sections = patch.structure;
  if (patch.category !== undefined) row.category = patch.category;
  const { error } = await db("report_templates").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function duplicateReportTemplate(
  source: ReportTemplateRow,
  teamId: string | null,
): Promise<string> {
  const userId = await currentUserId();
  const { data, error } = await db("report_templates")
    .insert({
      name: `${source.name} (copy)`,
      subtitle: source.subtitle,
      sections: source.sections,
      team_id: teamId,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not duplicate that template");
  return String(data.id);
}

export async function setReportTemplateArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await db("report_templates").update({ archived }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteReportTemplate(id: string): Promise<void> {
  const { error } = await db("report_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
