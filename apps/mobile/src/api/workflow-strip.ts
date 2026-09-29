import { supabase } from "@/lib/supabase";
import { getWorkflow, type WorkflowDetail } from "./workflows";

/**
 * The workflow the project header shows.
 *
 * Same choice as the web `ProjectWorkflowStrip`: the newest run that still has
 * work in it, falling back to the newest finished one, so a completed job still
 * shows its whole run filled in. Walkthrough runs share the table but are shot
 * lists rather than workflows, so they are left out.
 */
export async function getProjectWorkflowStrip(projectId: string): Promise<WorkflowDetail | null> {
  const { data, error } = await supabase
    .from("project_workflows")
    .select("id, completed_at, source_kind, started_at")
    .eq("project_id", projectId)
    .order("started_at", { ascending: false });
  if (error) throw new Error(error.message);

  const runs = (
    (data as { id: string; completed_at: string | null; source_kind: string | null }[]) ?? []
  ).filter((run) => (run.source_kind ?? "workflow") === "workflow");
  const chosen = runs.find((run) => !run.completed_at) ?? runs[0];
  if (!chosen) return null;
  return getWorkflow(chosen.id);
}
