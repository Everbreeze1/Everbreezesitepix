/**
 * What is outstanding in a workflow phase.
 *
 * Ported from `apps/web/src/features/projects/components/ProjectWorkflows.tsx`
 * rather than reinvented, because the two clients read the same rows and a
 * phase that reads "blocked" on a phone and "done" on the web is worse than
 * either answer alone. Kept import-free so the rules can be tested directly.
 */

export type WorkflowItemKind = "check" | "photo" | "note";

export type WorkflowItemLike = {
  kind: string;
  required: boolean;
  completed_at: string | null;
  note_text: string | null;
  photo_id: string | null;
};

export type WorkflowPhaseLike = {
  requires_signoff: boolean;
  signed_off_at: string | null;
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
 * outstanding with the photo already on it.
 */
export function isItemComplete(item: WorkflowItemLike): boolean {
  if (item.kind === "photo") return Boolean(item.photo_id);
  if (item.kind === "note") return Boolean(item.note_text?.trim());
  return Boolean(item.completed_at);
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
 * The first one that is not complete. Returns -1 when everything is done, which
 * the caller shows as a finished workflow rather than parking the marker on the
 * last phase.
 */
export function currentPhaseIndex(
  phases: ReadonlyArray<{ phase: WorkflowPhaseLike; items: WorkflowItemLike[] }>,
): number {
  return phases.findIndex((entry) => !phaseState(entry.phase, entry.items).complete);
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
