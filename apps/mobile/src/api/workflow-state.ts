/**
 * What is outstanding in a workflow phase.
 *
 * Ported from `apps/web/src/features/projects/components/ProjectWorkflows.tsx`
 * rather than reinvented, because the two clients read the same rows and a
 * phase that reads "blocked" on a phone and "done" on the web is worse than
 * either answer alone. The stage rules (what a stage still needs, whether it
 * is open yet) are not copied at all: they come from `@everlumen/shared`, the
 * same module the web runner reads, so the button hint here and the sentence
 * the database sends back when it refuses are always the same words.
 */
import {
  isStagedRun,
  isStepDone,
  stageViews,
  type StagePhase,
  type StageStep,
  type StageView,
  type WorkflowItemKind as SharedWorkflowItemKind,
} from "@everlumen/shared";

export {
  describeMissing,
  isStagedRun,
  isStepDone,
  missingCount,
  stageMissing,
  stageViews,
  type StageMissing,
  type StagePhase,
  type StageStep,
  type StageView,
} from "@everlumen/shared";

export type WorkflowItemKind = SharedWorkflowItemKind;

export type WorkflowItemLike = {
  kind: string;
  required: boolean;
  completed_at: string | null;
  note_text: string | null;
  photo_id: string | null;
  /** The linked project checklist, for a `checklist` step. */
  checklist_id?: string | null;
};

export type WorkflowPhaseLike = {
  requires_signoff: boolean;
  signed_off_at: string | null;
  /** Set when the stage was marked done (staged runs), or by the recompute (walkthroughs). */
  completed_at?: string | null;
  /** Set when a manager opened this stage before the ones ahead of it. */
  unlocked_at?: string | null;
};

export type PhaseState = {
  total: number;
  done: number;
  requiredTotal: number;
  requiredDone: number;
  signedOk: boolean;
  /** Something mandatory is outstanding, so the phase cannot be closed. */
  blocked: boolean;
  /** Nothing left to do here at all. */
  complete: boolean;
};

/**
 * Whether a step counts as done.
 *
 * Each kind proves itself differently: a photo step is done when a photo is
 * attached, a note step when there is text, and a check step when it is ticked.
 * Reading `completed_at` for all three would leave a photo step showing
 * outstanding with the photo already on it. A checklist step is done when its
 * linked checklist is (the database mirrors the checklist's completion onto
 * the step), and one whose checklist was deleted has nothing left to wait for.
 */
export function isItemComplete(item: WorkflowItemLike): boolean {
  return isStepDone(item);
}

/**
 * Summarise one phase.
 *
 * Two rules the web version calls out as having been got wrong before, and
 * which are carried over deliberately:
 *
 * 1. A phase with no steps is not permanently unfinished. Empty phases are
 *    allowed by the designer, and treating one as incomplete pins the cursor to
 *    it forever and makes the workflow impossible to finish.
 * 2. "Blocked" and "complete" are different questions. A phase of purely
 *    optional steps blocks nothing, but it is still not done, so it keeps the
 *    cursor rather than being silently skipped.
 */
export function phaseState(phase: WorkflowPhaseLike, items: WorkflowItemLike[]): PhaseState {
  const required = items.filter((item) => item.required);
  const requiredDone = required.filter(isItemComplete).length;
  const done = items.filter(isItemComplete).length;
  const signedOk = !phase.requires_signoff || Boolean(phase.signed_off_at);
  const blocked = requiredDone < required.length || !signedOk;

  return {
    total: items.length,
    done,
    requiredTotal: required.length,
    requiredDone,
    signedOk,
    blocked,
    complete: !blocked && done === items.length,
  };
}

/**
 * Whether the phase can be signed off yet.
 *
 * Sign-off is a signature against work being finished, so it is refused while
 * required steps are outstanding. Allowing it early would put a name on a
 * record that the same screen still shows as incomplete.
 */
export function canSignOff(phase: WorkflowPhaseLike, items: WorkflowItemLike[]): boolean {
  if (!phase.requires_signoff) return false;
  if (phase.signed_off_at) return false;
  const state = phaseState({ ...phase, requires_signoff: false }, items);
  return state.requiredDone === state.requiredTotal;
}

