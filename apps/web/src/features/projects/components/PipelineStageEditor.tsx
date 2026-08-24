import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, X } from "lucide-react";
import {
  DEFAULT_PIPELINE_STAGES,
  MAX_PIPELINE_STAGES,
  PIPELINE_STAGE_COLORS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  defaultStatusForStageName,
  nextPipelineStageColor,
  normalizePipelineName,
  type ProjectStatus,
} from "@everlumen/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PipelineStage, PipelineStageInput } from "@/lib/project-boards.functions";

/**
 * One row of the stage editor while it is being edited.
 *
 * `id` is present for a stage that already exists in the database, and is what
 * keeps the projects standing in that column attached to it through a rename or
 * a reorder. `key` is local only, so a stage that has not been saved yet still
 * has a stable identity for React and for the drag sensor.
 */
export interface StageDraft {
  key: string;
  id?: string;
  name: string;
  color: string;
  /**
   * Which of the three buckets a job in this stage counts as. The map's pins,
   * the project list's filters and every count read that bucket, so this is
   * the field that stops a pipeline and a status ever disagreeing - see
   * packages/shared/src/pipeline-stages.ts.
   */
  status: ProjectStatus;
  /**
   * Set once somebody picks a bucket by hand. Until then the guess follows
   * whatever they type, so naming a stage "Paid" lands on Completed without
   * anyone being asked - and stops second-guessing them the moment they
   * disagree with it.
   */
  statusTouched?: boolean;
}

function newKey(): string {
  return `new-${crypto.randomUUID()}`;
}

export function draftsFromStages(stages: readonly PipelineStage[]): StageDraft[] {
  return [...stages]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      key: s.id,
      id: s.id,
      name: s.name,
      color: s.color,
      status: s.status ?? defaultStatusForStageName(s.name),
      statusTouched: true,
    }));
}

export function defaultStageDrafts(): StageDraft[] {
  return DEFAULT_PIPELINE_STAGES.map((s) => ({
    key: newKey(),
    name: s.name,
    color: s.color,
    status: s.status,
    statusTouched: true,
  }));
}

export function draftsToInput(drafts: readonly StageDraft[]): PipelineStageInput[] {
  return drafts.map((d) => ({
    id: d.id,
    name: d.name.trim(),
    color: d.color,
    status: d.status ?? defaultStatusForStageName(d.name),
  }));
}

/** The first thing wrong with the list, or null when it is savable. */
export function stageDraftsIssue(drafts: readonly StageDraft[]): string | null {
  if (drafts.length === 0) return "A pipeline needs at least one stage.";
  if (drafts.length > MAX_PIPELINE_STAGES) {
    return `A pipeline holds at most ${MAX_PIPELINE_STAGES} stages.`;
  }
  const seen = new Set<string>();
  for (const d of drafts) {
    const norm = normalizePipelineName(d.name);
    if (!norm) return "Every stage needs a name.";
    if (seen.has(norm)) return `Two stages are both called "${d.name.trim()}".`;
    seen.add(norm);
  }
  return null;
}

function chipTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? "#111827" : "#ffffff";
}

/**
 * The stage list, editable in place.
 *
 * Stages used to be picked from the team's tags, which is what let one project
 * stand in three columns at once. There is no tag picker here on purpose: a
 * stage is typed, coloured and ordered as itself, and nothing about it reaches
 * into the tag system. Tags still exist, unchanged, for filtering and search.
 */
