import Stripe from "stripe";

/** Set via env — Railway project vars in production, apps/api/.env locally. */
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

/** Server-only Stripe client — never ship the secret key to browsers. */
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
 * Per-seat price IDs (checkout sets `quantity` = seat count, so these must be
 * configured as per-unit Stripe Prices, not flat fees, for the seat stepper
 * on the pricing page to actually charge correctly).
 *
 * `_MONTHLY` env vars are optional and fall back to the original unsuffixed
 * `STRIPE_PRICE_<PLAN>` vars, so existing monthly checkout configured before
 * annual billing shipped keeps working unchanged. `_ANNUAL` vars are new and
 * required only when a customer actually picks annual billing — until real
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
