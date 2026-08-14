import Stripe from "stripe";

/** Set via env - Railway project vars in production, apps/api/.env locally. */
export function requireStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return key;
}

export function requireStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  return secret;
}

let _stripe: Stripe | undefined;

/** Server-only Stripe client - never ship the secret key to browsers. */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  _stripe = new Stripe(requireStripeSecretKey());
  return _stripe;
}

export type BillingPlan = "starter" | "pro" | "team";
export type BillingInterval = "monthly" | "annual";

function requirePriceEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/**
 * Seat-based price IDs. Checkout sets `quantity` = total seat count, so each
 * Price MUST be configured in Stripe as **graduated tiered** pricing to match
 * what /pricing advertises (base price covers N seats, then a lower rate for
 * each additional seat). For Pro monthly that is:
 *
 *   Tier 1 - first 3 units:  flat fee $119, per-unit $0
 *   Tier 2 - 4 and above:    per-unit $29
 *
 * A plain flat per-unit Price is WRONG here: at quantity=5 it would bill
 * 5 x $119 = $595 instead of the advertised $119 + 2 x $29 = $177. The tier
 * boundaries and amounts must mirror `basePriceMonthly` / `includedSeats` /
 * `additionalSeatMonthly` in apps/web/src/lib/pricing.ts, with annual Prices
 * set to the same figures less the 20% ANNUAL_DISCOUNT.
 *
 * `_MONTHLY` env vars are optional and fall back to the original unsuffixed
 * `STRIPE_PRICE_<PLAN>` vars, so existing monthly checkout configured before
 * annual billing shipped keeps working unchanged. `_ANNUAL` vars are new and
 * required only when a customer actually picks annual billing - until real
 * annual Price objects are created in Stripe and these are set, annual
 * checkout will fail with a clear "Missing STRIPE_PRICE_<PLAN>_ANNUAL" error
 * rather than silently charging the wrong amount.
 */
export function planToPriceId(plan: BillingPlan, interval: BillingInterval = "monthly"): string {
  const key = plan.toUpperCase();
  if (interval === "annual") return requirePriceEnv(`STRIPE_PRICE_${key}_ANNUAL`);
  return process.env[`STRIPE_PRICE_${key}_MONTHLY`] ?? requirePriceEnv(`STRIPE_PRICE_${key}`);
}

export function priceIdToPlan(priceId: string | null | undefined): BillingPlan | null {
  if (!priceId) return null;
  for (const plan of ["starter", "pro", "team"] as const) {
    const key = plan.toUpperCase();
    if (
      priceId === process.env[`STRIPE_PRICE_${key}`] ||
      priceId === process.env[`STRIPE_PRICE_${key}_MONTHLY`] ||
      priceId === process.env[`STRIPE_PRICE_${key}_ANNUAL`]
    ) {
      return plan;
    }
  }
  return null;
}
