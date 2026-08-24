import { z } from "zod";
import type Stripe from "stripe";
import { getSupabaseAdmin } from "../../lib/supabase";
import { getStripe, planToPriceId, type BillingPlan, type BillingInterval } from "../../lib/stripe";
import { PLAN_MEMBER_CAP } from "../../lib/team-plan";
import { can } from "@everlumen/shared/team-permissions";
import type { ServiceContext } from "../../lib/user-context";

const PLAN_VALUES = ["starter", "pro", "team"] as const;

/** Free trial granted on every new subscription, all tiers. */
const TRIAL_DAYS = 14;

export const createCheckoutSessionInputSchema = z.object({
  plan: z.enum(PLAN_VALUES),
  origin: z.string().url(),
  interval: z.enum(["monthly", "annual"]).default("monthly"),
  // Outer sanity bound only. The real ceiling is PLAN_MEMBER_CAP, checked
  // per-plan below, because it differs by tier.
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
  /*
   * Owner OR Admin, per section 4 of the Team Management spec, which gives
   * Admin `billing: yes`. It was owner-only, so an Admin held a capability the
   * server refused - the kind of mismatch that shows up as a button that 403s.
   *
   * This is the widening worth being deliberate about: it is the Stripe portal,
   * where a subscription can be changed or cancelled. Nothing else in this
   * change touches money. If you want billing kept to the owner alone, this
   * single condition is the place to narrow it, and the matrix entry for
   * `admin -> billing` in packages/shared/src/team-permissions.ts is the
   * other half.
   */
  if (!can((membership as any).role, "billing")) {
    throw Object.assign(new Error("Only the team owner or an admin can manage billing."), {
      status: 403,
    });
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
  // The pricing page disables the stepper past each tier's cap, but this RPC
  // is callable directly - without this a caller could buy 40 seats of Starter
  // and land on a subscription the invite flow (PLAN_MEMBER_CAP) then refuses
  // to honour, i.e. paid-for seats that can never be filled.
  const seatCap = PLAN_MEMBER_CAP[data.plan as BillingPlan];
  if (data.seats > seatCap) {
    throw new Error(
      `The ${data.plan} plan holds up to ${seatCap} user${seatCap === 1 ? "" : "s"}. ` +
        `Choose a higher plan for a crew of ${data.seats}.`,
    );
  }

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
    metadata: {
      team_id: team.id,
      plan: data.plan,
      interval: data.interval,
      seats: String(data.seats),
    },
    subscription_data: {
      // Every tier advertises the same free trial on /pricing - keep this in
      // sync with TRIAL_DAYS in apps/web/src/lib/pricing.ts.
      trial_period_days: TRIAL_DAYS,
      metadata: {
        team_id: team.id,
        plan: data.plan,
        interval: data.interval,
        seats: String(data.seats),
      },
    },
    // Our products don't have a Stripe tax_code assigned, which Managed
    // Payments (on by default for this account) requires. Disable it for
    // this session rather than guessing a tax category - this SDK version
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
    // 409, not a bare Error. `jsonFromUnknownError` only forwards a message for
    // 4xx; without a status this reached the customer as a generic 500
    // "internal_error" and reached the audit log as one too, which is how a
    // precondition someone can act on became indistinguishable from a crash.
    throw Object.assign(new Error("No billing account yet - subscribe to a plan first."), {
      status: 409,
    });
  }

  const stripe = getStripe();
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: team.stripe_customer_id,
      return_url: `${data.origin}/settings`,
    });
    return { url: session.url };
  } catch (e: any) {
    /*
     * `resource_missing` here means the STRIPE_SECRET_KEY this process is
     * holding cannot see this customer - the customer was deleted, or the key
     * belongs to a different Stripe account than the one that created them.
     *
     * That second case is not hypothetical and it is invisible from the
     * outside: every stored `stripe_customer_id` stays syntactically valid, so
     * the failure looks like a random 500 on one button rather than like a
     * misconfigured key. Naming it costs one branch and saves the next person
     * the investigation.
     */
    if (e?.code === "resource_missing" || e?.raw?.code === "resource_missing") {
      throw new Error(
        `Stripe does not recognise this team's customer id (${team.stripe_customer_id}). ` +
          "The STRIPE_SECRET_KEY in use may belong to a different Stripe account than the one " +
          "holding this customer. Check the key before changing any data.",
      );
    }
    throw e;
  }
}
