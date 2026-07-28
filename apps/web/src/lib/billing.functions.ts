import { rpcOp } from "./sitepix-api";

export type BillingPlan = "starter" | "pro" | "team";

export const createCheckoutSession = rpcOp<
  { plan: BillingPlan; origin: string; interval?: "monthly" | "annual"; seats?: number },
  { url: string }
>("createCheckoutSession", { idempotent: true });

export const createBillingPortalSession = rpcOp<{ origin: string }, { url: string }>(
  "createBillingPortalSession",
);
