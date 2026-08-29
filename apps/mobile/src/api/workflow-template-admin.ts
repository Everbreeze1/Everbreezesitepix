import { supabase } from "@/lib/supabase";
import type {
  WorkflowItemKind,
  WorkflowPhase,
  WorkflowTemplateItem,
} from "./workflow-template-edit";
import { asPositionedPhase } from "./workflow-template-edit";

/**
 * Managing workflow templates: the phases and the steps inside them.
 *
 * Direct RLS writes, matching `template-admin.ts` next door and the web
 * settings page. Nothing needs the service role: a template is rows scoped to
 * its creator, and the policy is the whole of the rule.
 *
 * Not queued through the outbox, for the same reason as the checklist editor:
 * this is office work done once and deliberately, and a phase that silently
 * appears twenty minutes later while somebody else is editing the same template
 * is worse than a write that fails and says so.
 */

const PHASE_FIELDS = "id, template_id, position, name, description, requires_signoff";
const ITEM_FIELDS = "id, phase_id, position, kind, label, required";

export async function listPhases(templateId: string): Promise<WorkflowPhase[]> {
  const { data, error } = await supabase
    .from("workflow_template_phases")
    .select(PHASE_FIELDS)
    .eq("template_id", templateId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  // Adapted at the boundary so nothing downstream has to know that a phase's
  // sort label is its `name`.
  return ((data ?? []) as Omit<WorkflowPhase, "label">[]).map(asPositionedPhase);
}

/**
 * Every item across every phase of one template, in one query.
 *
 * A query per phase would be one round trip per phase on a connection that may
 * be one bar, and a template with eight phases is normal. The screen groups
 * them with `itemsInPhase`.
 */
export async function listPhaseItems(phaseIds: string[]): Promise<WorkflowTemplateItem[]> {
  if (phaseIds.length === 0) return [];
  const { data, error } = await supabase
    .from("workflow_template_items")
    .select(ITEM_FIELDS)
    .in("phase_id", phaseIds)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkflowTemplateItem[];
}

export async function createPhase(args: {
  templateId: string;
  name: string;
  description: string | null;
  position: number;
}): Promise<WorkflowPhase> {
  const { data, error } = await supabase
    .from("workflow_template_phases")
    .insert({
      template_id: args.templateId,
      name: args.name,
      description: args.description,
      position: args.position,
    } as never)
    .select(PHASE_FIELDS)
    .single();
  if (error) throw new Error(error.message);
  return asPositionedPhase(data as Omit<WorkflowPhase, "label">);
}

export async function updatePhase(
  id: string,
  patch: { name?: string; description?: string | null; requires_signoff?: boolean },
): Promise<void> {
  const { error } = await supabase
    .from("workflow_template_phases")
    .update(patch as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Delete a phase, and with it every step inside it.
 *
 * The cascade is the database's: `workflow_template_items.phase_id` is
 * `ON DELETE CASCADE`. Worth knowing rather than assuming, because it is the
 * difference between a confirm that says "and its 6 steps" and one that lies.
 */
export async function deletePhase(id: string): Promise<void> {
  const { error } = await supabase.from("workflow_template_phases").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function createItem(args: {
  phaseId: string;
  label: string;
  kind: WorkflowItemKind;
  required: boolean;
  position: number;
}): Promise<WorkflowTemplateItem> {
  const { data, error } = await supabase
    .from("workflow_template_items")
    .insert({
      phase_id: args.phaseId,
      label: args.label,
      kind: args.kind,
      required: args.required,
      position: args.position,
    } as never)
    .select(ITEM_FIELDS)
    .single();
  if (error) throw new Error(error.message);
  return data as WorkflowTemplateItem;
}

export async function updateItem(
  id: string,
  patch: { label?: string; kind?: WorkflowItemKind; required?: boolean },
): Promise<void> {
  const { error } = await supabase
    .from("workflow_template_items")
    .update(patch as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from("workflow_template_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Write back the positions that actually moved, on either table.
 *
 * One statement per row: PostgREST has no "set these ids to these different
 * values" form, and a bulk upsert would need every column of every row.
 * `positionChanges` keeps the list to the two or three that moved, which is
 * what makes that acceptable.
 *
 * Sequential rather than `Promise.all`: adjacent rows of one table, and firing
 * twenty at once on a weak connection is how a reorder ends up half applied.
 */
export async function savePositions(
  table: "workflow_template_phases" | "workflow_template_items",
  changes: { id: string; position: number }[],
): Promise<void> {
  for (const change of changes) {
    const { error } = await supabase
      .from(table)
      .update({ position: change.position } as never)
      .eq("id", change.id);
    if (error) throw new Error(error.message);
  }
}
