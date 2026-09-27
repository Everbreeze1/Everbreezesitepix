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
