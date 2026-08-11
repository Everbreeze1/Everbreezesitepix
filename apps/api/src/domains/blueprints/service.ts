import { z } from "zod";
import { parseReportTemplateStructure } from "@sitepix/shared";
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
    // 404, not a bare Error: without a status this collapsed to a 500
    // internal_error, so an ownership rejection looked like a server crash.
    throw Object.assign(new Error("Project not found"), { status: 404 });
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

  /*
   * SECURITY — prove the caller can see this blueprint before dereferencing it.
   *
   * `requireOwnProject` validates the DESTINATION and `requireTeamPlan` the
   * plan, but `blueprintId` itself was never checked, and every read below
   * runs on the SERVICE-ROLE client, which bypasses RLS. A caller could pass
   * another team's blueprint id and have its checklists, documents, reports,
   * workflows and label sets copied wholesale into their own project — a full
   * read of another team's template library through a write endpoint.
   *
   * Reading through `ctx.supabase` IS the check: RLS hides rows the caller has
   * no access to, so a miss here means "not yours".
   */
  const { data: ownBlueprint } = await (ctx.supabase as any)
    .from("project_templates")
    .select("id")
    .eq("id", data.blueprintId)
    .maybeSingle();
  if (!ownBlueprint) {
    throw Object.assign(new Error("That blueprint isn't available to you."), { status: 403 });
  }

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
    // This is a merge implemented as an overwrite, so the READ has to be
    // trusted before the write. postgrest-js resolves rather than throws: a
    // timeout or 5xx here came back as `{ data: null, error }`, `?? []` turned
    // that into "the project has no labels", and the update below then REPLACED
    // the project's real labels with only the blueprint's. Binding the error
    // turns a transient failure into a failed apply instead of silent data loss.
    const { data: pr, error: prErr } = await supabaseAdmin
      .from("projects")
      .select("labels")
      .eq("id", data.projectId)
      .single();
    if (prErr) throw new Error(prErr.message);
    const merged = Array.from(
      new Set([...(((pr as any)?.labels as string[] | null) ?? []), ...tplLabels]),
    );
    const { error: labelsErr } = await supabaseAdmin
      .from("projects")
      .update({ labels: merged } as any)
      .eq("id", data.projectId);
    if (labelsErr) throw new Error(labelsErr.message);
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

  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const values: Record<string, string> = {
    project_name: data.projectName,
    project_address: data.projectAddress ?? "",
    date: today,
    prepared_by: data.preparedBy ?? "",
    company_name: data.companyName ?? "",
    /*
     * Aliases for the vocabulary the report-template wizard advertises
     * (ReportTemplatesManager's DEFAULT_PLACEHOLDERS) — its starter sections ship
     * "{{report_date}}" in the body. `fill` leaves an unknown token as literal
     * source, so without these a blueprint-applied report reads
     * "Overview of the site visit for Acme on {{report_date}}". Harmless while
     * the report branch was writing to a column nothing read; visible the moment
     * these reports actually render.
     */
    report_date: today,
    author_name: data.preparedBy ?? "",
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
        /*
         * `report_templates.sections` is jsonb holding one of TWO shapes: the
         * legacy `[{heading, body}]` array, or the editor's
         * `{coverStyle, placeholders, items}` object. Nothing migrated the old
         * rows, so both are live.
         *
         * This used to be `((r as any).sections as any[]) ?? []` — a cast plus a
         * null-only guard, which is no guard at all against the object shape. So
         * every report template saved by the current editor threw
         * "sections.map is not a function", the item was pushed onto `failed`,
         * and the dialog still announced the blueprint as applied.
         *
         * `parseReportTemplateStructure` is the single shared reading of that
         * column — the same one the editor uses — so the two cannot drift again.
         */
        const structure = parseReportTemplateStructure((r as any).sections);

        /*
         * A report's content lives in `project_report_sections`, one row per
         * section — that is what the builder, the public share page and the PDF
         * all read.
         *
         * This used to concatenate every section into one HTML string and store
         * it as `project_reports.body`. There is no `body` column on that table
         * (20260618230000 creates it; the only ALTERs add cover flags,
         * photos_per_page and subtitle) — `{ html }` is the shape of
         * `document_templates.body`, copy-pasted onto the wrong table. PostgREST
         * rejects an insert naming an unknown column, and because the result was
         * never destructured that rejection was discarded and `counts.reports++`
         * ran anyway. Fixing only the crash above would therefore have swapped a
         * loud error for a silent one: "1 report" with nothing created.
         *
         * Mirrors the working walkthrough→report path in walkthroughs/service.ts.
         */
        const { data: createdReport, error: reportErr } = await supabaseAdmin
          .from("project_reports" as any)
          .insert({
            project_id: data.projectId,
            created_by: ctx.userId,
            title: (r as any).name,
            subtitle: (r as any).subtitle ?? null,
          } as any)
          .select("id")
          .single();
        if (reportErr || !createdReport) {
          throw new Error(reportErr?.message ?? "Failed to create report");
        }

        if (structure.items.length) {
          const sectionRows = structure.items.map((s, idx) => ({
            report_id: (createdReport as any).id,
            position: idx,
            // `title` renders as plain text and `body` as rich HTML, so only the
            // body is markup. Both get `fill`: headings carry merge fields too,
            // and filling only the body left a literal "{{project_name}}" in the
            // heading of every report a blueprint produced.
            title: fill(s.heading, values),
            body: fill(s.body, values),
            photos: [],
          }));
          const { error: sectionsErr } = await supabaseAdmin
            .from("project_report_sections" as any)
            .insert(sectionRows);
          // Thrown, not warned — same as the workflow branch below. An empty
          // report counted as a success is the exact miscount this branch is
          // being fixed for.
          if (sectionsErr) throw sectionsErr;
        }
        counts.reports++;
      } else if (it.kind === "label_set") {
        const { data: lsItems, error: lsErr } = await supabaseAdmin
          .from("label_set_items" as any)
          .select("name, color, position")
          .eq("label_set_id", it.ref_id)
          .order("position", { ascending: true });
        if (lsErr) throw new Error(lsErr.message);
        const names = ((lsItems as any[]) ?? []).map((x: any) => x.name);
        // A deleted or empty label set writes nothing, so it must not be
        // counted. `counts.label_sets++` used to sit outside this guard and
        // reported "1 label set" while `projects.labels` was untouched.
        if (!names.length) continue;
        // Same overwrite-shaped merge as the blueprint-level labels above, and
        // the same reason for binding the read's error: a failed read here
        // replaced the project's labels with only this set's.
        const { data: pr, error: prErr } = await supabaseAdmin
          .from("projects")
          .select("labels")
          .eq("id", data.projectId)
          .single();
        if (prErr) throw new Error(prErr.message);
        const merged = Array.from(
          new Set([...(((pr as any)?.labels as string[] | null) ?? []), ...names]),
        );
        const { error: mergeErr } = await supabaseAdmin
          .from("projects")
          .update({ labels: merged } as any)
          .eq("id", data.projectId);
        if (mergeErr) throw new Error(mergeErr.message);
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
