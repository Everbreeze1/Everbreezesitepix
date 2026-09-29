import { useQuery } from "@tanstack/react-query";
import { getAdminAccess } from "@/api/admin";
import { getMyTeam } from "@/api/team";
import { canAuthorRecords, isManagerRole } from "@/api/record-edit-rules";
import { isAccountOwner } from "./access";
import { useAuth } from "./auth";

/**
 * Whether the signed-in person is platform staff, and with which role.
 *
 * Keyed by user id. The query cache is persisted to disk, so a key without the
 * id would hand the next account on this phone the previous one's answer: sign
 * out of the staff test account, sign in as a subscriber, and the Admin row
 * would still be there from cache.
 */
export function usePlatformAdmin(enabled = true) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["is-platform-admin", user?.id ?? null],
    queryFn: getAdminAccess,
    enabled: enabled && Boolean(user?.id),
    staleTime: 10 * 60 * 1000,
  });
  return {
    isAdmin: query.data?.isAdmin === true,
    role: query.data?.role ?? null,
    isLoading: query.isLoading,
  };
}

/** Whether the signed-in person owns the account (team role `owner`). */
export function useAccountOwner(enabled = true) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["my-team"],
    queryFn: getMyTeam,
    enabled: enabled && Boolean(user?.id),
    staleTime: 30_000,
  });
  return { isOwner: isAccountOwner(query.data), isLoading: query.isLoading };
}

/**
 * What the signed-in person may do to a task, checklist or workflow beyond
 * filling it in: author its structure (Pro or Team plan, owner/admin/manager),
 * and whether they count as a manager for reopening someone else's record.
 *
 * Shares the `my-team` cache with `useAccountOwner` and the team screen, so
 * asking costs nothing once any of them has loaded.
 */
export function useRecordAuthoring(enabled = true) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["my-team"],
    queryFn: getMyTeam,
    enabled: enabled && Boolean(user?.id),
    staleTime: 30_000,
  });
  return {
    canAuthor: canAuthorRecords(query.data),
    isManager: isManagerRole(query.data?.myRole),
    isLoading: query.isLoading,
  };
}
