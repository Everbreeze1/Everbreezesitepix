import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Crown, Loader2, Minus, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { SubscriptionGateProvider } from "@/hooks/use-subscription-gate";
import { UpgradeGateDialog } from "@/components/UpgradeGateDialog";
import { getMyTeam, createTeam, createCheckoutSession } from "@/features/teams/api";
import type { BillingPlan } from "@/features/teams/api";
import {
  ANNUAL_DISCOUNT,
  MAX_SEATS,
  PLANS,
  TRIAL_DAYS,
  annualTotal,
  displayFeatures,
  exceedsSeatCap,
  gainsBetween,
  higherTiers,
  monthlyRate,
  monthlyTotal,
  planById,
  sellsExtraSeats,
  type BillingInterval,
  type PlanPricing,
} from "@/lib/pricing";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Pricing - Everlumen" },
      {
        name: "description",
        content: "Choose the Everlumen plan that fits your crew - Starter, Pro, or Team.",
      },
    ],
  }),
});

/* ---------------- Shared controls ---------------- */

function IntervalToggle({
  interval,
  onChange,
}: {
  interval: BillingInterval;
  onChange: (v: BillingInterval) => void;
}) {
  return (
    <div className="inline-flex items-center gap-3">
      <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card p-1">
        {(["monthly", "annual"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={interval === v}
            className={`rounded-full px-5 py-1.5 font-manrope text-sm font-bold transition-colors ${
              interval === v
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {v === "monthly" ? "Monthly" : "Annual"}
          </button>
        ))}
      </div>
      <span className="font-manrope text-xs font-extrabold uppercase tracking-wider text-emerald-600">
        Save {ANNUAL_DISCOUNT * 100}%
      </span>
    </div>
  );
}

/**
 * One stepper for the whole page - changing it re-prices every card at once,
 * so the comparison is always for the same crew size.
 */
function CrewSizePicker({ seats, onChange }: { seats: number; onChange: (n: number) => void }) {
  const btn =
    "flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="inline-flex items-center gap-3">
      <span className="inline-flex items-center gap-2 font-manrope text-sm font-bold text-foreground">
        <Users className="h-4 w-4 text-muted-foreground" />
        Calculate for your crew:
      </span>
      <div className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, seats - 1))}
          disabled={seats <= 1}
          aria-label="Remove a user"
          className={btn}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span
          aria-live="polite"
          className="min-w-[3ch] text-center font-manrope text-base font-extrabold text-foreground"
        >
          {seats}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(MAX_SEATS, seats + 1))}
          disabled={seats >= MAX_SEATS}
          aria-label="Add a user"
          className={btn}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** The price block shared by both the public and signed-in cards. */
function PriceBlock({
  plan,
  seats,
  interval,
  muted,
}: {
  plan: PlanPricing;
  seats: number;
  interval: BillingInterval;
  /** Renders against the dark sidebar surface used by the signed-in page. */
  muted?: boolean;
}) {
  const subtle = muted ? "text-sidebar-foreground/55" : "text-muted-foreground";
  const strong = muted ? "text-sidebar-foreground" : "text-foreground";
  const capped = exceedsSeatCap(plan, seats);

  if (capped) {
    return (
      <div>
        <p className={`font-display text-2xl font-bold tracking-tight ${strong}`}>
          Up to {plan.maxSeats} user{plan.maxSeats === 1 ? "" : "s"}
        </p>
        <p className={`mt-2 font-manrope text-xs ${subtle}`}>
          Not available for a crew of {seats} - choose Pro or Team.
        </p>
      </div>
    );
  }

  const extraSeats = Math.max(0, seats - plan.includedSeats);
  const total = monthlyTotal(plan, seats, interval);

  return (
    <div>
      <p className={`font-display text-4xl font-bold tracking-tight ${strong}`}>
        ${total}
        <span className={`ml-1 text-base font-medium ${subtle}`}>/month</span>
      </p>
      <p className={`mt-2 font-manrope text-xs font-bold ${strong}`}>
        {plan.includedSeats} User{plan.includedSeats === 1 ? "" : "s"} Included
      </p>
      {sellsExtraSeats(plan) ? (
        <p className={`font-manrope text-xs ${subtle}`}>
          Additional Users: ${monthlyRate(plan.additionalSeatMonthly, interval)} each
          {/* The ceiling belongs next to the add-on price, not further down.
              Starter sells a second seat and then stops, and a crew reading
              only "$19 each" plans a third hire this tier will never seat.
              Pro and Team stop at 50 too, but that is enforcement, not an
              offer - see `advertiseSeatCap`. */}
          {plan.advertiseSeatCap ? `, capped at ${plan.maxSeats} users` : ""}
        </p>
      ) : (
        /* Only reachable if a plan's cap and its included count ever match:
           there is no add-on to price, and "$0 each" would advertise a seat
           that cannot be bought at any price. */
        <p className={`font-manrope text-xs ${subtle}`}>
          Capped at {plan.maxSeats} users, no add-ons
        </p>
      )}
      <p className={`font-manrope text-xs ${subtle}`}>
        USD / Billed {interval === "annual" ? "Annually" : "Monthly"}
      </p>
      {/* Only meaningful once the crew is larger than what the base covers. */}
      {extraSeats > 0 && (
        <p className={`mt-2 font-manrope text-xs ${subtle}`}>
          {plan.includedSeats} included + {extraSeats} additional = {seats} users
        </p>
      )}
      {interval === "annual" && (
        <p className={`mt-2 font-manrope text-xs ${subtle}`}>
          ${annualTotal(plan, seats).toLocaleString()} billed yearly
        </p>
      )}
    </div>
  );
}

function FeatureList({ features, muted }: { features: string[]; muted?: boolean }) {
  return (
    <ul className="mt-6 flex-1 space-y-2.5">
      {features.map((f) => (
        <li
          key={f}
          className={`flex items-start gap-2 font-manrope text-sm ${
            muted ? "text-sidebar-foreground/80" : "text-foreground/80"
          }`}
        >
          <Check
            className={`mt-0.5 h-4 w-4 shrink-0 ${muted ? "text-sidebar-ring" : "text-primary"}`}
          />
          {f}
        </li>
      ))}
    </ul>
  );
}

function PricingPage() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) return null;
  if (!user) return <PublicPricingPage />;
  return <AuthedPricingPage />;
}

/**
 * The public shelf, laid out as the marketing redesign draws it: three plans
 * that say who they are for and how many people they seat, a feature
 * comparison, and the three billing questions people ask before they sign up.
 *
 * No prices here - a visitor is told what each tier is for, and the number is
 * settled on the signed-in page, where the CTA actually opens checkout. That
 * is also why the crew-size stepper and the monthly/annual toggle are gone from
 * this page: they existed only to recompute a price.
 *
 * Reached by anonymous visitors from the homepage/nav/footer - must render
 * without any authenticated-app assumptions (no AppSidebar/AppHeader, no
 * authed RPC calls). CTAs route to signup; checkout only happens once the
 * visitor has an account and a team.
 */
const PUBLIC_PLANS = [
  {
    id: "starter",
    name: "Starter",
    blurb: "For solo operators and small crews just getting off camera rolls.",
    users: "1 user included",
  },
  {
    id: "pro",
    name: "Pro",
    blurb: "For crews running multiple active jobs who need AI reporting and walkthroughs.",
    users: "5 users included",
    popular: true,
  },
  {
    id: "team",
    name: "Team",
    blurb: "For general contractors managing subs, clients, and templates across every job.",
    users: "Unlimited users",
  },
] as const;

/** A cell is included (true), not included (false), or a short label such as "Basic". */
type Cell = boolean | string;

const COMPARISON: { group: string; rows: { feature: string; cells: [Cell, Cell, Cell] }[] }[] = [
  {
    group: "Capture & storage",
    rows: [
      { feature: "Photo & video capture", cells: [true, true, true] },
      { feature: "Unlimited photo storage", cells: [true, true, true] },
      { feature: "Offline mode", cells: [true, true, true] },
      { feature: "Live site map", cells: [true, true, true] },
    ],
  },
  {
    group: "Reporting & AI",
    rows: [
      { feature: "Manual reports", cells: [true, true, true] },
      { feature: "AI-drafted reports", cells: [false, true, true] },
      { feature: "Recorded walkthroughs", cells: [false, true, true] },
      { feature: "AI assistant", cells: [false, true, true] },
      { feature: "Company watermark on exports", cells: [false, true, true] },
    ],
  },
  {
    group: "Organization",
    rows: [
      { feature: "Tags & labels", cells: [true, true, true] },
      { feature: "Checklists & templates", cells: ["Basic", "Full", "Full"] },
      { feature: "Tasks on photos", cells: [false, true, true] },
      { feature: "Project blueprints", cells: [false, false, true] },
    ],
  },
  {
    group: "Team & client access",
    rows: [
      { feature: "Share links with clients", cells: [true, true, true] },
      { feature: "Portfolio site & website embeds", cells: [false, false, true] },
      { feature: "Advanced roles & permissions", cells: [false, false, true] },
      { feature: "Subcontractor access", cells: [false, false, true] },
    ],
  },
];

const BILLING_FAQ = [
  {
    q: "Can I switch plans later?",
    a: "Yes - upgrade or downgrade any time from account settings; changes apply on your next billing cycle.",
  },
  {
    q: 'What counts as a "user"?',
    a: "Anyone with a login - office staff and field crew both count. Subcontractors given scoped project access do not count against your seat total on Team.",
  },
  {
    q: "Is there a contract?",
    a: "No. Month-to-month, cancel any time - annual billing is available if you'd rather lock in a rate.",
  },
];

function ComparisonCell({ value }: { value: Cell }) {
  if (value === false) return <span className="text-muted-foreground">—</span>;
  if (value === true) return <Check className="mx-auto h-4 w-4 text-[oklch(0.55_0.14_150)]" />;
  return <span className="font-semibold text-[oklch(0.55_0.14_150)]">{value}</span>;
}

function PublicPricingPage() {
  return (
    <div className="min-h-screen bg-background landing">
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-[1100px] px-8 pb-14 pt-20 text-center">
          <p className="font-manrope text-xs font-bold uppercase tracking-[0.14em] text-accent-foreground">
            Pricing
          </p>
          <h1 className="font-display mx-auto mt-3.5 max-w-[640px] text-[42px] font-bold leading-[1.04] tracking-[-0.01em] text-foreground">
            Built to fit your crew size.
          </h1>
          <p className="font-manrope mx-auto mt-4 max-w-[520px] text-[15.5px] leading-[1.6] text-muted-foreground">
            Every plan includes AI reports, live site maps, and unlimited photo storage — no
            per-feature upgrades. Tell us your crew size and we&apos;ll get you set up with the
            right one.
          </p>
        </section>

        <section className="mx-auto max-w-[1100px] px-8 pb-[60px]">
          <div className="grid gap-5 md:grid-cols-3">
            {PUBLIC_PLANS.map((plan) => {
              const popular = "popular" in plan && plan.popular;
              return (
                <div
                  key={plan.id}
                  className={`relative flex flex-col rounded-[18px] border bg-card p-[30px] ${
                    popular
                      ? "border-primary shadow-[0_12px_32px_rgba(0,0,0,0.06)]"
                      : "border-border"
                  }`}
                >
                  {popular && (
                    <span className="absolute -top-3 left-6 inline-flex rounded-full bg-primary px-3 py-1 font-manrope text-[11px] font-bold text-primary-foreground">
                      Most popular
                    </span>
                  )}
                  <p className="font-manrope text-[20px] font-bold text-foreground">{plan.name}</p>
                  <p className="mt-1.5 font-manrope text-[13.5px] text-muted-foreground">
                    {plan.blurb}
                  </p>
                  <p className="mt-[22px] font-manrope text-[13px] text-faint">{plan.users}</p>
                  <Button
                    asChild
                    variant={popular ? "default" : "outline"}
                    className="mt-[22px] h-12 w-full rounded-full font-manrope text-[14.5px] font-bold"
                  >
                    <Link to="/signup">Start free trial</Link>
                  </Button>
                </div>
              );
            })}
          </div>
          <p className="mt-5 text-center font-manrope text-[13px] text-faint">
            Annual billing available.{" "}
            <Link to="/contact" className="font-semibold text-accent-foreground hover:underline">
              Talk to us
            </Link>{" "}
            for a plan tailored to your team.
          </p>
        </section>

        <section className="border-t border-border bg-secondary pb-24 pt-16">
          <div className="mx-auto max-w-[1100px] px-8">
            <h2 className="font-display mb-9 text-center text-[26px] font-bold leading-[1.04] tracking-[-0.01em] text-foreground">
              Compare plans in detail
            </h2>
            <div className="overflow-x-auto rounded-[18px] border border-border bg-card px-7 py-2">
              <table className="w-full min-w-[560px] border-collapse font-manrope text-[13.5px]">
                <thead>
                  <tr className="border-b-2 border-border font-bold">
                    <th scope="col" className="w-[40%] py-[13px] text-left">
                      Feature
                    </th>
                    <th scope="col" className="py-[13px] text-center">
                      Starter
                    </th>
                    <th scope="col" className="py-[13px] text-center text-accent-foreground">
                      Pro
                    </th>
                    <th scope="col" className="py-[13px] text-center">
                      Team
                    </th>
                  </tr>
                </thead>
                {COMPARISON.map((section) => (
                  <tbody key={section.group}>
                    <tr>
                      <th
                        colSpan={4}
                        scope="colgroup"
                        className="pb-1.5 pt-[22px] text-left text-[11.5px] font-bold uppercase tracking-[0.06em] text-faint"
                      >
                        {section.group}
                      </th>
                    </tr>
                    {section.rows.map((row) => (
                      <tr key={row.feature} className="border-b border-border last:border-b-0">
                        <td className="py-[13px]">{row.feature}</td>
                        {row.cells.map((cell, i) => (
                          <td key={i} className="py-[13px] text-center">
                            <ComparisonCell value={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[760px] px-8 py-20">
          <h2 className="font-display mb-7 text-center text-[26px] font-bold leading-[1.04] tracking-[-0.01em] text-foreground">
            Billing questions
          </h2>
          <div className="rounded-[18px] border border-border bg-card px-7 py-[22px]">
            {BILLING_FAQ.map((item) => (
              <div key={item.q} className="border-b border-border py-3.5 last:border-b-0">
                <p className="font-manrope text-[14.5px] font-semibold text-foreground">{item.q}</p>
                <p className="mt-1.5 font-manrope text-[13.5px] text-muted-foreground">{item.a}</p>
              </div>
            ))}
          </div>
          <p className="mt-[22px] text-center">
            <Link
              to="/faq"
              className="font-manrope text-[13.5px] font-semibold text-accent-foreground hover:underline"
            >
              See the full FAQ →
            </Link>
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

interface MyTeamResult {
  team: { id: string; name: string } | null;
  /** Used to price the page for the crew the team actually has today. */
  members: { id: string }[];
  plan: BillingPlan;
  isActive: boolean;
}

/** Reached by signed-in users - from Settings/Teams "Manage plan", or from
 * the upgrade banner/gate dialog shown app-wide for a team with no active
 * subscription yet.
 *
 * Deliberately NOT the public page's three-column shelf. A signed-in visitor
 * is not choosing between three products from scratch - they hold a position
 * and are deciding whether to move up from it. So this leads with the plan
 * they're on and shows only genuine upgrades, each answering "what am I
 * missing?" with the concrete feature delta rather than a full list they'd
 * have to diff by eye.
 *
 * Prices stay: the CTA here goes straight to Stripe checkout, so hiding the
 * number would mean the first place a customer learns the cost is the payment
 * page. They're reframed as a delta against what the team already pays, which
 * is the figure that actually drives an upgrade decision. */
function AuthedPricingPage() {
  const qc = useQueryClient();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  // Null until the user touches the stepper, so the page opens priced for the
  // crew the team actually has rather than for one person - a 6-person team
  // seeing a 1-seat price would be quoted a number they can never pay.
  const [seatsOverride, setSeatsOverride] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await getMyTeam()) as MyTeamResult,
  });

  const teamSeats = Math.min(MAX_SEATS, Math.max(1, data?.members?.length ?? 1));
  const seats = seatsOverride ?? teamSeats;

  // An inactive subscription is treated as holding no tier at all, so every
  // plan reads as an upgrade instead of one being marked "current" while the
  // team can't actually use it.
  const currentPlan: BillingPlan | null = data?.isActive ? data.plan : null;
  const current = currentPlan ? planById(currentPlan) : undefined;
  const upgrades = higherTiers(currentPlan);
  const atTopTier = !!currentPlan && upgrades.length === 0;

  return (
    <SubscriptionGateProvider>
      <SidebarProvider>
        <div className="min-h-screen flex w-full bg-background">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0 bg-background">
            <AppHeader />
            <main className="flex-1 min-w-0 p-6 md:p-10">
              <div className="mx-auto max-w-6xl">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sidebar-ring/15">
                  <Crown className="h-6 w-6 text-sidebar-ring" strokeWidth={2} />
                </span>
                <h1 className="font-display mt-6 text-4xl font-bold tracking-tight text-foreground">
                  {atTopTier ? "Your plan" : current ? "Upgrade your plan" : "Choose your plan"}
                </h1>
                <p className="mt-3 max-w-xl font-manrope text-sm text-muted-foreground">
                  {current
                    ? "Change or cancel anytime from Settings."
                    : `Every plan starts with a ${TRIAL_DAYS}-day free trial. Change or cancel anytime from Settings.`}
                </p>

                {!isLoading && !data?.team ? (
                  <CreateTeamPrompt
                    onCreated={() => qc.invalidateQueries({ queryKey: ["my-team"] })}
                  />
                ) : (
                  <>
                    {current && (
                      <CurrentPlanPanel plan={current} seats={seats} interval={interval} />
                    )}

                    {upgrades.length > 0 && (
                      <>
                        <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-8">
                          <CrewSizePicker seats={seats} onChange={setSeatsOverride} />
                          <IntervalToggle interval={interval} onChange={setInterval} />
                        </div>
                        {seatsOverride !== null && seatsOverride !== teamSeats && (
                          <p className="mt-3 font-manrope text-xs text-muted-foreground">
                            Priced for {seatsOverride} user{seatsOverride === 1 ? "" : "s"} - your
                            team has {teamSeats} today.
                          </p>
                        )}

                        <div
                          className={`mt-8 grid gap-6 ${
                            upgrades.length === 1 ? "max-w-xl" : "md:grid-cols-2"
                          }`}
                        >
                          {upgrades.map((plan) => (
                            <PlanCard
                              key={plan.id}
                              plan={plan}
                              interval={interval}
                              seats={seats}
                              disabled={isLoading || !data?.team}
                              currentPlan={currentPlan}
                            />
                          ))}
                        </div>
                      </>
                    )}

                    {atTopTier && (
                      <p className="mt-8 max-w-xl font-manrope text-sm text-muted-foreground">
                        You're on the highest tier - every feature is unlocked. Manage seats,
                        payment method and invoices from{" "}
                        <Link to="/settings" className="font-bold text-primary hover:underline">
                          Settings
                        </Link>
                        .
                      </p>
                    )}
                  </>
                )}
              </div>
            </main>
          </div>
        </div>
        <UpgradeGateDialog />
      </SidebarProvider>
    </SubscriptionGateProvider>
  );
}

function CreateTeamPrompt({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const m = useMutation({
    mutationFn: () => createTeam({ data: { name: name.trim() } }),
    onSuccess: () => {
      toast.success("Team created - pick a plan below");
      onCreated();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create team"),
  });

  return (
    <div className="mt-10 max-w-md rounded-3xl bg-sidebar p-6 text-sidebar-foreground md:p-8">
      <h2 className="font-manrope text-lg font-extrabold text-sidebar-foreground">
        Name your team to continue
      </h2>
      <p className="mt-1 font-manrope text-sm text-sidebar-foreground/60">
        Everlumen subscriptions are billed per team - you'll be the owner and can invite others
        after subscribing.
      </p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Team name (e.g. Acme Construction)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className="border-sidebar-border bg-sidebar-foreground/5 text-sidebar-foreground placeholder:text-sidebar-foreground/40 sm:flex-1"
        />
        <Button
          disabled={!name.trim() || m.isPending}
          onClick={() => m.mutate()}
          className="bg-sidebar-ring font-manrope font-bold text-sidebar-foreground hover:bg-sidebar-ring/90"
        >
          {m.isPending ? "Creatingâ€¦" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

/**
 * What the team is on today, stated plainly above the upgrade options so the
 * page opens with the user's own position rather than a sales grid.
 */
function CurrentPlanPanel({
  plan,
  seats,
  interval,
}: {
  plan: PlanPricing;
  seats: number;
  interval: BillingInterval;
}) {
  return (
    <div className="mt-8 rounded-[28px] border border-border bg-card p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 font-manrope text-[11px] font-extrabold uppercase tracking-wider text-primary">
            <Check className="h-3 w-3" /> Your plan
          </span>
          <p className="font-display mt-3 text-3xl font-bold tracking-tight text-foreground">
            {plan.name}
          </p>
          <p className="mt-1 font-manrope text-sm text-muted-foreground">{plan.tagline}</p>
        </div>
        <div className="text-right">
          {/* Past its own seat cap this plan has no price - quoting an
              extrapolated one would invent a tier we don't sell. */}
          {exceedsSeatCap(plan, seats) ? (
            <p className="font-display text-lg font-bold tracking-tight text-foreground">
              Holds up to {plan.maxSeats} user{plan.maxSeats === 1 ? "" : "s"}
            </p>
          ) : (
            <p className="font-display text-2xl font-bold tracking-tight text-foreground">
              ${monthlyTotal(plan, seats, interval)}
              <span className="ml-1 text-sm font-medium text-muted-foreground">/month</span>
            </p>
          )}
          <p className="mt-1 font-manrope text-xs text-muted-foreground">
            {plan.includedSeats} user{plan.includedSeats === 1 ? "" : "s"} included
            {/* Same rule as the public cards: name Starter's ceiling, because
                it is the reason to move up, and stay quiet about Pro's and
                Team's, which are enforcement rather than an offer. */}
            {plan.advertiseSeatCap ? ` Â· up to ${plan.maxSeats}` : ""}
          </p>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="mt-3 rounded-lg font-manrope font-bold"
          >
            <Link to="/settings">Manage billing</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  interval,
  seats,
  disabled,
  currentPlan,
}: {
  plan: PlanPricing;
  interval: BillingInterval;
  seats: number;
  disabled: boolean;
  /** Null when the team has no active subscription - then nothing is "extra". */
  currentPlan: BillingPlan | null;
}) {
  const capped = exceedsSeatCap(plan, seats);
  // The concrete answer to "what am I missing?" - only what this tier adds
  // beyond what the team already has, so there's nothing to diff by eye.
  const gains = gainsBetween(currentPlan, plan.id);
  const currentPricing = currentPlan ? planById(currentPlan) : undefined;
  // Only meaningful while the current plan can actually seat this crew -
  // past its cap it has no price at this size, so there's nothing to diff.
  const currentIsPriceable = !!currentPricing && !exceedsSeatCap(currentPricing, seats);
  const delta =
    currentPricing && currentIsPriceable
      ? monthlyTotal(plan, seats, interval) - monthlyTotal(currentPricing, seats, interval)
      : null;

  const m = useMutation({
    mutationFn: () =>
      createCheckoutSession({
        data: { plan: plan.id, origin: window.location.origin, interval, seats },
      }),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to start checkout"),
  });

  return (
    <div
      className={`flex flex-col rounded-[28px] border border-sidebar-border bg-sidebar p-7 text-sidebar-foreground transition-opacity ${
        capped ? "opacity-60" : ""
      }`}
    >
      <p className="font-manrope text-xs font-extrabold uppercase tracking-[1.5px] text-sidebar-ring">
        {plan.name}
      </p>

      <div className="mt-3">
        <PriceBlock plan={plan} seats={seats} interval={interval} muted />
      </div>

      {/* The upgrade decision is driven by the difference, not the sticker. */}
      {!capped && delta !== null && delta > 0 && (
        <p className="mt-2 font-manrope text-xs font-bold text-sidebar-ring">
          +${delta}/month more than your current plan
        </p>
      )}
      {/* No delta to show because the current plan can't seat this crew at
          all - which is itself the reason to move up, so say that instead. */}
      {!capped && currentPricing && !currentIsPriceable && (
        <p className="mt-2 font-manrope text-xs font-bold text-sidebar-ring">
          Your {currentPricing.name} plan holds only {currentPricing.maxSeats} user
          {currentPricing.maxSeats === 1 ? "" : "s"}
        </p>
      )}

      <p className="mt-3 font-manrope text-sm text-sidebar-foreground/65">{plan.tagline}</p>

      {gains.length > 0 ? (
        <div className="mt-6 flex-1">
          <p className="font-manrope text-[11px] font-extrabold uppercase tracking-wider text-sidebar-foreground/50">
            {currentPlan ? "What you'll unlock" : "What's included"}
          </p>
          <ul className="mt-3 space-y-2.5">
            {gains.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2 font-manrope text-sm text-sidebar-foreground/85"
              >
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-sidebar-ring" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <FeatureList features={displayFeatures(plan)} muted />
      )}

      <Button
        disabled={disabled || capped || m.isPending}
        onClick={() => m.mutate()}
        className="mt-7 h-11 rounded-lg bg-sidebar-ring font-manrope text-sm font-bold text-sidebar-foreground hover:bg-sidebar-ring/90 disabled:opacity-60"
      >
        {capped ? (
          `Up to ${plan.maxSeats} users`
        ) : m.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : currentPlan ? (
          `Upgrade to ${plan.name}`
        ) : (
          `Start ${TRIAL_DAYS}-day free trial`
        )}
      </Button>
    </div>
  );
}
