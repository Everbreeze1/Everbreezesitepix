import { useMemo } from "react";
import { useTeamMembers } from "@/hooks/use-team-members";

/**
 * The shape both photo panels already speak (`CommentContributor`). Declared
 * here rather than imported so a hook does not depend on a feature component.
 */
export interface AssignableTeammate {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

function label(t: AssignableTeammate): string {
  return (t.fullName ?? t.email ?? "").toLowerCase();
}

/**
 * Who a photo's task can be handed to, and who can be @mentioned on it.
 *
 * The panels in the photo lightbox were built on `getProjectContributors`, which
 * answers a different question: it counts who has ALREADY uploaded a photo,
 * created a task or written a report on this project, and returns only those
 * people. So the assignee dropdown on a photo listed whoever happened to have
 * touched the project - one name, in the report that started this - while the
 * project's own Tasks tab, which reads the roster through getMyTeam, listed the
 * whole crew. A teammate who had just been invited, or who works on other jobs,
 * could not be assigned anything from a photo at all.
 *
 * Same family as the profiles-from-the-browser bug in `use-team-members`: the
 * list is not empty and nothing errors, so it reads as "the feature works" while
 * quietly missing most of the team.
 *
 * The roster is the answer, and contributors are merged in on top of it rather
 * than dropped: somebody who uploaded photos and has since left the team still
 * has to render with a name against the work they hold. Roster values win where
 * both carry one, since `getMyTeam` is the live copy.
 *
 * Pending invitees are deliberately absent - `useTeamMembers` keeps them
 * separate because they have no auth user yet, so nothing can be assigned to
 * them.
 */
export function useAssignableTeammates(contributors: AssignableTeammate[] = []): {
  teammates: AssignableTeammate[];
  isLoading: boolean;
} {
  const { members, isLoading } = useTeamMembers();

  const teammates = useMemo(() => {
    const byId = new Map<string, AssignableTeammate>();
    for (const m of members) {
      if (!m.user_id) continue;
      byId.set(m.user_id, {
        userId: m.user_id,
        fullName: m.full_name,
        email: m.email,
        avatarUrl: m.avatar_url,
      });
    }
    for (const c of contributors) {
      if (!c?.userId) continue;
      const known = byId.get(c.userId);
      byId.set(c.userId, {
        userId: c.userId,
        fullName: known?.fullName ?? c.fullName ?? null,
        email: known?.email ?? c.email ?? null,
        avatarUrl: known?.avatarUrl ?? c.avatarUrl ?? null,
      });
    }
    return Array.from(byId.values()).sort((a, b) => label(a).localeCompare(label(b)));
  }, [members, contributors]);

  return { teammates, isLoading };
}
