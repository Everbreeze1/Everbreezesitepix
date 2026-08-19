import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import { useAuth } from "@/hooks/use-auth";
import { getProjectAssignees } from "@/lib/teams.functions";

/**
 * Who is on these jobs.
 *
 * One request for a window of project ids rather than one per project: the
 * projects grid draws a crew stack on every card, and a per-card query is sixty
 * requests to render one screen. The project page passes a single id and pays
 * for exactly that.
 *
 * `canAssign` is the SERVER's answer, carried back with the data. The web could
 * work it out from the roster and `can(role, "manage_users")`, and that is
 * exactly the kind of second implementation that drifts: a control the browser
 * shows and the RPC then refuses is worse than no control, because the user has
 * already decided they can do the thing.
 */
export function useProjectAssignees(projectIds: string[]): {
  byProject: Record<string, string[]>;
  canAssign: boolean;
  isLoading: boolean;
} {
  const { user } = useAuth();
  // Sorted and de-duplicated so a re-render that reorders the grid does not
  // look like a different question and refetch.
  const ids = useMemo(
    () => Array.from(new Set(projectIds.filter(Boolean))).sort(),
    [projectIds.join(",")], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { data, isLoading } = useQuery({
    queryKey: qk.projectAssignees(user?.id ?? "anon", ids),
    queryFn: () => getProjectAssignees({ data: { projectIds: ids } }),
    enabled: !!user && ids.length > 0,
    staleTime: 30_000,
  });

  return {
    byProject: ((data as any)?.byProject ?? {}) as Record<string, string[]>,
    canAssign: !!(data as any)?.canAssign,
    isLoading,
  };
}

/**
 * Write the crew we just saved into every cached window, then reconcile.
 *
 * Invalidating alone was correct and felt broken. Measured in a browser
 * (scripts/probe-crew-refresh.mjs): the dialog closed 3.4s after the click and
 * the card kept its old avatars until 6.5s, because invalidation only marks the
 * query stale and the refetch is another RPC round trip. Three seconds of a
 * card contradicting the toast that just confirmed the change reads as a
 * failed save, and the second thing a person does about a failed save is do it
 * again.
 *
 * The round trip is also unnecessary: the caller sent `userIds` and the server
 * accepted them, so the new answer is already known here. Seeding it repaints
 * on the same tick the dialog closes, and the invalidate that follows is what
 * corrects the cache if the server did something we did not predict.
 *
 * Prefix-matched on purpose. A save made from the project page has to reach the
 * grid's copy too, and the two hold different id windows of the same table.
 * Windows that do not contain this project are left exactly as they were, which
 * is what stops a patch from inventing an entry the server never returned.
 */
export function useApplyProjectAssignees(): (projectId: string, userIds: string[]) => void {
  const qc = useQueryClient();
  const { user } = useAuth();
  return (projectId, userIds) => {
    const key = qk.projectAssignees(user?.id ?? "anon");
    qc.setQueriesData({ queryKey: key }, (old: any) => {
      if (!old?.byProject || !(projectId in old.byProject)) return old;
      return { ...old, byProject: { ...old.byProject, [projectId]: userIds } };
    });
    void qc.invalidateQueries({ queryKey: key });
  };
}
