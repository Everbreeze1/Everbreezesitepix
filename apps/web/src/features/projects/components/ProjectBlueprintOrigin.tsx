import { Link } from "@tanstack/react-router";
import { LayoutTemplate } from "lucide-react";
import { relativeTime } from "@sitepix/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BlueprintOriginApplication } from "@/lib/blueprint.functions";
import type { BlueprintOriginState } from "@/hooks/use-project-blueprint-origin";
import {
  DESTINATION,
  KIND_ORDER,
  KIND_OUTCOME,
  type BlueprintItemKind,
} from "@/features/settings/components/blueprint-outcomes";

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
 * This closes the loop from the project end - the pill names the blueprint, and
 * opening it breaks down what that apply created and which tab each part landed
 * on, so the connection between "a blueprint was applied" and "these checklists
 * appeared" is visible rather than inferred.
 */
export function ProjectBlueprintOrigin({
  state,
  onOpenPanel,
}: {
  /** From `useProjectBlueprintOrigin` - one reader shared with the per-item badges. */
  state: BlueprintOriginState;
  onOpenPanel?: (panel: ProjectPanel) => void;
}) {
  if (state.kind === "loading" || state.kind === "none") return null;

  if (state.kind === "unavailable") {
    // Badge, never hide. Rendering nothing here is what made "the ledger is not
    // on this environment" look identical to "no blueprint was applied".
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-sidebar-foreground/20 px-3 py-1 text-[11px] font-bold text-sidebar-foreground/45"
        title="This project's blueprint history could not be read, so its origin can't be shown. It may not be set up on this environment yet."
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
          <span className="truncate">Blueprint · {first.blueprintName ?? "a blueprint"}</span>
          {extra > 0 && <span className="shrink-0 opacity-70">+{extra}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="max-h-[60vh] overflow-y-auto">
          {applications.map((app, i) => (
            <ApplicationBlock
              key={`${app.blueprintId ?? "deleted"}-${app.appliedAt}-${i}`}
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
  app: BlueprintOriginApplication;
  first: boolean;
  onOpenPanel?: (panel: ProjectPanel) => void;
}) {
  /*
   * Counts are keyed by `countsKey`, not by the display plural - the two are
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
          <p className="truncate text-sm font-bold text-foreground">
            {app.blueprintName ?? "A deleted blueprint"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {/*
             * A backfilled row is an inference from the project's checklists and
             * workflows, not a recorded apply, and its counts are known to be
             * partial. Saying "Set up" would assert something nobody observed.
             */}
            {app.inferred
              ? "Detected from its checklists"
              : `${first ? "Set up" : "Also applied"} ${relativeTime(app.appliedAt)}`}
            {app.version != null && <span> · v{app.version}</span>}
            {app.failedCount > 0 && (
              <span className="font-bold text-destructive"> · {app.failedCount} failed</span>
            )}
          </p>
          {/*
           * The blueprint has moved on, and this project has not.
           *
           * This is the visible half of the spec's isolation rule: "editing the
           * master Blueprint later must NOT retroactively alter projects already
           * using it." That the rule holds is a property of the apply being a
           * copy; that anyone can TELL it holds needs saying, and the moment it
           * matters is when someone opens a project, sees the blueprint's name,
           * and wonders whether what they are looking at is current.
           *
           * Only shown when there is a real gap, so an unedited blueprint adds
           * no noise.
           */}
          {app.version != null &&
            app.currentVersion != null &&
            app.currentVersion > app.version && (
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                That blueprint is now at v{app.currentVersion}. This project keeps what it was
                given.
              </p>
            )}
        </div>
        {/*
         * Badge, never hide: a teammate who cannot open someone's personal
         * blueprint still learns which blueprint made this project. Only the
         * route in is withheld.
         */}
        {app.blueprintVisible && app.blueprintId ? (
          <Link
            to="/templates"
            search={{ tab: "blueprints", blueprint: app.blueprintId }}
            className="shrink-0 text-[11px] font-bold text-primary hover:underline"
          >
            Open →
          </Link>
        ) : (
          <span
            className="shrink-0 text-[11px] text-muted-foreground"
            title={
              app.blueprintId
                ? "This blueprint is in another member's personal library."
                : "This blueprint has since been deleted."
            }
          >
            {app.blueprintId ? "Private" : "Deleted"}
          </span>
        )}
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
            // tab, and labels are not a tab at all - so only project-scoped
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
