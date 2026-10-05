import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  Gauge,
  Hash,
  Star,
  ToggleLeft,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ChecklistItemType } from "@everlumen/shared";

/**
 * The checklist answer-type vocabulary, in one place.
 *
 * This map used to exist twice - once in the template designer and once in the
 * project runner, minus the hints - so the two screens could describe the same
 * concept differently, and adding a seventh type only showed up in one of them.
 * Both now read from here, which is also what keeps a "Pass / Fail" chip the
 * same shade of green whether you are authoring it or answering it.
 */
export type ItemType = ChecklistItemType;

export interface ItemTypeMeta {
  /** Full name, for menus. */
  label: string;
  /** Abbreviated name, for chips where horizontal space is scarce. */
  short: string;
  icon: LucideIcon;
  /** One-line explanation of when to reach for it. */
  hint: string;
  /** Border + fill + text, light and dark. */
  tint: string;
}

export const TYPE_META: Record<ItemType, ItemTypeMeta> = {
  checkbox: {
    label: "Checkbox",
    short: "Check",
    icon: CheckSquare,
    hint: "Simple done / not done",
    tint: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  pass_fail: {
    label: "Pass / Fail",
    short: "Pass/Fail",
    icon: CheckCircle2,
    hint: "Inspection result",
    tint: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  yes_no: {
    label: "Yes / No",
    short: "Yes/No",
    icon: ToggleLeft,
    hint: "Quick binary answer",
    tint: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  rating: {
    label: "Star rating (1–5)",
    short: "Rating",
    icon: Star,
    hint: "Quality score, 5 stars = excellent",
    tint: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  numeric: {
    label: "Number / Measurement",
    short: "Number",
    icon: Hash,
    hint: "Measurement with a unit, or a count",
    tint: "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  severity: {
    label: "Severity (1–5)",
    short: "Severity",
    icon: AlertTriangle,
    hint: "How bad is the issue, 1 Minor to 5 Critical",
    tint: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  },
  condition: {
    label: "Condition",
    short: "Condition",
    icon: Gauge,
    hint: "Good, Fair or Poor",
    tint: "border-lime-500/25 bg-lime-500/10 text-lime-700 dark:text-lime-300",
  },
  text: {
    label: "Text / Notes",
    short: "Text",
    icon: Type,
    hint: "Free-form note",
    tint: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
};

/** Menu order: the two most-used types first, free text last. */
export const TYPE_ORDER: ItemType[] = [
  "checkbox",
  "pass_fail",
  "yes_no",
  "condition",
  "severity",
  "rating",
  "numeric",
  "text",
];

/**
 * Selected-state colours for the severity scale, 1 (green) to 5 (red), so a
 * Critical reads as urgent at a glance in the runner and the builder preview.
 */
export const SEVERITY_TINTS: Record<number, string> = {
  1: "bg-emerald-500/15 border-emerald-500/50 text-emerald-700 dark:text-emerald-300",
  2: "bg-lime-500/15 border-lime-500/50 text-lime-700 dark:text-lime-300",
  3: "bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300",
  4: "bg-orange-500/15 border-orange-500/50 text-orange-700 dark:text-orange-300",
  5: "bg-red-500/15 border-red-500/50 text-red-700 dark:text-red-300",
};

/** Selected-state colours for Good / Fair / Poor. */
export const CONDITION_TINTS: Record<string, string> = {
  Good: "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  Fair: "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-400",
  Poor: "bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-400",
};

/**
 * Whether a recorded answer counts as given.
 *
 * Deliberately does *not* look at pass/fail polarity - a "Fail" is an answer,
 * not an incomplete item. Group-board rollups
 * (`apps/api/src/domains/projects/groups.ts`) count completion off
 * `completed_at` alone, so anything stricter here would make the two disagree.
 */
export function hasResponse(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}
