import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import type { ServiceContext } from "../../lib/user-context";
import { createPageFromTemplateService } from "../projects/page-templates";

export const applyProjectBlueprintInputSchema = z.object({
  blueprintId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectName: z.string(),
  projectAddress: z.string().nullable().optional(),
  preparedBy: z.string().optional(),
  companyName: z.string().optional(),
});

function fill(html: string, values: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, k) => {
    const v = values[String(k).toLowerCase()];
    return v ? v : m;
  });
}

async function requireOwnProject(ctx: ServiceContext, projectId: string) {
  const { data: project } = await (ctx.supabase as any)
    .from("projects")
    .select("id, created_by")
    .eq("id", projectId)
    .maybeSingle();
  if (!project || project.created_by !== ctx.userId) {
    throw new Error("Project not found");
  }
}

async function requireTeamPlan(ctx: ServiceContext) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: membership } = await supabaseAdmin
    .from("team_members" as any)
    .select("team_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!membership) throw new Error("Project Blueprints require the Team plan.");

  const { data: team } = await supabaseAdmin
    .from("teams" as any)
    .select("plan, is_internal")
    .eq("id", (membership as any).team_id)
    .maybeSingle();
  const plan = (team as any)?.plan;
  const isInternal = !!(team as any)?.is_internal;
  if (plan !== "team" && !isInternal) {
    throw new Error("Project Blueprints require the Team plan.");
  }
}

