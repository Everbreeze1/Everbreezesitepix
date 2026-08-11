import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LayoutTemplate } from "lucide-react";
import { relativeTime } from "@sitepix/shared";
import { supabase } from "@/integrations/sitepix/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DESTINATION,
  KIND_ORDER,
  KIND_OUTCOME,
  type BlueprintItemKind,
} from "@/features/settings/components/blueprint-outcomes";

interface Application {
  blueprintId: string;
  name: string;
  appliedAt: string;
  counts: Record<string, number>;
  failedCount: number;
}

/*
 * `null` used to mean three different things at once — still loading, no
 * blueprint was applied, and the ledger could not be read — and all three
 * rendered as nothing. A project on an environment without migration
 * 20260810000000 looked exactly like a project nobody had applied a blueprint
 * to, with no console line and no UI anywhere saying otherwise.
 *
 * "I can't tell" is a different answer from "there isn't one", so it gets its
 * own state and its own chip. Badge it, never hide it.
 */
type State =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "unavailable"; reason: "not-provisioned" | "read-failed" }
  | { kind: "ok"; applications: Application[] };

/** Panel keys on the project's own PageTabStrip. */
export type ProjectPanel = "reports" | "checklists" | "workflows";

/**
 * "Blueprint · <name>" on the project hero.
 *
 * The blueprint → project link only ran one way: you could apply a blueprint and
 * then never tell, from the project, that a blueprint was why any of this exists.
 * The items land in Checklists / Documents / Workflows looking exactly like rows
 * someone typed by hand.
 *
 * This closes the loop from the project end — the pill names the blueprint, and
 * opening it breaks down what that apply created and which tab each part landed
 * on, so the connection between "a blueprint was applied" and "these checklists
 * appeared" is visible rather than inferred.
 */
