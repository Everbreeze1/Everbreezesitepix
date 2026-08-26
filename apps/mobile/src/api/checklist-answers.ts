/**
 * What a checklist answer is, independent of how it is stored or displayed.
 *
 * Kept free of imports so it can be tested directly. The shapes below are not
 * ours to choose: the same rows are rendered by the web runner, the public
 * share page, and the printed sheet, and `formatChecklistAnswer` in
 * `@everlumen/shared` decides what each one prints. A value stored in a
 * different shape here comes out blank on paper and on a customer-facing link.
 */

/** Whether a recorded answer counts as given. Mirrors web's `hasResponse`. */
export function hasResponse(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/**
 * The answer a tap should store, given the item type and what is already there.
 *
 * Tapping the value that is already selected clears it, which is how the web
 * runner behaves and the only way to undo an answer on a required item.
 */
export function toggledResponse(itemType: string, current: unknown, choice: unknown): unknown {
  if (itemType === "rating") {
    const currentNumber = typeof current === "number" ? current : Number(current);
    return currentNumber === choice ? null : choice;
  }
  return current === choice ? null : choice;
}

/** Option labels for a two-way item, in the order web renders them. */
export function choicesFor(itemType: string): string[] | null {
  if (itemType === "pass_fail") return ["Pass", "Fail"];
  if (itemType === "yes_no") return ["Yes", "No"];
  return null;
}

/**
 * The patch written for an answer.
 *
 * `completed_at` moves with the answer: recording one completes the item and
 * clearing it un-completes it. Progress counts read `completed_at`, so writing
 * `response_value` alone would leave a checklist that is visibly answered and
 * still reported as unfinished.
 */
export function responsePatch(
  value: unknown,
  userId: string | null,
  now: () => Date = () => new Date(),
) {
  const completedAt = hasResponse(value) ? now().toISOString() : null;
  return {
    response_value: value,
    completed_at: completedAt,
    completed_by: completedAt ? userId : null,
  };
}

/** Parse what was typed into a numeric item, or null if it is not a number. */
export function parseNumericAnswer(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  /*
   * A numeric field that stores "12a" as text produces a report nobody can
   * total, and the value looks fine on screen until someone tries. Refuse it.
   */
  return Number.isFinite(parsed) ? parsed : null;
}
