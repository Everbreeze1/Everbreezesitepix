import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
import { getStripe } from "../../lib/stripe";
import { logAdminAction } from "./audit";
import type { AuthedContext } from "../../lib/user-context";

/*
 * Billing operations beyond "ask Stripe what the status is".
 *
 * syncTeamBilling could re-pull a subscription and nothing else, so every other
 * billing question - comp a team, extend a trial, cancel for someone who
 * emailed asking, find out whether a paid plan was ever actually paid for - was
 * a trip to the Stripe dashboard plus a hand-written UPDATE against `teams`.
 * Hand-written UPDATEs against `teams` are how the paywall hole in LAUNCH.md
 * 1.0a stayed invisible for as long as it did.
 */

const reasonSchema = z.string().trim().min(3).max(500);

export interface TeamBillingDetail {
  teamId: string;
  plan: string;
  subscriptionStatus: string;
  isInternal: boolean;
  memberLimit: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** Null when the team has no Stripe subscription, or Stripe could not be reached. */
  stripe: {
    status: string;
    quantity: number | null;
    currentPeriodEnd: string | null;
    trialEnd: string | null;
    cancelAtPeriodEnd: boolean;
    priceId: string | null;
    unavailableReason?: string;
  } | null;
  invoices: Array<{
    id: string;
    number: string | null;
    status: string | null;
    amountDue: number;
    amountPaid: number;
    currency: string;
    created: string;
    hostedUrl: string | null;
  }>;
}

export const getTeamBillingInputSchema = z.object({ teamId: z.string().uuid() });

export async function getTeamBillingService(
  ctx: AuthedContext,
  data: z.infer<typeof getTeamBillingInputSchema>,
): Promise<TeamBillingDetail> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const { data: team, error } = await (admin as any)
    .from("teams")
    .select(
      "id, plan, subscription_status, is_internal, member_limit, stripe_customer_id, stripe_subscription_id",
    )
    .eq("id", data.teamId)
    .single();
  if (error || !team) throw new Error("Team not found");

  let stripeInfo: TeamBillingDetail["stripe"] = null;
  let invoices: TeamBillingDetail["invoices"] = [];

  /*
   * Stripe is a third party on the far side of the network. It failing must
   * degrade this panel, never break the page: the local columns above are the
   * ones the paywall actually reads, and an operator needs to see them most
   * urgently precisely when Stripe is having a bad day.
   */
  if (team.stripe_subscription_id || team.stripe_customer_id) {
    try {
      const stripe = getStripe();
      if (team.stripe_subscription_id) {
        const sub = await stripe.subscriptions.retrieve(team.stripe_subscription_id);
        const item = sub.items.data[0];
        stripeInfo = {
          status: sub.status,
          quantity: item?.quantity ?? null,
          currentPeriodEnd: (item as any)?.current_period_end
            ? new Date((item as any).current_period_end * 1000).toISOString()
            : null,
          trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          priceId: item?.price?.id ?? null,
        };
      }
      if (team.stripe_customer_id) {
        const list = await stripe.invoices.list({ customer: team.stripe_customer_id, limit: 12 });
        invoices = list.data.map((inv) => ({
          id: inv.id ?? "",
          number: inv.number ?? null,
          status: inv.status ?? null,
          amountDue: inv.amount_due ?? 0,
          amountPaid: inv.amount_paid ?? 0,
          currency: inv.currency ?? "usd",
          created: new Date((inv.created ?? 0) * 1000).toISOString(),
          hostedUrl: inv.hosted_invoice_url ?? null,
        }));
      }
    } catch (e: any) {
      stripeInfo = {
        status: "unknown",
        quantity: null,
        currentPeriodEnd: null,
        trialEnd: null,
        cancelAtPeriodEnd: false,
        priceId: null,
        unavailableReason: e?.message ?? "Stripe could not be reached.",
      };
    }
  }

  return {
    teamId: team.id,
    plan: team.plan,
    subscriptionStatus: team.subscription_status,
    isInternal: team.is_internal,
    memberLimit: team.member_limit ?? null,
    stripeCustomerId: team.stripe_customer_id,
    stripeSubscriptionId: team.stripe_subscription_id,
    stripe: stripeInfo,
    invoices,
  };
}

export const overrideTeamPlanInputSchema = z.object({
  teamId: z.string().uuid(),
  plan: z.enum(["starter", "pro", "team"]).optional(),
  /** Complimentary access. Bypasses the subscription check entirely. */
  isInternal: z.boolean().optional(),
  reason: reasonSchema,
});

