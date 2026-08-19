import { useEffect, useMemo, useState } from "react";
import { Info, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import {
  DEFAULT_PIPELINE_STAGES,
  pipelineNameBlocks,
  pipelineNameIssue,
  pipelineNameMessage,
  samePipelineName,
} from "@sitepix/shared";
import {
  updateProjectBoard,
  deleteProjectBoard,
  type ProjectBoard,
} from "@/lib/project-boards.functions";
import {
  PipelineStageEditor,
  defaultStageDrafts,
  draftsFromStages,
  draftsToInput,
  stageDraftsIssue,
  type StageDraft,
} from "@/features/projects/components/PipelineStageEditor";

/**
 * Pipeline settings: the name, and the stage list.
 *
 * There used to be a tag picker here, and the "stages" it produced were the
 * team's tags. Renaming a stage renamed a tag everywhere else in the app, and
 * two tags on one project drew two cards. Stages are the board's own rows now,
 * so this sheet edits them directly and touches nothing else.
 */
export function BoardSettingsSheet({
  open,
  onOpenChange,
  board,
  otherBoardNames,
  tagNames = [],
  projectNames = [],
  countByStageId = {},
  onUpdated,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: ProjectBoard;
  /** Every other pipeline on the team, so a rename cannot create a duplicate. */
  otherBoardNames: string[];
  tagNames?: string[];
  projectNames?: string[];
  countByStageId?: Record<string, number>;
  onUpdated: (board: ProjectBoard) => void;
  onDeleted: (id: string) => void;
}) {
  const confirm = useConfirm();
  const [name, setName] = useState(board.name);
  const [stages, setStages] = useState<StageDraft[]>(() => draftsFromStages(board.stages));
  const [saving, setSaving] = useState(false);

  // Re-seed when a different board is opened (or the board changes underneath us).
  useEffect(() => {
    setName(board.name);
    setStages(draftsFromStages(board.stages));
  }, [board.id, board.name, board.stages]);

  const nameIssue = useMemo(
    () => pipelineNameIssue(name, { otherPipelineNames: otherBoardNames, tagNames, projectNames }),
    [name, otherBoardNames, tagNames, projectNames],
  );
  const stagesIssue = stageDraftsIssue(stages);
  const blocked = pipelineNameBlocks(nameIssue) || !!stagesIssue;

  /** Already the default set, so offering to reset to it would say nothing. */
  const looksStandard = useMemo(
    () =>
      stages.length === DEFAULT_PIPELINE_STAGES.length &&
      stages.every((s, i) => samePipelineName(s.name, DEFAULT_PIPELINE_STAGES[i].name)),
    [stages],
  );

  /** Stages the person deleted from the list that still hold work. */
  const droppedCount = useMemo(() => {
    const kept = new Set(stages.map((s) => s.id).filter(Boolean) as string[]);
    return board.stages
      .filter((s) => !kept.has(s.id))
      .reduce((n, s) => n + (countByStageId[s.id] ?? 0), 0);
  }, [stages, board.stages, countByStageId]);

  async function handleSave() {
    if (blocked) return;
    if (droppedCount > 0) {
      const ok = await confirm({
        title: "Remove stages that still hold work?",
        description: `${droppedCount} project${droppedCount === 1 ? "" : "s"} will drop out of this pipeline. The project${droppedCount === 1 ? "" : "s"} and everything on ${droppedCount === 1 ? "it" : "them"} stay; only the pipeline position is cleared, and you can put ${droppedCount === 1 ? "it" : "them"} back in any stage.`,
        variant: "destructive",
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const updated = await updateProjectBoard({
        data: { id: board.id, name: name.trim(), stages: draftsToInput(stages) },
      });
      onUpdated(updated);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save pipeline");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (
      !(await confirm({
        description: `Delete "${board.name}"? The projects stay - only the pipeline and its stages are removed.`,
        variant: "destructive",
      }))
    )
      return;
    try {
      await deleteProjectBoard({ data: { id: board.id } });
      onDeleted(board.id);
      onOpenChange(false);
      toast.success("Pipeline deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete pipeline");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 pb-4 pt-6 text-left">
          <SheetTitle>Pipeline Settings</SheetTitle>
          <SheetDescription>
            Name the process, then set the stages a job moves through. A project sits in one stage
            at a time.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <Label htmlFor="board-name">Pipeline Name</Label>
          <Input
            id="board-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5"
          />
          {nameIssue ? (
            <p
              className={`mt-1.5 text-xs font-semibold ${
                pipelineNameBlocks(nameIssue)
                  ? "text-destructive"
                  : "text-amber-600 dark:text-amber-500"
              }`}
            >
              {pipelineNameMessage(nameIssue)}
            </p>
          ) : (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Name it after the process it represents, not a customer, job or location.
            </p>
          )}

          <div className="mb-2 mt-6 flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-foreground">
              Stages <span className="text-muted-foreground">({stages.length})</span>
            </p>
            {/*
              The way out for a board that came across from the tag era.
              Every pipeline that existed before the rework had its columns
              built from tag names, so plenty of them read "carpet", "ac4",
              "2025" - tag names, not steps in a process. Retyping six rows to
              fix that is enough friction that most people would not.

              It replaces rather than merges, because nothing can guess which
              standard stage "carpet" was meant to be. The jobs are not lost:
              they land in the "Not in a pipeline" rail on the board, ready to
              be dragged into the right column, and the confirmation on Done
              says how many that will be before anything is written.
            */}
            {!looksStandard && (
              <button
                type="button"
                onClick={() => setStages(defaultStageDrafts())}
                className="text-xs font-semibold text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
              >
                Use the standard stages
              </button>
            )}
          </div>

          <PipelineStageEditor
            drafts={stages}
            onChange={setStages}
            countByStageId={countByStageId}
          />
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-6 py-4">
          <Button
            variant="outline"
            onClick={handleDelete}
            className="text-destructive hover:text-destructive"
          >
            Delete Pipeline
          </Button>
          <Button onClick={handleSave} disabled={saving || blocked}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
