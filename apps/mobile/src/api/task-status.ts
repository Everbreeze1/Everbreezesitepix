/**
 * Task status rules, free of imports so they can be tested directly.
 *
 * Values mirror `apps/web/src/features/projects/components/ProjectTasks.tsx`.
 * The same rows appear in the web board, the team dashboard, and report task
 * sections, so a status this app invents would be a task nothing else can show.
 */

export type TaskStatus = "open" | "in_progress" | "done";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export const TASK_STATUSES: readonly TaskStatus[] = ["open", "in_progress", "done"];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

export function normaliseStatus(value: unknown): TaskStatus {
  return isTaskStatus(value) ? value : "open";
}

/**
 * The status a tap on the status control moves to.
 *
 * Open to in progress to done, then back to open. A single control that cycles
 * beats three buttons on a phone held in one hand, and wrapping round is the
 * only way to undo a task marked done by mistake.
 */
export function advanceStatus(current: unknown): TaskStatus {
  const status = normaliseStatus(current);
  if (status === "open") return "in_progress";
  if (status === "in_progress") return "done";
  return "open";
}

/**
 * The patch a status change writes.
 *
 * `completed_at` is derived rather than passed in. It has to be null for
 * anything that is not done, or a task moved back to open keeps a completion
 * timestamp and reads as finished in every report that groups by it.
 */
export function statusPatch(next: TaskStatus, now: () => Date = () => new Date()) {
  return {
    status: next,
    completed_at: next === "done" ? now().toISOString() : null,
  };
}

/**
 * Whether a message from the database is a refusal that retrying cannot fix.
 *
 * The completion trigger added in `20260819000000_assignment_and_completion.sql`
 * raises a sentence when someone who is not the assignee, the assigner, or a
 * manager tries to mark work done. That is a rule, not an outage: queuing it for
 * an hourly retry would hide the explanation the trigger went to the trouble of
 * writing.
 */
export function isCompletionRefusal(message: string): boolean {
  return /can mark this (checklist|task|workflow)/i.test(message);
}
