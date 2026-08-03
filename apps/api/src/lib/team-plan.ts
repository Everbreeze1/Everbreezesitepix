import type { AuthedContext } from "./user-context";

export type BillingTier = "starter" | "pro" | "team";

/**
 * Hard seat ceiling per tier — what actually blocks invites (teams/service.ts)
 * and what checkout refuses to sell beyond (billing/service.ts).
 *
 * Mirrors `maxSeats` in apps/web/src/lib/pricing.ts, which is what the pricing
 * page's seat stepper disables against. Keep the two in sync: the web value
 * decides what a visitor can *ask* for, this one decides what we'll *honour*.
 */
export const PLAN_MEMBER_CAP: Record<BillingTier, number> = {
  starter: 2,
  pro: 50,
  team: 50,
};

export interface CallerPlan {
  /** Subscription is live (or the team is flagged internal/complimentary). */
  isActive: boolean;
  /** Pro *or* Team — the gate for paid features generally. */
  isPro: boolean;
  /** Team specifically — the gate for unlimited-tier allowances. */
  isTeam: boolean;
  tier: BillingTier;
}

/**
 * Real team billing (teams.plan / subscription_status / is_internal) —
 * replaces the old per-user `subscriptions` table, which was never wired to
 * Stripe and doesn't exist on the live database.
 *
 * Mirrors the client-side `useSubscription` hook: an internal team is treated
 * as active Team tier regardless of its raw `plan` column, so complimentary
 * accounts get full access rather than merely bypassing the paywall.
 */
export async function getCallerTeamPlan(
  supabase: AuthedContext["supabase"],
  userId: string,
): Promise<CallerPlan> {
  const { data: membership } = await supabase
    .from("team_members" as any)
    .select("team_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return { isActive: false, isPro: false, isTeam: false, tier: "starter" };

  const { data: team } = await supabase
    .from("teams" as any)
    .select("plan, subscription_status, is_internal")
    .eq("id", (membership as any).team_id)
    .maybeSingle();

  const isInternal = !!(team as any)?.is_internal;
  const isActive = isInternal || (team as any)?.subscription_status === "active";
  const rawPlan = (team as any)?.plan as string | undefined;
  const tier: BillingTier = isInternal
    ? "team"
    : rawPlan === "pro" || rawPlan === "team"
      ? rawPlan
      : "starter";

  return {
    isActive,
    isPro: isActive && (tier === "pro" || tier === "team"),
    isTeam: isActive && tier === "team",
    tier,
  };
}
