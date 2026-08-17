import type { AuthedContext } from "./user-context";

export type BillingTier = "starter" | "pro" | "team";

/**
 * Hard seat ceiling per tier - what actually blocks invites (teams/service.ts)
 * and what checkout refuses to sell beyond (billing/service.ts).
 *
 * Mirrors `maxSeats` in apps/web/src/lib/pricing.ts, which is what the pricing
 * page's seat stepper disables against. Keep the two in sync: the web value
 * decides what a visitor can *ask* for, this one decides what we'll *honour*.
 *
 * Pro and Team are sold as "add as many users as you want", so their number is
 * UNLIMITED_SEATS (999) from pricing.ts rather than a real ceiling. It stays a
 * number on purpose: every seat is still billed, and an unbounded quantity
 * turns one mis-typed crew size into a five-figure invoice. Written as a
 * literal here so this file has no cross-app import.
 */
export const PLAN_MEMBER_CAP: Record<BillingTier, number> = {
  starter: 2,
  pro: 999,
  team: 999,
};

/**
 * `teams.subscription_status` values that grant paid access.
 *
 * This is the single definition of "is this team allowed in", and getting the
 * set wrong is expensive in both directions - too narrow locks out paying
 * customers, too wide gives the product away.
 *
 * - `active`   - paid and current.
 * - `trialing` - **every** checkout starts a trial (see TRIAL_DAYS in
 *   billing/service.ts), so this is the status of every new customer for their
 *   first days. Omitting it locked out each one for the whole trial they had
 *   just signed up for.
 * - `past_due` - a renewal charge failed and Stripe is still retrying on its
 *   own schedule. That retry window *is* the grace period: Stripe fires
 *   `customer.subscription.deleted` only once it gives up, and that is what
 *   ends access. Treating `past_due` as inactive turned an expired card into an
 *   instant total lockout, which is the opposite of the dunning flow in
 *   billing/webhook.ts.
 *
 * Everything else is denied, including Stripe's `unpaid`, `canceled`,
 * `incomplete`, `incomplete_expired`, `paused`, and this column's own default
 * of `inactive`. Deny is the safe default here: an unrecognised status must
 * never fall through to access.
 *
 * Mirrored client-side by `useSubscription` in
 * apps/web/src/hooks/use-subscription.tsx - keep the two in sync, or the UI
 * hides features the server would happily serve.
 */
export const ACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
]);

export interface CallerPlan {
  /** Subscription is live (or the team is flagged internal/complimentary). */
  isActive: boolean;
  /** Pro *or* Team - the gate for paid features generally. */
  isPro: boolean;
  /** Team specifically - the gate for unlimited-tier allowances. */
  isTeam: boolean;
  tier: BillingTier;
}

/**
 * Real team billing (teams.plan / subscription_status / is_internal) -
 * replaces the old per-user `subscriptions` table, which was never wired to
 * Stripe and doesn't exist on the live database.
 *
 * Mirrors the client-side `useSubscription` hook: an internal team is treated
 * as active Team tier regardless of its raw `plan` column, so complimentary
 * accounts get full access rather than merely bypassing the paywall.
 */
/**
 * Server-side gate for a Team-tier feature.
 *
 * The client hides these behind `useSubscription().isTeam`, but a hidden button
 * is not enforcement - the RPC stays reachable with a hand-made request, so a
 * Starter account could use a feature it never paid for. Any write that is
 * *sold* as Team-only needs this on the server as well as in the UI.
 */
export async function requireTeamPlan(
  ctx: { supabase: AuthedContext["supabase"]; userId: string },
  feature: string,
): Promise<void> {
  const plan = await getCallerTeamPlan(ctx.supabase, ctx.userId);
  if (!plan.isTeam) {
    throw Object.assign(new Error(`${feature} requires the Team plan.`), { status: 403 });
  }
}

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
  const isActive =
    isInternal || ACTIVE_SUBSCRIPTION_STATUSES.has((team as any)?.subscription_status);
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
