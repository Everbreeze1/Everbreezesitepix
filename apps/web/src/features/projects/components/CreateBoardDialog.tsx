import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { pipelineNameBlocks, pipelineNameIssue, pipelineNameMessage } from "@sitepix/shared";
import { createProjectBoard, type ProjectBoard } from "@/lib/project-boards.functions";
import {
  PipelineStageEditor,
  defaultStageDrafts,
  draftsToInput,
  stageDraftsIssue,
  type StageDraft,
} from "@/features/projects/components/PipelineStageEditor";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Existing pipeline names, so a second board with the same name is refused here. */
  existingBoardNames: string[];
  /** Tag and project names, so a pipeline named after one of them can be questioned. */
  tagNames?: string[];
  projectNames?: string[];
  onCreated?: (board: ProjectBoard) => void;
}

/**
 * New pipeline: a name and a list of stages, and no tag in sight.
 *
 * This dialog used to be a checklist of the team's tags, each ticked tag
 * becoming a column. That is the shape the client asked us to drop: it made a
 * column a tag, so a project carrying three of them stood in three columns at
 * once, and it made a board a saved filter, so a second one under a near
 * identical name was a normal thing to end up with.
 */
export function CreateBoardDialog({
  open,
  onOpenChange,
  existingBoardNames,
  tagNames = [],
  projectNames = [],
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [stages, setStages] = useState<StageDraft[]>(() => defaultStageDrafts());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setStages(defaultStageDrafts());
    }
  }, [open]);

  const nameIssue = useMemo(
    () =>
      name.trim()
        ? pipelineNameIssue(name, {
            otherPipelineNames: existingBoardNames,
            tagNames,
            projectNames,
          })
        : null,
    [name, existingBoardNames, tagNames, projectNames],
  );
  const stagesIssue = stageDraftsIssue(stages);
  const blocked = pipelineNameBlocks(nameIssue) || !!stagesIssue || !name.trim();

  const submit = async () => {
    if (blocked) return;
    setSaving(true);
    try {
      const created = await createProjectBoard({
        data: { name: name.trim(), stages: draftsToInput(stages) },
      });
      toast.success(`Pipeline "${created.name}" created`);
      onCreated?.(created);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save pipeline");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>New Pipeline</DialogTitle>
          <DialogDescription>
            A pipeline is the process work moves through. Each project sits in one stage at a time,
            and dragging its card is what changes that stage.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="-mx-2 flex-1 px-2">
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="board-name">Name</Label>
              <Input
                id="board-name"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Install Jobs"
              />
              {nameIssue ? (
                <p
                  className={
                    pipelineNameBlocks(nameIssue)
                      ? "text-xs font-semibold text-destructive"
                      : "text-xs font-semibold text-amber-600 dark:text-amber-500"
                  }
                >
                  {pipelineNameMessage(nameIssue)}
                </p>
              ) : (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  Name it after the process it represents, not a customer, job or location. One-off
                  groupings belong in a tag filter.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Stages ({stages.length})</Label>
              <p className="text-xs text-muted-foreground">
                Starts with the standard set. Rename, recolour, reorder or remove any of them.
              </p>
              <PipelineStageEditor drafts={stages} onChange={setStages} />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || blocked}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
