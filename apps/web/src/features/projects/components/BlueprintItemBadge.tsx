import { LayoutTemplate } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "From <blueprint>" on an individual checklist / workflow / document / report.
 *
 * The blueprint pill on the project hero answers *how many* of each kind a
 * blueprint created and *which tab* they landed in. It cannot answer "is THIS
 * checklist one of them", because a blueprint-created row is byte-identical to
 * one someone typed by hand - which is the whole reason provenance was invisible.
 *
 * Two ways in, and they are not equally good.
 *
 * `origin` is the recorded answer: the row itself points at the apply that
 * created it (`blueprint_application_id`, 20260924000000), so it is exact and it
 * does not move when the blueprint is later edited.
 *
 * `source` is the old inference - the ledger's `itemSources` map, source
 * template id → blueprint. It is kept only for databases where that migration
 * has not run yet, because it is wrong in two directions: a checklist applied
 * from the same template BY HAND is badged as blueprint output, and editing the
 * blueprint silently re-labels projects it was applied to months ago. Prefer
 * `origin` wherever it is available.
 *
 * `"manual"` is rendered only on projects that actually have a blueprint
 * applied. On a project with no blueprint every row is manual, so saying so on
 * each one is noise with no contrast to draw.
 */
export function BlueprintItemBadge({
  origin,
  source,
  className,
}: {
  /** Recorded origin. `"manual"` prints the explicit "Added manually" tag. */
  origin?: { blueprintName: string | null; inferred?: boolean } | "manual" | null;
  /** Legacy inferred origin. Ignored whenever `origin` is supplied. */
  source?: { blueprintId: string | null; blueprintName: string | null } | null;
  className?: string;
}) {
  const base =
    "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold";

  if (origin === "manual") {
    return (
      <span
        className={cn(base, "border-dashed border-border/70 text-muted-foreground/70", className)}
        title="Added on this project, not by a blueprint"
      >
        <span className="truncate">Added manually</span>
      </span>
    );
  }

  const resolved = origin ?? source;
  if (!resolved) return null;
  const name = resolved.blueprintName ?? "a blueprint";
  /*
   * An inferred tag is the backfill's guess, matched on template and timing.
   * It must not read like something the apply recorded - the client asked for
   * this trail specifically so it could be audited.
   */
  // `origin` is already narrowed past "manual" by the early return above.
  const inferred = origin ? origin.inferred === true : true;
  return (
    <span
      className={cn(base, "border-border bg-muted/60 text-muted-foreground", className)}
      title={
        inferred
          ? `Matched to the “${name}” blueprint by its template and timing, not recorded at the time it was applied`
          : `Created by the “${name}” blueprint`
      }
    >
      <LayoutTemplate className="h-3 w-3 shrink-0" />
      <span className="truncate">{name}</span>
      {inferred && <span className="shrink-0 font-normal opacity-70">~</span>}
    </span>
  );
}
