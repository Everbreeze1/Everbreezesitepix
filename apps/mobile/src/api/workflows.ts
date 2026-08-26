import { supabase } from "@/lib/supabase";
import { isItemComplete, type WorkflowItemLike, type WorkflowPhaseLike } from "./workflow-state";

/**
 * Project workflows: multi-phase job runs with sign-off.
 *
 * Read and advance only on mobile. Designing a workflow, adding phases, and
 * changing what a phase requires are manager actions that stay on the web app;
 * the field needs to see where the job is and move it forward.
 */

export type WorkflowSummary = {
  id: string;
  name: string;
  project_id: string;
  completed_at: string | null;
  updated_at: string;
  /** Derived by `listProjectWorkflows`, not columns. */
  total: number;
  done: number;
};

export type WorkflowItem = WorkflowItemLike & {
  id: string;
  phase_id: string;
  label: string;
  position: number;
  completed_by: string | null;
};

export type WorkflowPhase = WorkflowPhaseLike & {
  id: string;
  workflow_id: string;
  name: string;
  description: string | null;
  position: number;
  notes: string | null;
  signoff_name: string | null;
  signed_off_by: string | null;
  items: WorkflowItem[];
};

export type WorkflowDetail = {
  id: string;
  name: string;
  project_id: string;
  description: string | null;
  completed_at: string | null;
  phases: WorkflowPhase[];
};

const PHASE_FIELDS =
  "id, workflow_id, name, description, position, notes, requires_signoff, signed_off_at, signed_off_by, signoff_name";
const ITEM_FIELDS =
  "id, phase_id, kind, label, position, required, completed_at, completed_by, note_text, photo_id";

export async function listProjectWorkflows(projectId: string): Promise<WorkflowSummary[]> {
  const { data, error } = await supabase
    .from("project_workflows")
    .select("id, name, project_id, completed_at, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  const rows = (data as Omit<WorkflowSummary, "total" | "done">[]) ?? [];
  if (rows.length === 0) return [];

  /*
   * Progress needs the items, and items hang off phases rather than the
   * workflow, so this walks down one level before counting. Two round trips is
   * still cheaper than an aggregate per workflow, and a wrong count on this
   * screen is worse than a slightly slower one.
   */
  const { data: phases } = await supabase
    .from("project_workflow_phases")
    .select("id, workflow_id")
    .in(
      "workflow_id",
      rows.map((row) => row.id),
    );

  const phaseRows = (phases as { id: string; workflow_id: string }[]) ?? [];
  const workflowByPhase = new Map(phaseRows.map((phase) => [phase.id, phase.workflow_id]));

  const totals = new Map<string, { total: number; done: number }>();

  if (phaseRows.length > 0) {
    const { data: items } = await supabase
      .from("project_workflow_items")
      .select("phase_id, kind, required, completed_at, note_text, photo_id")
      .in(
        "phase_id",
        phaseRows.map((phase) => phase.id),
      );

    for (const item of (items as (WorkflowItemLike & { phase_id: string })[]) ?? []) {
      const workflowId = workflowByPhase.get(item.phase_id);
      if (!workflowId) continue;
      const entry = totals.get(workflowId) ?? { total: 0, done: 0 };
      entry.total += 1;
      if (isItemComplete(item)) entry.done += 1;
      totals.set(workflowId, entry);
    }
  }

  return rows.map((row) => ({
    ...row,
    total: totals.get(row.id)?.total ?? 0,
    done: totals.get(row.id)?.done ?? 0,
  }));
}

export async function getWorkflow(workflowId: string): Promise<WorkflowDetail | null> {
  const { data: workflow, error } = await supabase
    .from("project_workflows")
    .select("id, name, project_id, description, completed_at")
    .eq("id", workflowId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!workflow) return null;

  const { data: phases, error: phaseError } = await supabase
    .from("project_workflow_phases")
    .select(PHASE_FIELDS)
    .eq("workflow_id", workflowId)
    .order("position", { ascending: true });

  if (phaseError) throw new Error(phaseError.message);
  const phaseRows = (phases as Omit<WorkflowPhase, "items">[]) ?? [];

  let itemRows: WorkflowItem[] = [];
  if (phaseRows.length > 0) {
    const { data: items, error: itemError } = await supabase
      .from("project_workflow_items")
      .select(ITEM_FIELDS)
      .in(
        "phase_id",
        phaseRows.map((phase) => phase.id),
      )
      .order("position", { ascending: true });

    if (itemError) throw new Error(itemError.message);
    itemRows = (items as WorkflowItem[]) ?? [];
  }

  return {
    ...(workflow as Omit<WorkflowDetail, "phases">),
    phases: phaseRows.map((phase) => ({
      ...phase,
      items: itemRows.filter((item) => item.phase_id === phase.id),
    })),
  };
}

export async function applyWorkflowItemPatch(
  itemId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("project_workflow_items")
    .update(patch as never)
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function applyPhasePatch(
  phaseId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("project_workflow_phases")
    .update(patch as never)
    .eq("id", phaseId);
  // The completion trigger raises its own sentence for an unauthorised
  // sign-off; pass it through rather than replacing it with a generic message.
  if (error) throw new Error(error.message);
}