export function PipelineStageEditor({
  drafts,
  onChange,
  /** Names of stages that currently hold projects, so removing one can warn. */
  countByStageId = {},
}: {
  drafts: StageDraft[];
  onChange: (next: StageDraft[]) => void;
  countByStageId?: Record<string, number>;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleReorder(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = drafts.findIndex((d) => d.key === String(active.id));
    const to = drafts.findIndex((d) => d.key === String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(drafts, from, to));
  }

  function patch(key: string, next: Partial<StageDraft>) {
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...next } : d)));
  }

  const issue = stageDraftsIssue(drafts);

  return (
    <div>
      {/*
        Said once here rather than as a hint under twenty rows. A team that
        never opens the dropdown still gets a sensible answer: the bucket
        follows the stage name until somebody changes it.
      */}
      <p className="mb-2 text-xs leading-snug text-muted-foreground">
        Each stage also says whether a job in it is live, paused or done. That is what the map and
        the project filters read, so a job at Invoiced stops showing as an active one.
      </p>
      {drafts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No stages yet.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReorder}>
          <SortableContext items={drafts.map((d) => d.key)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {drafts.map((draft, i) => (
                <StageRow
                  key={draft.key}
                  draft={draft}
                  index={i}
                  holding={draft.id ? (countByStageId[draft.id] ?? 0) : 0}
                  canRemove={drafts.length > 1}
                  onName={(name) =>
                    patch(draft.key, {
                      name,
                      // Only while nobody has said otherwise. See statusTouched.
                      ...(draft.statusTouched ? {} : { status: defaultStatusForStageName(name) }),
                    })
                  }
                  onColor={(color) => patch(draft.key, { color })}
                  onStatus={(status) => patch(draft.key, { status, statusTouched: true })}
                  onRemove={() => onChange(drafts.filter((d) => d.key !== draft.key))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        disabled={drafts.length >= MAX_PIPELINE_STAGES}
        onClick={() =>
          onChange([
            ...drafts,
            {
              key: newKey(),
              name: "",
              color: nextPipelineStageColor(drafts.length),
              status: "active",
            },
          ])
        }
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        {drafts.length >= MAX_PIPELINE_STAGES ? "Stage limit reached" : "Add stage"}
      </Button>

      {issue && <p className="mt-2 text-xs font-semibold text-destructive">{issue}</p>}
    </div>
  );
}

function StageRow({
  draft,
  index,
  holding,
  canRemove,
  onName,
  onColor,
  onStatus,
  onRemove,
}: {
  draft: StageDraft;
  index: number;
  holding: number;
  canRemove: boolean;
  onName: (v: string) => void;
  onColor: (v: string) => void;
  onStatus: (v: ProjectStatus) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: draft.key,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // `relative` is required for the z-index to apply at all: this row is a
      // flex *container*, not a flex item, and its parent is a plain block - so
      // a bare `z-10` was dropped and the dragged row was painted in DOM order,
      // letting later siblings' opaque backgrounds cut across it.
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-2",
        isDragging && "relative z-[5] opacity-80 shadow-md",
      )}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-label={`Reorder ${draft.name || `stage ${index + 1}`}`}
        className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Colour for ${draft.name || `stage ${index + 1}`}`}
            className="h-6 w-6 shrink-0 rounded-full border border-border shadow-sm"
            style={{ background: draft.color, color: chipTextColor(draft.color) }}
          />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <div className="grid grid-cols-5 gap-1.5">
            {PIPELINE_STAGE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => onColor(c)}
                className={cn(
                  "h-6 w-6 rounded-full border shadow-sm",
                  draft.color.toLowerCase() === c.toLowerCase()
                    ? "border-foreground ring-2 ring-foreground/30"
                    : "border-border",
                )}
                style={{ background: c }}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Input
        value={draft.name}
        onChange={(e) => onName(e.target.value)}
        placeholder="Stage name"
        aria-label={`Stage ${index + 1} name`}
        className="h-8 min-w-0 flex-1"
      />

      {/*
        What a job standing here counts as. This is the whole reconciliation in
        one control: the map, the filters and the counts read the bucket, the
        board reads the stage, and this is where a team says which is which -
        "Invoiced" is finished work even though the money has not landed.
      */}
      <Select value={draft.status} onValueChange={(v) => onStatus(v as ProjectStatus)}>
        <SelectTrigger
          aria-label={`What ${draft.name || `stage ${index + 1}`} counts as`}
          title="What a job in this stage counts as on the map and in filters"
          className="h-8 w-[104px] shrink-0 px-2 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROJECT_STATUSES.map((s) => (
            <SelectItem key={s} value={s} className="text-xs">
              {PROJECT_STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`Remove ${draft.name || `stage ${index + 1}`}`}
        title={
          holding > 0
            ? `${holding} project${holding === 1 ? "" : "s"} here will drop out of the pipeline`
            : undefined
        }
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
