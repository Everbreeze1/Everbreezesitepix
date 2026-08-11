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

  /*
   * EVERY table with `project_id ... REFERENCES public.projects(id) ON DELETE
   * CASCADE` must be listed here.
   *
   * This is not a "nice to have" list — the merge finishes by DELETEing the
   * source project, so anything reachable by that cascade and *not* moved first
   * is destroyed. site logs, documents, document folders, pages and blueprint
   * applications were all missing, while the confirm dialog told the user their
   * content would be moved. Adding a new project-scoped table without adding it
   * here silently makes this destructive again, so keep it in sync with
   * `grep -rl "REFERENCES public.projects(id)" supabase/migrations/`.
   *
   * `notifications` is deliberately excluded: those are per-event records that
   * point at the old project, and letting the cascade drop them is correct.
   */
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
    "project_site_logs",
    "project_documents",
    "project_document_folders",
    "project_pages",
    "project_blueprint_applications",
  ];

  /**
   * True when the failure is "this table isn't in this database".
   *
   * Several tables above exist in the migration folder but not in production
   * (`project_label_events` is one), and skipping those is intended. The old
   * check was `message.includes("does not exist")`, which never matched what
   * PostgREST actually returns — a missing table comes back as PGRST205
   * "Could not find the table 'public.x' in the schema cache". So the guard
   * never fired, the loop threw on the first absent table, and because the
   * tables before it had *already* been updated, every merge left the data
   * half-moved and then reported failure. Match on the error codes instead:
   * PGRST205 from the schema cache, 42P01 from Postgres itself.
   */
  const isMissingTable = (error: { code?: string; message?: string }) =>
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /could not find the table|does not exist/i.test(error.message ?? "");

  /*
   * There is no transaction here: PostgREST gives us one statement per request,
   * so a mid-loop failure genuinely can leave rows split across both projects.
   * That is survivable (the rows still exist and the source project is still
   * there, because the DELETE is last) but it is not atomic, and re-running the
   * merge is the recovery path. Making it truly atomic means moving this whole
   * body into a Postgres function called via rpc(); worth doing if this grows.
   */
  for (const table of moveableTables) {
    const { error } = await (supabaseAdmin as any)
      .from(table)
      .update({ project_id: data.targetId })
      .eq("project_id", data.sourceId);
    if (error) {
      if (isMissingTable(error)) continue;
      throw new Error(`${table}: ${error.message}`);
    }
  }

  const { error: tagErr } = await (supabaseAdmin as any)
    .from("project_tags")
    .update({ project_id: data.targetId })
    .eq("project_id", data.sourceId);
  if (tagErr && !isMissingTable(tagErr)) {
    throw new Error(`project_tags: ${tagErr.message}`);
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