/**
 * Set a team's plan or comp them, without touching Stripe.
 *
 * This writes exactly the columns the paywall reads, which is the reason it is
 * fenced this heavily: `requirePlatformAdmin`, a mandatory reason, and an audit
 * row recording the before and after. The same write from a browser was a live
 * vulnerability (LAUNCH.md 1.0a) until `authenticated` lost its UPDATE grant;
 * the capability still has to exist for support, so it exists here, once,
 * where it is logged.
 *
 * Deliberately does NOT reach into Stripe. Comping a team is a decision about
 * access, not about billing, and a well-meaning cancel-and-comp that also
 * refunds is not recoverable from this screen.
 */
export async function overrideTeamPlanService(
  ctx: AuthedContext,
  data: z.infer<typeof overrideTeamPlanInputSchema>,
): Promise<{ ok: true; plan: string; isInternal: boolean }> {
  await requirePlatformAdmin(ctx.userId, "billing");
  const admin = getSupabaseAdmin();

  if (data.plan === undefined && data.isInternal === undefined) {
    throw new Error("Nothing to change: pass a plan, a complimentary flag, or both.");
  }

  const { data: before, error: beforeError } = await (admin as any)
    .from("teams")
    .select("id, plan, is_internal, subscription_status")
    .eq("id", data.teamId)
    .single();
  if (beforeError || !before) throw new Error("Team not found");

  const patch: Record<string, unknown> = {};
  if (data.plan !== undefined) patch.plan = data.plan;
  if (data.isInternal !== undefined) patch.is_internal = data.isInternal;

  const { error } = await (admin as any).from("teams").update(patch).eq("id", data.teamId);
  if (error) throw new Error(error.message);

  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: "override_team_plan",
    targetType: "team",
    targetId: data.teamId,
    metadata: {
      reason: data.reason,
      before: { plan: before.plan, isInternal: before.is_internal },
      after: {
        plan: data.plan ?? before.plan,
        isInternal: data.isInternal ?? before.is_internal,
      },
    },
  });

  return {
    ok: true,
    plan: (data.plan ?? before.plan) as string,
    isInternal: (data.isInternal ?? before.is_internal) as boolean,
  };
}

export const manageTeamSubscriptionInputSchema = z.object({
  teamId: z.string().uuid(),
  action: z.enum(["cancel_at_period_end", "resume", "cancel_now", "extend_trial"]),
  /** Days to add. Only read for extend_trial. */
  trialDays: z.number().int().min(1).max(90).optional(),
  reason: reasonSchema,
});

/**
 * The Stripe-side subscription actions, as opposed to the local override above.
 *
 * `cancel_at_period_end` and `resume` are the pair worth having: a customer who
 * emails "please cancel" almost always means "at the end of what I paid for",
 * and being able to undo it when they change their mind two days later is the
 * difference between a support action and a refund conversation.
 *
 * The local `teams` row is left to the webhook, which is the single writer for
 * subscription state. Writing both here would race it, and the webhook would
 * win at an unpredictable moment.
 */
export async function manageTeamSubscriptionService(
  ctx: AuthedContext,
  data: z.infer<typeof manageTeamSubscriptionInputSchema>,
): Promise<{ ok: true; status: string; message: string }> {
  await requirePlatformAdmin(ctx.userId, "billing");
  const admin = getSupabaseAdmin();

  const { data: team, error } = await (admin as any)
    .from("teams")
    .select("id, name, stripe_subscription_id")
    .eq("id", data.teamId)
    .single();
  if (error || !team) throw new Error("Team not found");
  if (!team.stripe_subscription_id) {
    throw new Error(
      "This team has no Stripe subscription. To change their access, use the plan override instead.",
    );
  }

  const stripe = getStripe();
  let status: string;
  let message: string;

  switch (data.action) {
    case "cancel_at_period_end": {
      const sub = await stripe.subscriptions.update(team.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
      status = sub.status;
      message = "Will cancel at the end of the current period. Access continues until then.";
      break;
    }
    case "resume": {
      const sub = await stripe.subscriptions.update(team.stripe_subscription_id, {
        cancel_at_period_end: false,
      });
      status = sub.status;
      message = "Cancellation withdrawn. The subscription will renew as normal.";
      break;
    }
    case "cancel_now": {
      const sub = await stripe.subscriptions.cancel(team.stripe_subscription_id);
      status = sub.status;
      message = "Cancelled immediately. The webhook will revoke access shortly.";
      break;
    }
    case "extend_trial": {
      const days = data.trialDays ?? 14;
      const current = await stripe.subscriptions.retrieve(team.stripe_subscription_id);
      // Extend from whichever is later: an existing trial end, or now. Adding
      // days to a trial that ended last month would set a date in the past and
      // silently do nothing.
      const base = Math.max(current.trial_end ?? 0, Math.floor(Date.now() / 1000));
      const sub = await stripe.subscriptions.update(team.stripe_subscription_id, {
        trial_end: base + days * 24 * 60 * 60,
        proration_behavior: "none",
      });
      status = sub.status;
      message = `Trial extended by ${days} days.`;
      break;
    }
  }

  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: `subscription_${data.action}`,
    targetType: "team",
    targetId: data.teamId,
    metadata: { reason: data.reason, status, trialDays: data.trialDays ?? null },
  });

  return { ok: true, status, message };
}

