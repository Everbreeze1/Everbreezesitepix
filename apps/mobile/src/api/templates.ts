import { supabase } from "@/lib/supabase";

/**
 * Starting a checklist or workflow from a template.
 *
 * Deliberately not queued through the outbox, and that is the one decision
 * worth understanding here. Every other write in the app goes through the
 * queue, but applying a template is a multi-table sequence, not an independent
 * row: the parent has to exist before its children can reference it, and the
 * phase ids the database assigns are what the items point at. Queued as
 * separate rows they could drain in an order the database cannot accept, and
 * the failure would surface hours later with nothing to retry against.
 *
 * So this needs a connection, and the UI says so rather than pretending. The
 * same reasoning `walkthroughs.ts` records for its save sequence.
 *
 * Both sequences below roll back their parent on failure. Without that, a
 * partial apply leaves an empty checklist or a phase-less workflow on the
 * project, and the crew's natural response (tap it again) stacks another one
 * on every attempt. The web versions were both fixed for exactly this and the
 * comments there say so.
 */

export type TemplateSummary = {
  id: string;
  name: string;
  description: string | null;
  category?: string | null;
};

/** Checklist templates available to this workspace, newest usable first. */
export async function listChecklistTemplates(): Promise<TemplateSummary[]> {
  const { data, error } = await supabase
    .from("checklist_templates")
    .select("id, name, description, archived, category")
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  // Archived templates stay in the table so old checklists keep their origin,
  // but they are not offered as something to start.
  return ((data as (TemplateSummary & { archived: boolean | null })[]) ?? []).filter(
    (t) => !t.archived,
  );
}

/** Workflow templates available to this workspace. */
export async function listWorkflowTemplates(): Promise<TemplateSummary[]> {
  const { data, error } = await supabase
    .from("workflow_templates")
    .select("id, name, description, archived")
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data as (TemplateSummary & { archived: boolean | null })[]) ?? []).filter(
    (t) => !t.archived,
  );
}

/**
 * Create a checklist on a project from a template.
 *
 * Mirrors `ApplyTemplateDialog.tsx` step for step, including the two things
 * that file learned the hard way:
 *
 * 1. A failed read of the template items is thrown, not swallowed. Swallowing
 *    it made an unreadable template look like an empty one, and the crew got a
 *    success message over a checklist with nothing in it.
 * 2. Positions are renumbered from zero rather than carried across. A template
 *    whose own positions have gaps or duplicates would otherwise produce a
 *    checklist the reorder controls cannot move.
 *
 * @returns the new checklist id, so the caller can open it directly.
 */
export async function applyChecklistTemplate(
  projectId: string,
  template: TemplateSummary,
  userId: string,
): Promise<string> {
  const { data: items, error: readError } = await supabase
    .from("checklist_template_items")
    .select("position, label, required, item_type, description")
    .eq("template_id", template.id)
    .order("position", { ascending: true });

  if (readError) throw new Error(readError.message);

  const { data: created, error: createError } = await supabase
    .from("project_checklists")
    .insert({
      project_id: projectId,
      template_id: template.id,
      name: template.name,
      created_by: userId,
    } as never)
    .select("id")
    .single();

  if (createError || !created) {
    throw new Error(createError?.message ?? "Could not start that checklist");
  }

  const checklistId = (created as { id: string }).id;

  const rows = (
    (items as
      | {
          label: string;
          required: boolean | null;
          item_type: string | null;
          description: string | null;
        }[]
      | null) ?? []
  ).map((item, index) => ({
    checklist_id: checklistId,
    position: index,
    label: item.label,
    required: item.required ?? false,
    item_type: item.item_type ?? "checkbox",
    description: item.description ?? null,
  }));

  if (rows.length > 0) {
    const { error: itemsError } = await supabase
      .from("project_checklist_items")
      .insert(rows as never);

    if (itemsError) {
      // Compensating delete. Leaving the parent behind gives the project an
      // item-less checklist, and the obvious retry stacks another one.
      await supabase.from("project_checklists").delete().eq("id", checklistId);
      throw new Error(itemsError.message);
    }
  }

  return checklistId;
}

/**
 * Start a workflow on a project from a template.
 *
 * Three tables rather than two: template phases and template items become
 * project phases and project items, and the items have to point at the phase
 * ids the database just assigned. Phases are inserted in one batch and matched
 * back by `position`, which is why positions are renumbered from zero here too.
 *
 * The rollback deletes only the workflow row and relies on the cascade to take
 * its phases and items with it, exactly as the web version does.
 *
 * @returns the new workflow id.
 */
export async function applyWorkflowTemplate(
  projectId: string,
  template: TemplateSummary,
  userId: string,
): Promise<string> {
  const { data: templatePhases, error: phaseError } = await supabase
    .from("workflow_template_phases")
    .select("id, position, name, description, requires_signoff")
    .eq("template_id", template.id)
    .order("position", { ascending: true });

  if (phaseError) throw new Error(phaseError.message);

  const phases =
    (templatePhases as
      | {
          id: string;
          name: string;
          description: string | null;
          requires_signoff: boolean | null;
        }[]
      | null) ?? [];

  let templateItems: { phase_id: string; kind: string; label: string; required: boolean }[] = [];
  if (phases.length > 0) {
    const { data, error } = await supabase
      .from("workflow_template_items")
      .select("phase_id, position, kind, label, required")
      .in(
        "phase_id",
        phases.map((p) => p.id),
      )
      .order("position", { ascending: true });

    if (error) throw new Error(error.message);
    templateItems = (data as typeof templateItems | null) ?? [];
  }

  const { data: created, error: createError } = await supabase
    .from("project_workflows")
    .insert({
      project_id: projectId,
      template_id: template.id,
      name: template.name,
      description: template.description,
      created_by: userId,
    } as never)
    .select("id")
    .single();

  if (createError || !created) {
    throw new Error(createError?.message ?? "Could not start that workflow");
  }

  const workflowId = (created as { id: string }).id;

  try {
    if (phases.length > 0) {
      const { data: newPhases, error: insertPhaseError } = await supabase
        .from("project_workflow_phases")
        .insert(
          phases.map((phase, index) => ({
            workflow_id: workflowId,
            position: index,
            name: phase.name,
            description: phase.description,
            requires_signoff: phase.requires_signoff ?? false,
          })) as never,
        )
        .select("id, position");

      if (insertPhaseError) throw new Error(insertPhaseError.message);

      // Matched back by position, because the database assigns the ids and the
      // insert does not promise to return them in the order they were sent.
      const idByPosition = new Map<number, string>();
      for (const row of (newPhases as { id: string; position: number }[] | null) ?? []) {
        idByPosition.set(row.position, row.id);
      }

      const itemRows = phases.flatMap((phase, index) => {
        const newPhaseId = idByPosition.get(index);
        if (!newPhaseId) return [];
        return templateItems
          .filter((item) => item.phase_id === phase.id)
          .map((item, itemIndex) => ({
            phase_id: newPhaseId,
            position: itemIndex,
            kind: item.kind,
            label: item.label,
            required: item.required,
          }));
      });

      if (itemRows.length > 0) {
        const { error: itemsError } = await supabase
          .from("project_workflow_items")
          .insert(itemRows as never);
        if (itemsError) throw new Error(itemsError.message);
      }
    }
  } catch (error) {
    // Cascades to phases and items, so the project is left exactly as it was.
    await supabase.from("project_workflows").delete().eq("id", workflowId);
    throw error;
  }

  return workflowId;
}
