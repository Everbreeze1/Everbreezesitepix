import { Camera, CheckSquare, StickyNote } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The workflow step vocabulary, in one place.
 *
 * Same reasoning as `checklist-items.ts`: the designer described these three
 * kinds with tinted chips and hints while the runner drew bare grey icons, so
 * a "photo prompt" looked like two unrelated things depending on which screen
 * you were on. One map, one look.
 */
export type ItemKind = "check" | "photo" | "note";

export interface ItemKindMeta {
  label: string;
  short: string;
  icon: LucideIcon;
  /** What the crew is expected to do - shown in the designer's type menu. */
  hint: string;
  tint: string;
  /** Example label, used as the designer's field placeholder. */
  placeholder: string;
}

export const KIND_META: Record<ItemKind, ItemKindMeta> = {
  check: {
    icon: CheckSquare,
    label: "Checklist item",
    short: "Check",
    hint: "Crew ticks it off on site",
    tint: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    placeholder: "e.g. Verify breaker labeled",
  },
  photo: {
    icon: Camera,
    label: "Photo prompt",
    short: "Photo",
    hint: "Crew must capture a photo",
    tint: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    placeholder: "e.g. Before photo - front elevation",
  },
  note: {
    icon: StickyNote,
    label: "Note field",
    short: "Note",
    hint: "Crew types a short answer",
    tint: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    placeholder: "e.g. Customer concerns raised on site",
  },
};

export const KIND_ORDER: ItemKind[] = ["check", "photo", "note"];