export async function applyProjectBlueprintService(
  ctx: ServiceContext,
  data: z.infer<typeof applyProjectBlueprintInputSchema>,
) {
  await requireOwnProject(ctx, data.projectId);
  await requireTeamPlan(ctx);

  const supabaseAdmin = getSupabaseAdmin();
  const counts: Record<string, number> = {
    checklists: 0,
    documents: 0,
    reports: 0,
    label_sets: 0,
    workflows: 0,
  };
  const failed: Array<{ kind: string; reason: string }> = [];

  // Blueprint labels → merge onto project
  const { data: tpl } = await supabaseAdmin
    .from("project_templates" as any)
    .select("labels")
    .eq("id", data.blueprintId)
    .single();
  const tplLabels: string[] = ((tpl as any)?.labels as string[] | null) ?? [];
  if (tplLabels.length) {
    const { data: pr } = await supabaseAdmin
      .from("projects")
      .select("labels")
      .eq("id", data.projectId)
      .single();
    const merged = Array.from(
      new Set([...(((pr as any)?.labels as string[] | null) ?? []), ...tplLabels]),
    );
    await supabaseAdmin
      .from("projects")
      .update({ labels: merged } as any)
      .eq("id", data.projectId);
  }

  // Legacy checklist attachments
  const { data: attached } = await supabaseAdmin
    .from("project_template_checklists" as any)
    .select("checklist_template_id, position")
    .eq("project_template_id", data.blueprintId)
    .order("position", { ascending: true });
  const legacyChecklists = ((attached as any[]) ?? []).map((a) => ({
    kind: "checklist" as const,
    ref_id: a.checklist_template_id,
  }));

  // Generic multi-kind items
  const { data: items } = await supabaseAdmin
    .from("project_template_items" as any)
    .select("kind, ref_id, position")
    .eq("project_template_id", data.blueprintId)
    .order("position", { ascending: true });
  const allItems = [
    ...legacyChecklists,
    ...((items as any[]) ?? []).map((i) => ({
      kind: i.kind as string,
      ref_id: i.ref_id as string,
    })),
  ];

  const values: Record<string, string> = {
    project_name: data.projectName,
    project_address: data.projectAddress ?? "",
    date: new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    prepared_by: data.preparedBy ?? "",
    company_name: data.companyName ?? "",
  };

  for (const it of allItems) {
    try {
      if (it.kind === "checklist") {
        const { data: t } = await supabaseAdmin
          .from("checklist_templates" as any)
          .select("name")
          .eq("id", it.ref_id)
          .single();
        if (!t) continue;
        const { data: created } = await supabaseAdmin
          .from("project_checklists" as any)
          .insert({
            project_id: data.projectId,
            template_id: it.ref_id,
            name: (t as any).name,
            created_by: ctx.userId,
          })
          .select("id")
          .single();
        if (!created) continue;
        const { data: tItems } = await supabaseAdmin
          .from("checklist_template_items" as any)
          .select("position, label, required, item_type, description")
          .eq("template_id", it.ref_id)
          .order("position", { ascending: true });
        // Renumber from zero: the select above is already ordered by position,
        // and carrying a template's stored numbers across propagates any gaps
        // or duplicates into the new checklist. Matches applyTemplate on the web.
        const rows = ((tItems as any[]) ?? []).map((x: any, idx: number) => ({
          checklist_id: (created as any).id,
          position: idx,
          label: x.label,
          required: x.required ?? false,
          item_type: x.item_type ?? "checkbox",
          description: x.description ?? null,
        }));
        if (rows.length) await supabaseAdmin.from("project_checklist_items" as any).insert(rows);
        counts.checklists++;
      } else if (it.kind === "document") {
        // Create a real page, the same object "Save as template" round-trips
        // out of. This used to write a `project_site_logs` row, whose only
        // reader (ProjectSiteLogs) is mounted inside ProjectReports — a
        // component nothing renders any more. The apply reported "1 document
        // created" and the project's Documents tab stayed empty, because the
        // row landed somewhere with no UI attached to it.
        //
        // createPageFromTemplateService also resolves the placeholder tokens
        // against the project itself, so the copy here no longer has to guess
        // at the project's name and address.
        await createPageFromTemplateService(ctx, {
          projectId: data.projectId,
          templateId: it.ref_id,
          resolveTokens: true,
        });
        counts.documents++;
      } else if (it.kind === "report") {
        const { data: r } = await supabaseAdmin
          .from("report_templates" as any)
          .select("name, subtitle, sections")
          .eq("id", it.ref_id)
          .single();
        if (!r) continue;
        const sections = ((r as any).sections as any[]) ?? [];
        const body = sections
          .map((s: any) => `<h2>${s.heading ?? ""}</h2>${fill(s.body ?? "", values)}`)
          .join("\n");
        await supabaseAdmin.from("project_reports" as any).insert({
          project_id: data.projectId,
          title: (r as any).name,
          subtitle: (r as any).subtitle ?? null,
          body: { html: body },
          created_by: ctx.userId,
        } as any);
        counts.reports++;
      } else if (it.kind === "label_set") {
        const { data: lsItems } = await supabaseAdmin
          .from("label_set_items" as any)
          .select("name, color, position")
          .eq("label_set_id", it.ref_id)
          .order("position", { ascending: true });
        const names = ((lsItems as any[]) ?? []).map((x: any) => x.name);
        if (names.length) {
          const { data: pr } = await supabaseAdmin
            .from("projects")
            .select("labels")
            .eq("id", data.projectId)
            .single();
          const merged = Array.from(
            new Set([...(((pr as any)?.labels as string[] | null) ?? []), ...names]),
          );
          await supabaseAdmin
            .from("projects")
            .update({ labels: merged } as any)
            .eq("id", data.projectId);
        }
        counts.label_sets++;
      } else if (it.kind === "workflow") {
        const { data: wt } = await supabaseAdmin
          .from("workflow_templates" as any)
          .select("name")
          .eq("id", it.ref_id)
          .single();
        if (!wt) continue;
        const { data: phases } = await supabaseAdmin
          .from("workflow_template_phases" as any)
          .select("id, name, position, description, requires_signoff")
          .eq("template_id", it.ref_id)
          .order("position", { ascending: true });
        const { data: created } = await supabaseAdmin
          .from("project_workflows" as any)
          .insert({
            project_id: data.projectId,
            template_id: it.ref_id,
            name: (wt as any).name,
            created_by: ctx.userId,
          } as any)
          .select("id")
          .single();
        if (!created) continue;
        for (const p of (phases as any[]) ?? []) {
          const { data: newPhase } = await supabaseAdmin
            .from("project_workflow_phases" as any)
            .insert({
              workflow_id: (created as any).id,
              name: p.name,
              position: p.position,
              // Carried over from the template. Dropping these turned every
              // sign-off gate into an ordinary phase on the applied copy.
              description: p.description ?? null,
              requires_signoff: !!p.requires_signoff,
            } as any)
            .select("id")
            .single();
          if (!newPhase) continue;
          const { data: pItems } = await supabaseAdmin
            .from("workflow_template_items" as any)
            // `kind` is NOT NULL with no default on project_workflow_items, so
            // omitting it here rejected every row — a blueprint containing a
            // workflow produced phases with no steps at all.
            .select("label, position, required, kind")
            .eq("phase_id", p.id)
            .order("position", { ascending: true });
          const rows = ((pItems as any[]) ?? []).map((x: any) => ({
            phase_id: (newPhase as any).id,
            label: x.label,
            position: x.position,
            required: !!x.required,
            kind: x.kind ?? "check",
          }));
          if (rows.length) {
            const { error: itemsErr } = await supabaseAdmin
              .from("project_workflow_items" as any)
              .insert(rows);
            if (itemsErr) throw itemsErr;
          }
        }
        counts.workflows++;
      }
    } catch (e) {
      // One bad item must not abort the rest of the blueprint, but it also
      // must not be invisible — the caller reports these so "applied" never
      // silently means "applied most of it".
      console.error("apply blueprint item failed", it, e);
      failed.push({ kind: it.kind, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  // Ledger row. Everything above lands as ordinary project rows — a checklist
  // created by a blueprint is indistinguishable from one typed by hand — so
  // without this the blueprint's own screen can never show where it has been
  // used. Best-effort on purpose: the work is already committed, and losing the
  // audit trail must not turn a successful apply into a failed one (notably on
  // an environment where 20260810000000 has not been run yet).
  // postgrest-js resolves rather than throws, so the error is checked, not
  // caught — a missing table comes back as `error`, not an exception.
  const { error: ledgerErr } = await supabaseAdmin
    .from("project_blueprint_applications" as any)
    .insert({
      blueprint_id: data.blueprintId,
      project_id: data.projectId,
      applied_by: ctx.userId,
      counts,
      failed_count: failed.length,
    } as any);
  if (ledgerErr) console.error("record blueprint application failed", ledgerErr);

  return { counts, failed };
}
