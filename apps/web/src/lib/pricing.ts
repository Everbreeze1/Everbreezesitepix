import type { BillingPlan } from "@/features/teams/api";

export type BillingInterval = "monthly" | "annual";

/** Annual billing is 20% off the monthly rate. */
export const ANNUAL_DISCOUNT = 0.2;

/** Every tier starts with the same no-card-required trial. */
export const TRIAL_DAYS = 14;

/**
 * The ceiling Pro and Team stop at. Enforced, but deliberately not advertised
 * (see `advertiseSeatCap`): a crew of 51 is an Enterprise conversation, not a
 * plan comparison.
 *
 * Mirrored by PLAN_MEMBER_CAP in apps/api/src/lib/team-plan.ts and by the
 * teams_sync_member_limit() trigger in supabase/migrations.
 */
export const SELF_SERVE_SEAT_CAP = 50;

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
   * invites - a plan can't be sold for more seats than it can hold.
   *
   */
  maxSeats: number;
  /**
   * Whether `maxSeats` belongs on the card.
   *
   * Starter's cap IS the offer - a crew of 3 has to know before they buy, and
   * it is the reason to look at Pro. Pro and Team stop at 50 as well, but that
   * number is an operational limit rather than a product boundary: nobody
   * picks between those two tiers on it, and printing it turns "add the crew"
   * into "up to 50 only". Past 50 the answer is Enterprise, which the band
   * under the cards already points at.
   */
  advertiseSeatCap: boolean;
  /**
   * What this tier adds over the one below it - NOT its full feature list.
   *
   * Stored as a delta so "what am I missing by staying on Starter?" is a real
   * computation (`gainsBetween`) rather than a hardcoded "Everything in X"
   * string that can drift out of sync with the list beneath it.
   */
  adds: string[];
  /** Draws the "Most popular" flag. Exactly one plan should carry it. */
  popular?: boolean;
}

/**
 * The band under the three cards. Not a fourth `PlanPricing`: it has no price,
 * no seat maths and no checkout, so modelling it as one would put a plan into
 * PLAN_ORDER that `tierRank` and `higherTiers` would then offer as an upgrade
 * nobody can buy.
 */
export const ENTERPRISE = {
  headline: "Enterprise",
  summary: "10+ users, API access, SSO, dedicated success manager. Custom pricing.",
  cta: "Talk to sales",
} as const;

export const PLANS: PlanPricing[] = [
  {
    id: "starter",
    name: "Starter",
    audience: "For Solo & Small Teams",
    tagline: "Document every job so nothing gets lost, disputed, or forgotten.",
    basePriceMonthly: 24,
    // 1 seat in the base, a $15 add-on for the second, hard stop at 2. The
    // Team Management spec is explicit that "the 2nd user is the $15/mo
    // add-on", and it is the second user in a different sense too: an Admin
    // plus one Technician, never two Admins.
    includedSeats: 1,
    additionalSeatMonthly: 19,
    maxSeats: 2,
    advertiseSeatCap: true,
    adds: [
      "Photo & video capture",
      // Already recorded on every photo and already stamped on reports, and
      // this list never said so - the proof-of-work tier was hiding the part
      // that makes the proof hold up.
      "GPS & timestamp tagging",
      "Basic project management",
      // Site Logs themselves are not gated; only the AI that drafts them is,
      // which is why Pro's line below says "AI-assisted".
      "Site logs",
      "Tags & labels",
      "Manual reports & share links",
      "Offline mode",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    audience: "For Growing Teams",
    tagline: "Coordinate crews without constant calls, texts, and check-ins.",
    // The third user used to cost $95 more than the second: Starter capped at
    // 2 for $39 and the next seat available anywhere was a $119 Pro base. That
    // cliff is the whole reason this tier gets repriced.
    basePriceMonthly: 79,
    includedSeats: 3,
    additionalSeatMonthly: 24,
    maxSeats: SELF_SERVE_SEAT_CAP,
    advertiseSeatCap: false,
    popular: true,
    adds: [
      // `are_teammates()` gates on plan IN ('pro','team') - see
      // supabase/migrations/20260612193150_teams_plan.sql. Sharing a workspace
      // at all is what Pro unlocks, and the list never said so.
      "Shared team workspace",
      "Live site map",
      // "Recorded", not just "Walkthroughs": generating an AI Summary also
      // files into the Walkthroughs tab and is available on any active plan.
      // Recording a narrated walkthrough is the part this tier unlocks.
      "Recorded walkthroughs",
      "Company watermark",
      "100 Auto Reports/mo",
      "AI-assisted Site Logs",
      "Full checklists & templates",
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
    additionalSeatMonthly: 24,
    maxSeats: SELF_SERVE_SEAT_CAP,
    advertiseSeatCap: false,
    adds: [
      "Workflows & project blueprints",
      // The Portfolio lock screen sends people here with "See Team plan", and
      // this list is what they land on - it named every other Team feature
      // except the one they clicked for.
      "Client-facing Portfolio site + website embeds",
      "Advanced roles & permissions",
      "Unlimited Auto Reports",
      // "Highest storage" deliberately absent. The tier does get the largest
      // allowance (see use-storage-usage), but nobody shops on a number they
      // cannot picture, and it invited "how many GB?" every time it appeared.
      // Enforced in the backend, not sold on the card.
    ],
  },
];

/** Highest seat count any plan can hold - the stepper's ceiling. */
export const MAX_SEATS = Math.max(...PLANS.map((p) => p.maxSeats));

/**
 * True when the plan actually sells seats past what the base covers. False on
 * Starter, where the cap and the included count are the same number - quoting
 * "additional users: $0 each" there advertises a thing you cannot buy.
 */
export function sellsExtraSeats(plan: PlanPricing): boolean {
  return plan.maxSeats > plan.includedSeats;
}

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
 * Everything gained by moving from `from` up to `to` - the concrete answer to
 * "what am I missing out on?". Empty when `to` is not actually higher.
 */
export function gainsBetween(from: BillingPlan | null, to: BillingPlan): string[] {
  const fromRank = from ? tierRank(from) : -1;
  const toRank = tierRank(to);
  if (toRank <= fromRank) return [];
  return PLANS.slice(fromRank + 1, toRank + 1).flatMap((p) => p.adds);
}

/** Tiers strictly above the caller's current one - the real upgrade options. */
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
 * that. Returns the monthly figure for the chosen interval - multiply by 12
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
