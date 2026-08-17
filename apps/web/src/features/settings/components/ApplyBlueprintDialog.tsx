import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  FolderOpen,
  Loader2,
  Search,
  TriangleAlert,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { applyProjectBlueprint } from "@/lib/blueprint.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { KIND_OUTCOME, type BlueprintItemKind } from "./blueprint-outcomes";
import { BlueprintOutcomePreview } from "./BlueprintOutcomePreview";

interface ProjectRow {
  id: string;
  name: string;
  street: string | null;
  city: string | null;
  archived: boolean | null;
}

interface ApplyResult {
  projectId: string;
  projectName: string;
  counts: Record<string, number>;
  failed: Array<{ kind: string; reason: string }>;
  /**
   * False when the items were created but nothing recorded which blueprint made
   * them, so the project cannot show its origin. The server treats that write as
   * best-effort and does not throw, so this flag is the only signal.
   */
  ledgerRecorded?: boolean;
  error?: string;
}

/**
 * Apply a blueprint to one or more existing projects.
 *
 * Blueprints could previously only be applied while creating a project, so an
 * authored blueprint had no visible route to the projects already running -
 * the "how do I actually use this?" gap. And a crew that standardises on a
 * blueprint mid-season wants it on the twelve jobs already open, not on the
 * next one only, which is why the target is a multi-select rather than a radio
 * list. Three steps on one surface: what it will create, which projects it
 * lands on, and what actually happened to each.
 */
