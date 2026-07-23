import { z } from "zod";
import type { ServiceContext } from "../../lib/user-context";
import { getSupabaseAdmin } from "../../lib/supabase";

export const combineProjectsInputSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
});

export async function combineProjectsService(
  ctx: ServiceContext,
  data: z.infer<typeof combineProjectsInputSchema>,
) {
  const { data: projs, error: projErr } = await (ctx.supabase as any)
    .from("projects")
    .select("id, created_by")
    .in("id", [data.sourceId, data.targetId])
    .is("deleted_at", null);
  if (projErr) throw new Error(projErr.message);
  const rows = (projs as Array<{ id: string; created_by: string }>) ?? [];
  if (rows.length !== 2 || rows.some((r) => r.created_by !== ctx.userId)) {
    throw new Error("Unauthorized");
  }

  const supabaseAdmin = getSupabaseAdmin();

  const moveableTables = [
    "photos",
    "videos",
    "tasks",
    "project_checklists",
    "project_reports",
    "project_workflows",
    "walkthroughs",
    "photo_comments",
    "project_label_events",
  ];

  for (const table of moveableTables) {
    const { error } = await (supabaseAdmin as any)
      .from(table)
      .update({ project_id: data.targetId })
      .eq("project_id", data.sourceId);
    if (error) {
      if (error.message?.toLowerCase().includes("does not exist")) {
        continue;
      }
      throw new Error(`${table}: ${error.message}`);
    }
  }

  try {
    const { error: tagErr } = await (supabaseAdmin as any)
      .from("project_tags")
      .update({ project_id: data.targetId })
      .eq("project_id", data.sourceId);
    if (tagErr) {
      if (!tagErr.message?.toLowerCase().includes("does not exist")) {
        throw new Error(`project_tags: ${tagErr.message}`);
      }
    }
  } catch {
    /* ignored */
  }

  const { data: srcProj } = await (supabaseAdmin as any)
    .from("projects")
    .select("labels")
    .eq("id", data.sourceId)
    .maybeSingle();
  const { data: tgtProj } = await (supabaseAdmin as any)
    .from("projects")
    .select("labels")
    .eq("id", data.targetId)
    .maybeSingle();
  if (srcProj && tgtProj) {
    const merged = Array.from(
      new Set([...((tgtProj.labels as string[]) ?? []), ...((srcProj.labels as string[]) ?? [])]),
    );
    if (merged.length !== (tgtProj.labels ?? []).length) {
      const { error: labelErr } = await (supabaseAdmin as any)
        .from("projects")
        .update({ labels: merged })
        .eq("id", data.targetId);
      if (labelErr) throw new Error(`labels: ${labelErr.message}`);
    }
  }

  const { data: memberships } = await (supabaseAdmin as any)
    .from("project_group_members")
    .select("group_id")
    .eq("project_id", data.sourceId);
  for (const m of memberships ?? []) {
    const { error: upsertErr } = await (supabaseAdmin as any)
      .from("project_group_members")
      .upsert(
        { group_id: (m as { group_id: string }).group_id, project_id: data.targetId },
        { onConflict: "group_id,project_id" },
      );
    if (upsertErr) throw new Error(`group_members: ${upsertErr.message}`);
  }
  const { error: delGroupErr } = await (supabaseAdmin as any)
    .from("project_group_members")
    .delete()
    .eq("project_id", data.sourceId);
  if (delGroupErr) throw new Error(`group_members_delete: ${delGroupErr.message}`);

  const { error: delErr } = await (supabaseAdmin as any)
    .from("projects")
    .delete()
    .eq("id", data.sourceId)
    .eq("created_by", ctx.userId);
  if (delErr) throw new Error(delErr.message);

  return { ok: true, targetId: data.targetId };
}
