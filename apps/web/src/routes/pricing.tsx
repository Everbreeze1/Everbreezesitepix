import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Crown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { getMyTeam, createTeam, createCheckoutSession } from "@/features/teams/api";
import type { BillingPlan } from "@/features/teams/api";

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

const PLANS: {
  id: BillingPlan;
  name: string;
  price: string;
  tagline: string;
  features: string[];
}[] = [
  {
    id: "starter",
    name: "Starter",
    price: "$24",
    tagline: "The simple solo tech tool.",
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
    price: "$119",
    tagline: "The serious field tool — our main tier.",
    features: [
      "Everything in Starter",
      "Company watermark",
      "Walkthroughs + auto report",
      "AI-assisted Site Logs",
      "Full checklists & templates",
      "Map view",
      "Tasks on photos",
    ],
  },
  {
    id: "team",
    name: "Team",
    price: "$179",
    tagline: "Multi-user companies — efficiency at scale.",
    features: [
      "Everything in Pro",
      "Workflows",
      "Project blueprints",
      "Advanced roles & permissions",
      "Unlimited auto reports",
      "Highest storage",
    ],
  },
];

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
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
          <Crown className="h-6 w-6 text-primary" strokeWidth={2} />
        </span>
        <h1 className="font-display mt-6 text-4xl font-bold tracking-tight text-foreground">
          Choose your plan
        </h1>
        <p className="mt-3 max-w-xl font-manrope text-sm text-muted-foreground">
          Every plan is billed monthly, no free trial. Sign up, then pick a plan to get started —
          you can change or cancel anytime from Settings.
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className="flex flex-col rounded-[28px] border border-border bg-card p-7"
            >
              <p className="font-manrope text-xs font-extrabold uppercase tracking-[1.5px] text-primary">
                {plan.name}
              </p>
              <p className="font-display mt-3 text-4xl font-bold tracking-tight text-foreground">
                {plan.price}
                <span className="ml-1 text-base font-medium text-muted-foreground">/mo</span>
              </p>
              <p className="mt-2 font-manrope text-sm text-muted-foreground">{plan.tagline}</p>

              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 font-manrope text-sm text-foreground/80">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>

              <Button
                asChild
                className="mt-7 h-11 rounded-lg font-manrope text-sm font-bold"
              >
                <Link to="/signup">Sign up for {plan.name}</Link>
              </Button>
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

interface MyTeamResult {
  team: { id: string; name: string } | null;
}

/** Reached by signed-in users — from Settings/Teams "Manage plan", or from
 * the upgrade banner/gate dialog shown app-wide for a team with no active
 * subscription yet. */
function AuthedPricingPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await getMyTeam()) as MyTeamResult,
  });

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          <AppHeader />
          <main className="flex-1 min-w-0 p-6 md:p-10">
            <div className="mx-auto max-w-5xl">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sidebar-ring/15">
                <Crown className="h-6 w-6 text-sidebar-ring" strokeWidth={2} />
              </span>
              <h1 className="font-display mt-6 text-4xl font-bold tracking-tight text-foreground">
                Choose your plan
              </h1>
              <p className="mt-3 max-w-xl font-manrope text-sm text-muted-foreground">
                Every plan is billed monthly. Change or cancel anytime from Settings once you're
                subscribed.
              </p>

              {!isLoading && !data?.team ? (
                <CreateTeamPrompt onCreated={() => qc.invalidateQueries({ queryKey: ["my-team"] })} />
              ) : (
                <div className="mt-10 grid gap-6 md:grid-cols-3">
                  {PLANS.map((plan) => (
                    <PlanCard key={plan.id} plan={plan} disabled={isLoading || !data?.team} />
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
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
  disabled,
}: {
  plan: (typeof PLANS)[number];
  disabled: boolean;
}) {
  const m = useMutation({
    mutationFn: () =>
      createCheckoutSession({
        data: { plan: plan.id, origin: window.location.origin },
      }),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to start checkout"),
  });

  return (
    <div className="flex flex-col rounded-[28px] border border-sidebar-border bg-sidebar p-7 text-sidebar-foreground">
      <p className="font-manrope text-xs font-extrabold uppercase tracking-[1.5px] text-sidebar-ring">
        {plan.name}
      </p>
      <p className="font-display mt-3 text-4xl font-bold tracking-tight text-sidebar-foreground">
        {plan.price}
        <span className="ml-1 text-base font-medium text-sidebar-foreground/50">/mo</span>
      </p>
      <p className="mt-2 font-manrope text-sm text-sidebar-foreground/65">{plan.tagline}</p>

      <ul className="mt-6 flex-1 space-y-2.5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 font-manrope text-sm text-sidebar-foreground/80">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-sidebar-ring" />
            {f}
          </li>
        ))}
      </ul>

      <Button
        disabled={disabled || m.isPending}
        onClick={() => m.mutate()}
        className="mt-7 h-11 rounded-lg bg-sidebar-ring font-manrope text-sm font-bold text-sidebar-foreground hover:bg-sidebar-ring/90"
      >
        {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Subscribe to ${plan.name}`}
      </Button>
    </div>
  );
}