export function ProjectBlueprintOrigin({
  projectId,
  onOpenPanel,
}: {
  projectId: string;
  onOpenPanel?: (panel: ProjectPanel) => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      const { data, error } = await supabase
        .from("project_blueprint_applications" as any)
        .select("blueprint_id, created_at, counts, failed_count, project_templates(name)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        // Never silent. PGRST205 is "no such table in the schema cache", i.e.
        // the ledger migration has not been run on this environment; anything
        // else is a genuine read failure. Both are reported, neither is mistaken
        // for "this project has no blueprint".
        console.warn("[blueprint-origin] ledger read failed", {
          projectId,
          code: (error as { code?: string }).code,
          message: error.message,
        });
        setState({
          kind: "unavailable",
          reason:
            (error as { code?: string }).code === "PGRST205" ? "not-provisioned" : "read-failed",
        });
        return;
      }
      const rows = ((data as any[]) ?? []) as Array<{
        blueprint_id: string;
        created_at: string;
        counts: Record<string, number> | null;
        failed_count: number | null;
        project_templates: { name: string } | null;
      }>;
      if (!rows.length) {
        setState({ kind: "none" });
        return;
      }
      setState({
        kind: "ok",
        applications: rows.map((r) => ({
          blueprintId: r.blueprint_id,
          // The embed resolves to null when the blueprint sits in another
          // member's personal library and RLS hides it. The viewer still learns
          // that a blueprint was applied, which is the point of the pill.
          name: r.project_templates?.name ?? "a blueprint",
          appliedAt: r.created_at,
          counts: r.counts ?? {},
          failedCount: r.failed_count ?? 0,
        })),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (state.kind === "loading" || state.kind === "none") return null;

  if (state.kind === "unavailable") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-sidebar-foreground/20 px-3 py-1 text-[11px] font-bold text-sidebar-foreground/45"
        title={
          state.reason === "not-provisioned"
            ? "Blueprint history isn't set up on this environment yet, so this project's origin can't be shown."
            : "This project's blueprint history could not be read. Try reloading."
        }
      >
        <LayoutTemplate className="h-3.5 w-3.5" />
        Blueprint origin unavailable
      </span>
    );
  }

  const { applications } = state;
  // The first apply is the one that set the project up; later ones are
  // additions. Naming the first keeps the label stable as more are applied.
  const first = applications[0];
  const extra = applications.length - 1;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-sidebar-foreground/20 bg-sidebar-foreground/10 px-3 py-1 text-[11px] font-bold text-sidebar-foreground transition hover:bg-sidebar-foreground/20"
          title="See what this blueprint created"
        >
          <LayoutTemplate className="h-3.5 w-3.5 shrink-0 text-sidebar-ring" />
          <span className="truncate">Blueprint · {first.name}</span>
          {extra > 0 && <span className="shrink-0 opacity-70">+{extra}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="max-h-[60vh] overflow-y-auto">
          {applications.map((app, i) => (
            <ApplicationBlock
              key={`${app.blueprintId}-${app.appliedAt}`}
              app={app}
              first={i === 0}
              onOpenPanel={onOpenPanel}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ApplicationBlock({
  app,
  first,
  onOpenPanel,
}: {
  app: Application;
  first: boolean;
  onOpenPanel?: (panel: ProjectPanel) => void;
}) {
  /*
   * Counts are keyed by `countsKey`, not by the display plural — the two are
   * deliberately separate fields (see blueprint-outcomes.ts). Walking KIND_ORDER
   * rather than Object.entries keeps the rows in apply order and drops any key
   * the server adds later that this build doesn't know how to name.
   */
  const rows = KIND_ORDER.map((kind) => {
    const meta = KIND_OUTCOME[kind];
    const n = app.counts[meta.countsKey] ?? 0;
    return n > 0 ? { kind, meta, n } : null;
  }).filter(Boolean) as Array<{
    kind: BlueprintItemKind;
    meta: (typeof KIND_OUTCOME)[BlueprintItemKind];
    n: number;
  }>;

  return (
    <div className="border-b border-border p-3 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{app.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {first ? "Set up" : "Also applied"} {relativeTime(app.appliedAt)}
            {app.failedCount > 0 && (
              <span className="font-bold text-destructive"> · {app.failedCount} failed</span>
            )}
          </p>
        </div>
        <Link
          to="/templates"
          search={{ tab: "blueprints", blueprint: app.blueprintId }}
          className="shrink-0 text-[11px] font-bold text-primary hover:underline"
        >
          Open →
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">Nothing was created by this apply.</p>
      ) : (
        <ul className="mt-2 space-y-0.5">
          {rows.map(({ kind, meta, n }) => {
            const dest = DESTINATION[meta.destination];
            const Icon = meta.icon;
            const label = `${n} ${n === 1 ? meta.label.toLowerCase() : meta.plural}`;
            // Reports collect on the workspace Reports screen, not a project
            // tab, and labels are not a tab at all — so only project-scoped
            // destinations get a jump button. DESTINATION carries that fact so
            // it isn't re-guessed here.
            const jumpable =
              dest.scope !== "workspace" &&
              (meta.destination === "checklists" ||
                meta.destination === "workflows" ||
                meta.destination === "documents");
            const panel: ProjectPanel | null =
              meta.destination === "checklists"
                ? "checklists"
                : meta.destination === "workflows"
                  ? "workflows"
                  : meta.destination === "documents"
                    ? "reports"
                    : null;
            const body = (
              <>
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-left">{label}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{dest.tab}</span>
              </>
            );
            return (
              <li key={kind}>
                {jumpable && panel && onOpenPanel ? (
                  <button
                    type="button"
                    onClick={() => onOpenPanel(panel)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-[11.5px] text-foreground transition hover:bg-muted"
                  >
                    {body}
                  </button>
                ) : (
                  <span className="flex w-full items-center gap-2 px-1.5 py-1 text-[11.5px] text-foreground">
                    {body}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
