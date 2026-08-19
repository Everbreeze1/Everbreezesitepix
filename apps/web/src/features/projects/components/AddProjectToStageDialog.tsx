import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { setProjectPipelineStage, type PipelineStage } from "@/lib/project-boards.functions";

interface ProjectRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  street: string | null;
  location: string | null;
  pipeline_stage_id?: string | null;
  /** Where it is now, so picking it reads as a move rather than a copy. */
  currentStageName?: string | null;
}

interface Props {
  open: boolean;
  stage: PipelineStage;
  projects: ProjectRow[];
  onClose: () => void;
  onMoved: (projectId: string) => void;
  onFailed: (projectId: string, previousStageId: string | null) => void;
}

/**
 * Put a project into this stage.
 *
 * Deliberately not "add": a project holds one stage, so choosing it here takes
 * it out of whatever column it was in. The list says which one that was instead
 * of hiding already-placed projects, because "I can't find it" is worse than
 * "it's over there".
 */
export function AddProjectToStageDialog({
  open,
  stage,
  projects,
  onClose,
  onMoved,
  onFailed,
}: Props) {
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const filtered = projects.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const addr = [p.location, p.street, p.city, p.state].filter(Boolean).join(" ").toLowerCase();
    return p.name.toLowerCase().includes(q) || addr.includes(q);
  });

  const moveProject = async (project: ProjectRow) => {
    const previous = project.pipeline_stage_id ?? null;
    setSaving(project.id);
    onMoved(project.id);
    try {
      await setProjectPipelineStage({ data: { projectId: project.id, stageId: stage.id } });
      toast.success(`Moved to "${stage.name}"`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not move project");
      onFailed(project.id, previous);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move a project to "{stage.name}"</DialogTitle>
          <DialogDescription>
            A project sits in one stage at a time, so this moves it out of whichever stage it is in
            now.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            className="h-8 pl-8"
          />
        </div>
        <ScrollArea className="h-72 rounded-md border border-border">
          <div className="p-1">
            {filtered.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">
                {projects.length === 0
                  ? "Every project is already at this stage."
                  : "No projects match."}
              </p>
            ) : (
              filtered.map((p) => {
                const addr = p.location ?? [p.street, p.city, p.state].filter(Boolean).join(", ");
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => moveProject(p)}
                    disabled={saving === p.id}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      {addr && (
                        <p className="truncate text-[11px] text-muted-foreground">{addr}</p>
                      )}
                      {p.currentStageName && (
                        <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                          {p.currentStageName}
                          <ArrowRight className="h-3 w-3" />
                          {stage.name}
                        </p>
                      )}
                    </span>
                    {saving === p.id && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
