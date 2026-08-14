/**
 * The vocabulary shared by a checklist/workflow record and every place that
 * renders one: the app page, the public share link, the printed sheet.
 *
 * Lives in `shared` because the *same* record is rendered twice from two
 * different sources - the web app reads live rows over RLS, the public share
 * route reads them with the service role and hands the browser a pre-baked
 * payload. Both must produce the same document, so the answer formatting and
 * the type labels are written once here rather than once per renderer.
 */

/** Checklist answer types. Mirrors `project_checklist_items.item_type`. */
export type ChecklistItemType = "checkbox" | "rating" | "text" | "pass_fail" | "numeric" | "yes_no";

/** Workflow step kinds. Mirrors `project_workflow_items.kind`. */
export type WorkflowItemKind = "check" | "photo" | "note";

/** Short, human labels for the printed record - no icons, no colours. */
export const CHECKLIST_TYPE_LABELS: Record<ChecklistItemType, string> = {
  checkbox: "Check",
  pass_fail: "Pass / Fail",
  yes_no: "Yes / No",
  rating: "Rating",
  numeric: "Number",
  text: "Text",
};

export const WORKFLOW_KIND_LABELS: Record<WorkflowItemKind, string> = {
  check: "Check",
  photo: "Photo",
  note: "Note",
};

/** Whether a recorded answer counts as given. Matches `hasResponse` in the app. */
export function hasFieldResponse(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/**
 * Renders a stored `response_value` as the text that belongs on paper.
 *
 * The stored shapes are what `ItemResponse` writes: "Pass"/"Fail" and
 * "Yes"/"No" as strings, ratings and numerics as numbers, text as a string.
 * Returns null when there is no answer, so callers can print an empty rule
 * instead of the word "null" - which is what a naive `String(value)` did.
 */
export function formatChecklistAnswer(
  itemType: ChecklistItemType | string | null | undefined,
  value: unknown,
): string | null {
  if (!hasFieldResponse(value)) return null;
  if (itemType === "rating") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? `${n} / 5` : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  // A jsonb column can hold anything; anything else is not printable prose.
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/** One line of a project's address, collapsed the way a letterhead wants it. */
export function formatProjectAddress(
  p: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null,
): string | null {
  if (!p) return null;
  const cityLine = [p.city, p.state].filter(Boolean).join(", ");
  const tail = [cityLine, p.zip].filter(Boolean).join(" ");
  const out = [p.street, tail].filter(Boolean).join(", ");
  return out || null;
}
