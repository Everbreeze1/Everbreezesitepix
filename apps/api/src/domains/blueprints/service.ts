import { z } from "zod";
import { parseReportTemplateStructure } from "@sitepix/shared";
import { getSupabaseAdmin } from "../../lib/supabase";
import { isMissingColumn, isMissingTable } from "../../lib/postgrest";
import type { ServiceContext } from "../../lib/user-context";
import { createPageFromTemplateService } from "../projects/page-templates";

/** `.in()` rejects an empty list, and this can never match a real row. */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

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
   * SECURITY - prove the caller can see this blueprint before dereferencing it.
   *
   * `requireOwnProject` validates the DESTINATION and `requireTeamPlan` the
   * plan, but `blueprintId` itself was never checked, and every read below
   * runs on the SERVICE-ROLE client, which bypasses RLS. A caller could pass
   * another team's blueprint id and have its checklists, documents, reports,
   * workflows and label sets copied wholesale into their own project - a full
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
    walkthroughs: 0,
  };
  const failed: Array<{ kind: string; reason: string }> = [];

  // Blueprint labels → merge onto project. `name` is read here too and stored on
  // the ledger row, so the history can still say which blueprint set a project up
  // after that blueprint has been deleted (20260812000000). `version` is the
  // bundle's edit counter (20260908000000) and gets stamped onto the ledger, so
  // "which shape of this blueprint made this project" survives later edits to it.
  const TEMPLATE_BASE = "name, labels";
  let { data: tpl, error: tplErr } = await supabaseAdmin
    .from("project_templates" as any)
    .select(`${TEMPLATE_BASE}, version`)
    .eq("id", data.blueprintId)
    .single();
  if (tplErr && isMissingColumn(tplErr)) {
    // 20260908000000 pending here. The version is provenance, not the work, so
    // it must not be able to stop a blueprint from being applied.
    console.warn("blueprint apply: reading template without version", tplErr.message);
    ({ data: tpl, error: tplErr } = await supabaseAdmin
      .from("project_templates" as any)
      .select(TEMPLATE_BASE)
      .eq("id", data.blueprintId)
      .single());
  }
  const blueprintName: string | null = ((tpl as any)?.name as string | null) ?? null;
  const blueprintVersion: number | null = ((tpl as any)?.version as number | undefined) ?? null;
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
  const requested = [
    ...legacyChecklists,
    ...((items as any[]) ?? []).map((i) => ({
      kind: i.kind as string,
      ref_id: i.ref_id as string,
    })),
  ];

  /*
   * "zero-to-one workflow", from the spec.
   *
   * A workflow becomes the project's status tracker, and a project has one
   * status. Two of them applied side by side leaves the project with two
   * competing trackers and no rule saying which one is authoritative.
   *
   * The blueprint builder stops you attaching a second, but it is not the only
   * writer: a duplicated blueprint, a hand-run insert, or a row that predates
   * the rule can all get here. Enforced rather than assumed, and the extras are
   * REPORTED - dropping them silently would leave the caller's preview
   * promising a workflow that was never created.
   */
  const SINGLETON_KINDS = new Set(["workflow"]);
  const seenSingleton = new Set<string>();
  const allItems: typeof requested = [];
  for (const it of requested) {
    if (SINGLETON_KINDS.has(it.kind)) {
      if (seenSingleton.has(it.kind)) {
        failed.push({
          kind: it.kind,
          reason: `A blueprint applies at most one ${it.kind}, and this one holds more than one. Only the first was applied.`,
        });
        continue;
      }
      seenSingleton.add(it.kind);
    }
    allItems.push(it);
  }

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
     * (ReportTemplatesManager's DEFAULT_PLACEHOLDERS) - its starter sections ship
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
        // reader (ProjectSiteLogs) was mounted inside ProjectReports, a
        // component nothing rendered and which has since been deleted. The
        // apply reported "1 document created" and the project's Documents tab
        // stayed empty, because the row landed somewhere with no UI attached.
        //
        // createPageFromTemplateService also resolves the placeholder tokens
        // against the project itself, so the copy here no longer has to guess
        // at the project's name and address.
        await createPageFromTemplateService(ctx, {
          projectId: data.projectId,
          templateId: it.ref_id,
          resolveTokens: true,
          // Nothing to prompt with on a blueprint apply: whatever the project
          // cannot fill in arrives as a labelled blank in the document.
          values: {},
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
         * This used to be `((r as any).sections as any[]) ?? []` - a cast plus a
         * null-only guard, which is no guard at all against the object shape. So
         * every report template saved by the current editor threw
         * "sections.map is not a function", the item was pushed onto `failed`,
         * and the dialog still announced the blueprint as applied.
         *
         * `parseReportTemplateStructure` is the single shared reading of that
         * column - the same one the editor uses - so the two cannot drift again.
         */
        const structure = parseReportTemplateStructure((r as any).sections);

        /*
         * A report's content lives in `project_report_sections`, one row per
         * section - that is what the builder, the public share page and the PDF
         * all read.
         *
         * This used to concatenate every section into one HTML string and store
         * it as `project_reports.body`. There is no `body` column on that table
         * (20260618230000 creates it; the only ALTERs add cover flags,
         * photos_per_page and subtitle) - `{ html }` is the shape of
         * `document_templates.body`, copy-pasted onto the wrong table. PostgREST
         * rejects an insert naming an unknown column, and because the result was
         * never destructured that rejection was discarded and `counts.reports++`
         * ran anyway. Fixing only the crash above would therefore have swapped a
         * loud error for a silent one: "1 report" with nothing created.
         *
         * Mirrors the working walkthrough→report path in walkthroughs/service.ts.
         */
        const reportBase = {
          project_id: data.projectId,
          created_by: ctx.userId,
          title: (r as any).name,
          subtitle: (r as any).subtitle ?? null,
        };
        let { data: createdReport, error: reportErr } = await supabaseAdmin
          .from("project_reports" as any)
          .insert({
            ...reportBase,
            // Per-item provenance, so a report can carry a "from <blueprint>"
            // badge like its siblings. project_checklists.template_id and
            // project_workflows.template_id have recorded this since they were
            // built; reports were the one blueprint output with no pointer back
            // to what created them (20260812000000 adds the column).
            source_template: it.ref_id,
          } as any)
          .select("id")
          .single();
        if (reportErr && isMissingColumn(reportErr)) {
          // Migration pending. The badge is a nicety; creating the report at all
          // is the fix. Failing the item here would have reintroduced the very
          // breakage this branch was rewritten to remove.
          console.warn("blueprint report: retrying without source_template", reportErr.message);
          ({ data: createdReport, error: reportErr } = await supabaseAdmin
            .from("project_reports" as any)
            .insert(reportBase as any)
            .select("id")
            .single());
        }
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
          // Thrown, not warned - same as the workflow branch below. An empty
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
            // omitting it here rejected every row - a blueprint containing a
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
      } else if (it.kind === "walkthrough") {
        /*
         * A walkthrough template is a shot list, and a shot list on a project is
         * an ordered run of capture steps the crew ticks off. That is exactly
         * `project_workflow_items`, which already carries kind, photo_id,
         * completed_at and completed_by and is already rendered and written by
         * the project's Workflows tab - see the long note at the top of
         * 20260908000000 for why this reuses that table rather than growing a
         * second one shaped the same.
         *
         * `source_kind` is what keeps it a walkthrough after it lands. Without
         * it the project would call a shot list a workflow forever after.
         */
        const { data: wt, error: wtErr } = await supabaseAdmin
          .from("walkthrough_templates" as any)
          .select("name, description")
          .eq("id", it.ref_id)
          .single();
        if (wtErr) throw new Error(wtErr.message);
        if (!wt) continue;

        const { data: shots, error: shotsErr } = await supabaseAdmin
          .from("walkthrough_template_shots" as any)
          .select("label, description, capture, required, position")
          .eq("template_id", it.ref_id)
          .order("position", { ascending: true });
        if (shotsErr) throw new Error(shotsErr.message);

        const { data: created, error: createdErr } = await supabaseAdmin
          .from("project_workflows" as any)
          .insert({
            project_id: data.projectId,
            // NOT `template_id`: that column has a foreign key to
            // `workflow_templates`, so a walkthrough template's id is rejected
            // outright there. 20260908000000 adds this one for the purpose.
            walkthrough_template_id: it.ref_id,
            source_kind: "walkthrough",
            name: (wt as any).name,
            description: (wt as any).description ?? null,
            created_by: ctx.userId,
          } as any)
          .select("id")
          .single();
        if (createdErr) throw new Error(createdErr.message);
        if (!created) continue;

        /*
         * One phase, holding every shot.
         *
         * A walkthrough is a single pass through a site, not a sequence of
         * gated stages - splitting it into phases would invent structure the
         * author never wrote. The phase is named after the template so the run
         * reads as itself rather than as an unnamed container, and
         * `requires_signoff` stays false: a shot list records what was
         * captured, it does not gate anything.
         */
        const { data: phase, error: phaseErr } = await supabaseAdmin
          .from("project_workflow_phases" as any)
          .insert({
            workflow_id: (created as any).id,
            name: (wt as any).name,
            position: 0,
            description: (wt as any).description ?? null,
            requires_signoff: false,
          } as any)
          .select("id")
          .single();
        if (phaseErr) throw new Error(phaseErr.message);
        if (!phase) throw new Error("Failed to create the walkthrough's phase");

        /*
         * `capture` → `kind`. Both vocabularies are closed sets and they are
         * deliberately not the same words, so the mapping is written out rather
         * than passed through: a shot asks for a photo, a clip, or a written
         * note, and the run records a photo step, a photo step, or a note step.
         *
         * 'video' maps to 'photo' because `project_workflow_items.kind` has
         * only the three values in its CHECK and a video capture still resolves
         * to "attach the media you took here". The instruction to film rather
         * than photograph lives in the label, which carries it verbatim.
         */
        const KIND_FOR_CAPTURE: Record<string, string> = {
          photo: "photo",
          video: "photo",
          note: "note",
        };
        const shotRows = ((shots as any[]) ?? []).map((s: any, idx: number) => ({
          phase_id: (phase as any).id,
          // Renumbered from zero, same reason as the checklist branch: the
          // select is already ordered, and carrying stored numbers across
          // propagates any gaps into the new run.
          position: idx,
          kind: KIND_FOR_CAPTURE[s.capture as string] ?? "photo",
          // The shot's own description is folded into the label because
          // `project_workflow_items` has nowhere else to put it, and losing it
          // would strip the shot of the one thing that says what to aim at.
          label: s.description ? `${s.label} - ${s.description}` : s.label,
          required: !!s.required,
        }));
        if (shotRows.length) {
          const { error: shotInsertErr } = await supabaseAdmin
            .from("project_workflow_items" as any)
            .insert(shotRows);
          if (shotInsertErr) throw shotInsertErr;
        }
        counts.walkthroughs++;
      }
    } catch (e) {
      // One bad item must not abort the rest of the blueprint, but it also
      // must not be invisible - the caller reports these so "applied" never
      // silently means "applied most of it".
      console.error("apply blueprint item failed", it, e);
      failed.push({ kind: it.kind, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  // Ledger row. Everything above lands as ordinary project rows - a checklist
  // created by a blueprint is indistinguishable from one typed by hand - so
  // without this the blueprint's own screen can never show where it has been
  // used. Best-effort on purpose: the work is already committed, and losing the
  // audit trail must not turn a successful apply into a failed one (notably on
  // an environment where 20260810000000 has not been run yet).
  // postgrest-js resolves rather than throws, so the error is checked, not
  // caught - a missing table comes back as `error`, not an exception.
  const ledgerBase = {
    blueprint_id: data.blueprintId,
    project_id: data.projectId,
    applied_by: ctx.userId,
    counts,
    failed_count: failed.length,
  };
  let { error: ledgerErr } = await supabaseAdmin
    .from("project_blueprint_applications" as any)
    .insert({
      ...ledgerBase,
      // Denormalised so the history survives the blueprint being deleted.
      blueprint_name: blueprintName,
      // Distinguishes a real apply from a row reconstructed by the backfill in
      // 20260812000100, which the project header labels differently because an
      // inference must not be presented as an observation.
      origin: "applied",
      /*
       * The version of the bundle this project actually received
       * (20260908000000). The items above are copies, so a later edit to the
       * blueprint cannot reach them - this column is what makes that auditable
       * rather than merely true, which is the spec's "store a blueprint_version
       * or snapshot the component data onto the project-level instance".
       */
      blueprint_version: blueprintVersion,
    } as any);
  /*
   * A ladder, not a single fallback. PostgREST rejects the whole row over one
   * unknown column, so a database missing a column has to be retried with less;
   * but the columns arrive in two different migrations, and collapsing straight
   * to `ledgerBase` would throw away `blueprint_name` and `origin` on a database
   * that has 20260812000000 and is only waiting for 20260908000000. Each rung
   * drops exactly the newest thing and keeps everything older.
   */
  if (ledgerErr && isMissingColumn(ledgerErr)) {
    console.warn("blueprint ledger: retrying without blueprint_version", ledgerErr.message);
    ({ error: ledgerErr } = await supabaseAdmin
      .from("project_blueprint_applications" as any)
      .insert({
        ...ledgerBase,
        blueprint_name: blueprintName,
        origin: "applied",
      } as any));
  }
  if (ledgerErr && isMissingColumn(ledgerErr)) {
    /*
     * 20260812000000 has not been applied here yet either. Write what this
     * database can hold; without this rung, adding provenance columns to the
     * insert would have STOPPED provenance being recorded on an old database,
     * breaking something that worked.
     */
    console.warn("blueprint ledger: retrying without blueprint_name/origin", ledgerErr.message);
    ({ error: ledgerErr } = await supabaseAdmin
      .from("project_blueprint_applications" as any)
      .insert(ledgerBase as any));
  }
  if (ledgerErr) console.error("record blueprint application failed", ledgerErr);

  /*
   * Best-effort stays non-throwing - the items really were created and that must
   * not be reported as a failure. But it stops being SILENT: without this flag
   * the caller could not tell that the project will never show its origin, so
   * "which blueprint set this up?" became unanswerable with nothing anywhere
   * having said so.
   */
  return { counts, failed, ledgerRecorded: !ledgerErr };
}

/* -------------------------------------------------------------------------- */
/*  Reading provenance back                                                    */
/* -------------------------------------------------------------------------- */

export const getProjectBlueprintOriginInputSchema = z.object({
  projectId: z.string().uuid(),
});

export type BlueprintOriginApplication = {
  /** null once the blueprint has been deleted; `blueprintName` still names it. */
  blueprintId: string | null;
  blueprintName: string | null;
  /** May this caller open /templates for it? Teammates often cannot. */
  blueprintVisible: boolean;
  /** Reconstructed by the 20260812000100 backfill rather than observed. */
  inferred: boolean;
  /**
   * The bundle version this project received (20260908000000). Null on rows
   * written before that column existed, and on databases still without it.
   */
  version: number | null;
  /**
   * What that blueprint is at NOW, when the caller can see it.
   *
   * Higher than `version` means the blueprint has been edited since this project
   * was set up - and, because the apply copies rather than links, that this
   * project was deliberately left alone. Null when there is nothing to compare
   * against.
   */
  currentVersion: number | null;
  appliedAt: string;
  counts: Record<string, number>;
  failedCount: number;
};

/**
 * What blueprints made this project, and which item came from which.
 *
 * Read through the API rather than straight from the browser because the ledger
 * and the blueprint library have different visibility rules. `projects` is
 * visible to every teammate via are_teammates(), but `project_templates` (and
 * therefore `project_template_items`) is visible only to its author when the
 * blueprint carries no team_id - which is what the Templates screen writes for a
 * user without a team. A teammate reading the ledger directly got zero rows and
 * an empty item map, i.e. exactly what a project with no blueprint looks like.
 *
 * So: authorise on the PROJECT, then read with the service role.
 * `blueprintVisible` carries the library-level permission separately, which lets
 * a teammate learn *which* blueprint set the project up without gaining a route
 * into someone else's personal library.
 */
export async function getProjectBlueprintOriginService(
  ctx: ServiceContext,
  data: z.infer<typeof getProjectBlueprintOriginInputSchema>,
): Promise<{
  status: "ok" | "unavailable";
  applications: BlueprintOriginApplication[];
  /**
   * `template ref_id` → the blueprint that brought it in, for per-item badges.
   * Keyed by ref_id alone: a checklist template appears at most once in a given
   * blueprint, and if two applied blueprints share one, the later apply wins -
   * which matches what the project actually ended up with.
   */
  itemSources: Record<string, { blueprintId: string | null; blueprintName: string | null }>;
}> {
  /*
   * Authorisation is "can this person see the project", NOT "did they create
   * it". `requireOwnProject` above is creator-only and would re-break the
   * teammate case this function exists to fix. Reading through `ctx.supabase`
   * IS the check - RLS on `projects` already unions owner + are_teammates.
   */
  const { data: proj } = await (ctx.supabase as any)
    .from("projects")
    .select("id")
    .eq("id", data.projectId)
    .maybeSingle();
  if (!proj) throw Object.assign(new Error("Project not found"), { status: 404 });

  const supabaseAdmin = getSupabaseAdmin();
  // `blueprint_name` and `origin` arrive with 20260812000000. PostgREST rejects
  // the whole select over an unknown column, so a database still waiting for
  // that migration falls back to the original column list - the names then come
  // from the lookup below and every row reads as a real apply, which is exactly
  // what it was before `origin` existed.
  const LEDGER_BASE = "blueprint_id, counts, failed_count, created_at";
  const LEDGER_V2 = `${LEDGER_BASE}, blueprint_name, origin`;
  let { data: rows, error } = await supabaseAdmin
    .from("project_blueprint_applications" as any)
    .select(`${LEDGER_V2}, blueprint_version`)
    .eq("project_id", data.projectId)
    .order("created_at", { ascending: true });
  // Same two-rung ladder as the write above, and for the same reason: dropping
  // straight to LEDGER_BASE would lose the names and the inferred flag on a
  // database that has them and is only missing the version.
  if (error && isMissingColumn(error)) {
    console.warn("blueprint origin: reading without blueprint_version", error.message);
    ({ data: rows, error } = await supabaseAdmin
      .from("project_blueprint_applications" as any)
      .select(LEDGER_V2)
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true }));
  }
  if (error && isMissingColumn(error)) {
    console.warn("blueprint origin: reading without blueprint_name/origin", error.message);
    ({ data: rows, error } = await supabaseAdmin
      .from("project_blueprint_applications" as any)
      .select(LEDGER_BASE)
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true }));
  }

  if (error) {
    // Not provisioned is a different answer from "no blueprint", and the caller
    // renders it differently. A genuine 5xx stays loud.
    if (isMissingTable(error)) return { status: "unavailable", applications: [], itemSources: {} };
    throw new Error(error.message);
  }

  const ledger = ((rows as any[]) ?? []) as Array<{
    blueprint_id: string | null;
    blueprint_name: string | null;
    counts: Record<string, number> | null;
    failed_count: number | null;
    created_at: string;
    origin: string | null;
    blueprint_version: number | null;
  }>;
  if (!ledger.length) return { status: "ok", applications: [], itemSources: {} };

  const blueprintIds = Array.from(
    new Set(ledger.map((r) => r.blueprint_id).filter(Boolean) as string[]),
  );

  /*
   * Caller-scoped, so RLS decides. Membership here means "you may open it".
   *
   * `version` comes along for the ride so the caller can compare what this
   * project RECEIVED against what the blueprint is now. That comparison is the
   * whole point of the versioning rule: the instances are copies, so a blueprint
   * that has moved on since cannot have altered this project, and saying so is
   * more use than a bare version number nobody can interpret.
   */
  const ids = blueprintIds.length ? blueprintIds : [NIL_UUID];
  let { data: visibleRows, error: visibleErr } = await (ctx.supabase as any)
    .from("project_templates")
    .select("id, name, version")
    .in("id", ids);
  if (visibleErr && isMissingColumn(visibleErr)) {
    // 20260908000000 pending. Losing the comparison must not lose the names.
    ({ data: visibleRows } = await (ctx.supabase as any)
      .from("project_templates")
      .select("id, name")
      .in("id", ids));
  }
  const visible = new Map<string, string>(
    ((visibleRows as any[]) ?? []).map((t: any) => [t.id as string, t.name as string]),
  );
  const currentVersions = new Map<string, number>(
    ((visibleRows as any[]) ?? [])
      .filter((t: any) => typeof t.version === "number")
      .map((t: any) => [t.id as string, t.version as number]),
  );

  // Names for rows written before `blueprint_name` existed, read with the admin
  // client so a teammate still gets a name for a blueprint they cannot open.
  const missingName = blueprintIds.filter(
    (id) => !ledger.find((r) => r.blueprint_id === id)?.blueprint_name,
  );
  const nameFallback = new Map<string, string>();
  if (missingName.length) {
    const { data: named } = await supabaseAdmin
      .from("project_templates" as any)
      .select("id, name")
      .in("id", missingName);
    for (const t of ((named as any[]) ?? []) as Array<{ id: string; name: string }>) {
      nameFallback.set(t.id, t.name);
    }
  }

  const applications: BlueprintOriginApplication[] = ledger.map((r) => ({
    blueprintId: r.blueprint_id,
    blueprintName:
      r.blueprint_name ?? (r.blueprint_id ? (nameFallback.get(r.blueprint_id) ?? null) : null),
    blueprintVisible: !!r.blueprint_id && visible.has(r.blueprint_id),
    inferred: r.origin === "inferred",
    version: r.blueprint_version ?? null,
    // Null when the blueprint is deleted, invisible to this caller, or the
    // column is not there yet - all three mean "no comparison to offer", which
    // the caller renders as silence rather than as a change.
    currentVersion: r.blueprint_id ? (currentVersions.get(r.blueprint_id) ?? null) : null,
    appliedAt: r.created_at,
    counts: r.counts ?? {},
    failedCount: r.failed_count ?? 0,
  }));

  /*
   * The per-item map. Both sources are read, in the same order the apply
   * processes them, because legacy `project_template_checklists` attachments are
   * applied before `project_template_items` and a blueprint can hold both.
   */
  const itemSources: Record<string, { blueprintId: string | null; blueprintName: string | null }> =
    {};
  if (blueprintIds.length) {
    const nameOf = (id: string) =>
      ledger.find((r) => r.blueprint_id === id)?.blueprint_name ?? nameFallback.get(id) ?? null;

    const [{ data: legacy }, { data: items }] = await Promise.all([
      supabaseAdmin
        .from("project_template_checklists" as any)
        .select("project_template_id, checklist_template_id")
        .in("project_template_id", blueprintIds),
      supabaseAdmin
        .from("project_template_items" as any)
        .select("project_template_id, ref_id")
        .in("project_template_id", blueprintIds),
    ]);

    for (const row of ((legacy as any[]) ?? []) as Array<{
      project_template_id: string;
      checklist_template_id: string;
    }>) {
      itemSources[row.checklist_template_id] = {
        blueprintId: row.project_template_id,
        blueprintName: nameOf(row.project_template_id),
      };
    }
    for (const row of ((items as any[]) ?? []) as Array<{
      project_template_id: string;
      ref_id: string;
    }>) {
      itemSources[row.ref_id] = {
        blueprintId: row.project_template_id,
        blueprintName: nameOf(row.project_template_id),
      };
    }
  }

  return { status: "ok", applications, itemSources };
}

