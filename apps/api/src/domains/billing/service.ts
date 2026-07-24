import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { getStripe, planToPriceId, type BillingPlan } from "../../lib/stripe";
import type { ServiceContext } from "../../lib/user-context";

const PLAN_VALUES = ["starter", "pro", "team"] as const;

export const createCheckoutSessionInputSchema = z.object({
  plan: z.enum(PLAN_VALUES),
  origin: z.string().url(),
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
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: planToPriceId(data.plan as BillingPlan), quantity: 1 }],
    success_url: `${data.origin}/settings?checkout=success`,
    cancel_url: `${data.origin}/pricing`,
    metadata: { team_id: team.id, plan: data.plan },
    subscription_data: {
      metadata: { team_id: team.id, plan: data.plan },
    },
  });

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