/**
 * Index of the phase the crew is working on now.
 *
 * The first one that is not done (see `phaseDone`). Returns -1 when everything is done, which
 * the caller shows as a finished workflow rather than parking the marker on the
 * last phase.
 */
export function currentPhaseIndex(
  phases: ReadonlyArray<{ phase: WorkflowPhaseLike; items: WorkflowItemLike[] }>,
  staged = false,
): number {
  return phases.findIndex((entry) => !phaseDone(entry.phase, entry.items, staged));
}

/**
 * Whether a phase is done.
 *
 * On a staged run (anything but a walkthrough) a stage is done only when
 * somebody marked it done, which the database refuses until its required
 * steps and sign-off are in, and takes back if one is later removed. So
 * `completed_at` is the whole answer and the steps are not re-counted here.
 * Walkthrough runs keep the old rule: done when every step is filled in.
 */
export function phaseDone(
  phase: WorkflowPhaseLike,
  items: WorkflowItemLike[],
  staged: boolean,
): boolean {
  if (staged) return Boolean(phase.completed_at);
  return phaseState(phase, items).complete;
}

/**
 * Every stage of a staged run with its lock and what it still needs, from the
 * shared `stageViews`. Phases already come sorted by position; the shared
 * helper sorts again, which costs nothing and means a caller never has to.
 */
export function workflowStages<
  P extends WorkflowPhaseLike & { id: string; position: number; name: string },
>(phases: (P & { items: WorkflowItemLike[] })[]): StageView<P & StagePhase>[] {
  const stepsById = new Map<string, StageStep[]>(phases.map((p) => [p.id, p.items]));
  return stageViews(phases as (P & StagePhase)[], (id) => stepsById.get(id) ?? []);
}

/** Whether a run is staged, from its `source_kind`. Re-stated for screens that only hold the row. */
export function runIsStaged(run: { source_kind?: string | null } | null | undefined): boolean {
  return isStagedRun(run?.source_kind ?? null);
}

/** The patch "Mark stage done" writes. The database refuses it with a sentence when it is early. */
export function stageDonePatch(userId: string | null, now: () => Date = () => new Date()) {
  return { completed_at: now().toISOString(), completed_by: userId };
}

/** The patch "Unlock early" writes. Only an Owner, Admin or Manager may. */
export function stageUnlockPatch(userId: string | null, now: () => Date = () => new Date()) {
  return { unlocked_at: now().toISOString(), unlocked_by: userId };
}

/** The patch a tick on a check step writes. */
export function checkItemPatch(
  item: WorkflowItemLike,
  userId: string | null,
  now: () => Date = () => new Date(),
) {
  const next = item.completed_at ? null : now().toISOString();
  return { completed_at: next, completed_by: next ? userId : null };
}

/** The patch a phase sign-off writes. */
export function signoffPatch(
  name: string,
  userId: string | null,
  now: () => Date = () => new Date(),
) {
  return {
    signoff_name: name.trim(),
    signed_off_by: userId,
    signed_off_at: now().toISOString(),
  };
}

/**
 * Queued writes that a stage's "done" still depends on: a tick, a note or a
 * sign-off for this stage that has not reached the server, and photos for its
 * steps that are still uploading.
 *
 * The screen shows those optimistically, so without this "Mark stage done"
 * would light up and then be refused by the database for work the crew can see
 * on screen. Marking done waits for these to drain first.
 */
export function pendingStageWrites(
  rows: { id: string; kind: string; state: string; payload: string }[],
  phaseId: string,
  itemIds: string[],
): number {
  const ids = new Set(itemIds);
  let count = 0;
  for (const row of rows) {
    if (row.state === "failed") continue;
    if (row.id === `workflow_phase_patch:${phaseId}:signoff`) {
      count += 1;
    } else if (row.id.startsWith("workflow_item_patch:")) {
      if (ids.has(row.id.slice("workflow_item_patch:".length))) count += 1;
    } else if (row.kind === "photo_upload") {
      try {
        const target = (JSON.parse(row.payload) as { attachToWorkflowItemId?: unknown })
          .attachToWorkflowItemId;
        if (typeof target === "string" && ids.has(target)) count += 1;
      } catch {
        // A payload that does not parse cannot be waited on.
      }
    }
  }
  return count;
}
