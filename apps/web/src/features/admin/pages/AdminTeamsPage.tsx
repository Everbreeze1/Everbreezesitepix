import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { listPlatformTeams, syncTeamBilling } from "@/lib/admin.functions";
import { formatBytes } from "@/hooks/use-storage-usage";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

function statusBadgeClass(status: string): string {
  if (status === "active" || status === "trialing") return "bg-emerald-500/10 text-emerald-600";
  if (status === "past_due" || status === "unpaid") return "bg-amber-500/10 text-amber-600";
  if (status === "canceled" || status === "incomplete_expired") return "bg-red-500/10 text-red-600";
  return "bg-muted text-muted-foreground";
}

export function AdminTeamsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isPending } = useQuery({
    queryKey: ["admin", "teams", debouncedSearch],
    queryFn: () => listPlatformTeams({ data: { search: debouncedSearch || undefined } }),
  });

  const teams = data?.teams ?? [];
  const totalStorage = teams.reduce((sum, t) => sum + t.storageBytes, 0);
  const activeCount = teams.filter((t) => t.subscriptionStatus === "active").length;

  const handleSync = async (teamId: string) => {
    setSyncingId(teamId);
    try {
      const res = await syncTeamBilling({ data: { teamId } });
      toast.success(`Synced - status: ${res.subscriptionStatus}, plan: ${res.plan}`);
      void qc.invalidateQueries({ queryKey: ["admin", "teams"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not sync billing");
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Teams</p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">{teams.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Active subscriptions
          </p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">{activeCount}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Projects</p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">
            {teams.reduce((sum, t) => sum + t.projectCount, 0)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Storage used
          </p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">{formatBytes(totalStorage)}</p>
        </div>
      </div>

      <div className="relative mt-6 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search team name…"
          className="h-9 pl-8"
        />
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-card p-6">
        {isPending || !data ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : teams.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No teams match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4">Team</th>
                  <th className="pb-2 pr-4">Plan</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Members</th>
                  <th className="pb-2 pr-4">Projects</th>
                  <th className="pb-2 pr-4">Storage</th>
                  <th className="pb-2 pr-4">Created</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="py-2 pr-4 font-medium text-foreground">
                      <Link
                        to="/admin/teams/$teamId"
                        params={{ teamId: t.id }}
                        className="hover:underline"
                      >
                        {t.name}
                      </Link>
                      {t.isInternal && (
                        <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                          internal
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 capitalize text-muted-foreground">{t.plan}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusBadgeClass(t.subscriptionStatus)}`}
                      >
                        {t.subscriptionStatus}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{t.memberCount}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{t.projectCount}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{formatBytes(t.storageBytes)}</td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        {t.stripeCustomerId && (
                          <a
                            href={`https://dashboard.stripe.com/customers/${t.stripeCustomerId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="Open in Stripe"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={syncingId === t.id}
                          onClick={() => handleSync(t.id)}
                          title="Re-sync from Stripe"
                        >
                          {syncingId === t.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
