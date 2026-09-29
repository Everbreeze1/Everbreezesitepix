import { useQuery } from "@tanstack/react-query";
import { getAdminAccess } from "@/api/admin";
import { getMyTeam } from "@/api/team";
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
