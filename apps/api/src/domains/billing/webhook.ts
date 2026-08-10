import type Stripe from "stripe";
import { getSupabaseAdmin } from "../../lib/supabase";
import { getStripe, priceIdToPlan, requireStripeWebhookSecret } from "../../lib/stripe";
import { insertNotification } from "../notifications/service";

type TeamLookup = { column: "stripe_subscription_id" | "stripe_customer_id"; value: string };

type BillingTeam = {
  id: string;
  owner_id: string;
  plan: string;
  subscription_status: string;
};

/** Statuses a successful payment is allowed to clear back to `active`. */
const DUNNING_STATUSES = new Set(["past_due", "unpaid", "incomplete"]);

/**
 * Dedupe window for the "payment failed" notice. Wide enough to swallow
 * Stripe's webhook redelivery window (it retries a failed delivery for up to
 * 3 days), narrow enough that a genuinely new retry failure days later still
 * reaches the owner.
 */
const DUNNING_NOTICE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** Trial-ending notice fires once, 3 days out — one per trial is plenty. */
const TRIAL_NOTICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function updateTeamByLookup(lookup: TeamLookup, patch: Record<string, unknown>) {
  const { error } = await getSupabaseAdmin()
    .from("teams" as any)
    .update(patch)
    .eq(lookup.column, lookup.value);
  if (error) console.error("[billing webhook] failed to update team", lookup, error);
}

/** Stripe expands some refs and not others depending on the event. */
function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

async function findTeam(lookup: TeamLookup): Promise<BillingTeam | null> {
  const { data } = await getSupabaseAdmin()
    .from("teams" as any)
    .select("id, owner_id, plan, subscription_status")
    .eq(lookup.column, lookup.value)
    .maybeSingle();
  return (data ?? null) as BillingTeam | null;
}

/**
 * Resolve the team an invoice belongs to. Prefer the subscription id, but fall
 * back to the customer — `teams.stripe_subscription_id` is only written by
 * checkout.session.completed, so a subscription created any other way (Stripe
 * dashboard, a plan swapped in the billing portal) may not be on the row yet.
 * Both columns carry unique indexes, so either lookup is single-valued.
 */
async function findTeamForInvoice(
  invoice: Stripe.Invoice,
): Promise<{ team: BillingTeam; lookup: TeamLookup } | null> {
  const subscriptionId = idOf(invoice.subscription);
  if (subscriptionId) {
    const lookup: TeamLookup = { column: "stripe_subscription_id", value: subscriptionId };
    const team = await findTeam(lookup);
    if (team) return { team, lookup };
  }
  const customerId = idOf(invoice.customer);
  if (customerId) {
    const lookup: TeamLookup = { column: "stripe_customer_id", value: customerId };
    const team = await findTeam(lookup);
    if (team) return { team, lookup };
  }
  return null;
}

function formatAmount(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

/*
 * Notify the team owner, at most once per window.
 *
 * Stripe redelivers on any non-2xx and can deliver the same event twice, so
 * every handler here must be safe to run repeatedly. `notifications` has no
 * unique key to lean on and its `entity_id` is a uuid column — a Stripe id
 * cannot go in it — so the dedupe is a lookback on (recipient, type, title).
 * `admin_announcement` is likewise the only type the table's CHECK constraint
 * allows for a message that isn't hung off a task/checklist/comment/invite.
 */
async function notifyOwnerOnce(team: BillingTeam, title: string, body: string, withinMs: number) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: recent } = await supabaseAdmin
    .from("notifications" as any)
    .select("id")
    .eq("recipient_id", team.owner_id)
    .eq("type", "admin_announcement")
    .eq("title", title)
    .gte("created_at", new Date(Date.now() - withinMs).toISOString())
    .limit(1)
    .maybeSingle();
  if (recent) return;

  await insertNotification(supabaseAdmin, {
    recipientId: team.owner_id,
    actorId: null,
    type: "admin_announcement",
    title,
    body,
    linkPath: "/settings",
  });
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

/*
 * Dunning — a renewal charge failed.
 *
 * Deliberately does NOT touch `plan`. Stripe keeps retrying the card on its
 * own schedule for the whole retry window and only fires
 * customer.subscription.deleted once it gives up; that window IS the grace
 * period, so the tier and the seat cap it implies (teams.member_limit, synced
 * from plan by teams_sync_member_limit_trg) survive the failure and are back
 * the instant a retry succeeds. Downgrading here would evict members over a
 * card that expired.
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const found = await findTeamForInvoice(invoice);
  if (!found) {
    console.error("[billing webhook] invoice.payment_failed for unknown team", invoice.id);
    return;
  }
  const { team, lookup } = found;

  if (team.subscription_status !== "past_due") {
    await updateTeamByLookup(lookup, { subscription_status: "past_due" });
  }

  const retryAt = invoice.next_payment_attempt
    ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      })
    : null;
  await notifyOwnerOnce(
    team,
    "Payment failed — update your card",
    `We couldn't charge ${formatAmount(invoice.amount_due, invoice.currency)} for your ${team.plan} plan. ` +
      (retryAt
        ? `We'll try again on ${retryAt} — update your payment method in Settings to avoid losing access.`
        : `Update your payment method in Settings to keep your team's access.`),
    DUNNING_NOTICE_WINDOW_MS,
  );
}

/*
 * Recovery. customer.subscription.updated also reports this, but ordering
 * between the two events isn't guaranteed, so clear the dunning state here
 * too. Gated on the stored status so the very first invoice of a subscription
 * (already `active`) and $0 trial invoices (`trialing`) fall straight through
 * without a spurious "payment received" notice.
 */
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const found = await findTeamForInvoice(invoice);
  if (!found) return;
  const { team, lookup } = found;
  if (!DUNNING_STATUSES.has(team.subscription_status)) return;

  await updateTeamByLookup(lookup, { subscription_status: "active" });
  await notifyOwnerOnce(
    team,
    "Payment received — your subscription is active",
    `Thanks — ${formatAmount(invoice.amount_paid, invoice.currency)} was received and your ${team.plan} plan is active again.`,
    DUNNING_NOTICE_WINDOW_MS,
  );
}

/*
 * Every checkout starts a TRIAL_DAYS trial (billing/service.ts), so this event
 * does fire for real customers. Stripe sends it once, 3 days out.
 */
async function handleTrialWillEnd(subscription: Stripe.Subscription) {
  const team = await findTeam({ column: "stripe_subscription_id", value: subscription.id });
  if (!team) return;

  const endsAt = subscription.trial_end
    ? new Date(subscription.trial_end * 1000).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      })
    : null;
  await notifyOwnerOnce(
    team,
    "Your free trial ends soon",
    endsAt
      ? `Your ${team.plan} trial ends on ${endsAt} and the card on file will be charged. Manage or cancel in Settings.`
      : `Your ${team.plan} trial is ending and the card on file will be charged. Manage or cancel in Settings.`,
    TRIAL_NOTICE_WINDOW_MS,
  );
}

/*
 * The Stripe endpoint is subscribed to an explicit event list, not "all
 * events" (docs/ops.md §5.2), so adding a `case` here is only half the change:
 * until the endpoint at Dashboard → Developers → Webhooks also lists
 * `invoice.payment_failed`, `invoice.paid` and
 * `customer.subscription.trial_will_end`, Stripe never delivers them and the
 * dunning handlers below are dead code. Keep this list and ops.md in step.
 */
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
    case "customer.subscription.trial_will_end":
      await handleTrialWillEnd(event.data.object as Stripe.Subscription);
      break;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    case "invoice.paid":
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;
    default:
      break;
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}
