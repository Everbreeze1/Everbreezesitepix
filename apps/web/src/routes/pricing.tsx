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
  ENTERPRISE,
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

/** Reached by anonymous visitors from the homepage/nav/footer - must render
 * without any authenticated-app assumptions (no AppSidebar/AppHeader, no
 * authed RPC calls). CTAs route to signup; checkout only happens once the
 * visitor has an account and a team. */
function PublicPricingPage() {
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [seats, setSeats] = useState(1);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="text-center">
          <h1 className="font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Document every job.
          </h1>
          <p className="font-display mt-1 text-2xl font-bold italic tracking-tight text-foreground sm:text-3xl">
            Never lose proof of work.
          </p>
          <p className="mt-4 font-manrope text-sm text-muted-foreground">
            Start your {TRIAL_DAYS}-day free trial. Cancel anytime.
          </p>
        </div>

        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-8">
          <CrewSizePicker seats={seats} onChange={setSeats} />
          <IntervalToggle interval={interval} onChange={setInterval} />
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {PLANS.map((plan) => {
            const capped = exceedsSeatCap(plan, seats);
            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-[28px] border p-7 transition-opacity ${
                  capped ? "opacity-60" : ""
                } ${plan.popular ? "border-primary shadow-sm" : "border-border"} bg-card`}
              >
                {/* Only meaningful while the plan is actually on offer - a
                    "Most popular" flag on a card reading "Not available for a
                    crew of 8" is pointing at something you cannot buy. */}
                {plan.popular && !capped && (
                  <span className="absolute -top-3 left-7 inline-flex rounded-full bg-primary px-3 py-1 font-manrope text-[11px] font-extrabold uppercase tracking-wider text-primary-foreground">
                    Most popular
                  </span>
                )}
                <p className="font-display text-2xl font-bold text-foreground">{plan.name}</p>
                <span className="mt-2 inline-flex w-fit rounded-full bg-foreground px-3 py-1 font-manrope text-[11px] font-bold text-background">
                  {plan.audience}
                </span>

                <div className="mt-5">
                  <PriceBlock plan={plan} seats={seats} interval={interval} />
                </div>

                <Button
                  asChild={!capped}
                  disabled={capped}
                  className="mt-6 h-11 rounded-lg font-manrope text-sm font-bold"
                >
                  {capped ? <span>Not available</span> : <Link to="/signup">Start Free Trial</Link>}
                </Button>

                <p className="mt-4 font-manrope text-xs text-muted-foreground">{plan.tagline}</p>
                <FeatureList features={displayFeatures(plan)} />
              </div>
            );
          })}
        </div>

        {/* Pro and Team sell any number of seats, so this is not a seat
            ceiling anyone has hit - it is the band of asks (API, SSO, a named
            contact) that no self-serve tier answers, and which otherwise leave
            with no next step on this page. */}
        <div className="mt-8 flex flex-col items-start justify-between gap-4 rounded-[28px] border border-border bg-card p-6 sm:flex-row sm:items-center sm:p-7">
          <p className="font-manrope text-sm text-muted-foreground">
            <span className="font-extrabold text-foreground">{ENTERPRISE.headline}</span>{" "}
            {ENTERPRISE.summary}
          </p>
          <Button
            asChild
            variant="outline"
            className="h-11 shrink-0 rounded-lg font-manrope text-sm font-bold"
          >
            <Link to="/contact">{ENTERPRISE.cta}</Link>
          </Button>
        </div>
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
          {m.isPending ? "Creating…" : "Continue"}
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
            {plan.advertiseSeatCap ? ` · up to ${plan.maxSeats}` : ""}
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
