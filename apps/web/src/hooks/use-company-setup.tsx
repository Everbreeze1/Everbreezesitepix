import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isBusinessProfileComplete, type BusinessProfile } from "@everlumen/shared";
import { getMyTeam, dismissSetupPrompt } from "@/lib/teams.functions";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";

/**
 * "Has this company told us who they are yet, and should we be asking?"
 *
 * Two separate facts, deliberately kept separate:
 *
 *   * the answers live on the team, so a second admin sees the profile their
 *     colleague filled in rather than being asked the same questions again;
 *   * the dismissal lives on the person, because "not now" is one person's
 *     decision about one card.
 *
 * Everything reads through the same `["my-team", userId]` query the rest of the
 * app already uses, so saving the profile and invalidating that key updates
 * every screen at once - the dashboard card, the Settings form and the trade
 * order on both template screens.
 */

export interface CompanySetup {
  /** The stored answers, empty-but-valid when nothing has been answered. */
  profile: BusinessProfile;
  /** Null until the user creates or joins a company. */
  teamId: string | null;
  companyName: string | null;
  /** Owners and admins answer for the company; a member cannot. */
  canEdit: boolean;
  /** Industry and team size are both answered. */
  isComplete: boolean;
  /** Show the "finish setting up" card: incomplete, allowed, and not dismissed. */
  shouldPrompt: boolean;
  loading: boolean;
  /** Record "not now" for this person, durably. */
  dismiss: () => Promise<void>;
  /** Re-read the team after a save. */
  refresh: () => Promise<void>;
}

const EMPTY: BusinessProfile = {
  industry: null,
  trades: [],
  team_size: null,
  project_volume: null,
  goals: [],
  heard_from: null,
  service_area: null,
  profile_completed_at: null,
};

export function useCompanySetup(): CompanySetup {
  const { user } = useAuth();
  const { profile: userProfile, loading: profileLoading, reload } = useProfile();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["my-team", user?.id],
    queryFn: () => getMyTeam(),
    enabled: !!user,
    staleTime: 60_000,
  });

  const team = (data?.team ?? null) as Record<string, unknown> | null;

  /*
   * Read defensively rather than trusting the row shape. A database that has
   * not had 20260827000000 applied yet returns a team with none of these
   * columns, and the honest reading of that is "not answered", not a crash on
   * the dashboard.
   */
  const profile: BusinessProfile = team
    ? {
        industry: (team.industry as string | null) ?? null,
        trades: Array.isArray(team.trades) ? (team.trades as string[]) : [],
        team_size: (team.team_size as string | null) ?? null,
        project_volume: (team.project_volume as string | null) ?? null,
        goals: Array.isArray(team.goals) ? (team.goals as string[]) : [],
        heard_from: (team.heard_from as string | null) ?? null,
        service_area: (team.service_area as string | null) ?? null,
        profile_completed_at: (team.profile_completed_at as string | null) ?? null,
      }
    : EMPTY;

  const myRole = data?.myRole ?? null;
  // No team yet means nobody has claimed the company, so the person looking at
  // this is the one who will own it. Refusing them the form here would leave
  // the account permanently unable to be set up.
  const canEdit = !team || myRole === "owner" || myRole === "admin";
  const isComplete = isBusinessProfileComplete(profile);
  const dismissed = !!(userProfile as { setup_prompt_dismissed_at?: string | null } | null)
    ?.setup_prompt_dismissed_at;

  const loading = isLoading || profileLoading;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["my-team", user?.id] });
  }, [queryClient, user?.id]);

  const dismiss = useCallback(async () => {
    await dismissSetupPrompt();
    await reload();
  }, [reload]);

  return {
    profile,
    teamId: (team?.id as string | undefined) ?? null,
    companyName: (team?.name as string | undefined) ?? null,
    canEdit,
    isComplete,
    // Never while loading: a card that appears for a second and vanishes reads
    // as a glitch, and this one appears on the screen people land on.
    shouldPrompt: !loading && !isComplete && canEdit && !dismissed,
    loading,
    dismiss,
    refresh,
  };
}
