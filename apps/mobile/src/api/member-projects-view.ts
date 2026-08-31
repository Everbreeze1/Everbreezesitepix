/**
 * Scoping a Restricted member to particular jobs.
 *
 * Import-free so the two rules that decide whether a control appears at all can
 * be tested, and both of them are about not showing something that would be
 * refused or would do nothing.
 */

/** Enough of a roster row to decide what to offer. */
export type ScopableMember = {
  id: string;
  role: string;
  fullName: string | null;
  email: string | null;
};

/** Enough of a project to list it. */
export type ScopableProject = { id: string; name: string | null };

/**
 * Whether scoping applies to this member at all.
 *
 * Only Restricted members are fenced. Everyone else sees every job on the team
 * by role, so offering to pick their jobs would imply a limit that does not
 * exist - and saving it would quietly staff them onto those jobs as crew,
 * because it is the same `project_assignments` table.
 *
 * Compared against the exact stored string rather than through a normaliser: a
 * role nobody recognises must not be treated as Restricted and silently fenced.
 */
export function needsProjectScope(member: { role: string }): boolean {
  return member.role === "restricted";
}

/**
 * Whether this caller may change it.
 *
 * The server gates on `manage_users` and nothing else. The team screen's own
 * `canManageUsers` is broader - it also allows `manage_own_crew` - so reusing
 * that would put the control in front of somebody whose save is refused. This
 * takes the narrower answer deliberately.
 */
export function canScopeProjects(permissions: { manageUsers: boolean }): boolean {
  return permissions.manageUsers;
}

/** Flip one job in or out. Order is preserved so the sheet does not reshuffle. */
export function toggledProject(selected: string[], projectId: string): string[] {
  return selected.includes(projectId)
    ? selected.filter((id) => id !== projectId)
    : [...selected, projectId];
}

/** Whether the picked set differs from what is stored. */
export function scopeChanged(before: string[], after: string[]): boolean {
  if (before.length !== after.length) return true;
  const had = new Set(before);
  return after.some((id) => !had.has(id));
}

/**
 * The line on the member's row.
 *
 * "No jobs" is called out rather than shown as a zero, because it is the state
 * that leaves somebody staring at an empty app and it is the one a manager most
 * needs to notice on a list.
 */
export function scopeSummary(count: number): string {
  if (count === 0) return "No jobs yet, so they see nothing";
  return `${count} job${count === 1 ? "" : "s"}`;
}

/**
 * What a save is about to do, in words.
 *
 * Emptying the list is singled out. It is a legitimate act - it is how somebody
 * is parked without being removed from the team - but it is indistinguishable
 * from a mistake unless the consequence is stated.
 */
export function scopeChangeWarning(after: string[], name: string): string | null {
  if (after.length > 0) return null;
  return `${name} will not be able to see any jobs until they are given one.`;
}

/** Jobs first that they are already on, then alphabetical. */
export function sortedProjects(projects: ScopableProject[], selected: string[]): ScopableProject[] {
  const on = new Set(selected);
  return [...projects].sort((a, b) => {
    const aOn = on.has(a.id);
    const bOn = on.has(b.id);
    if (aOn !== bOn) return aOn ? -1 : 1;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

/** How a member is named in the scoping sheet. */
export function memberLabel(member: Pick<ScopableMember, "fullName" | "email">): string {
  return member.fullName?.trim() || member.email?.trim() || "Teammate";
}
