import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  exportTeams,
  getTeamIndustryMix,
  listTeamDirectory,
  syncTeamBilling,
  type DirectoryTeam,
  type TeamDirectoryFilters,
  type TeamSort,
  type TeamStatusFilter,
} from "@/lib/admin.functions";
import { formatBytes } from "@/hooks/use-storage-usage";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { TEAM_SIZES, choiceLabel, industryLabel } from "@everlumen/shared";
import { useAdminRole } from "../hooks/use-admin-role";
import { CapabilityNotice } from "../components/AdminTable";
import { BillingReconciliationPanel } from "../components/BillingReconciliationPanel";
import { cn } from "@/lib/utils";

/*
 * The teams screen.
 *
 * It was the last list still assembled in Node: a name search, a cursor, and
 * tiles that counted whatever page happened to be loaded - so "Teams 50" meant
 * fifty rows, not fifty teams, and the industry mix was a distribution over an
 * arbitrary page that had to caption itself to say so.
 *
 * Filtering, sorting, counting and paging now happen in SQL
 * (admin_team_directory), and the industry mix is its own query over every
 * team. Same shape as the users directory, deliberately: two admin lists that
 * behave differently is a thing an operator has to remember.
 */

const STATUS_FILTERS: Array<{ id: TeamStatusFilter | "all"; label: string; hint: string }> = [
  { id: "all", label: "All", hint: "Every team" },
  { id: "active", label: "Active", hint: "Subscribed or trialing" },
  { id: "past_due", label: "Past due", hint: "A renewal charge failed" },
  { id: "canceled", label: "Canceled", hint: "Subscription ended" },
  {
    id: "unpaid_plan",
    label: "Paid, unbacked",
    hint: "On a paid plan with no Stripe subscription and not complimentary",
  },
  { id: "internal", label: "Complimentary", hint: "Access granted without billing" },
  { id: "no_profile", label: "No profile", hint: "Never finished the setup wizard" },
  { id: "dormant", label: "Dormant", hint: "No member activity in 30 days" },
];

const PAGE_SIZE = 50;

function statusBadgeClass(status: string): string {
  if (status === "active" || status === "trialing") return "bg-emerald-500/10 text-emerald-600";
  if (status === "past_due" || status === "unpaid") return "bg-amber-500/10 text-amber-600";
  if (status === "canceled" || status === "incomplete_expired") return "bg-red-500/10 text-red-600";
  return "bg-muted text-muted-foreground";
}

function relative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days > 60) return `${Math.floor(days / 30)}mo ago`;
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `${hours}h ago`;
  return "just now";
}

