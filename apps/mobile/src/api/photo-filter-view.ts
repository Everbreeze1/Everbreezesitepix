/**
 * The project photo grid's filters.
 *
 * Import-free so it can be tested. The same three filters the web project page
 * offers above its grid: phase, tags (any-of or all-of), and photos against
 * videos, with the same meaning, so a filter set on one surface finds the same
 * photographs on the other.
 */

export type PhaseFilter = "all" | "before" | "after" | "untagged";
export type TagLogic = "or" | "and";
export type MediaFilter = "all" | "photos" | "videos";
/** The web popover's Photo size: Small, Medium, Large. */
export type PhotoSize = "sm" | "md" | "lg";
export type PhotoOrder = "newest" | "oldest";

/**
 * The phase chips, in the web's words and order.
 *
 * "Needs review" is the untagged bucket: a photo nobody has marked before or
 * after yet. It was "Untagged" here, which read as "has no tags" and sent
 * people to the tag filter for something the phase chip already did.
 */
export const PHASE_FILTER_LABELS: { id: PhaseFilter; label: string }[] = [
  { id: "all", label: "All captures" },
  { id: "before", label: "Before work" },
  { id: "after", label: "After work" },
  { id: "untagged", label: "Needs review" },
];

/**
 * The pill in a tile's corner, as the web grid draws it: Before, After,
 * Walkthrough for a frame a walk captured, and Needs review for the rest.
 */
export function phasePill(phase: string | null): {
  label: string;
  tone: "before" | "after" | "walkthrough" | "review";
} {
  if (phase === "before") return { label: "Before", tone: "before" };
  if (phase === "after") return { label: "After", tone: "after" };
  if (phase === "walkthrough") return { label: "Walkthrough", tone: "walkthrough" };
  return { label: "Needs review", tone: "review" };
}

/**
 * Tiles across for a photo size.
 *
 * Medium is the grid every phone has always drawn (three across, more on a
 * tablet). Small packs a contact sheet for scanning a long job; Large drops to
 * two across on a phone so a detail can be read without opening the photo.
 */
export function photoGridColumns(width: number, size: PhotoSize): number {
  const w = Math.max(0, width);
  if (size === "sm") return Math.min(10, Math.max(4, Math.floor(w / 80)));
  if (size === "lg") return Math.min(6, Math.max(2, Math.floor(w / 170)));
  return Math.min(8, Math.max(3, Math.floor(w / 105)));
}

type Filterable = { phase: string | null; tags: string[] | null };

/** "before" and "after" are phases; anything else, including null, is untagged. */
export function normalizedPhase(phase: string | null): Exclude<PhaseFilter, "all"> {
  return phase === "before" ? "before" : phase === "after" ? "after" : "untagged";
}

export function filterPhotos<T extends Filterable>(
  photos: T[],
  filters: { phase: PhaseFilter; tags: string[]; logic: TagLogic },
): T[] {
  return photos.filter((photo) => {
    if (filters.phase !== "all" && normalizedPhase(photo.phase) !== filters.phase) return false;
    if (filters.tags.length === 0) return true;
    const own = photo.tags ?? [];
    return filters.logic === "and"
      ? filters.tags.every((tag) => own.includes(tag))
      : filters.tags.some((tag) => own.includes(tag));
  });
}

/**
 * Every tag on the loaded photos, most used first, with its count.
 *
 * Alphabetical within a count so the row does not reshuffle between renders.
 */
export function photoTagCounts(photos: Filterable[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const photo of photos) {
    for (const tag of photo.tags ?? []) {
      const name = tag.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  );
}

/** Add a tag to the filter, or take it off again. */
export function toggleTag(selected: string[], tag: string): string[] {
  return selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag];
}

/** How many filters beyond the phase chips are narrowing the grid, for the button. */
export function activeFilterCount(filters: { tags: string[]; media: MediaFilter }): number {
  return (filters.tags.length > 0 ? 1 : 0) + (filters.media !== "all" ? 1 : 0);
}