export const listBlueprintItemSourcesInputSchema = z.object({
  projectIds: z.array(z.string().uuid()).max(200),
});

/**
 * `itemSources`, batched across several projects.
 *
 * The workspace Reports screen lists reports from every project at once, so
 * asking the per-project endpoint once per project would be one round trip per
 * row group. Same authorisation rule - the caller's own RLS decides which of the
 * requested projects they may see, and unseen ones are simply absent from the
 * result rather than erroring.
 */
export async function listBlueprintItemSourcesService(
  ctx: ServiceContext,
  data: z.infer<typeof listBlueprintItemSourcesInputSchema>,
): Promise<{
  status: "ok" | "unavailable";
  byProject: Record<
    string,
    Record<string, { blueprintId: string | null; blueprintName: string | null }>
  >;
}> {
  if (!data.projectIds.length) return { status: "ok", byProject: {} };

  // RLS is the filter: whatever comes back is what this caller may see.
  const { data: visibleProjects } = await (ctx.supabase as any)
    .from("projects")
    .select("id")
    .in("id", data.projectIds);
  const allowed = ((visibleProjects as any[]) ?? []).map((p: any) => p.id as string);
  if (!allowed.length) return { status: "ok", byProject: {} };

  const supabaseAdmin = getSupabaseAdmin();
  // Same pending-migration fallback as getProjectBlueprintOriginService.
  let { data: rows, error } = await supabaseAdmin
    .from("project_blueprint_applications" as any)
    .select("project_id, blueprint_id, blueprint_name")
    .in("project_id", allowed);
  if (error && isMissingColumn(error)) {
    ({ data: rows, error } = await supabaseAdmin
      .from("project_blueprint_applications" as any)
      .select("project_id, blueprint_id")
      .in("project_id", allowed));
  }
  if (error) {
    if (isMissingTable(error)) return { status: "unavailable", byProject: {} };
    throw new Error(error.message);
  }

  const ledger = ((rows as any[]) ?? []) as Array<{
    project_id: string;
    blueprint_id: string | null;
    blueprint_name: string | null;
  }>;
  if (!ledger.length) return { status: "ok", byProject: {} };

  const blueprintIds = Array.from(
    new Set(ledger.map((r) => r.blueprint_id).filter(Boolean) as string[]),
  );
  const nameOf = new Map<string, string | null>();
  for (const r of ledger) {
    if (r.blueprint_id && !nameOf.get(r.blueprint_id)) nameOf.set(r.blueprint_id, r.blueprint_name);
  }
  const unnamed = blueprintIds.filter((id) => !nameOf.get(id));
  if (unnamed.length) {
    const { data: named } = await supabaseAdmin
      .from("project_templates" as any)
      .select("id, name")
      .in("id", unnamed);
    for (const t of ((named as any[]) ?? []) as Array<{ id: string; name: string }>) {
      nameOf.set(t.id, t.name);
    }
  }

  const [{ data: legacy }, { data: items }] = await Promise.all([
    supabaseAdmin
      .from("project_template_checklists" as any)
      .select("project_template_id, checklist_template_id")
      .in("project_template_id", blueprintIds.length ? blueprintIds : [NIL_UUID]),
    supabaseAdmin
      .from("project_template_items" as any)
      .select("project_template_id, ref_id")
      .in("project_template_id", blueprintIds.length ? blueprintIds : [NIL_UUID]),
  ]);

  // blueprint id → the ref_ids it contains
  const refsByBlueprint = new Map<string, string[]>();
  const push = (bp: string, ref: string) => {
    const cur = refsByBlueprint.get(bp);
    if (cur) cur.push(ref);
    else refsByBlueprint.set(bp, [ref]);
  };
  for (const row of ((legacy as any[]) ?? []) as Array<{
    project_template_id: string;
    checklist_template_id: string;
  }>) {
    push(row.project_template_id, row.checklist_template_id);
  }
  for (const row of ((items as any[]) ?? []) as Array<{
    project_template_id: string;
    ref_id: string;
  }>) {
    push(row.project_template_id, row.ref_id);
  }

  const byProject: Record<
    string,
    Record<string, { blueprintId: string | null; blueprintName: string | null }>
  > = {};
  for (const r of ledger) {
    if (!r.blueprint_id) continue;
    const bucket = (byProject[r.project_id] ??= {});
    for (const ref of refsByBlueprint.get(r.blueprint_id) ?? []) {
      bucket[ref] = {
        blueprintId: r.blueprint_id,
        blueprintName: nameOf.get(r.blueprint_id) ?? null,
      };
    }
  }
  return { status: "ok", byProject };
}
