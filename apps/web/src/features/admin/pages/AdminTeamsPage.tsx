import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { listPlatformTeams, syncTeamBilling, type PlatformTeam } from "@/lib/admin.functions";
import { formatBytes } from "@/hooks/use-storage-usage";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { TEAM_SIZES, choiceLabel, industryLabel } from "@everlumen/shared";
import { AdminTable, type AdminColumn } from "../components/AdminTable";
import { useAdminList } from "../hooks/use-admin-list";
import { BillingReconciliationPanel } from "../components/BillingReconciliationPanel";

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

  const list = useAdminList<{ teams: PlatformTeam[]; nextCursor: string | null }, PlatformTeam>({
    queryKey: ["admin", "teams", debouncedSearch],
    fetchPage: (cursor) =>
      listPlatformTeams({ data: { search: debouncedSearch || undefined, cursor } }),
    rowsOf: (page) => page.teams,
  });

  const teams = list.rows;
  const totalStorage = teams.reduce((sum, t) => sum + t.storageBytes, 0);
  const activeCount = teams.filter((t) => t.subscriptionStatus === "active").length;

  /*
   * Who is actually signing up, by trade.
   *
   * This is the question the business profile was added to answer, so it gets
   * its own panel rather than being something you reconstruct by reading the
   * table. Counted over the page in view, and labelled as such: the list is
   * cursor-paginated, and a total that silently means "the first fifty" is
   * worse than no total.
   */
  const byIndustry = (() => {
    const counts = new Map<string, number>();
    for (const t of teams) {
      const key = t.industry ?? "__none";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  })();
  const answered = teams.filter((t) => t.industry).length;

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

  const columns: Array<AdminColumn<PlatformTeam>> = [
    {
      key: "team",
      header: "Team",
      className: "font-medium text-foreground",
      cell: (t) => (
        <>
          <Link to="/admin/teams/$teamId" params={{ teamId: t.id }} className="hover:underline">
            {t.name}
          </Link>
          {t.isInternal && (
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
              internal
            </span>
          )}
        </>
      ),
    },
    {
      key: "industry",
      header: "Industry",
      cell: (t) => industryLabel(t.industry) ?? <span className="opacity-50">-</span>,
    },
    {
      key: "size",
      header: "Size",
      cell: (t) => choiceLabel(TEAM_SIZES, t.teamSize) ?? <span className="opacity-50">-</span>,
    },
    { key: "plan", header: "Plan", className: "capitalize", cell: (t) => t.plan },
    {
      key: "status",
      header: "Status",
      cell: (t) => (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusBadgeClass(t.subscriptionStatus)}`}
        >
          {t.subscriptionStatus}
        </span>
      ),
    },
    { key: "members", header: "Members", cell: (t) => t.memberCount },
    { key: "projects", header: "Projects", cell: (t) => t.projectCount },
    { key: "storage", header: "Storage", cell: (t) => formatBytes(t.storageBytes) },
    {
      key: "created",
      header: "Created",
      cell: (t) => new Date(t.createdAt).toLocaleDateString(),
    },
    {
      key: "actions",
      header: "",
      cell: (t) => (
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
      ),
    },
  ];

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
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Projects
          </p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">
            {teams.reduce((sum, t) => sum + t.projectCount, 0)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Storage used
          </p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">
            {formatBytes(totalStorage)}
          </p>
        </div>
      </div>

      {teams.length > 0 && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Industry mix
            </p>
            <p className="text-xs text-muted-foreground">
              {answered} of {teams.length} shown have completed the setup wizard
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {byIndustry.map(([id, count]) => (
              <span
                key={id}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
                  id === "__none" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                }`}
              >
                {id === "__none" ? "Not answered" : (industryLabel(id) ?? id)}
                <span className="opacity-70">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <BillingReconciliationPanel />

      <div className="relative mt-6 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search team name…"
          className="h-9 pl-8"
        />
      </div>
      <AdminTable
        className="mt-4"
        columns={columns}
        rows={teams}
        getRowKey={(t) => t.id}
        isPending={list.isPending}
        isFetchingMore={list.isFetchingMore}
        hasMore={list.hasMore}
        onLoadMore={list.loadMore}
        error={list.error}
        emptyMessage="No teams match."
        caption="The tiles and the industry mix above count these rows only."
      />
    </div>
  );
}
