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

function requirePriceEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/** Monthly price IDs only — annual + per-seat pricing are a fast-follow. */
export function planToPriceId(plan: BillingPlan): string {
  switch (plan) {
    case "starter":
      return requirePriceEnv("STRIPE_PRICE_STARTER");
    case "pro":
      return requirePriceEnv("STRIPE_PRICE_PRO");
    case "team":
      return requirePriceEnv("STRIPE_PRICE_TEAM");
  }
}

export function priceIdToPlan(priceId: string | null | undefined): BillingPlan | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_TEAM) return "team";
  return null;
}
