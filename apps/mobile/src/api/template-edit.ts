import type { ChecklistItemType } from "@everlumen/shared";

/**
 * Editing a checklist template, as rules.
 *
 * Import-free so the ordering can be tested, and ordering is the whole of the
 * difficulty. `position` is an integer column with nothing enforcing that it is
 * dense, unique or zero-based: templates seeded by different code paths have
 * gaps, duplicates and one-based runs in them, and `applyChecklistTemplate`
 * already renumbers on the way out because of it.
 *
 * An editor that trusted those positions would let two items claim the same
 * slot and then reorder unpredictably. So every mutation here renumbers the
 * whole list, and the renumbering is what is tested.
 */

/**
 * Anything this file can order.
 *
 * The ordering helpers below were written for checklist items and are used
 * unchanged by workflow template **phases** and workflow template **items**,
 * which are three different tables with three different shapes and exactly the
 * same `position` problem. Widening them to this beat writing the same
 * renumber-after-every-edit logic twice more, and it means the tests that pin
 * the awkward cases cover all three.
 */
export type Positioned = {
  id: string;
  position: number;
  /** The tie-break when two rows share a position. */
  label: string;
};

export type TemplateItem = Positioned & {
  description: string | null;
  required: boolean;
  item_type: ChecklistItemType | string;
};

/** A row being added, before the database has given it an id. */
export type NewTemplateItem = Omit<TemplateItem, "id">;

export const MAX_LABEL = 200;

/**
 * The order to render in.
 *
 * Sorted by position, then by label as a tie-break. Without the tie-break, two
 * items sharing a position swap places between renders depending on the order
 * the rows came back, which reads as the list shuffling itself.
 */
export function ordered<T extends Positioned>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Renumber from zero, densely.
 *
 * Called after every move, insert and delete rather than trying to patch a
 * single position, because a gap-free run is the only state the reorder
 * controls behave predictably in and the cost of rewriting a list of twenty
 * integers is nothing.
 */
export function renumber<T extends Positioned>(items: T[]): T[] {
  return items.map((item, index) =>
    item.position === index ? item : { ...item, position: index },
  );
}

/**
 * Move one item up or down by a step.
 *
 * A phone has no drag handles worth the interaction cost on a list this long,
 * so reordering is two arrows. Out-of-range moves return the same array rather
 * than throwing, so the top item's up arrow is simply inert.
 */
export function moved<T extends Positioned>(items: T[], id: string, by: -1 | 1): T[] {
  const list = ordered(items);
  const from = list.findIndex((item) => item.id === id);
  if (from === -1) return items;
  const to = from + by;
  if (to < 0 || to >= list.length) return items;

  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return renumber(next);
}

/** Drop an item, then close the gap it left. */
export function removed<T extends Positioned>(items: T[], id: string): T[] {
  return renumber(ordered(items).filter((item) => item.id !== id));
}

/**
 * Only the rows whose position actually changed.
 *
 * A renumber usually moves two of twenty, and writing all twenty back is
 * nineteen wasted round trips on a connection that may be one bar.
 */
export function positionChanges<T extends Positioned>(
  before: T[],
  after: T[],
): { id: string; position: number }[] {
  const was = new Map(before.map((item) => [item.id, item.position]));
  return after
    .filter((item) => was.get(item.id) !== item.position)
    .map((item) => ({ id: item.id, position: item.position }));
}

/**
 * Why a label cannot be used, or null.
 *
 * Duplicates are allowed, deliberately. A checklist genuinely has "Photograph
 * the panel" under three different phases, and refusing that would be the
 * editor inventing a rule the runner does not have.
 */
export function labelError(label: string): string | null {
  const value = label.trim();
  if (!value) return "Give the item a label.";
  if (value.length > MAX_LABEL) return `Keep it under ${MAX_LABEL} characters.`;
  return null;
}

export function templateNameError(name: string): string | null {
  const value = name.trim();
  if (!value) return "Give the template a name.";
  if (value.length > 120) return "Keep the name under 120 characters.";
  return null;
}

/**
 * The item types a phone offers.
 *
 * All six the runner understands, in the order somebody reaches for them: a
 * plain check is most of every template, and the numeric and text types are
 * the long tail.
 */
export const ITEM_TYPES: ChecklistItemType[] = [
  "checkbox",
  "pass_fail",
  "yes_no",
  "rating",
  "numeric",
  "text",
];

/**
 * A safe default for an unrecognised stored type.
 *
 * `item_type` is a text column, so a template written by an older client can
 * hold something this build has never seen. Rendering it as a checkbox is
 * wrong in a small way; leaving the picker with nothing selected is wrong in a
 * way that loses the value on the next save.
 */
export function normaliseItemType(value: string | null | undefined): ChecklistItemType {
  return ITEM_TYPES.includes(value as ChecklistItemType)
    ? (value as ChecklistItemType)
    : "checkbox";
}

/** The line under a template in the list. */
export function templateSummary(itemCount: number, requiredCount: number): string {
  if (itemCount === 0) return "No items yet";
  const items = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  return requiredCount > 0 ? `${items}, ${requiredCount} required` : items;
}

/**
 * The next position for something being appended.
 *
 * Max plus one rather than length, because a list read mid-edit can be sparse
 * and `length` would collide with an existing row.
 */
export function nextPosition(items: Positioned[]): number {
  return items.reduce((max, item) => Math.max(max, item.position + 1), 0);
}
