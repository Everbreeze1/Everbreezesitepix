// Client-side helper to apply a project blueprint (project_template) to a project.
// Seeds checklists, documents, reports, label sets, and workflows.
//
// Kept in client code (not a server fn) so it uses the user's RLS-scoped
// supabase session — mirrors the existing pattern in _app.projects.new.tsx.

import { supabase } from "@/integrations/sitepix/client";

interface ProjectContext {
  projectId: string;
  projectName: string;
  projectAddress?: string | null;
  userId: string;
  preparedBy?: string;
  companyName?: string;
}

function fill(html: string, values: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, k) => {
    const v = values[String(k).toLowerCase()];
    return v ? v : m;
  });
}

export async function applyProjectBlueprint(
  blueprintId: string,
  ctx: ProjectContext,
): Promise<{ counts: Record<string, number> }> {
  const counts: Record<string, number> = {
    checklists: 0,
    documents: 0,
    reports: 0,
    label_sets: 0,
    workflows: 0,
  };

  // Blueprint labels → merge onto project
  const { data: tpl } = await supabase
    .from("project_templates" as any)
    .select("labels")
    .eq("id", blueprintId)
    .single();
  const tplLabels: string[] = ((tpl as any)?.labels as string[] | null) ?? [];
  if (tplLabels.length) {
    const { data: pr } = await supabase
      .from("projects")
      .select("labels")
      .eq("id", ctx.projectId)
      .single();
    const merged = Array.from(
      new Set([...(((pr as any)?.labels as string[] | null) ?? []), ...tplLabels]),
    );
    await supabase
      .from("projects")
      .update({ labels: merged } as any)
      .eq("id", ctx.projectId);
  }

  // Legacy checklist attachments
  const { data: attached } = await supabase
    .from("project_template_checklists" as any)
    .select("checklist_template_id, position")
    .eq("project_template_id", blueprintId)
    .order("position", { ascending: true });
  const legacyChecklists = ((attached as any[]) ?? []).map((a) => ({
    kind: "checklist" as const,
    ref_id: a.checklist_template_id,
  }));

  // Generic multi-kind items
  const { data: items } = await supabase
    .from("project_template_items" as any)
    .select("kind, ref_id, position")
    .eq("project_template_id", blueprintId)
    .order("position", { ascending: true });
  const allItems = [
    ...legacyChecklists,
    ...((items as any[]) ?? []).map((i) => ({
      kind: i.kind as string,
      ref_id: i.ref_id as string,
    })),
  ];

  const values: Record<string, string> = {
    project_name: ctx.projectName,
    project_address: ctx.projectAddress ?? "",
    date: new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    prepared_by: ctx.preparedBy ?? "",
    company_name: ctx.companyName ?? "",
  };

  for (const it of allItems) {
    try {
      if (it.kind === "checklist") {
        const { data: t } = await supabase
          .from("checklist_templates" as any)
          .select("name")
          .eq("id", it.ref_id)
          .single();
        if (!t) continue;
        const { data: created } = await supabase
          .from("project_checklists" as any)
          .insert({
            project_id: ctx.projectId,
            template_id: it.ref_id,
            name: (t as any).name,
            created_by: ctx.userId,
          })
          .select("id")
          .single();
        if (!created) continue;
        const { data: tItems } = await supabase
          .from("checklist_template_items" as any)
          .select("position, label, required, item_type, description")
          .eq("template_id", it.ref_id)
          .order("position", { ascending: true });
        const rows = ((tItems as any[]) ?? []).map((x: any, idx: number) => ({
          checklist_id: (created as any).id,
          position: x.position ?? idx,
          label: x.label,
          required: x.required ?? false,
          item_type: x.item_type ?? "checkbox",
          description: x.description ?? null,
        }));
        if (rows.length) await supabase.from("project_checklist_items" as any).insert(rows);
        counts.checklists++;
      } else if (it.kind === "document") {
        const { data: d } = await supabase
          .from("document_templates" as any)
          .select("name, body")
          .eq("id", it.ref_id)
          .single();
        if (!d) continue;
        const html = fill(((d as any).body?.html as string) ?? "", values);
        await (supabase as any).from("project_site_logs").insert({
          project_id: ctx.projectId,
          title: `${(d as any).name} — ${new Date().toLocaleDateString()}`,
          photo_ids: [],
          notes: { __doc_html__: html, __doc_source_template__: (d as any).name },
        });
        counts.documents++;
      } else if (it.kind === "report") {
        const { data: r } = await supabase
          .from("report_templates" as any)
          .select("name, subtitle, sections")
          .eq("id", it.ref_id)
          .single();
        if (!r) continue;
        const sections = ((r as any).sections as any[]) ?? [];
        const body = sections
          .map((s: any) => `<h2>${s.heading ?? ""}</h2>${fill(s.body ?? "", values)}`)
          .join("\n");
        await supabase.from("project_reports" as any).insert({
          project_id: ctx.projectId,
          title: (r as any).name,
          subtitle: (r as any).subtitle ?? null,
          body: { html: body },
          created_by: ctx.userId,
        } as any);
        counts.reports++;
      } else if (it.kind === "label_set") {
        const { data: lsItems } = await supabase
          .from("label_set_items" as any)
          .select("name, color, position")
          .eq("label_set_id", it.ref_id)
          .order("position", { ascending: true });
        const names = ((lsItems as any[]) ?? []).map((x: any) => x.name);
        if (names.length) {
          const { data: pr } = await supabase
            .from("projects")
            .select("labels")
            .eq("id", ctx.projectId)
            .single();
          const merged = Array.from(
            new Set([...(((pr as any)?.labels as string[] | null) ?? []), ...names]),
          );
          await supabase
            .from("projects")
            .update({ labels: merged } as any)
            .eq("id", ctx.projectId);
        }
        counts.label_sets++;
      } else if (it.kind === "workflow") {
        const { data: wt } = await supabase
          .from("workflow_templates" as any)
          .select("name")
          .eq("id", it.ref_id)
          .single();
        if (!wt) continue;
        const { data: phases } = await supabase
          .from("workflow_template_phases" as any)
          .select("id, name, position")
          .eq("template_id", it.ref_id)
          .order("position", { ascending: true });
        const { data: created } = await supabase
          .from("project_workflows" as any)
          .insert({
            project_id: ctx.projectId,
            template_id: it.ref_id,
            name: (wt as any).name,
            created_by: ctx.userId,
          } as any)
          .select("id")
          .single();
        if (!created) continue;
        for (const p of (phases as any[]) ?? []) {
          const { data: newPhase } = await supabase
            .from("project_workflow_phases" as any)
            .insert({ workflow_id: (created as any).id, name: p.name, position: p.position } as any)
            .select("id")
            .single();
          if (!newPhase) continue;
          const { data: pItems } = await supabase
            .from("workflow_template_items" as any)
            .select("label, position, required")
            .eq("phase_id", p.id)
            .order("position", { ascending: true });
          const rows = ((pItems as any[]) ?? []).map((x: any) => ({
            phase_id: (newPhase as any).id,
            label: x.label,
            position: x.position,
            required: !!x.required,
          }));
          if (rows.length) await supabase.from("project_workflow_items" as any).insert(rows);
        }
        counts.workflows++;
      }
    } catch (e) {
      console.error("apply blueprint item failed", it, e);
    }
  }

  return { counts };
}
