import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { isStagedRun, runStage, type StagePhase } from "@everlumen/shared";
import { supabase } from "@/integrations/everlumen/client";
import { useAuth } from "@/hooks/use-auth";

export interface ProjectWorkflowStage {
  workflowName: string;
  stageName: string;
  /** 1-based. */
  number: number;
  total: number;
  /** When the job arrived on this stage. */
  since: string;
  stuck: boolean;
}

/**
 * Which stage each job's open workflow is on, and whether it has sat there
 * past STUCK_AFTER_HOURS.
 *
 * Two requests for a window of project ids, not one per row, for the same
 * reason as `useProjectAssignees`. A job with more than one open workflow shows
 * the one that is stuck, else the one that has waited longest, since that is
 * the one somebody needs to chase. Walkthrough runs are shot lists, not staged
 * jobs, so they are left out. A failed read renders nothing: a stage hint on a
 * list row is never worth an error state.
 */
export function useProjectWorkflowStages(
  projectIds: string[],
): Record<string, ProjectWorkflowStage> {
  const { user } = useAuth();
  const ids = useMemo(
    () => Array.from(new Set(projectIds.filter(Boolean))).sort(),
    [projectIds.join(",")], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { data } = useQuery({
    queryKey: ["project-workflow-stages", user?.id ?? "anon", ids],
    enabled: !!user && ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: wfs, error } = await supabase
        .from("project_workflows" as any)
        .select("id, project_id, name, started_at, completed_at, source_kind")
        .in("project_id", ids)
        .is("completed_at", null);
      if (error) throw error;
      const runs = ((wfs as any[]) ?? []).filter((w) => isStagedRun(w.source_kind)) as {
        id: string;
        project_id: string;
        name: string;
        started_at: string;
        completed_at: string | null;
      }[];
      if (!runs.length) return {};

      const { data: phs, error: phErr } = await supabase
        .from("project_workflow_phases" as any)
        .select(
          "id, workflow_id, position, name, requires_signoff, signed_off_at, completed_at, unlocked_at",
        )
        .in(
          "workflow_id",
          runs.map((r) => r.id),
        );
      if (phErr) throw phErr;
      const phasesByRun = new Map<string, StagePhase[]>();
      for (const p of ((phs as any[]) ?? []) as (StagePhase & { workflow_id: string })[]) {
        const list = phasesByRun.get(p.workflow_id);
        if (list) list.push(p);
        else phasesByRun.set(p.workflow_id, [p]);
      }

      const now = Date.now();
      const out: Record<string, ProjectWorkflowStage> = {};
      for (const run of runs) {
        const stage = runStage(run, phasesByRun.get(run.id) ?? [], now);
        if (!stage.current || !stage.since) continue;
        const next: ProjectWorkflowStage = {
          workflowName: run.name,
          stageName: stage.current.name,
          number: stage.number,
          total: stage.total,
          since: stage.since,
          stuck: stage.stuck,
        };
        const prev = out[run.project_id];
        if (
          !prev ||
          (next.stuck && !prev.stuck) ||
          (next.stuck === prev.stuck && Date.parse(next.since) < Date.parse(prev.since))
        ) {
          out[run.project_id] = next;
        }
      }
      return out;
    },
  });

  return (data ?? {}) as Record<string, ProjectWorkflowStage>;
}

/** "3d", "5h": how long a job has been on its stage. */
export function stageWaitLabel(sinceIso: string, now: number = Date.now()): string {
  const hours = Math.max(0, Math.floor((now - Date.parse(sinceIso)) / 3_600_000));
  return hours >= 24 ? `${Math.floor(hours / 24)}d` : `${hours}h`;
}
