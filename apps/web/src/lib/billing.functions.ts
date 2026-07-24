import { rpcOp } from "./sitepix-api";

export type BillingPlan = "starter" | "pro" | "team";

export const createCheckoutSession = rpcOp<
  { plan: BillingPlan; origin: string },
  { url: string }
>("createCheckoutSession", { idempotent: true });

export const createBillingPortalSession = rpcOp<{ origin: string }, { url: string }>(
  "createBillingPortalSession",
);
