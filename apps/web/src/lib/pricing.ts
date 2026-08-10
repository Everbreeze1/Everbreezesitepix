import type { BillingPlan } from "@/features/teams/api";

export type BillingInterval = "monthly" | "annual";

/** Annual billing is 20% off the monthly rate. */
export const ANNUAL_DISCOUNT = 0.2;

/** Every tier starts with the same no-card-required trial. */
export const TRIAL_DAYS = 14;

export interface PlanPricing {
  id: BillingPlan;
  name: string;
  audience: string;
  tagline: string;
  /** Monthly base price, covering `includedSeats`. */
  basePriceMonthly: number;
  includedSeats: number;
  /** Monthly price for each seat beyond `includedSeats`. */
  additionalSeatMonthly: number;
  /**
   * Hard seat ceiling. Mirrors PLAN_MEMBER_CAP in
   * apps/api/src/domains/teams/service.ts, which is what actually blocks
   * invites — a plan can't be sold for more seats than it can hold.
   */
  maxSeats: number;
  /**
   * What this tier adds over the one below it — NOT its full feature list.
   *
   * Stored as a delta so "what am I missing by staying on Starter?" is a real
   * computation (`gainsBetween`) rather than a hardcoded "Everything in X"
   * string that can drift out of sync with the list beneath it.
   */
  adds: string[];
}

export const PLANS: PlanPricing[] = [
  {
    id: "starter",
    name: "Starter",
    audience: "For Solo & Small Teams",
    tagline: "Document every job so nothing gets lost, disputed, or forgotten.",
    basePriceMonthly: 24,
    includedSeats: 1,
    additionalSeatMonthly: 15,
    maxSeats: 2,
    adds: [
      "Photo & video capture",
      "Basic project management",
      "Tags & labels",
      "Manual reports",
      "Share links",
      "Offline mode",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    audience: "For Growing Teams",
    tagline: "Coordinate crews without constant calls, texts, and check-ins.",
    basePriceMonthly: 119,
    includedSeats: 3,
    additionalSeatMonthly: 29,
    maxSeats: 50,
    adds: [
      "Company watermark",
      "Walkthroughs + 100 Auto Reports/mo",
      "AI-assisted Site Logs",
      "Full checklists & templates",
      "Map view",
      "Tasks on photos",
    ],
  },
  {
    id: "team",
    name: "Team",
    audience: "For Multi-Crew Operations",
    tagline: "Improve margins and reduce rework as you grow.",
    basePriceMonthly: 179,
    includedSeats: 3,
    additionalSeatMonthly: 39,
    maxSeats: 50,
    adds: [
      "Workflows",
      "Project blueprints",
      // The Portfolio lock screen sends people here with "See Team plan", and
      // this list is what they land on — it named every other Team feature
      // except the one they clicked for.
      "Portfolio site + website embeds",
      "Advanced roles & permissions",
      "Unlimited Auto Reports",
      "Highest storage",
    ],
  },
];

/** Highest seat count any plan can hold — the stepper's ceiling. */
export const MAX_SEATS = Math.max(...PLANS.map((p) => p.maxSeats));

/** Cheapest to richest. Index doubles as the tier rank. */
export const PLAN_ORDER: BillingPlan[] = PLANS.map((p) => p.id);

export function tierRank(id: BillingPlan): number {
  const i = PLAN_ORDER.indexOf(id);
  // An unrecognised/absent plan sorts below everything, so an inactive or
  // unknown subscription is treated as "nothing yet" and every tier reads as
  // an upgrade rather than accidentally hiding all of them.
  return i === -1 ? -1 : i;
}

export function planById(id: BillingPlan): PlanPricing | undefined {
  return PLANS.find((p) => p.id === id);
}

/**
 * The full feature list to show on a plan card: everything inherited from the
 * tiers below, rolled up as one line, followed by this tier's own additions.
 */
export function displayFeatures(plan: PlanPricing): string[] {
  const rank = tierRank(plan.id);
  if (rank <= 0) return plan.adds;
  return [`Everything in ${PLANS[rank - 1].name}`, ...plan.adds];
}

/**
 * Everything gained by moving from `from` up to `to` — the concrete answer to
 * "what am I missing out on?". Empty when `to` is not actually higher.
 */
export function gainsBetween(from: BillingPlan | null, to: BillingPlan): string[] {
  const fromRank = from ? tierRank(from) : -1;
  const toRank = tierRank(to);
  if (toRank <= fromRank) return [];
  return PLANS.slice(fromRank + 1, toRank + 1).flatMap((p) => p.adds);
}

/** Tiers strictly above the caller's current one — the real upgrade options. */
export function higherTiers(current: BillingPlan | null): PlanPricing[] {
  const rank = current ? tierRank(current) : -1;
  return PLANS.slice(rank + 1);
}

/**
 * A monthly figure adjusted for the billing interval. Annual is quoted as an
 * equivalent monthly rate (the convention on most SaaS pricing pages),
 * so `$24/mo` becomes `$19/mo billed annually` rather than `$228`.
 */
export function monthlyRate(monthly: number, interval: BillingInterval): number {
  return interval === "annual" ? Math.round(monthly * (1 - ANNUAL_DISCOUNT)) : monthly;
}

/** True when this plan physically can't seat the requested crew. */
export function exceedsSeatCap(plan: PlanPricing, seats: number): boolean {
  return seats > plan.maxSeats;
}

/**
 * What a crew of `seats` costs per month on this plan: the base price (which
 * already covers `includedSeats`) plus the per-seat rate for everyone beyond
 * that. Returns the monthly figure for the chosen interval — multiply by 12
 * for the annual total.
 */
export function monthlyTotal(plan: PlanPricing, seats: number, interval: BillingInterval): number {
  const base = monthlyRate(plan.basePriceMonthly, interval);
  const extraSeats = Math.max(0, seats - plan.includedSeats);
  return base + extraSeats * monthlyRate(plan.additionalSeatMonthly, interval);
}

/** Total charged up front on an annual subscription. */
export function annualTotal(plan: PlanPricing, seats: number): number {
  return monthlyTotal(plan, seats, "annual") * 12;
}
