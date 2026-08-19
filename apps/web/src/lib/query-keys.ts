/**
 * Shared React Query key builders. Keeping these in one place means a
 * mutation in one file (e.g. NewProjectPage) can invalidate exactly
 * what another page's useQuery reads, without both sides having to agree
 * on a hand-typed array and risk drifting apart.
 *
 * Every key is scoped by userId: field devices get shared between crew
 * members who sign out and back in as someone else without a full page
 * reload, so an unscoped key could briefly serve one user's cached data
 * to the next person who logs in.
 */
export const qk = {
  dashboard: (userId: string) => ["dashboard", userId] as const,
  projectsList: (userId: string) => ["projects-list", userId] as const,
  projectGroups: (userId: string) => ["project-groups", userId] as const,
  projectBoards: (userId: string) => ["project-boards", userId] as const,
  /** Omit `filters` to get the base key - invalidating the base key clears
   * every filter variant for that user, since React Query matches by key prefix. */
  galleryPhotos: (
    userId: string,
    filters?: { projectFilter: string[]; dateFrom: string; dateTo: string },
  ) =>
    filters
      ? (["gallery", "photos", userId, filters] as const)
      : (["gallery", "photos", userId] as const),
  galleryProjects: (userId: string) => ["gallery", "projects", userId] as const,
  galleryTotalPhotos: (userId: string) => ["gallery", "total-photos", userId] as const,
  /** Day-bucketed photo counts behind the calendar's cells and heatmap. */
  photoActivity: (
    userId: string,
    scope?: { from: string; to: string; projectIds: string[]; tags: string[]; thumbs: boolean },
  ) =>
    scope ? (["photo-activity", userId, scope] as const) : (["photo-activity", userId] as const),
  /** The photos behind one selected calendar day. */
  photoDay: (userId: string, scope?: { day: string; projectIds: string[]; tags: string[] }) =>
    scope ? (["photo-day", userId, scope] as const) : (["photo-day", userId] as const),
  mapProjects: (userId: string) => ["map", "projects", userId] as const,
  /**
   * Who is on which job. Omit `projectIds` for the base key - invalidating that
   * clears every window of ids at once, which is what a save has to do: the
   * projects grid and the project page hold different slices of the same table.
   */
  projectAssignees: (userId: string, projectIds?: string[]) =>
    projectIds
      ? (["project-assignees", userId, [...projectIds].sort().join(",")] as const)
      : (["project-assignees", userId] as const),
  notificationsUnread: (userId: string) => ["notifications", "unread", userId] as const,
  notificationsList: (userId: string) => ["notifications", "list", userId] as const,
};