export function AdminTeamsPage() {
  const qc = useQueryClient();
  const { denyReason } = useAdminRole();
  const deniedBilling = denyReason("billing");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TeamStatusFilter | "all">("all");
  const [plan, setPlan] = useState<"starter" | "pro" | "team" | "all">("all");
  const [sort, setSort] = useState<TeamSort>("created");
  const [desc, setDesc] = useState(true);
  const [offset, setOffset] = useState(0);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);

  const filters: TeamDirectoryFilters = {
    search: debouncedSearch || undefined,
    status: status === "all" ? undefined : status,
    plan: plan === "all" ? undefined : plan,
    sort,
    desc,
  };

  const { data, isPending, isFetching } = useQuery({
    queryKey: ["admin", "team-directory", filters, offset],
    queryFn: () => listTeamDirectory({ data: { ...filters, limit: PAGE_SIZE, offset } }),
    placeholderData: (prev) => prev,
  });

  const { data: mix } = useQuery({
    queryKey: ["admin", "team-industry-mix"],
    queryFn: () => getTeamIndustryMix(),
  });

  const teams = data?.teams ?? [];
  const total = data?.total ?? 0;

  const applyFilter = <T,>(setter: (v: T) => void, value: T) => {
    setter(value);
    setOffset(0);
  };

  const toggleSort = (next: TeamSort) => {
    if (next === sort) setDesc((d) => !d);
    else {
      setSort(next);
      setDesc(true);
    }
    setOffset(0);
  };

  const handleSync = async (teamId: string) => {
    setSyncingId(teamId);
    try {
      const res = await syncTeamBilling({ data: { teamId } });
      toast.success(`Synced - status: ${res.subscriptionStatus}, plan: ${res.plan}`);
      void qc.invalidateQueries({ queryKey: ["admin", "team-directory"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not sync billing");
    } finally {
      setSyncingId(null);
    }
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const res = await exportTeams({ data: { ...filters } });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `everlumen-teams-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        res.truncated
          ? `Exported the first ${res.rows} of ${total} rows`
          : `Exported ${res.rows} rows`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {data?.degraded && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-bold text-foreground">Filters and sorting are unavailable</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Run supabase/migrations/20260823120000_admin_team_directory.sql. Until then this is a
              plain newest-first list with search, and the rollup columns are blank rather than
              wrong.
            </p>
          </div>
        </div>
      )}

      {/*
        The industry mix, over EVERY team.
        This panel is why the setup wizard collects a business profile, and it
        used to tally one page and caption itself to admit it.
      */}
      {mix && !mix.unavailable && mix.mix.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Industry mix
            </p>
            <p className="text-xs text-muted-foreground">
              {mix.answered} of {mix.totalTeams} teams have completed the setup wizard
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {mix.mix.map((m) => (
              <span
                key={m.industry}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
                  m.industry === "__none"
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary/10 text-primary"
                }`}
              >
                {m.industry === "__none"
                  ? "Not answered"
                  : (industryLabel(m.industry) ?? m.industry)}
                <span className="opacity-70">{m.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <BillingReconciliationPanel />

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={status === f.id ? "default" : "outline"}
              onClick={() => applyFilter(setStatus, f.id as TeamStatusFilter | "all")}
              title={f.hint}
            >
              {f.label}
            </Button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              placeholder="Search team or owner…"
              className="h-9 pl-8"
            />
          </div>

          <div className="flex items-center gap-1.5">
            {(["all", "starter", "pro", "team"] as const).map((p) => (
              <Button
                key={p}
                size="sm"
                variant={plan === p ? "secondary" : "ghost"}
                className="capitalize"
                onClick={() => applyFilter(setPlan, p)}
              >
                {p === "all" ? "Any plan" : p}
              </Button>
            ))}
          </div>

          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={busy || total === 0}
            onClick={doExport}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        {isPending ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : teams.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No teams match these filters.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <SortHeader id="name" sort={sort} desc={desc} onSort={toggleSort}>
                      Team
                    </SortHeader>
                    <th className="pb-2 pr-4">Plan</th>
                    <th className="pb-2 pr-4">Status</th>
                    <SortHeader id="members" sort={sort} desc={desc} onSort={toggleSort}>
                      Members
                    </SortHeader>
                    <SortHeader id="projects" sort={sort} desc={desc} onSort={toggleSort}>
                      Projects
                    </SortHeader>
                    <SortHeader id="storage" sort={sort} desc={desc} onSort={toggleSort}>
                      Storage
                    </SortHeader>
                    <SortHeader id="activity" sort={sort} desc={desc} onSort={toggleSort}>
                      Last active
                    </SortHeader>
                    <SortHeader id="created" sort={sort} desc={desc} onSort={toggleSort}>
                      Created
                    </SortHeader>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t) => (
                    <TeamRow
                      key={t.id}
                      team={t}
                      degraded={!!data?.degraded}
                      syncing={syncingId === t.id}
                      canSync={!deniedBilling}
                      onSync={() => handleSync(t.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <CapabilityNotice reason={deniedBilling} />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Showing {offset + 1}-{Math.min(offset + teams.length, total)} of{" "}
                {total.toLocaleString()}
                {isFetching && <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin" />}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset === 0 || isFetching}
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset + teams.length >= total || isFetching}
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SortHeader({
  id,
  sort,
  desc,
  onSort,
  children,
}: {
  id: TeamSort;
  sort: TeamSort;
  desc: boolean;
  onSort: (s: TeamSort) => void;
  children: React.ReactNode;
}) {
  const active = sort === id;
  return (
    <th className="pb-2 pr-4">
      <button
        type="button"
        onClick={() => onSort(id)}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {children}
        {active && (desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );
}

function TeamRow({
  team: t,
  degraded,
  syncing,
  canSync,
  onSync,
}: {
  team: DirectoryTeam;
  /*
   * Before the migration the rollups cannot be supplied. They render as unknown
   * rather than as zeroes, because "0 projects" is a fact an operator would act
   * on and "we could not ask" is not.
   */
  degraded: boolean;
  syncing: boolean;
  canSync: boolean;
  onSync: () => void;
}) {
  const unknown = <span className="opacity-40">-</span>;
  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-4 font-medium text-foreground">
        <Link to="/admin/teams/$teamId" params={{ teamId: t.id }} className="hover:underline">
          {t.name}
        </Link>
        <p className="text-xs font-normal text-muted-foreground">
          {t.owner.email ?? "no owner on file"}
          {t.industry && ` · ${industryLabel(t.industry) ?? t.industry}`}
          {t.teamSize && ` · ${choiceLabel(TEAM_SIZES, t.teamSize) ?? t.teamSize}`}
        </p>
      </td>
      <td className="py-2 pr-4 capitalize text-muted-foreground">
        {t.plan}
        {t.isInternal && (
          <span className="ml-1.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-600">
            comp
          </span>
        )}
      </td>
      <td className="py-2 pr-4">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusBadgeClass(t.subscriptionStatus)}`}
        >
          {t.subscriptionStatus}
        </span>
        {/* A paid plan with nothing backing it is the paywall-hole signature. */}
        {t.plan !== "starter" && !t.stripeSubscriptionId && !t.isInternal && (
          <span className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-600">
            unbacked
          </span>
        )}
      </td>
      <td className="py-2 pr-4 text-muted-foreground">{degraded ? unknown : t.memberCount}</td>
      <td className="py-2 pr-4 text-muted-foreground">{degraded ? unknown : t.projectCount}</td>
      <td className="py-2 pr-4 text-muted-foreground">
        {degraded ? unknown : formatBytes(t.storageBytes)}
      </td>
      <td className="py-2 pr-4 text-muted-foreground" title={t.lastActivityAt ?? "no activity"}>
        {degraded ? unknown : relative(t.lastActivityAt)}
      </td>
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
            disabled={syncing || !canSync}
            onClick={onSync}
            title="Re-sync from Stripe"
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
          <Link
            to="/admin/teams/$teamId"
            params={{ teamId: t.id }}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Manage
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </td>
    </tr>
  );
}
