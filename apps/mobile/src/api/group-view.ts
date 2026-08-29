/**
 * Reading and editing a project group, as rules.
 *
 * Import-free so the selection arithmetic is tested. Most of this is small; the
 * part worth pinning is that membership is edited as a **set** and saved as a
 * whole list, so the screen has to be able to say whether anything actually
 * changed. Without that, closing a picker somebody only scrolled through sends
 * a write that rewrites every membership row for no reason.
 */

export type GroupLike = {
  id: string;
  name: string;
  description: string | null;
  /** The service sends a count here, not the ids. See `ProjectGroup`. */
  project_count?: number;
  thumbnails?: string[];
};

/**
 * How many projects a group holds.
 *
 * Reads `project_count`, which is what the service sends. Guessing a
 * `projectIds` array here is exactly what made every group report "No projects
 * yet" however many it had.
 */
export function memberCount(group: Pick<GroupLike, "project_count">): number {
  const count = group.project_count;
  return typeof count === "number" && count > 0 ? count : 0;
}

/** The line under a group's name. */
export function groupSummary(count: number): string {
  if (count === 0) return "No projects yet";
  return `${count} project${count === 1 ? "" : "s"}`;
}

/**
 * Whether the picker's selection differs from what is stored.
 *
 * Order-insensitive, because the picker builds its list in the project list's
 * order and the server returns membership rows in whatever order they were
 * inserted. Comparing arrays directly would report a change on every open.
 */
export function selectionChanged(before: string[], after: ReadonlySet<string>): boolean {
  if (before.length !== after.size) return true;
  return before.some((id) => !after.has(id));
}

/**
 * The membership to send, in the project list's own order.
 *
 * Ordered rather than taken from the Set, whose iteration order is insertion
 * order and would record the sequence somebody happened to tap in. Nothing
 * reads the order today, and that is exactly why it should not be arbitrary:
 * the first thing to read it would inherit tap order as a feature.
 */
export function orderedSelection<T extends { id: string }>(
  projects: T[],
  selected: ReadonlySet<string>,
): string[] {
  return projects.filter((project) => selected.has(project.id)).map((project) => project.id);
}

export function groupNameError(name: string): string | null {
  const value = name.trim();
  if (!value) return "Give the group a name.";
  // The op caps at 120; saying so here saves a round trip to be told.
  if (value.length > 120) return "Keep the name under 120 characters.";
  return null;
}

/**
 * Toggle one project in a selection.
 *
 * Returns a new Set rather than mutating, so a caller holding it in state gets
 * a re-render. Mutating and calling `setState` with the same reference is the
 * classic way a picker stops responding after the first tap.
 */
export function toggled(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Covers to show on a group card.
 *
 * Capped at four: the service sends up to four and a row of more than that on a
 * phone is a strip of thumbnails too small to recognise anything in.
 */
export function covers(group: Pick<GroupLike, "thumbnails">, max = 4): string[] {
  return (Array.isArray(group.thumbnails) ? group.thumbnails : [])
    .filter((url) => typeof url === "string" && url.length > 0)
    .slice(0, max);
}
