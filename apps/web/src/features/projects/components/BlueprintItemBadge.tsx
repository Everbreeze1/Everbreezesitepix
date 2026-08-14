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
 * Driven by the ledger's `itemSources` map (source template id → blueprint), not
 * by `template_id !== null`. That distinction matters: `template_id` is also set
 * when a checklist template is applied on its own, so testing it for null would
 * badge directly-applied items as blueprint output.
 */
export function BlueprintItemBadge({
  source,
  className,
}: {
  source?: { blueprintId: string | null; blueprintName: string | null } | null;
  className?: string;
}) {
  if (!source) return null;
  const name = source.blueprintName ?? "a blueprint";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-bold text-muted-foreground",
        className,
      )}
      title={`Created by the “${name}” blueprint`}
    >
      <LayoutTemplate className="h-3 w-3 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}
