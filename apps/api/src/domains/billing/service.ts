import { z } from "zod";
import type Stripe from "stripe";
import { getSupabaseAdmin } from "../../lib/supabase";
import { getStripe, planToPriceId, type BillingPlan, type BillingInterval } from "../../lib/stripe";
import type { ServiceContext } from "../../lib/user-context";

const PLAN_VALUES = ["starter", "pro", "team"] as const;

/** Free trial granted on every new subscription, all tiers. */
const TRIAL_DAYS = 14;

export const createCheckoutSessionInputSchema = z.object({
  plan: z.enum(PLAN_VALUES),
  origin: z.string().url(),
  interval: z.enum(["monthly", "annual"]).default("monthly"),
  seats: z.number().int().min(1).max(500).default(1),
});

export const createBillingPortalSessionInputSchema = z.object({
  origin: z.string().url(),
});

async function requireOwnedTeam(ctx: ServiceContext) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: membership } = await supabaseAdmin
    .from("team_members" as any)
    .select("team_id, role")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!membership) throw new Error("Create a team first.");
  if ((membership as any).role !== "owner") {
    throw new Error("Only the team owner can manage billing.");
  }

  const { data: team } = await supabaseAdmin
    .from("teams" as any)
    .select("id, name, stripe_customer_id")
    .eq("id", (membership as any).team_id)
    .single();
  if (!team) throw new Error("Team not found");
  return team as unknown as { id: string; name: string; stripe_customer_id: string | null };
}

async function ensureStripeCustomer(
  team: { id: string; stripe_customer_id: string | null },
  email: string | undefined,
) {
  if (team.stripe_customer_id) return team.stripe_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email,
    metadata: { team_id: team.id },
  });

  await getSupabaseAdmin()
    .from("teams" as any)
    .update({ stripe_customer_id: customer.id })
    .eq("id", team.id);

  return customer.id;
}

export async function createCheckoutSessionService(
  ctx: ServiceContext,
  data: z.infer<typeof createCheckoutSessionInputSchema>,
) {
  const team = await requireOwnedTeam(ctx);
  const email = (ctx.claims as any)?.email as string | undefined;
  const customerId = await ensureStripeCustomer(team, email);

  const stripe = getStripe();
  const priceId = planToPriceId(data.plan as BillingPlan, data.interval as BillingInterval);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: data.seats }],
    success_url: `${data.origin}/settings?checkout=success`,
    cancel_url: `${data.origin}/pricing`,
    metadata: { team_id: team.id, plan: data.plan, interval: data.interval, seats: String(data.seats) },
    subscription_data: {
      // Every tier advertises the same free trial on /pricing — keep this in
      // sync with TRIAL_DAYS in apps/web/src/lib/pricing.ts.
      trial_period_days: TRIAL_DAYS,
      metadata: { team_id: team.id, plan: data.plan, interval: data.interval, seats: String(data.seats) },
    },
    // Our products don't have a Stripe tax_code assigned, which Managed
    // Payments (on by default for this account) requires. Disable it for
    // this session rather than guessing a tax category — this SDK version
    // (17.x) predates the managed_payments param, hence the cast.
    managed_payments: { enabled: false },
  } as Stripe.Checkout.SessionCreateParams & { managed_payments: { enabled: boolean } });

  if (!session.url) throw new Error("Failed to create checkout session");
  return { url: session.url };
}

export async function createBillingPortalSessionService(
  ctx: ServiceContext,
  data: z.infer<typeof createBillingPortalSessionInputSchema>,
) {
  const team = await requireOwnedTeam(ctx);
  if (!team.stripe_customer_id) {
    throw new Error("No billing account yet — subscribe to a plan first.");
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: team.stripe_customer_id,
    return_url: `${data.origin}/settings`,
  });

  return { url: session.url };
}
