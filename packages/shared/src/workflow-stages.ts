/**
 * Workflow stages: what a stage still needs, whether it is open yet, and how
 * long a job has sat on it.
 *
 * A workflow's phases are the job's stages, run in order. A stage is done when
 * someone marks it done, and the database only accepts that once every required
 * step is in (20261012000000_workflow_stage_gating.sql, `workflow_stage_missing`).
 * The web runner, the app and the Projects list all read the same rules from
 * here, so "2 photos and 1 checklist left" means the same thing on every screen
 * and matches the message the database sends back when it refuses.
 *
 * Walkthrough runs share these tables but are shot lists, not staged jobs, so
 * none of this applies to them (see `isStagedRun`).
 */

/** The step kinds a stage can hold. `checklist` links a project checklist. */
export type WorkflowStepKind = "check" | "photo" | "note" | "checklist";

export interface StageStep {
  kind: string;
  required: boolean;
  completed_at: string | null;
  photo_id: string | null;
  note_text: string | null;
  /** The linked project checklist, for a `checklist` step. */
  checklist_id?: string | null;
}

export interface StagePhase {
  id: string;
  position: number;
  name: string;
  requires_signoff: boolean;
  signed_off_at: string | null;
  /** Set when the stage was marked done. Undefined on a database without it. */
  completed_at?: string | null;
  /** Set when a manager opened this stage before the ones ahead of it. */
  unlocked_at?: string | null;
}

/** Hours on one stage before a job counts as stuck. */
export const STUCK_AFTER_HOURS = 48;

/** Walkthroughs are shot lists: no stage order, no "Mark stage done". */
export function isStagedRun(sourceKind: string | null | undefined): boolean {
  return (sourceKind ?? "workflow") !== "walkthrough";
}

/**
 * Whether one step is done.
 *
 * A checklist step mirrors its checklist: the database copies the checklist's
 * completion onto the step's `completed_at`. A step whose checklist was deleted
 * has nothing left to wait for, so it counts as done rather than pinning the
 * stage open forever.
 */
export function isStepDone(step: StageStep): boolean {
  switch (step.kind) {
    case "photo":
      return !!step.photo_id;
    case "note":
      return !!step.note_text?.trim();
    case "checklist":
      return !step.checklist_id || !!step.completed_at;
    default:
      return !!step.completed_at;
  }
}

export interface StageMissing {
  photos: number;
  checks: number;
  notes: number;
  checklists: number;
  signoff: boolean;
}

/** The required work a stage is still waiting on. Optional steps never block. */
export function stageMissing(
  phase: Pick<StagePhase, "requires_signoff" | "signed_off_at">,
  steps: StageStep[],
): StageMissing {
  const out: StageMissing = { photos: 0, checks: 0, notes: 0, checklists: 0, signoff: false };
  for (const s of steps) {
    if (!s.required || isStepDone(s)) continue;
    if (s.kind === "photo") out.photos++;
    else if (s.kind === "note") out.notes++;
    else if (s.kind === "checklist") out.checklists++;
    else if (s.kind === "check") out.checks++;
  }
  out.signoff = phase.requires_signoff && !phase.signed_off_at;
  return out;
}

export function missingCount(m: StageMissing): number {
  return m.photos + m.checks + m.notes + m.checklists + (m.signoff ? 1 : 0);
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * "2 photos, 1 check and sign-off", or null when nothing is missing.
 *
 * Same wording and order as `workflow_stage_missing` in the database, so the
 * button's hint and a refusal from the server never disagree.
 */
export function describeMissing(m: StageMissing): string | null {
  const parts: string[] = [];
  if (m.photos) parts.push(plural(m.photos, "photo"));
  if (m.checks) parts.push(plural(m.checks, "check"));
  if (m.notes) parts.push(plural(m.notes, "note"));
  if (m.checklists) parts.push(plural(m.checklists, "checklist"));
  if (m.signoff) parts.push("sign-off");
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export interface StageView<P extends StagePhase = StagePhase> {
  phase: P;
  index: number;
  done: boolean;
  /** An earlier stage is unfinished and nobody unlocked this one. */
  locked: boolean;
  /** The first unfinished stage ahead of this one, when locked. */
  waitingOn: string | null;
  missing: StageMissing;
  /** Nothing missing, not locked, not done yet. */
  canMarkDone: boolean;
  /** The first stage not yet done: where the job is. */
  isCurrent: boolean;
}

/**
 * Every stage of one run, in order, with its lock and what it still needs.
 * `phases` may arrive in any order; the result is sorted by position.
 */
export function stageViews<P extends StagePhase>(
  phases: P[],
  stepsOf: (phaseId: string) => StageStep[],
): StageView<P>[] {
  const sorted = [...phases].sort((a, b) => a.position - b.position);
  const currentId = sorted.find((p) => !p.completed_at)?.id ?? null;
  let firstOpen: string | null = null;
  return sorted.map((phase, index) => {
    const done = !!phase.completed_at;
    const waitingOn = !done && !phase.unlocked_at ? firstOpen : null;
    const locked = waitingOn !== null;
    const missing = stageMissing(phase, stepsOf(phase.id));
    if (!done && firstOpen === null) firstOpen = phase.name || `Stage ${index + 1}`;
    return {
      phase,
      index,
      done,
      locked,
      waitingOn,
      missing,
      canMarkDone: !done && !locked && missingCount(missing) === 0,
      isCurrent: phase.id === currentId,
    };
  });
}

/**
 * When the job arrived on a stage: the later of the run starting, the stage
 * before it being marked done, and a manager unlocking it.
 */
export function stageStartedAt(
  phases: StagePhase[],
  phaseId: string,
  workflowStartedAt: string,
): string {
  const sorted = [...phases].sort((a, b) => a.position - b.position);
  const idx = sorted.findIndex((p) => p.id === phaseId);
  const candidates = [workflowStartedAt];
  const prev = idx > 0 ? sorted[idx - 1] : null;
  if (prev?.completed_at) candidates.push(prev.completed_at);
  if (idx >= 0 && sorted[idx].unlocked_at) candidates.push(sorted[idx].unlocked_at!);
  return candidates.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
}

export function isStuck(
  sinceIso: string,
  now: number = Date.now(),
  hours: number = STUCK_AFTER_HOURS,
): boolean {
  const since = Date.parse(sinceIso);
  return Number.isFinite(since) && now - since > hours * 3_600_000;
}

export interface RunStage {
  /** The stage the job is on, or null when every stage is done. */
  current: StagePhase | null;
  /** 1-based number of the current stage. */
  number: number;
  total: number;
  since: string | null;
  stuck: boolean;
}

/** Where one open run stands, for a list of jobs. */
export function runStage(
  workflow: { started_at: string; completed_at: string | null },
  phases: StagePhase[],
  now: number = Date.now(),
): RunStage {
  const sorted = [...phases].sort((a, b) => a.position - b.position);
  const idx = workflow.completed_at ? -1 : sorted.findIndex((p) => !p.completed_at);
  if (idx < 0) {
    return {
      current: null,
      number: sorted.length,
      total: sorted.length,
      since: null,
      stuck: false,
    };
  }
  const current = sorted[idx];
  const since = stageStartedAt(sorted, current.id, workflow.started_at);
  return {
    current,
    number: idx + 1,
    total: sorted.length,
    since,
    stuck: isStuck(since, now),
  };
}
