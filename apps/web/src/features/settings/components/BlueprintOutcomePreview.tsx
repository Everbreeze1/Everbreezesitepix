import { useMemo } from "react";
import { ArrowRight, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DESTINATION,
  KIND_ORDER,
  KIND_OUTCOME,
  type BlueprintDestination,
  type BlueprintItemKind,
} from "./blueprint-outcomes";

export interface BlueprintPreviewItem {
  kind: BlueprintItemKind;
  name: string;
}

interface Group {
  destination: BlueprintDestination;
  /**
   * `looseLabels` marks the blueprint's own labels, which land on the project
   * as bare labels rather than as a saved label set — same destination, so the
   * row is labelled "Label" instead of "Label set".
   */
  entries: Array<{ kind: BlueprintItemKind; names: string[]; looseLabels?: boolean }>;
  total: number;
}

/** Groups a blueprint's contents by the project surface they land on. */
function groupByDestination(items: BlueprintPreviewItem[], labels: string[]): Group[] {
  const byKind = new Map<BlueprintItemKind, string[]>();
  for (const it of items) {
    const bucket = byKind.get(it.kind);
    if (bucket) bucket.push(it.name);
    else byKind.set(it.kind, [it.name]);
  }

  const order: BlueprintDestination[] = ["checklists", "workflows", "documents", "labels"];
  const groups: Group[] = [];
  for (const destination of order) {
    const entries: Group["entries"] = [];
    for (const kind of KIND_ORDER) {
      if (KIND_OUTCOME[kind].destination !== destination) continue;
      const names = byKind.get(kind);
      if (names?.length) entries.push({ kind, names });
    }
    // Blueprint labels are not an item — they are a property of the blueprint
    // itself — but they land on the project just the same, so the preview has
    // to account for them or "what this creates" under-reports.
    if (destination === "labels" && labels.length) {
      entries.push({ kind: "label_set", names: labels, looseLabels: true });
    }
    if (!entries.length) continue;
    groups.push({
      destination,
      entries,
      total: entries.reduce((n, e) => n + e.names.length, 0),
    });
  }
  return groups;
}

/**
 * "Apply this and here is the project you get."
 *
 * The blueprint builder listed template *types* — a row saying "Checklist ·
 * HVAC Inspection" told you what you had picked but never what selecting it
 * does. This shows the destination first: the project tab, then the things that
 * appear in it. Same component on the blueprint detail (before you have chosen
 * a project) and inside the apply dialog (after you have), so the promise and
 * the confirmation are literally the same picture.
 */
export function BlueprintOutcomePreview({
  items,
  labels,
  projectName,
  className,
  dense = false,
}: {
  items: BlueprintPreviewItem[];
  labels: string[];
  /** Named target, when one is known. Falls back to a generic project. */
  projectName?: string | null;
  className?: string;
  /** Tighter spacing for use inside a dialog. */
  dense?: boolean;
}) {
  const groups = useMemo(() => groupByDestination(items, labels), [items, labels]);

  if (!groups.length) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-dashed border-border px-4 py-8 text-center",
          className,
        )}
      >
        <p className="text-sm font-semibold text-foreground">This blueprint is still empty</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
          Add checklists, workflows, documents, reports or label sets below and this panel will show
          exactly what a project gets when you apply it.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {groups.map((group) => {
        const meta = DESTINATION[group.destination];
        const Icon = meta.icon;
        return (
          <div
            key={group.destination}
            className="rounded-2xl border border-border bg-card/80 px-3.5 py-3"
          >
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-bold text-foreground">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{projectName || "The project"}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span>{meta.tab}</span>
                </div>
                {!dense && (
                  <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                    {meta.blurb}
                  </p>
                )}
              </div>
              <span className="shrink-0 rounded-lg bg-muted px-2 py-1 text-[11px] font-extrabold text-muted-foreground">
                +{group.total}
              </span>
            </div>

            <ul className={cn("space-y-1", dense ? "mt-2" : "mt-2.5")}>
              {group.entries.flatMap((entry) =>
                entry.names.map((name, i) => {
                  const kindMeta = KIND_OUTCOME[entry.kind];
                  const KindIcon = kindMeta.icon;
                  return (
                    <li
                      key={`${entry.kind}-${i}-${name}`}
                      className="flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5"
                    >
                      <span
                        className={cn(
                          "grid h-5 w-5 shrink-0 place-items-center rounded",
                          kindMeta.tint,
                        )}
                      >
                        <KindIcon className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                        {name}
                      </span>
                      <span className="shrink-0 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                        {entry.looseLabels ? "Label" : kindMeta.label}
                      </span>
                    </li>
                  );
                }),
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
