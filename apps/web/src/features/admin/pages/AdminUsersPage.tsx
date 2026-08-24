import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  Download,
  Loader2,
  MailCheck,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  exportUsers,
  listUserDirectory,
  runBulkUserAction,
  type DirectoryUser,
  type UserDirectoryFilters,
  type UserSort,
  type UserStatusFilter,
} from "@/lib/admin.functions";
import { formatBytes } from "@/hooks/use-storage-usage";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePrompt } from "@/hooks/use-prompt";
import { cn } from "@/lib/utils";

/*
 * The users screen.
 *
 * It used to be a search box, six columns and a "Make admin" button. Everything
 * an operator actually asks - who is suspended, who never confirmed, who has no
 * team, who has gone quiet, how many accounts are there at all - had no answer
 * here, and the total was never shown because there was never a total to show.
 *
 * Filtering, sorting, counting and paging all happen in SQL now
 * (admin_user_directory), so the numbers on this page describe the whole table
 * rather than the fifty rows that happen to be loaded.
 */

const STATUS_FILTERS: Array<{ id: UserStatusFilter | "all"; label: string; hint: string }> = [
  { id: "all", label: "All", hint: "Every account" },
  { id: "active", label: "Active", hint: "Confirmed and not suspended" },
  { id: "unconfirmed", label: "Unconfirmed", hint: "Never clicked the confirmation email" },
  { id: "dormant", label: "Dormant", hint: "No recorded activity in 30 days" },
  { id: "no_team", label: "No team", hint: "Not a member of any team" },
  { id: "suspended", label: "Suspended", hint: "Cannot sign in" },
  { id: "admin", label: "Admins", hint: "Platform admins" },
];

const PAGE_SIZE = 50;

/** "3d ago", or "never". Absolute dates make a dormancy scan hard to read. */
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

