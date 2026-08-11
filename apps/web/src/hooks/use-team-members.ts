import { useQuery } from "@tanstack/react-query";
import { getMyTeam } from "@/lib/teams.functions";

export interface TeamMemberLite {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string | null;
}

/**
 * The one place the team roster is read.
 *
 * Several screens used to hand-roll this by querying `public.profiles` straight
 * from the browser. `profiles` has exactly ONE SELECT policy — "Users can view
 * own profile" USING (auth.uid() = id), in
 * 20260618045310_profiles_company_fix.sql — so every one of those queries came
 * back with a single row: the caller's own. Nothing errored, nothing spun,
 * nothing rendered an empty state. The assignee dropdown silently contained one
 * person (you), avatar stacks filled with "?", contributor filters listed
 * "Unknown", and the activity feed said "Someone" for the whole crew.
 *
 * `getMyTeam` resolves the same columns server-side with the service-role client
 * (apps/api/src/domains/teams/service.ts), which is precisely why the Teams page
 * has always shown teammate names while every picker did not.
 *
 * Deliberately NOT solved by widening the RLS policy: an RLS policy is
 * row-level, not column-level, and `profiles` also carries `company`,
 * `company_address`, `company_phone` and `company_logo_url`. A teammate-scoped
 * policy would hand every crew member the owner's business address and phone in
 * order to fix a dropdown. Going through the RPC exposes exactly the four
 * columns the Teams page already shows everyone.
 */
export function useTeamMembers() {
  const q = useQuery({
    queryKey: ["team-members"],
    queryFn: () => getMyTeam(),
    // The roster changes rarely; several panels mount this at once.
    staleTime: 5 * 60_000,
  });

  const members: TeamMemberLite[] = ((q.data as any)?.members ?? []).map((m: any) => ({
    // `m.id` is the team_members ROW id — assignee and uploader columns hold
    // USER ids, so this must be `user_id`.
    user_id: m.user_id,
    full_name: m.profile?.full_name ?? null,
    email: m.profile?.email ?? null,
    avatar_url: m.profile?.avatar_url ?? null,
    role: m.role ?? null,
  }));
  members.sort((a, b) =>
    (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""),
  );

  return {
    members,
    /** Pending invitees. They have no auth user yet, so they are NOT assignable. */
    pendingInvites: ((q.data as any)?.invites ?? []) as Array<{
      id: string;
      email: string;
      role: string;
    }>,
    isLoading: q.isLoading,
    isError: q.isError,
  };
}
