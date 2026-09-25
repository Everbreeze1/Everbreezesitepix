import { useEffect, useState } from "react";
import { supabase } from "@/integrations/everlumen/client";
import { cn } from "@/lib/utils";
import { TABLES, workflowState, type Item, type Phase, type Workflow } from "./ProjectWorkflows";

interface Loaded {
  workflow: Workflow;
  phases: Phase[];
  items: Item[];
}

/**
 * "Workflow · <name>" on the project header: one dot per phase of the job's
 * workflow, joined by a line, so where the job stands reads at a glance.
 *
 * Shows the workflow that still has work in it - the newest unfinished one - and
 * falls back to the newest finished one, so a completed job still shows its
 * whole run filled in. Walkthrough runs share the table but are shot lists, not
 * workflows, so they are left out. Renders nothing when the job has no workflow,
 * or when the read fails: a header strip is never worth an error state.
 *
 * `refreshKey` re-reads it when something on the page may have moved the
 * workflow on (the Workflows panel closing, the workflow count changing).
 */
export function ProjectWorkflowStrip({
  projectId,
  refreshKey,
  onOpen,
  showEmpty = false,
  className,
}: {
  projectId: string;
  refreshKey?: string | number;
  onOpen?: () => void;
  /** Draw a quiet "none started" row when the job has no workflow, instead of nothing. */
  showEmpty?: boolean;
  className?: string;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Dev-only design preview: add ?demoWorkflow=1 to a project's URL to draw the
    // reference's five-phase row without a workflow on the job, and without writing
    // one to the database. Compiled out of production builds.
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("demoWorkflow")) {
      const demo = (name: string, position: number): Phase =>
        ({
          id: `demo-${position}`,
          workflow_id: "demo",
          position,
          name,
          description: null,
          requires_signoff: false,
          notes: null,
          signed_off_by: null,
          signed_off_at: null,
          signoff_name: null,
        }) as Phase;
      setData({
        workflow: {
          id: "demo",
          name: "Normal HVAC Service Call",
          completed_at: new Date().toISOString(),
        } as Workflow,
        phases: [
          demo("Initial contact", 0),
          demo("Diagnosis", 1),
          demo("Pictures of units", 2),
          demo("Repair & service", 3),
          demo("Report back", 4),
        ],
        items: [],
      });
      setSettled(true);
      return;
    }
    void (async () => {
      try {
        const { data: wfs, error } = await supabase
          .from(TABLES.workflows as any)
          .select("*")
          .eq("project_id", projectId)
          .order("started_at", { ascending: false });
        if (error) throw error;
        const runs = ((wfs ?? []) as unknown as Workflow[]).filter(
          (w) => (w.source_kind ?? "workflow") === "workflow",
        );
        const chosen = runs.find((w) => !w.completed_at) ?? runs[0];
        if (!chosen) {
          if (!cancelled) {
            setData(null);
            setSettled(true);
          }
          return;
        }
        const { data: phs, error: pErr } = await supabase
          .from(TABLES.phases as any)
          .select("*")
          .eq("workflow_id", chosen.id)
          .order("position", { ascending: true });
        if (pErr) throw pErr;
        const phases = (phs ?? []) as unknown as Phase[];
        let items: Item[] = [];
        if (phases.length > 0) {
          const { data: its, error: iErr } = await supabase
            .from(TABLES.items as any)
            .select("*")
            .in(
              "phase_id",
              phases.map((p) => p.id),
            );
          if (iErr) throw iErr;
          items = (its ?? []) as unknown as Item[];
        }
        if (!cancelled) {
          setData({ workflow: chosen, phases, items });
          setSettled(true);
        }
      } catch (e) {
        // Hidden from the page - a header strip is never worth an error state - but
        // not from the console, or "no workflow" and "the read failed" look the same.
        console.warn("[workflow-strip] could not read this project's workflow", e);
        if (!cancelled) {
          setData(null);
          setSettled(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  if (!data || data.phases.length === 0) {
    if (!showEmpty || !settled) return null;
    return (
      <section className={className}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.05em] text-faint">
          Workflow · none started
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="text-[12.5px] font-semibold text-primary transition hover:underline"
        >
          Start a workflow from a template
        </button>
      </section>
    );
  }

  const state = workflowState(data.workflow, data.phases, data.items);
  // A run that has been signed off as finished is finished, whatever its steps say.
  const doneAll = state.isComplete;

  return (
    <section className={className}>
      <div className="mb-3.5 text-xs font-semibold uppercase tracking-[0.05em] text-faint">
        Workflow · {data.workflow.name}
      </div>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open workflow ${data.workflow.name}`}
        className="flex w-full items-start overflow-x-auto pb-1 text-left"
      >
        {state.phases.map((ph, i) => {
          const complete = doneAll || !!state.stateByPhase.get(ph.id)?.complete;
          const active = !doneAll && state.activePhaseId === ph.id;
          const last = i === state.phases.length - 1;
          return (
            <div key={ph.id} className="relative flex min-w-[88px] flex-1 flex-col items-center">
              {!last && (
                <div
                  className={cn(
                    "absolute left-1/2 top-[7px] z-0 h-0.5 w-full",
                    complete ? "bg-status-complete" : "bg-border",
                  )}
                />
              )}
              <div
                className={cn(
                  "z-10 h-[15px] w-[15px] rounded-full border-2",
                  complete
                    ? "border-status-complete bg-status-complete"
                    : active
                      ? "border-status-complete bg-card"
                      : "border-border bg-card",
                )}
              />
              <div
                className={cn(
                  "mt-2 px-1 text-center text-[11.5px] font-semibold",
                  complete || active ? "text-foreground" : "text-faint",
                )}
              >
                {ph.name}
              </div>
            </div>
          );
        })}
      </button>
    </section>
  );
}