export function AdminUsersPage() {
  const qc = useQueryClient();
  const prompt = usePrompt();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<UserStatusFilter | "all">("all");
  const [plan, setPlan] = useState<"starter" | "pro" | "team" | "all">("all");
  const [sort, setSort] = useState<UserSort>("joined");
  const [desc, setDesc] = useState(true);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);

  const filters: UserDirectoryFilters = {
    search: debouncedSearch || undefined,
    status: status === "all" ? undefined : status,
    plan: plan === "all" ? undefined : plan,
    sort,
    desc,
  };

  const { data, isPending, isFetching } = useQuery({
    queryKey: ["admin", "user-directory", filters, offset],
    queryFn: () => listUserDirectory({ data: { ...filters, limit: PAGE_SIZE, offset } }),
    // Keeps the previous page on screen while the next loads, so changing a
    // filter does not blink the table away.
    placeholderData: (prev) => prev,
  });

  const users = data?.users ?? [];
  const total = data?.total ?? 0;

  /*
   * Any filter change resets the page and the selection.
   *
   * Staying on page 4 of a result set that now has one page shows an empty
   * table and reads as a bug; keeping a selection across a filter change means
   * a bulk action hits accounts the operator can no longer see.
   */
  const applyFilter = <T,>(setter: (v: T) => void, value: T) => {
    setter(value);
    setOffset(0);
    setSelected(new Set());
  };

  const toggleSort = (next: UserSort) => {
    if (next === sort) setDesc((d) => !d);
    else {
      setSort(next);
      setDesc(true);
    }
    setOffset(0);
  };

  const allOnPageSelected = users.length > 0 && users.every((u) => selected.has(u.id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) users.forEach((u) => next.delete(u.id));
      else users.forEach((u) => next.add(u.id));
      return next;
    });

  const bulk = async (action: "suspend" | "reinstate" | "resend_confirmation", label: string) => {
    const ids = [...selected];
    if (!ids.length) return;
    const reason = await prompt({
      title: `${label} ${ids.length} account${ids.length === 1 ? "" : "s"}?`,
      description:
        action === "suspend"
          ? "They will be signed out and unable to sign in. Reversible from here."
          : action === "reinstate"
            ? "They will be able to sign in again immediately."
            : "A fresh confirmation email goes to anyone who has not confirmed yet.",
      label: "Reason (recorded in the audit log)",
      confirmText: label,
    });
    if (!reason || reason.trim().length < 3) return;

    setBusy(true);
    try {
      const res = await runBulkUserAction({
        data: { userIds: ids, action, reason: reason.trim() },
      });
      // Partial success is reported as partial, never rounded up to success.
      if (res.failed.length) {
        toast.warning(`${res.succeeded} done, ${res.failed.length} failed`, {
          description: res.failed
            .slice(0, 3)
            .map((f) => f.reason)
            .join(" · "),
        });
      } else {
        toast.success(`${res.succeeded} account${res.succeeded === 1 ? "" : "s"} updated`);
      }
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["admin", "user-directory"] });
    } catch (e: any) {
      toast.error(e?.message ?? "That action failed");
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const res = await exportUsers({ data: { ...filters } });
      // Assembled and saved in the browser: the CSV never becomes a file on the
      // server, so there is nothing to clean up or accidentally serve.
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `everlumen-users-${new Date().toISOString().slice(0, 10)}.csv`;
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
              Run supabase/migrations/20260823100000_admin_user_directory.sql. Until then this is a
              plain newest-first list with search, and the status columns are blank rather than
              wrong.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={status === f.id ? "default" : "outline"}
              onClick={() => applyFilter(setStatus, f.id as UserStatusFilter | "all")}
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
              placeholder="Search name, email, or company…"
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

        {selected.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 p-2.5">
            <span className="text-sm font-bold text-foreground">{selected.size} selected</span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => bulk("suspend", "Suspend")}
            >
              <Ban className="mr-1.5 h-3.5 w-3.5" /> Suspend
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => bulk("reinstate", "Reinstate")}
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Reinstate
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => bulk("resend_confirmation", "Resend confirmation to")}
            >
              <MailCheck className="mr-1.5 h-3.5 w-3.5" /> Resend confirmation
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        {isPending ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No accounts match these filters.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="w-8 pb-2 pr-3">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={toggleAll}
                        aria-label="Select all on this page"
                        className="h-4 w-4 rounded border-border"
                      />
                    </th>
                    <SortHeader id="name" sort={sort} desc={desc} onSort={toggleSort}>
                      Name
                    </SortHeader>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Team</th>
                    <SortHeader id="last_seen" sort={sort} desc={desc} onSort={toggleSort}>
                      Last seen
                    </SortHeader>
                    <SortHeader id="activity" sort={sort} desc={desc} onSort={toggleSort}>
                      30d calls
                    </SortHeader>
                    <SortHeader id="projects" sort={sort} desc={desc} onSort={toggleSort}>
                      Projects
                    </SortHeader>
                    <SortHeader id="storage" sort={sort} desc={desc} onSort={toggleSort}>
                      Storage
                    </SortHeader>
                    <SortHeader id="joined" sort={sort} desc={desc} onSort={toggleSort}>
                      Joined
                    </SortHeader>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      degraded={!!data?.degraded}
                      selected={selected.has(u.id)}
                      onToggle={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(u.id)) next.delete(u.id);
                          else next.add(u.id);
                          return next;
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {/* The real total, from SQL, not "the rows I happen to have". */}
                Showing {offset + 1}-{Math.min(offset + users.length, total)} of{" "}
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
                  disabled={offset + users.length >= total || isFetching}
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
  id: UserSort;
  sort: UserSort;
  desc: boolean;
  onSort: (s: UserSort) => void;
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

function UserRow({
  user: u,
  degraded,
  selected,
  onToggle,
}: {
  user: DirectoryUser;
  /*
   * Before the migration the directory cannot supply these columns. They are
   * rendered as "unknown" rather than as their zero values, because "never"
   * and "0" are readable as facts - and an operator scanning for dormant
   * accounts would act on them. A dash cannot be mistaken for data.
   */
  degraded: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const unknown = <span className="opacity-40">-</span>;
  return (
    <tr className={cn("border-t border-border", selected && "bg-primary/5")}>
      <td className="py-2 pr-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${u.fullName ?? u.email ?? u.id}`}
          className="h-4 w-4 rounded border-border"
        />
      </td>
      <td className="py-2 pr-4 font-medium text-foreground">
        <Link to="/admin/users/$userId" params={{ userId: u.id }} className="hover:underline">
          {u.fullName ?? u.email ?? "(no name)"}
        </Link>
        <p className="text-xs font-normal text-muted-foreground">{u.email}</p>
      </td>
      <td className="py-2 pr-4">
        <div className="flex flex-wrap gap-1">
          {/*
            Badges rather than one status word, because these overlap: an
            account can be suspended AND unconfirmed, and collapsing that to a
            single label throws away the reason someone is locked out.
          */}
          {u.suspended && <Badge tone="red">suspended</Badge>}
          {!u.emailConfirmed && <Badge tone="amber">unconfirmed</Badge>}
          {u.adminRole && <Badge tone="primary">{u.adminRole}</Badge>}
          {!u.suspended && u.emailConfirmed && !u.adminRole && (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </div>
      </td>
      <td className="py-2 pr-4 text-muted-foreground">
        {u.team ? (
          <>
            <Link
              to="/admin/teams/$teamId"
              params={{ teamId: u.team.id }}
              className="hover:underline"
            >
              {u.team.name}
            </Link>
            <p className="text-xs capitalize">
              {u.team.role} · {u.team.plan}
              {u.teamCount > 1 && ` · +${u.teamCount - 1} more`}
            </p>
          </>
        ) : (
          <span className="opacity-50">no team</span>
        )}
      </td>
      <td
        className="py-2 pr-4 text-muted-foreground"
        title={u.lastSeenAt ?? "no recorded activity"}
      >
        {degraded ? unknown : relative(u.lastSeenAt)}
      </td>
      <td className="py-2 pr-4 text-muted-foreground">
        {degraded ? unknown : u.requests30d.toLocaleString()}
      </td>
      <td className="py-2 pr-4 text-muted-foreground">{degraded ? unknown : u.projectCount}</td>
      <td className="py-2 pr-4 text-muted-foreground">
        {degraded ? unknown : formatBytes(u.storageBytes)}
      </td>
      <td className="py-2 pr-4 text-muted-foreground">
        {new Date(u.createdAt).toLocaleDateString()}
      </td>
    </tr>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "red" | "amber" | "primary";
  children: React.ReactNode;
}) {
  const cls =
    tone === "red"
      ? "bg-red-500/10 text-red-600"
      : tone === "amber"
        ? "bg-amber-500/10 text-amber-600"
        : "bg-primary/10 text-primary";
  return (
    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase", cls)}>
      {children}
    </span>
  );
}
