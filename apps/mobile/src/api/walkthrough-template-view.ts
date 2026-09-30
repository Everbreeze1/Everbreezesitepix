import { categoryRank, matchesSearch, tradeOf } from "./template-library-view";

/**
 * Walkthrough templates: a named, ordered shot list. Each shot says what to
 * capture and why, and whether the crew may skip it. The web's
 * `WalkthroughTemplatesManager` on a phone; import-free so it is tested.
 */

export type ShotCapture = "photo" | "video" | "note";

export type WalkthroughTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  archived: boolean;
  createdAt: string;
};

export type ShotRow = {
  id: string;
  templateId: string;
  position: number;
  label: string;
  description: string | null;
  capture: ShotCapture;
  required: boolean;
};

export const CAPTURE_OPTIONS: { id: ShotCapture; label: string; hint: string }[] = [
  { id: "photo", label: "Photo", hint: "A still. The default, and what most shots want." },
  {
    id: "video",
    label: "Video",
    hint: "A clip, for anything a still cannot show: running water, a fault under load.",
  },
  {
    id: "note",
    label: "Note",
    hint: "No capture. An instruction to follow or a reading to write down.",
  },
];

export function normaliseCapture(value: unknown): ShotCapture {
  return value === "video" || value === "note" ? value : "photo";
}

export function captureLabel(capture: ShotCapture): string {
  return CAPTURE_OPTIONS.find((o) => o.id === capture)?.label ?? "Photo";
}

/** The list: archive filter and search, by trade then name, the web's order. */
export function visibleWalkthroughTemplates(
  rows: readonly WalkthroughTemplateRow[],
  opts: { showArchived: boolean; search: string },
): WalkthroughTemplateRow[] {
  return rows
    .filter(
      (t) =>
        (opts.showArchived || !t.archived) &&
        matchesSearch(opts.search, t.name, t.description, t.category),
    )
    .sort(
      (a, b) =>
        categoryRank(tradeOf(a.category)) - categoryRank(tradeOf(b.category)) ||
        a.name.localeCompare(b.name),
    );
}

/** One template's shots in order. */
export function shotsFor(shots: readonly ShotRow[], templateId: string): ShotRow[] {
  return shots
    .filter((s) => s.templateId === templateId)
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
}

/**
 * The position a new shot takes: max + 1, not the count. Deleting never
 * renumbers survivors, so the count can hand out a position a sibling holds.
 */
export function nextShotPosition(shots: readonly ShotRow[]): number {
  return shots.reduce((max, s) => Math.max(max, s.position), -1) + 1;
}

export function shotSummary(shots: readonly ShotRow[]): string {
  if (shots.length === 0) return "No shots yet";
  const required = shots.filter((s) => s.required).length;
  const n = shots.length;
  return `${n} shot${n === 1 ? "" : "s"}${required ? `, ${required} required` : ""}`;
}
