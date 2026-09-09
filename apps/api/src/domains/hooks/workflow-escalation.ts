import { jsonError, jsonOk } from "../../lib/errors";
import { verifyCronSecret } from "../../lib/cron-auth";
import { getSupabaseAdmin } from "../../lib/supabase";
import { recordJobRun } from "../../lib/job-run";
import { insertNotification } from "../notifications/service";

/**
 * Escalation (spec #9): surface workflows that have shown no progress for their
 * configured window instead of waiting for someone to check by hand.
 *
 * A workflow counts as stalled when it is assigned, not completed, and its most
 * recent completed step is older than the template's `stall_window_hours` (or
 * there is no completed step at all). The assigned manager - whoever handed the
 * work out, or the workflow's creator - is told, in-app and email. Internal
 * only: nothing reaches the customer.
 */
export async function handleWorkflowEscalation(request: Request): Promise<Response> {
  if (!(await verifyCronSecret(request))) {
    return jsonError(401, "unauthorized", "Unauthorized");
  }

  try {
    const outcome = await recordJobRun("workflow-escalation", async () => {
      const admin = getSupabaseAdmin();
      const now = Date.now();

      const { data: wfRows, error } = await (admin as any)
        .from("project_workflows")
        .select(
          "id, name, project_id, assigned_to, assigned_by, created_by, template_id, workflow_templates(stall_window_hours)",
        )
        .is("completed_at", null)
        .not("assigned_to", "is", null);
      if (error) throw new Error(error.message);

      const workflows = (wfRows ?? []) as Array<{
        id: string;
        name: string;
        project_id: string;
        assigned_to: string;
        assigned_by: string | null;
        created_by: string;
        workflow_templates?: { stall_window_hours: number | null } | null;
      }>;

      let notified = 0;
      for (const wf of workflows) {
        const windowHours = Number(wf.workflow_templates?.stall_window_hours ?? 48);
        const cutoff = new Date(now - windowHours * 3_600_000).toISOString();

        const stalled = await isStalled(admin as any, wf.id, cutoff);
        if (!stalled) continue;

        await insertNotification(admin as any, {
          recipientId: wf.assigned_by ?? wf.created_by,
          actorId: null,
          type: "workflow_stalled",
          title: "Workflow stalled",
          body: `"${wf.name}" has had no progress in ${windowHours}h.`,
          linkPath: `/projects/${wf.project_id}`,
          projectId: wf.project_id,
          entityType: "workflow",
          entityId: wf.id,
        });
        notified++;
      }

      return { result: { notified, considered: workflows.length } };
    });

    return jsonOk(outcome);
  } catch (e: unknown) {
    return jsonError(500, "workflow_escalation_failed", e instanceof Error ? e.message : "Escalation failed");
  }
}

/**
 * Whether a workflow's most recent completed step predates `cutoff`, or it has
 * no completed step at all. Reads through the phases in one pass.
 */
async function isStalled(admin: any, workflowId: string, cutoff: string): Promise<boolean> {
  const { data: phases } = await admin
    .from("project_workflow_phases")
    .select("id")
    .eq("workflow_id", workflowId);

  const phaseIds = ((phases ?? []) as Array<{ id: string }>).map((p) => p.id);
  if (phaseIds.length === 0) return true;

  const { data: items } = await admin
    .from("project_workflow_items")
    .select("completed_at")
    .in("phase_id", phaseIds)
    .not("completed_at", "is", null);

  const sorted = ((items ?? []) as Array<{ completed_at: string }>)
    .map((i) => i.completed_at)
    .sort();
  const lastCompleted = sorted.length ? sorted[sorted.length - 1] : undefined;

  // No completed step ever, or the last one is older than the window.
  return !lastCompleted || lastCompleted < cutoff;
}
