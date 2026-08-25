import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getTeamBilling, manageTeamSubscription, overrideTeamPlan } from "@/lib/admin.functions";
import { usePrompt } from "@/hooks/use-prompt";
import { useConfirm } from "@/hooks/use-confirm";
import { useAdminRole } from "../hooks/use-admin-role";
import { CapabilityNotice } from "./AdminTable";

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/**
 * Billing operations for one team.
 *
 * Split into two groups on purpose, because they are two different kinds of
 * act. The overrides write our own `teams` columns and change what the customer
 * can reach right now; the subscription actions reach into Stripe and change
 * what they are charged. Presenting them as one row of buttons would invite
 * someone to comp a team and cancel their subscription in the same gesture.
 */
export function TeamBillingPanel({ teamId }: { teamId: string }) {
  const qc = useQueryClient();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const { denyReason } = useAdminRole();
  const denied = denyReason("billing");
  const [busy, setBusy] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["admin", "teams", "billing", teamId],
    queryFn: () => getTeamBilling({ data: { teamId } }),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "teams", "billing", teamId] });
    void qc.invalidateQueries({ queryKey: ["admin", "teams", "detail", teamId] });
  };

  const askReason = (title: string, description: string) =>
    prompt({
      title,
      description,
      label: "Reason (recorded in the audit log)",
      placeholder: "Ticket number, or what was agreed",
      confirmText: "Continue",
    });

  const setPlan = async (plan: "starter" | "pro" | "team") => {
    const reason = await askReason(
      `Move this team to the ${plan} plan?`,
      "This writes our own database columns and does not touch Stripe. Their card is unaffected.",
    );
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await overrideTeamPlan({ data: { teamId, plan, reason: reason.trim() } });
      toast.success(`Plan set to ${plan}.`);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not change the plan");
    } finally {
      setBusy(false);
    }
  };

  const setComplimentary = async (isInternal: boolean) => {
    const reason = await askReason(
      isInternal ? "Give this team complimentary access?" : "Remove complimentary access?",
      isInternal
        ? "They will have full access regardless of subscription status, indefinitely, until someone turns this off."
        : "They will fall back to whatever their subscription actually allows. If they have no active subscription, they lose access.",
    );
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await overrideTeamPlan({ data: { teamId, isInternal, reason: reason.trim() } });
      toast.success(isInternal ? "Complimentary access granted." : "Complimentary access removed.");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not change access");
    } finally {
      setBusy(false);
    }
  };

  const subscriptionAction = async (
    action: "cancel_at_period_end" | "resume" | "cancel_now" | "extend_trial",
    title: string,
    description: string,
    trialDays?: number,
  ) => {
    // cancel_now is the one that takes access away with no grace period, so it
    // gets a destructive confirm on top of the reason prompt.
    if (action === "cancel_now") {
      const ok = await confirm({
        title: "Cancel immediately?",
        description:
          "The subscription ends now, not at the end of the period they have already paid for. Prefer 'cancel at period end' unless they have specifically asked for this.",
        confirmText: "Cancel now",
        variant: "destructive",
      });
      if (!ok) return;
    }

    const reason = await askReason(title, description);
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      const res = await manageTeamSubscription({
        data: { teamId, action, trialDays, reason: reason.trim() },
      });
      toast.success(res.message);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "That action failed");
    } finally {
      setBusy(false);
    }
  };

  if (isPending || !data) {
    return (
      <div className="mt-6 rounded-2xl border border-border bg-card p-6">
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-6">
      <p className="text-sm font-extrabold text-foreground">Billing</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Plan in our database
          </p>
          <p className="mt-0.5 text-sm font-semibold capitalize text-foreground">
            {data.plan}
            {data.isInternal && (
              <span className="ml-1.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-600">
                complimentary
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Status in our database
          </p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{data.subscriptionStatus}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Status in Stripe
          </p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {data.stripe ? data.stripe.status : "No subscription"}
            {/* The disagreement is the interesting part - it means a webhook
                was missed, and the paywall is reading the stale half. */}
            {data.stripe && data.stripe.status !== data.subscriptionStatus && (
              <span className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-600">
                mismatch
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Renews</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {data.stripe?.currentPeriodEnd
              ? new Date(data.stripe.currentPeriodEnd).toLocaleDateString()
              : "-"}
            {data.stripe?.cancelAtPeriodEnd && (
              <span className="ml-1.5 text-xs font-normal text-amber-600">cancelling</span>
            )}
          </p>
        </div>
      </div>

      {data.stripe?.unavailableReason && (
        <p className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-600">
          Stripe could not be reached: {data.stripe.unavailableReason}
        </p>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Access overrides (our database, not Stripe)
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["starter", "pro", "team"] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant="outline"
              disabled={busy || !!denied || data.plan === p}
              onClick={() => setPlan(p)}
              className="capitalize"
            >
              Set {p}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !!denied}
            onClick={() => setComplimentary(!data.isInternal)}
          >
            {data.isInternal ? "Remove complimentary" : "Make complimentary"}
          </Button>
        </div>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Subscription (Stripe)
        </p>
        {!data.stripeSubscriptionId ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No Stripe subscription on this team. Use the overrides above to change their access.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {data.stripe?.cancelAtPeriodEnd ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !!denied}
                onClick={() =>
                  subscriptionAction(
                    "resume",
                    "Withdraw the cancellation?",
                    "The subscription will renew as normal at the end of this period.",
                  )
                }
              >
                Resume subscription
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !!denied}
                onClick={() =>
                  subscriptionAction(
                    "cancel_at_period_end",
                    "Cancel at the end of the period?",
                    "They keep access until the end of the period they have paid for.",
                  )
                }
              >
                Cancel at period end
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !!denied}
              onClick={() =>
                subscriptionAction(
                  "extend_trial",
                  "Extend the trial by 14 days?",
                  "Adds 14 days from whichever is later: the current trial end, or today.",
                  14,
                )
              }
            >
              Extend trial 14 days
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={busy || !!denied}
              onClick={() =>
                subscriptionAction(
                  "cancel_now",
                  "Cancel immediately?",
                  "Ends the subscription right away, with no remaining paid period.",
                )
              }
            >
              Cancel now
            </Button>
          </div>
        )}
      </div>

      <CapabilityNotice reason={denied} />

      {data.invoices.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Recent invoices
          </p>
          <div className="mt-2 space-y-1">
            {data.invoices.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"
              >
                <span className="font-bold text-foreground">{inv.number ?? inv.id}</span>
                <span
                  className={
                    inv.status === "paid"
                      ? "text-emerald-600"
                      : inv.status === "open"
                        ? "text-amber-600"
                        : "text-muted-foreground"
                  }
                >
                  {inv.status}
                </span>
                <span className="text-muted-foreground">
                  {money(inv.amountPaid || inv.amountDue, inv.currency)}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {new Date(inv.created).toLocaleDateString()}
                </span>
                {inv.hostedUrl && (
                  <a
                    href={inv.hostedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
