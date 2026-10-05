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
export type ChecklistItemType =
  | "checkbox"
  | "rating"
  | "text"
  | "pass_fail"
  | "numeric"
  | "yes_no"
  | "severity"
  | "condition";

/** Workflow step kinds. Mirrors `project_workflow_items.kind`. */
export type WorkflowItemKind = "check" | "photo" | "note" | "checklist";

/** Short, human labels for the printed record - no icons, no colours. */
export const CHECKLIST_TYPE_LABELS: Record<ChecklistItemType, string> = {
  checkbox: "Check",
  pass_fail: "Pass / Fail",
  yes_no: "Yes / No",
  rating: "Rating",
  numeric: "Number",
  text: "Text",
  severity: "Severity",
  condition: "Condition",
};

/**
 * How bad an issue is, 1 to 5. Runs the opposite way to `rating` (where 5 is
 * excellent), which is why it is its own type rather than a relabelled rating.
 */
export const SEVERITY_LEVELS: readonly { value: number; label: string }[] = [
  { value: 1, label: "Minor" },
  { value: 2, label: "Low" },
  { value: 3, label: "Moderate" },
  { value: 4, label: "High" },
  { value: 5, label: "Critical" },
];

/** The name of a severity answer, or null if it is not one of the five. */
export function severityLabel(value: unknown): string | null {
  const n = typeof value === "number" ? value : Number(value);
  return SEVERITY_LEVELS.find((l) => l.value === n)?.label ?? null;
}

/** Condition answers, best first. Stored as these exact strings. */
export const CONDITION_OPTIONS = ["Good", "Fair", "Poor"] as const;

/**
 * Units offered for a Number item. A template author can also type their own,
 * up to `MAX_UNIT_LENGTH` characters (the database enforces the same cap).
 */
export const MEASUREMENT_UNITS = [
  "in",
  "ft",
  "yd",
  "sq ft",
  "lin ft",
  "cu ft",
  "mm",
  "cm",
  "m",
  "sq m",
  "%",
  "°F",
  "°C",
  "psi",
  "amps",
  "volts",
  "gal",
  "lbs",
] as const;

export const MAX_UNIT_LENGTH = 16;

/** A unit as it should be stored: trimmed, capped, and null when blank. */
export function normalizeUnit(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, MAX_UNIT_LENGTH);
  return trimmed || null;
}

/**
 * Whether an answer describes a problem that should be backed by a photo:
 * a Fail, a Poor condition, or a High or Critical severity. The runners use it
 * to offer the photo picker right after the answer is chosen.
 */
export function answerWantsPhoto(itemType: string | null | undefined, value: unknown): boolean {
  if (itemType === "pass_fail") return value === "Fail";
  if (itemType === "condition") return value === "Poor";
  if (itemType === "severity") {
    const n = typeof value === "number" ? value : Number(value);
    return n >= 4;
  }
  return false;
}

/** Whether an item still owes the photo its template asked for. */
export function isMissingRequiredPhoto(
  item: { photo_required?: boolean | null },
  photoCount: number,
): boolean {
  return !!item.photo_required && photoCount === 0;
}

export const WORKFLOW_KIND_LABELS: Record<WorkflowItemKind, string> = {
  check: "Check",
  photo: "Photo",
  note: "Note",
  checklist: "Checklist",
};

/** Whether a recorded answer counts as given. Matches `hasResponse` in the app. */
export function hasFieldResponse(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/**
 * Renders a stored `response_value` as the text that belongs on paper.
 *
 * The stored shapes are what `ItemResponse` writes: "Pass"/"Fail",
 * "Yes"/"No" and "Good"/"Fair"/"Poor" as strings, ratings, severities and
 * numerics as numbers, text as a string. A numeric prints with its unit.
 * Returns null when there is no answer, so callers can print an empty rule
 * instead of the word "null" - which is what a naive `String(value)` did.
 */
export function formatChecklistAnswer(
  itemType: ChecklistItemType | string | null | undefined,
  value: unknown,
  unit?: string | null,
): string | null {
  if (!hasFieldResponse(value)) return null;
  if (itemType === "rating") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? `${n} / 5` : null;
  }
  if (itemType === "severity") {
    const n = typeof value === "number" ? value : Number(value);
    const label = severityLabel(n);
    return label ? `${n} / 5 ${label}` : null;
  }
  if (itemType === "numeric" && typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const u = normalizeUnit(unit);
    return u ? `${value} ${u}` : String(value);
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
