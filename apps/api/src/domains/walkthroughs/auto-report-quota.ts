import { getSupabaseAdmin } from "../../lib/supabase";
import { getCallerTeamPlan, type BillingTier } from "../../lib/team-plan";
import type { AuthedContext } from "../../lib/user-context";

/** Pro tier allowance: Auto Reports per user per calendar month. Team is unlimited. */
export const PRO_AUTO_REPORTS_PER_MONTH = 100;

export interface AutoReportQuota {
  tier: BillingTier;
  used: number;
  /** `Infinity` on Team - unlimited. */
  limit: number;
  remaining: number;
}

/** Start of the current UTC calendar month - the window the quota resets on. */
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
 * Take the slot BEFORE spending the LLM request, then confirm it was really
 * available.
 *
 * `assertAutoReportAllowed` on its own is check-then-act with a 10-60 second
 * model call in the middle, so N concurrent requests all counted the same
 * `used` value, all passed, and all generated - a Pro account capped at 100
 * could run well past it just by clicking twice. Writing the ledger row first
 * and re-counting afterwards makes the row itself the reservation: whoever ends
 * up beyond the limit releases theirs and is refused.
 *
 * Returns the reservation id so the caller can release it if generation fails -
 * nobody should burn quota on a report they never received.
 */
export async function reserveAutoReport(
  supabase: AuthedContext["supabase"],
  walkthroughId: string,
  userId: string,
): Promise<{ quota: AutoReportQuota; reservationId: string | null }> {
  const quota = await assertAutoReportAllowed(supabase, userId);

  const { data: row, error } = await getSupabaseAdmin()
    .from("auto_report_generations" as any)
    .insert({ walkthrough_id: walkthroughId, created_by: userId, plan: quota.tier })
    .select("id")
    .single();

  // Ledger unavailable: let the generation through rather than block paid work
  // on a bookkeeping table. Under-counting one report beats refusing a report
  // the customer is entitled to - the same trade-off the old code made.
  if (error || !row) {
    console.warn("[walkthrough] failed to reserve Auto Report usage", {
      walkthroughId,
      userId,
      error: error?.message,
    });
    return { quota, reservationId: null };
  }

  // `auto_report_generations` is absent from the generated types, so the row
  // shape has to be asserted through `unknown` - same gap as elsewhere.
  const reservationId = (row as unknown as { id: string }).id;
  if (quota.limit !== Number.POSITIVE_INFINITY) {
    const after = await getAutoReportQuota(supabase, userId);
    if (after.used > quota.limit) {
      await releaseAutoReport(reservationId);
      throw new Error(
        `You've used all ${PRO_AUTO_REPORTS_PER_MONTH} Auto Reports included with Pro this month. ` +
          "Upgrade to Team for unlimited Auto Reports, or wait until your quota resets next month.",
      );
    }
  }

  return { quota, reservationId };
}

/** Hand a reserved slot back - generation failed, so it was never consumed. */
export async function releaseAutoReport(reservationId: string | null): Promise<void> {
  if (!reservationId) return;
  const { error } = await getSupabaseAdmin()
    .from("auto_report_generations" as any)
    .delete()
    .eq("id", reservationId);
  if (error) {
    console.warn("[walkthrough] failed to release Auto Report reservation", {
      reservationId,
      error: error.message,
    });
  }
}
