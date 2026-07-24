import type Stripe from "stripe";
import { getSupabaseAdmin } from "../../lib/supabase";
import { getStripe, priceIdToPlan, requireStripeWebhookSecret } from "../../lib/stripe";

async function updateTeamByLookup(
  lookup: { column: "stripe_subscription_id" | "stripe_customer_id"; value: string },
  patch: Record<string, unknown>,
) {
  const { error } = await getSupabaseAdmin()
    .from("teams" as any)
    .update(patch)
    .eq(lookup.column, lookup.value);
  if (error) console.error("[billing webhook] failed to update team", lookup, error);
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const teamId = session.metadata?.team_id;
  const plan = session.metadata?.plan;
  if (!teamId || !plan) {
    console.error("[billing webhook] checkout.session.completed missing metadata", session.id);
    return;
  }

  const { error } = await getSupabaseAdmin()
    .from("teams" as any)
    .update({
      plan,
      stripe_subscription_id: session.subscription as string | null,
      subscription_status: "active",
    })
    .eq("id", teamId);
  if (error) console.error("[billing webhook] failed to activate team", teamId, error);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const priceId = subscription.items.data[0]?.price?.id;
  const plan = priceIdToPlan(priceId);
  const patch: Record<string, unknown> = { subscription_status: subscription.status };
  if (plan) patch.plan = plan;

  await updateTeamByLookup({ column: "stripe_subscription_id", value: subscription.id }, patch);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  await updateTeamByLookup(
    { column: "stripe_subscription_id", value: subscription.id },
    { plan: "starter", subscription_status: "canceled" },
  );
}

export async function handleStripeWebhook(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ code: "bad_request", message: "Missing signature" }), {
      status: 400,
    });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, requireStripeWebhookSecret());
  } catch (err) {
    console.error("[billing webhook] signature verification failed", err);
    return new Response(JSON.stringify({ code: "bad_request", message: "Invalid signature" }), {
      status: 400,
    });
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}
