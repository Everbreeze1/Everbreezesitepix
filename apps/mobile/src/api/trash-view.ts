/**
 * The workspace trash.
 *
 * Import-free so the wording can be tested, and the wording is the whole point:
 * everything on this screen is either "you can still get this back" or "this is
 * about to be gone for good", and a person deciding between them is deciding
 * about a job's entire photographic record.
 */

/** Mirrors what `listTrashedProjects` returns. Field names are the server's. */
export type TrashedProject = {
  id: string;
  name: string;
  description: string | null;
  location: string;
  status: string;
  deleted_at: string;
  /** Computed by the server against its own clock. */
  days_left: number;
  photo_count: number;
};

/** Matches `TRASH_RETENTION_DAYS` in the trash service. */
export const RETENTION_DAYS = 60;

/**
 * How long is left, in words.
 *
 * `days_left` comes from the server rather than being recomputed here, and that
 * is deliberate: the purge job runs on the server's clock, so a phone in
 * another timezone counting for itself would disagree with the thing that
 * actually deletes the data.
 */
export function timeLeftLabel(project: TrashedProject): string {
  const days = project.days_left;
  if (days <= 0) return "Due to be deleted";
  if (days === 1) return "1 day left";
  if (days <= 7) return `${days} days left`;
  return `${days} days left`;
}

/**
 * Whether to draw this row as urgent.
 *
 * A week, because that is roughly the span in which somebody might not open the
 * app at all. Marking the whole sixty days as urgent would make the marker mean
 * nothing, which is the usual way an urgency signal dies.
 */
export function isUrgent(project: TrashedProject): boolean {
  return project.days_left <= 7;
}

/** What a row says it contains. Photographs are what makes a project matter. */
export function contentsLabel(project: TrashedProject): string {
  const n = project.photo_count;
  if (n === 0) return "No photos";
  return `${n} photo${n === 1 ? "" : "s"}`;
}

/**
 * The most urgent first.
 *
 * Not newest-deleted first, which is the order the server returns. What a person
 * opening this screen needs is whatever is about to disappear, and the job
 * deleted two months ago is more urgent than the one deleted this morning.
 */
export function sortedByUrgency(projects: TrashedProject[]): TrashedProject[] {
  return [...projects].sort((a, b) => {
    if (a.days_left !== b.days_left) return a.days_left - b.days_left;
    return a.name.localeCompare(b.name);
  });
}

/** The line under the screen title. */
export function trashSummary(projects: TrashedProject[]): string {
  if (projects.length === 0) return "Nothing deleted";
  const urgent = projects.filter(isUrgent).length;
  const noun = projects.length === 1 ? "project" : "projects";
  if (urgent === 0) return `${projects.length} deleted ${noun}`;
  return `${projects.length} deleted ${noun}, ${urgent} due to go`;
}

/**
 * What the confirmation says before a permanent delete.
 *
 * Names the photo count, because that is the thing being destroyed and a
 * project name does not convey it. "Delete Riverside Unit 4" and "Delete
 * Riverside Unit 4 and its 340 photographs" are different decisions.
 */
export function purgeWarning(project: TrashedProject): string {
  const photos =
    project.photo_count > 0
      ? ` and its ${project.photo_count} photograph${project.photo_count === 1 ? "" : "s"}`
      : "";
  return `${project.name}${photos} will be deleted for good. This cannot be undone.`;
}

/** What the confirmation says before moving a live project to the trash. */
export function deleteWarning(projectName: string): string {
  return `${projectName} moves to the trash and stops appearing in your projects. You have ${RETENTION_DAYS} days to put it back.`;
}

/**
 * Why this account cannot delete this project, or null.
 *
 * Only the owner can. The server enforces it as `eq("owner_id", userId)` on an
 * update, and an update matching nothing is not an error in PostgREST - the op
 * answers `{ ok: true }` either way. So a teammate would be told the job was
 * deleted and it would still be there. Refusing in the client is what stops
 * that, which makes this message load-bearing rather than decorative.
 */
export function deleteRefusal(owns: boolean): string | null {
  return owns ? null : "Only the person who created this job can delete it.";
}