export function ApplyBlueprintDialog({
  open,
  onOpenChange,
  blueprintId,
  blueprintName,
  items,
  labels,
  companyName,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  blueprintId: string;
  blueprintName: string;
  /** What the blueprint contains, in apply order. */
  items: Array<{ kind: BlueprintItemKind; name: string }>;
  /** Labels the blueprint merges onto the project. */
  labels: string[];
  /** Fills `{{company_name}}` in document and report templates. */
  companyName?: string | null;
  /** Fired after at least one project was written to, so callers can refresh. */
  onApplied?: () => void;
}) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ApplyResult[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setResults(null);
    setTargetIds([]);
    setProgress(null);
    setQ("");
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("projects")
        .select("id, name, street, city, archived")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      setProjects((((data as any[]) ?? []) as ProjectRow[]).filter((p) => !p.archived));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        `${p.street ?? ""} ${p.city ?? ""}`.toLowerCase().includes(needle),
    );
  }, [projects, q]);

  const targets = useMemo(
    () => projects.filter((p) => targetIds.includes(p.id)),
    [projects, targetIds],
  );
  const nothingToApply = items.length === 0 && labels.length === 0;

  const toggle = (id: string) =>
    setTargetIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const apply = async () => {
    if (!targets.length) return;
    setApplying(true);
    setProgress({ done: 0, total: targets.length });
    const collected: ApplyResult[] = [];
    // Sequential on purpose: each apply is a fan-out of inserts across five
    // tables, and firing a dozen at once is how you get Postgres to start
    // rejecting them. The progress line makes the wait legible.
    for (const target of targets) {
      try {
        const res = await applyProjectBlueprint({
          data: {
            blueprintId,
            projectId: target.id,
            projectName: target.name,
            projectAddress: [target.street, target.city].filter(Boolean).join(", ") || null,
            preparedBy: profile?.full_name || user?.email || "",
            companyName: companyName || undefined,
          },
        });
        collected.push({
          projectId: target.id,
          projectName: target.name,
          counts: res.counts ?? {},
          failed: res.failed ?? [],
          ledgerRecorded: res.ledgerRecorded,
        });
      } catch (e: any) {
        collected.push({
          projectId: target.id,
          projectName: target.name,
          counts: {},
          failed: [],
          error: e?.message ?? "Couldn't apply this blueprint",
        });
      }
      setProgress({ done: collected.length, total: targets.length });
    }
    setResults(collected);
    setApplying(false);

    const okCount = collected.filter((r) => !r.error).length;
    const errored = collected.filter((r) => r.error);
    if (okCount) onApplied?.();
    if (!okCount) toast.error(errored[0]?.error ?? "Couldn't apply this blueprint");
    else if (errored.length) toast.warning(`Applied to ${okCount} of ${collected.length} projects`);
    else if (collected.some((r) => r.failed.length))
      toast.warning(`Applied, but some items couldn't be created`);
    else
      toast.success(
        okCount === 1
          ? `“${blueprintName}” applied to ${collected[0].projectName}`
          : `“${blueprintName}” applied to ${okCount} projects`,
      );
  };

  /*
   * The header used to read "Blueprint applied - Everything below now exists on
   * the projects listed." whenever `results` was set, including when every item
   * had failed. The red per-item panel was right there underneath contradicting
   * it. A summary that can be false is worse than no summary.
   */
  const anyDegraded = !!results?.some((r) => r.error || r.failed.length > 0);
  const allErrored = !!results?.length && results.every((r) => r.error);

  return (
    <Dialog open={open} onOpenChange={(v) => (applying ? null : onOpenChange(v))}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>
            {!results
              ? `Apply “${blueprintName}”`
              : allErrored
                ? "Couldn’t apply"
                : anyDegraded
                  ? "Applied with problems"
                  : "Blueprint applied"}
          </DialogTitle>
          <DialogDescription>
            {!results
              ? "Nothing is created until you pick the projects and confirm."
              : allErrored
                ? "Nothing was created."
                : anyDegraded
                  ? "Some items couldn’t be created - they’re listed in red below."
                  : "Everything below now exists on the projects listed."}
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto px-5 py-4">
            {results.map((r) => {
              const created = Object.entries(r.counts).filter(([, n]) => n > 0);
              // A row that partly failed has no `r.error` but a non-empty
              // `r.failed`, so it used to take the all-clear styling and show
              // the same primary-tinted folder as a clean apply.
              const degraded = !!r.error || r.failed.length > 0;
              return (
                <div
                  key={r.projectId}
                  className="rounded-2xl border border-border bg-card/80 p-3.5"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                        degraded
                          ? "bg-destructive/10 text-destructive"
                          : "bg-primary/10 text-primary",
                      )}
                    >
                      {degraded ? (
                        <TriangleAlert className="h-4 w-4" />
                      ) : (
                        <FolderOpen className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-foreground">{r.projectName}</p>
                      <p className="text-[11.5px] text-muted-foreground">
                        {r.error
                          ? r.error
                          : created.length === 0
                            ? "Nothing to create"
                            : created
                                .map(([key, n]) => {
                                  // Matched on `countsKey`, not `plural` - the
                                  // display plural "label sets" never equalled
                                  // the wire key `label_sets`, so this lookup
                                  // missed and the raw key was printed instead.
                                  const kind = (
                                    Object.keys(KIND_OUTCOME) as BlueprintItemKind[]
                                  ).find((k) => KIND_OUTCOME[k].countsKey === key);
                                  const meta = kind ? KIND_OUTCOME[kind] : null;
                                  // Both branches go through `meta` now. The
                                  // plural branch used to echo the wire key
                                  // unconditionally, which only read as English
                                  // by luck - every key but `label_sets` happens
                                  // to be a word.
                                  if (!meta) return `${n} ${key}`;
                                  return `${n} ${n === 1 ? meta.label.toLowerCase() : meta.plural}`;
                                })
                                .join(" · ")}
                      </p>
                    </div>
                    {!r.error && (
                      <Button asChild size="sm" variant="outline" className="shrink-0 rounded-lg">
                        <Link to="/projects/$projectId" params={{ projectId: r.projectId }}>
                          Open
                          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                  </div>

                  {r.ledgerRecorded === false && !r.error && (
                    <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11.5px] text-muted-foreground">
                      <span className="font-bold text-amber-600 dark:text-amber-400">Note</span> -
                      applied, but we couldn’t record which blueprint did it, so this project won’t
                      show its origin.
                    </p>
                  )}

                  {r.failed.length > 0 && (
                    <ul className="mt-2 space-y-0.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
                      {r.failed.map((f, i) => (
                        <li key={`${f.kind}-${i}`} className="text-[11.5px] text-muted-foreground">
                          <span className="font-bold capitalize text-destructive">{f.kind}</span> -{" "}
                          {f.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-5 overflow-y-auto px-5 py-4">
            {/* What you'll get. Same panel the blueprint detail shows, so the
                promise on the page and the promise in the dialog cannot drift. */}
            <section>
              <p className="font-manrope text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                What this creates
              </p>
              <BlueprintOutcomePreview
                className="mt-2"
                items={items}
                labels={labels}
                projectName={targets.length === 1 ? targets[0].name : null}
                dense
              />
              {/* The reassurance sat permanently on the blueprint detail page,
                  where nothing was about to happen. It belongs at the point
                  something is. */}
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                Nothing is overwritten: existing checklists, documents and labels on the project
                stay exactly as they are, and these are added alongside them.
              </p>
            </section>

            {/* Where it goes. */}
            <section>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-manrope text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                  Apply to
                </p>
                {targetIds.length > 0 && (
                  <button
                    type="button"
                    className="text-[11px] font-bold text-muted-foreground hover:text-foreground"
                    onClick={() => setTargetIds([])}
                  >
                    Clear {targetIds.length} selected
                  </button>
                )}
              </div>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search projects…"
                  className="h-9 pl-9 text-sm"
                />
              </div>
              <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto rounded-xl border border-border p-1">
                {loading ? (
                  <div className="flex h-24 items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {projects.length === 0 ? "No projects yet." : "No projects match that search."}
                  </p>
                ) : (
                  filtered.map((p) => {
                    const on = targetIds.includes(p.id);
                    const where = [p.street, p.city].filter(Boolean).join(", ");
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(p.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
                          on ? "bg-primary/10" : "hover:bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-4 w-4 shrink-0 place-items-center rounded border",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                        >
                          {on && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.name}</span>
                          {where && (
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {where}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="border-t border-border px-5 py-3">
          {results ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <p className="mr-auto hidden text-xs text-muted-foreground sm:block">
                {applying && progress
                  ? `Applying… ${progress.done} of ${progress.total}`
                  : targets.length === 0
                    ? "Choose one or more projects"
                    : `${targets.length} project${targets.length === 1 ? "" : "s"} selected`}
              </p>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
                Cancel
              </Button>
              <Button
                onClick={() => void apply()}
                disabled={targets.length === 0 || applying || nothingToApply}
              >
                {applying ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-4 w-4" />
                )}
                Apply blueprint
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