export interface BillingReconciliation {
  /** Paid plan in our database, no Stripe subscription id. The paywall-hole signature. */
  paidWithoutSubscription: Array<{
    id: string;
    name: string;
    plan: string;
    subscriptionStatus: string;
    isInternal: boolean;
    createdAt: string;
  }>;
  /** Marked active locally but Stripe disagrees, or the subscription is gone. */
  statusMismatch: Array<{
    id: string;
    name: string;
    localStatus: string;
    stripeStatus: string;
    plan: string;
  }>;
  checkedAgainstStripe: number;
  stripeError: string | null;
}

/**
 * The query LAUNCH.md 1.0a tells the owner to run once, as a permanent screen.
 *
 * For the length of the paywall hole, any signed-in user could PATCH their own
 * `teams` row to `plan: "team", subscription_status: "active"` from the
 * browser. The migration closed it; it did not identify who had already done
 * it, and a paid plan in the database is not evidence of a payment. That
 * question does not stop mattering after one look, so it lives here.
 *
 * `is_internal` teams are listed but flagged rather than hidden - a comped team
 * legitimately has no subscription, and quietly filtering them out would make
 * the report look cleaner than the data is.
 */
export async function getBillingReconciliationService(
  ctx: AuthedContext,
): Promise<BillingReconciliation> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const { data: teams, error } = await (admin as any)
    .from("teams")
    .select("id, name, plan, subscription_status, is_internal, stripe_subscription_id, created_at");
  if (error) throw new Error(error.message);
  const all = (teams as any[]) ?? [];

  const paidWithoutSubscription = all
    .filter((t) => t.plan !== "starter" && !t.stripe_subscription_id)
    .map((t) => ({
      id: t.id,
      name: t.name,
      plan: t.plan,
      subscriptionStatus: t.subscription_status,
      isInternal: !!t.is_internal,
      createdAt: t.created_at,
    }));

  const withSubs = all.filter((t) => t.stripe_subscription_id);
  const statusMismatch: BillingReconciliation["statusMismatch"] = [];
  let stripeError: string | null = null;
  let checked = 0;

  try {
    const stripe = getStripe();
    // Sequential, not a fan-out: this runs against every subscribed team and a
    // parallel burst is the fastest way to meet Stripe's rate limiter.
    for (const t of withSubs) {
      try {
        const sub = await stripe.subscriptions.retrieve(t.stripe_subscription_id);
        checked += 1;
        if (sub.status !== t.subscription_status) {
          statusMismatch.push({
            id: t.id,
            name: t.name,
            localStatus: t.subscription_status,
            stripeStatus: sub.status,
            plan: t.plan,
          });
        }
      } catch (e: any) {
        checked += 1;
        statusMismatch.push({
          id: t.id,
          name: t.name,
          localStatus: t.subscription_status,
          // A subscription id that Stripe no longer knows is the more alarming
          // half of this report, not an error to swallow.
          stripeStatus: e?.code === "resource_missing" ? "missing in Stripe" : "lookup failed",
          plan: t.plan,
        });
      }
    }
  } catch (e: any) {
    stripeError = e?.message ?? "Stripe could not be reached.";
  }

  return {
    paidWithoutSubscription,
    statusMismatch,
    checkedAgainstStripe: checked,
    stripeError,
  };
}
