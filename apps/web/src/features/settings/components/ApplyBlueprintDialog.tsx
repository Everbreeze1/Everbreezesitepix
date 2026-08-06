import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, FolderOpen, Loader2, Search, Tag, TriangleAlert } from "lucide-react";
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

interface ProjectRow {
  id: string;
  name: string;
  street: string | null;
  city: string | null;
  archived: boolean | null;
}

/**
 * Apply a blueprint to an existing project.
 *
 * Blueprints could previously only be applied while creating a project, so an
 * authored blueprint had no visible route to the projects already running —
 * the "how do I actually use this?" gap. Three steps, all on one surface: what
 * it will create, which project it lands on, and what actually happened.
 */
export function ApplyBlueprintDialog({
  open,
  onOpenChange,
  blueprintId,
  blueprintName,
  items,
  labels,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  blueprintId: string;
  blueprintName: string;
  /** What the blueprint contains, in apply order. */
  items: Array<{ kind: BlueprintItemKind; name: string }>;
  /** Labels the blueprint merges onto the project. */
  labels: string[];
}) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{
    projectId: string;
    projectName: string;
    counts: Record<string, number>;
    failed: Array<{ kind: string; reason: string }>;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setTargetId(null);
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

  /** One row per kind, so "3 checklists" reads as one line, not three. */
  const summary = useMemo(() => {
    const map = new Map<BlueprintItemKind, string[]>();
    for (const it of items) {
      const bucket = map.get(it.kind);
      if (bucket) bucket.push(it.name);
      else map.set(it.kind, [it.name]);
    }
    return map;
  }, [items]);

  const target = projects.find((p) => p.id === targetId) ?? null;
  const nothingToApply = items.length === 0 && labels.length === 0;

  const apply = async () => {
    if (!target) return;
    setApplying(true);
    try {
      const res = await applyProjectBlueprint({
        data: {
          blueprintId,
          projectId: target.id,
          projectName: target.name,
          projectAddress: [target.street, target.city].filter(Boolean).join(", ") || null,
          preparedBy: profile?.full_name || user?.email || "",
        },
      });
      setResult({
        projectId: target.id,
        projectName: target.name,
        counts: res.counts ?? {},
        failed: res.failed ?? [],
      });
      const total = Object.values(res.counts ?? {}).reduce((a, b) => a + b, 0);
      if (res.failed?.length)
        toast.warning(`Applied ${total} item(s), ${res.failed.length} failed`);
      else toast.success(`“${blueprintName}” applied to ${target.name}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't apply this blueprint");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>
            {result ? "Blueprint applied" : `Apply “${blueprintName}” to a project`}
          </DialogTitle>
          <DialogDescription>
            {result
              ? "Everything below now exists on the project."
              : "Nothing is created until you choose a project and confirm."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              {Object.entries(result.counts)
                .filter(([, n]) => n > 0)
                .map(([key, n]) => {
                  // Service counts are plural keys ("checklists"); map back.
                  const kind = (Object.keys(KIND_OUTCOME) as BlueprintItemKind[]).find(
                    (k) => KIND_OUTCOME[k].plural === key,
                  );
                  const meta = kind ? KIND_OUTCOME[kind] : null;
                  const Icon = meta?.icon ?? Check;
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
                    >
                      <span
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                          meta?.tint ?? "bg-muted",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">
                          {n} {n === 1 ? (meta?.label.toLowerCase() ?? key) : key} created
                        </div>
                        {meta && (
                          <div className="text-[11.5px] text-muted-foreground">{meta.becomes}</div>
                        )}
                      </div>
                      <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                    </div>
                  );
                })}

              {Object.values(result.counts).every((n) => n === 0) && (
                <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  This blueprint had nothing to create.
                </p>
              )}

              {result.failed.length > 0 && (
                <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-destructive">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    {result.failed.length} item{result.failed.length === 1 ? "" : "s"} couldn't be
                    created
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {result.failed.map((f, i) => (
                      <li key={`${f.kind}-${i}`} className="text-[11.5px] text-muted-foreground">
                        <span className="font-semibold capitalize">{f.kind}</span> — {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-5 overflow-y-auto px-5 py-4">
            {/* What you'll get. */}
            <section>
              <p className="font-manrope text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                What this creates
              </p>
              {nothingToApply ? (
                <p className="mt-2 rounded-xl border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
                  This blueprint is empty — add checklists, workflows, documents or reports to it
                  first.
                </p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {[...summary.entries()].map(([kind, names]) => {
                    const meta = KIND_OUTCOME[kind];
                    const Icon = meta.icon;
                    return (
                      <div
                        key={kind}
                        className="flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
                      >
                        <span
                          className={cn(
                            "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                            meta.tint,
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">
                            {names.length}{" "}
                            {names.length === 1 ? meta.label.toLowerCase() : meta.plural}
                          </div>
                          <div className="truncate text-[11.5px] text-muted-foreground">
                            {names.join(" · ")}
                          </div>
                          <div className="mt-0.5 text-[11.5px] text-muted-foreground/80">
                            → {meta.becomes}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {labels.length > 0 && (
                    <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-400">
                        <Tag className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">
                          {labels.length} label{labels.length === 1 ? "" : "s"}
                        </div>
                        <div className="truncate text-[11.5px] text-muted-foreground">
                          {labels.join(" · ")}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-muted-foreground/80">
                          → Merged onto the project, existing labels kept
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Where it goes. */}
            <section>
              <p className="font-manrope text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                Apply to
              </p>
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
                    const on = targetId === p.id;
                    const where = [p.street, p.city].filter(Boolean).join(", ");
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setTargetId(p.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
                          on ? "bg-primary/10" : "hover:bg-muted",
                        )}
                      >
                        <FolderOpen
                          className={cn(
                            "h-4 w-4 shrink-0",
                            on ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.name}</span>
                          {where && (
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {where}
                            </span>
                          )}
                        </span>
                        {on && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="border-t border-border px-5 py-3">
          {result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button asChild>
                <Link to="/projects/$projectId" params={{ projectId: result.projectId }}>
                  Open {result.projectName}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </>
          ) : (
            <>
              <p className="mr-auto hidden text-xs text-muted-foreground sm:block">
                {target ? `Applying to ${target.name}` : "Choose a project to continue"}
              </p>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void apply()} disabled={!target || applying || nothingToApply}>
                {applying && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Apply blueprint
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
