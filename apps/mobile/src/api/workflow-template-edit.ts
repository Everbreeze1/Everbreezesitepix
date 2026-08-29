import type { Positioned } from "./template-edit";

/**
 * Editing a workflow template: phases, and the items inside each one.
 *
 * Import-free apart from a type, so the rules are tested directly.
 *
 * **The nesting is the whole difficulty, and it is why this was left until
 * last.** A checklist template is one list. A workflow template is a list of
 * phases, each holding its own list of items, and every ordering problem in the
 * flat case appears twice: once across phases and once within each phase, on
 * two tables whose `position` columns are independent. Shipping half of that
 * (phases you can reorder holding items you cannot) is worse than shipping
 * none, because it looks finished.
 *
 * The ordering helpers themselves are not re-implemented here: `ordered`,
 * `renumber`, `moved`, `removed` and `positionChanges` in `template-edit.ts`
 * are generic over anything with `{ id, position, label }`, which phases and
 * workflow items both are.
 */

/** Mirrors `project_workflow_items.kind` and the CHECK on the template table. */
export type WorkflowItemKind = "check" | "photo" | "note";

export type WorkflowPhase = Positioned & {
  template_id: string;
  name: string;
  description: string | null;
  requires_signoff: boolean;
};

export type WorkflowTemplateItem = Positioned & {
  phase_id: string;
  kind: WorkflowItemKind | string;
  required: boolean;
};

/**
 * A phase's sort key is its name.
 *
 * `Positioned` wants a `label`, and a phase's is its `name`. Carrying both
 * would mean two fields that must never disagree, so the row is adapted at the
 * boundary instead: nothing downstream has to remember which one is real.
 */
export function asPositionedPhase(phase: Omit<WorkflowPhase, "label">): WorkflowPhase {
  return { ...phase, label: phase.name };
}

/**
 * What each item kind actually does when the crew runs the workflow.
 *
 * Named for the action, not the column value. "check" means nothing on its own,
 * and this picker is the only place anybody meets these three.
 */
export const ITEM_KINDS: { id: WorkflowItemKind; label: string; hint: string }[] = [
  { id: "check", label: "Tick it off", hint: "A step somebody confirms is done" },
  { id: "photo", label: "Take a photo", hint: "Evidence, attached to this step" },
  { id: "note", label: "Write a note", hint: "A short line of text" },
];

/**
 * A safe default for an unrecognised stored kind.
 *
 * `kind` has a CHECK constraint, so a bad value cannot be written today, but a
 * template seeded by older code can hold one. Rendering it as a tick is wrong
 * in a small way; leaving the picker with nothing selected loses the value on
 * the next save.
 */
export function normaliseKind(value: string | null | undefined): WorkflowItemKind {
  return ITEM_KINDS.some((kind) => kind.id === value) ? (value as WorkflowItemKind) : "check";
}

export function phaseNameError(name: string): string | null {
  const value = name.trim();
  if (!value) return "Give the phase a name.";
  if (value.length > 120) return "Keep the name under 120 characters.";
  return null;
}

/** Items belonging to one phase. */
export function itemsInPhase<T extends { phase_id: string }>(items: T[], phaseId: string): T[] {
  return items.filter((item) => item.phase_id === phaseId);
}

/**
 * The line under a phase.
 *
 * Counts what the phase holds and flags sign-off, because sign-off is the one
 * property of a phase that changes what the crew has to do rather than what
 * they see.
 */
export function phaseSummary(itemCount: number, requiresSignoff: boolean): string {
  const items = itemCount === 0 ? "No steps yet" : `${itemCount} step${itemCount === 1 ? "" : "s"}`;
  return requiresSignoff ? `${items} · needs sign-off` : items;
}

/** The line under a workflow template in the list. */
export function workflowTemplateSummary(phaseCount: number, itemCount: number): string {
  if (phaseCount === 0) return "No phases yet";
  const phases = `${phaseCount} phase${phaseCount === 1 ? "" : "s"}`;
  return `${phases}, ${itemCount} step${itemCount === 1 ? "" : "s"}`;
}

/**
 * Whether a template can actually be applied to a project.
 *
 * `applyWorkflowTemplate` walks phases and inserts their items. A template with
 * phases but no items produces a workflow with nothing to do in it, and one
 * with no phases at all produces an empty workflow. Neither throws, and both
 * waste the crew's time discovering it on site, so the editor says so first.
 */
export function templateUsabilityWarning(phaseCount: number, itemCount: number): string | null {
  if (phaseCount === 0)
    return "This template has no phases, so applying it makes an empty workflow.";
  if (itemCount === 0)
    return "No phase has any steps yet, so there would be nothing to work through.";
  return null;
}

/**
 * Phases holding nothing.
 *
 * Returned as ids rather than a count so the screen can mark the actual rows.
 * An empty phase is legal and occasionally deliberate (a milestone with only a
 * sign-off), which is why this informs rather than blocks.
 */
export function emptyPhaseIds(phases: { id: string }[], items: { phase_id: string }[]): string[] {
  const holding = new Set(items.map((item) => item.phase_id));
  return phases.filter((phase) => !holding.has(phase.id)).map((phase) => phase.id);
}
