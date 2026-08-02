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
  exceedsSeatCap,
  monthlyRate,
  monthlyTotal,
  type BillingInterval,
  type PlanPricing,
} from "@/lib/pricing";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Pricing — Everbreeze SitePix" },
      {
        name: "description",
        content: "Choose the SitePix plan that fits your crew — Starter, Pro, or Team.",
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
 * One stepper for the whole page — changing it re-prices every card at once,
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
          Not available for a crew of {seats} — choose Pro or Team.
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
      <p className={`font-manrope text-xs ${subtle}`}>
        Additional Users: ${monthlyRate(plan.additionalSeatMonthly, interval)} each
      </p>
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
          <Check className={`mt-0.5 h-4 w-4 shrink-0 ${muted ? "text-sidebar-ring" : "text-primary"}`} />
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

/** Reached by anonymous visitors from the homepage/nav/footer — must render
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
                className={`flex flex-col rounded-[28px] border p-7 transition-opacity ${
                  capped ? "border-border bg-card opacity-60" : "border-border bg-card"
                }`}
              >
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
                  {capped ? (
                    <span>Not available</span>
                  ) : (
                    <Link to="/signup">Start Free Trial</Link>
                  )}
                </Button>

                <p className="mt-4 font-manrope text-xs text-muted-foreground">{plan.tagline}</p>
                <FeatureList features={plan.features} />
              </div>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

interface MyTeamResult {
  team: { id: string; name: string } | null;
  plan: BillingPlan;
  isActive: boolean;
}

/** Reached by signed-in users — from Settings/Teams "Manage plan", or from
 * the upgrade banner/gate dialog shown app-wide for a team with no active
 * subscription yet. */
function AuthedPricingPage() {
  const qc = useQueryClient();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [seats, setSeats] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await getMyTeam()) as MyTeamResult,
  });

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
                  Choose your plan
                </h1>
                <p className="mt-3 max-w-xl font-manrope text-sm text-muted-foreground">
                  Every plan starts with a {TRIAL_DAYS}-day free trial. Change or cancel anytime
                  from Settings.
                </p>

                <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-8">
                  <CrewSizePicker seats={seats} onChange={setSeats} />
                  <IntervalToggle interval={interval} onChange={setInterval} />
                </div>

                {!isLoading && !data?.team ? (
                  <CreateTeamPrompt
                    onCreated={() => qc.invalidateQueries({ queryKey: ["my-team"] })}
                  />
                ) : (
                  <div className="mt-10 grid gap-6 md:grid-cols-3">
                    {PLANS.map((plan) => (
                      <PlanCard
                        key={plan.id}
                        plan={plan}
                        interval={interval}
                        seats={seats}
                        disabled={isLoading || !data?.team}
                        isCurrent={!!data?.isActive && data.plan === plan.id}
                      />
                    ))}
                  </div>
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
      toast.success("Team created — pick a plan below");
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
        SitePix subscriptions are billed per team — you'll be the owner and can invite others
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

function PlanCard({
  plan,
  interval,
  seats,
  disabled,
  isCurrent,
}: {
  plan: PlanPricing;
  interval: BillingInterval;
  seats: number;
  disabled: boolean;
  isCurrent: boolean;
}) {
  const capped = exceedsSeatCap(plan, seats);
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
      className={`flex flex-col rounded-[28px] border p-7 text-sidebar-foreground transition-opacity ${
        isCurrent ? "border-sidebar-ring bg-sidebar" : "border-sidebar-border bg-sidebar"
      } ${capped ? "opacity-60" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-manrope text-xs font-extrabold uppercase tracking-[1.5px] text-sidebar-ring">
          {plan.name}
        </p>
        {isCurrent && (
          <span className="rounded-full bg-sidebar-ring/15 px-2.5 py-1 font-manrope text-[10px] font-extrabold uppercase tracking-wider text-sidebar-ring">
            Current plan
          </span>
        )}
      </div>

      <div className="mt-3">
        <PriceBlock plan={plan} seats={seats} interval={interval} muted />
      </div>

      <p className="mt-3 font-manrope text-sm text-sidebar-foreground/65">{plan.tagline}</p>

      <FeatureList features={plan.features} muted />

      <Button
        disabled={isCurrent || disabled || capped || m.isPending}
        onClick={() => m.mutate()}
        className="mt-7 h-11 rounded-lg bg-sidebar-ring font-manrope text-sm font-bold text-sidebar-foreground hover:bg-sidebar-ring/90 disabled:opacity-60"
      >
        {isCurrent ? (
          "Current plan"
        ) : capped ? (
          `Up to ${plan.maxSeats} users`
        ) : m.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          `Start ${TRIAL_DAYS}-day free trial`
        )}
      </Button>
    </div>
  );
}
