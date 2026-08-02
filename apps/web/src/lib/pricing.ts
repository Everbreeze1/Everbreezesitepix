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
  features: string[];
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
    features: [
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
    features: [
      "Everything in Starter",
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
    features: [
      "Everything in Pro",
      "Workflows",
      "Project blueprints",
      "Advanced roles & permissions",
      "Unlimited Auto Reports",
      "Highest storage",
    ],
  },
];

/** Highest seat count any plan can hold — the stepper's ceiling. */
export const MAX_SEATS = Math.max(...PLANS.map((p) => p.maxSeats));

/**
 * A monthly figure adjusted for the billing interval. Annual is quoted as an
 * equivalent monthly rate (what CompanyCam and most SaaS pricing pages show),
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
