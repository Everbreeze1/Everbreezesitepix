import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, ShieldCheck } from "lucide-react";
import { getBillingReconciliation } from "@/lib/admin.functions";

/**
 * The paid-plan-without-a-payment report.
 *
 * LAUNCH.md 1.0a: for as long as the paywall hole was open, any signed-in user
 * could PATCH their own `teams` row to the top tier from the browser. The
 * migration closed it. Nothing has ever established who had already walked
 * through it, and a paid plan in our database is not evidence that anyone paid.
 *
 * Collapsed by default and only expanded when there is something to see, so it
 * stays a standing check rather than a permanent alarm nobody reads. It runs on
 * demand rather than on page load - it makes one Stripe call per subscribed
 * team, which is not something to spend on every visit to the Teams tab.
 */
export function BillingReconciliationPanel() {
  const [open, setOpen] = useState(false);

  const { data, isFetching, error } = useQuery({
    queryKey: ["admin", "billing", "reconciliation"],
    queryFn: () => getBillingReconciliation(),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const problemCount =
    (data?.paidWithoutSubscription.filter((t) => !t.isInternal).length ?? 0) +
    (data?.statusMismatch.length ?? 0);

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm font-extrabold text-foreground">Billing reconciliation</span>
        {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {data && problemCount > 0 && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-600">
            {problemCount} to review
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {open ? "" : "Checks every team against Stripe"}
        </span>
      </button>

      {open && (
        <div className="mt-4">
          {error ? (
            <p className="text-sm text-red-600">{(error as Error).message}</p>
          ) : isFetching && !data ? (
            <p className="text-sm text-muted-foreground">
              Checking every subscription in Stripe...
            </p>
          ) : data ? (
            <div className="space-y-5">
              {data.stripeError && (
                <p className="rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-600">
                  Stripe could not be reached: {data.stripeError}. Only the database-side check
                  below ran.
                </p>
              )}

              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Paid plan with no Stripe subscription
                </p>
                {data.paidWithoutSubscription.length === 0 ? (
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-600">
                    <ShieldCheck className="h-4 w-4" /> None. Every paid plan has a subscription.
                  </p>
                ) : (
                  <div className="mt-2 space-y-1">
                    {data.paidWithoutSubscription.map((t) => (
                      <div
                        key={t.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        {!t.isInternal && (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                        )}
                        <Link
                          to="/admin/teams/$teamId"
                          params={{ teamId: t.id }}
                          className="font-bold text-foreground hover:underline"
                        >
                          {t.name}
                        </Link>
                        <span className="text-xs capitalize text-muted-foreground">
                          {t.plan} · {t.subscriptionStatus}
                        </span>
                        {t.isInternal ? (
                          // Comped teams legitimately have no subscription.
                          // Flagged rather than hidden, so the report is not
                          // quietly cleaner than the data.
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-600">
                            complimentary, expected
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-600">
                            no payment on file
                          </span>
                        )}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {new Date(t.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Our status disagrees with Stripe
                </p>
                {data.statusMismatch.length === 0 ? (
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-600">
                    <ShieldCheck className="h-4 w-4" /> None. {data.checkedAgainstStripe}{" "}
                    subscription(s) checked and all agree.
                  </p>
                ) : (
                  <div className="mt-2 space-y-1">
                    {data.statusMismatch.map((t) => (
                      <div
                        key={t.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <Link
                          to="/admin/teams/$teamId"
                          params={{ teamId: t.id }}
                          className="font-bold text-foreground hover:underline"
                        >
                          {t.name}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          ours: {t.localStatus} · Stripe: {t.stripeStatus}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          Use &quot;Re-sync from Stripe&quot; to fix
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
