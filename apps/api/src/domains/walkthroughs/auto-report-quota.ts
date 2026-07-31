import { getSupabaseAdmin } from "../../lib/supabase";
import { getCallerTeamPlan, type BillingTier } from "../../lib/team-plan";
import type { AuthedContext } from "../../lib/user-context";

/** Pro tier allowance: Auto Reports per user per calendar month. Team is unlimited. */
export const PRO_AUTO_REPORTS_PER_MONTH = 100;

export interface AutoReportQuota {
  tier: BillingTier;
  used: number;
  /** `Infinity` on Team — unlimited. */
  limit: number;
  remaining: number;
}

/** Start of the current UTC calendar month — the window the quota resets on. */
function monthStart(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Month-to-date Auto Report usage for a user. Counted with the service role so
 * the number is authoritative regardless of the caller's RLS view.
 */
export async function getAutoReportQuota(
  supabase: AuthedContext["supabase"],
  userId: string,
): Promise<AutoReportQuota> {
  const plan = await getCallerTeamPlan(supabase, userId);
  const limit = plan.isTeam
    ? Number.POSITIVE_INFINITY
    : plan.isPro
      ? PRO_AUTO_REPORTS_PER_MONTH
      : 0;

  const { count } = await getSupabaseAdmin()
    .from("auto_report_generations" as any)
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId)
    .gte("created_at", monthStart());

  const used = count ?? 0;
  return {
    tier: plan.tier,
    used,
    limit,
    remaining: limit === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(0, limit - used),
  };
}

/**
 * Throws unless the caller may generate another Auto Report right now.
 * Call *before* spending an LLM request.
 */
export async function assertAutoReportAllowed(
  supabase: AuthedContext["supabase"],
  userId: string,
): Promise<AutoReportQuota> {
  const quota = await getAutoReportQuota(supabase, userId);
  if (quota.limit === 0) {
    throw new Error(
      "Auto Reports are a Pro and Team feature. Upgrade your plan to generate reports from walkthroughs.",
    );
  }
  if (quota.remaining <= 0) {
    throw new Error(
      `You've used all ${PRO_AUTO_REPORTS_PER_MONTH} Auto Reports included with Pro this month. ` +
        "Upgrade to Team for unlimited Auto Reports, or wait until your quota resets next month.",
    );
  }
  return quota;
}

/**
 * Records one consumed Auto Report. Best-effort: a ledger write failure must
 * never discard a report the user already waited for and that is already saved
 * to the walkthrough — the cost of under-counting one generation is far lower
 * than handing back an error for work that actually succeeded.
 */
export async function recordAutoReportGeneration(
  walkthroughId: string,
  userId: string,
  tier: BillingTier,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("auto_report_generations" as any)
    .insert({ walkthrough_id: walkthroughId, created_by: userId, plan: tier });
  if (error) {
    console.warn("[walkthrough] failed to record Auto Report usage", {
      walkthroughId,
      userId,
      error: error.message,
    });
  }
}
