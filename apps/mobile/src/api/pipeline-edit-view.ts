import {
  DEFAULT_PIPELINE_STAGES,
  MAX_PIPELINE_STAGES,
  defaultStatusForStageName,
  nextPipelineStageColor,
  normalizePipelineName,
  samePipelineName,
  type ProjectStatus,
} from "@everlumen/shared";
import type { PipelineStage } from "./pipeline-view";

/**
 * Editing a pipeline's stages on a phone.
 *
 * The same rules as the web's `PipelineStageEditor`, kept import-free of React
 * so a test can hold them still. The web reorders by dragging; a phone gets an
 * up and a down arrow on each row instead, which is `moveDraft` below.
 *
 * `stages` is sent to the server as the whole list, in order, not as a patch:
 * a stage left out is deleted, and the jobs standing in it fall out of the
 * pipeline (`ON DELETE SET NULL`). That is why `droppedStageCount` exists, so
 * the save can say how many jobs that is before anything is written.
 */

export type StageDraft = {
  /** Local identity, stable across renames and reorders. */
  key: string;
  /** Present for a stage that already exists, which keeps its jobs attached. */
  id?: string;
  name: string;
  color: string;
  status: ProjectStatus;
  /**
   * Set once somebody picks the bucket by hand. Until then it follows the name,
   * so typing "Paid" lands on Completed without anyone being asked.
   */
  statusTouched?: boolean;
};

/** What `createProjectBoard` and `updateProjectBoard` take for each stage. */
export type StageInput = {
  id?: string;
  name: string;
  color: string;
  status: ProjectStatus;
};

let sequence = 0;
const newKey = () => `new-${(sequence += 1)}`;

export function draftsFromStages(stages: readonly PipelineStage[]): StageDraft[] {
  return [...stages]
    .sort((a, b) => a.position - b.position)
    .map((stage) => ({
      key: stage.id,
      id: stage.id,
      name: stage.name,
      color: stage.color,
      status: (stage.status as ProjectStatus) ?? defaultStatusForStageName(stage.name),
      statusTouched: true,
    }));
}

/** The standard set every new pipeline starts with. */
export function defaultStageDrafts(): StageDraft[] {
  return DEFAULT_PIPELINE_STAGES.map((seed) => ({
    key: newKey(),
    name: seed.name,
    color: seed.color,
    status: seed.status,
    statusTouched: true,
  }));
}

/** One more row at the end, in the next colour of the palette. */
export function withNewStage(drafts: readonly StageDraft[]): StageDraft[] {
  if (drafts.length >= MAX_PIPELINE_STAGES) return [...drafts];
  return [
    ...drafts,
    { key: newKey(), name: "", color: nextPipelineStageColor(drafts.length), status: "active" },
  ];
}

export function canAddStage(drafts: readonly StageDraft[]): boolean {
  return drafts.length < MAX_PIPELINE_STAGES;
}

/** Rename a row, letting the bucket follow the name until somebody sets it. */
export function renameDraft(drafts: readonly StageDraft[], key: string, name: string) {
  return drafts.map((draft) =>
    draft.key === key
      ? {
          ...draft,
          name,
          ...(draft.statusTouched ? {} : { status: defaultStatusForStageName(name) }),
        }
      : draft,
  );
}

export function patchDraft(
  drafts: readonly StageDraft[],
  key: string,
  patch: Partial<Pick<StageDraft, "color" | "status">>,
): StageDraft[] {
  return drafts.map((draft) =>
    draft.key === key
      ? { ...draft, ...patch, ...(patch.status ? { statusTouched: true } : {}) }
      : draft,
  );
}

export function removeDraft(drafts: readonly StageDraft[], key: string): StageDraft[] {
  // A pipeline needs one stage; the last row cannot go.
  if (drafts.length <= 1) return [...drafts];
  return drafts.filter((draft) => draft.key !== key);
}

/** The arrow buttons' reorder: one place up (-1) or down (+1), clamped. */
export function moveDraft(
  drafts: readonly StageDraft[],
  key: string,
  delta: -1 | 1,
): StageDraft[] {
  const from = drafts.findIndex((draft) => draft.key === key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= drafts.length) return [...drafts];
  const next = [...drafts];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function draftsToInput(drafts: readonly StageDraft[]): StageInput[] {
  return drafts.map((draft) => ({
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name.trim(),
    color: draft.color,
    status: draft.status ?? defaultStatusForStageName(draft.name),
  }));
}

/** The first thing wrong with the list, or null when it can be saved. */
export function stageDraftsIssue(drafts: readonly StageDraft[]): string | null {
  if (drafts.length === 0) return "A pipeline needs at least one stage.";
  if (drafts.length > MAX_PIPELINE_STAGES) {
    return `A pipeline holds at most ${MAX_PIPELINE_STAGES} stages.`;
  }
  const seen = new Set<string>();
  for (const draft of drafts) {
    const norm = normalizePipelineName(draft.name);
    if (!norm) return "Every stage needs a name.";
    if (seen.has(norm)) return `Two stages are both called "${draft.name.trim()}".`;
    seen.add(norm);
  }
  return null;
}

/** Already the standard set, so offering to reset to it would say nothing. */
export function looksStandard(drafts: readonly StageDraft[]): boolean {
  return (
    drafts.length === DEFAULT_PIPELINE_STAGES.length &&
    drafts.every((draft, i) => samePipelineName(draft.name, DEFAULT_PIPELINE_STAGES[i].name))
  );
}

/** Jobs standing in stages the edit removes, which a save will take off the board. */
export function droppedStageCount(
  original: readonly PipelineStage[],
  drafts: readonly StageDraft[],
  counts: ReadonlyMap<string, number>,
): number {
  const kept = new Set(drafts.map((draft) => draft.id).filter(Boolean) as string[]);
  return original
    .filter((stage) => !kept.has(stage.id))
    .reduce((sum, stage) => sum + (counts.get(stage.id) ?? 0), 0);
}

/** The confirmation a save with dropped jobs asks, in the web's words. */
export function droppedStageWarning(count: number): string {
  const one = count === 1;
  return `${count} project${one ? "" : "s"} will drop out of this pipeline. The project${
    one ? "" : "s"
  } and everything on ${one ? "it" : "them"} stay; only the pipeline position is cleared, and you can put ${
    one ? "it" : "them"
  } back in any stage.`;
}
