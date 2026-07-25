/**
 * Shared React Query key builders. Keeping these in one place means a
 * mutation in one file (e.g. CreateProjectDialog) can invalidate exactly
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
  /** Omit `filters` to get the base key — invalidating the base key clears
   * every filter variant for that user, since React Query matches by key prefix. */
  galleryPhotos: (userId: string, filters?: { projectFilter: string[]; dateFrom: string; dateTo: string }) =>
    filters
      ? (["gallery", "photos", userId, filters] as const)
      : (["gallery", "photos", userId] as const),
  galleryProjects: (userId: string) => ["gallery", "projects", userId] as const,
  galleryTotalPhotos: (userId: string) => ["gallery", "total-photos", userId] as const,
  mapProjects: (userId: string) => ["map", "projects", userId] as const,
};
