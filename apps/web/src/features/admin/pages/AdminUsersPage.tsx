import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, ShieldCheck, ShieldOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { listPlatformUsers, setPlatformAdmin, type PlatformUser } from "@/lib/admin.functions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useConfirm } from "@/hooks/use-confirm";
import { useAuth } from "@/hooks/use-auth";
import { AdminTable, type AdminColumn } from "../components/AdminTable";
import { useAdminList } from "../hooks/use-admin-list";

export function AdminUsersPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  const list = useAdminList<{ users: PlatformUser[]; nextCursor: string | null }, PlatformUser>({
    queryKey: ["admin", "users", debouncedSearch],
    fetchPage: (cursor) =>
      listPlatformUsers({ data: { search: debouncedSearch || undefined, cursor } }),
    rowsOf: (page) => page.users,
  });

  /*
   * Granting platform admin hands over every customer's data, and revoking it
   * takes that away from someone who may be mid-task. Both used to happen on a
   * single unguarded click, in a table where the button sits inches from a row
   * the operator was only reading.
   *
   * The confirmation names the person, not "this user" - the whole risk here is
   * acting on the wrong row.
   */
  const toggleAdmin = async (target: PlatformUser, makeAdmin: boolean) => {
    const who = target.fullName ?? target.email ?? "this user";
    const isSelf = target.id === user?.id;

    const ok = await confirm(
      makeAdmin
        ? {
            title: "Grant platform admin?",
            description: `${who} will be able to read every team's data, send announcements to all users, change billing, and grant admin access to others.`,
            confirmText: "Grant admin access",
          }
        : {
            title: isSelf ? "Revoke your own admin access?" : "Revoke platform admin?",
            description: isSelf
              ? `You are about to remove your own admin access. You will lose this dashboard immediately and will need another admin to grant it back.`
              : `${who} will immediately lose access to the admin dashboard.`,
            confirmText: "Revoke access",
            variant: "destructive",
          },
    );
    if (!ok) return;

    setBusyId(target.id);
    try {
      await setPlatformAdmin({ data: { userId: target.id, isAdmin: makeAdmin } });
      toast.success(makeAdmin ? "Granted admin access" : "Revoked admin access");
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      // The layout's gate reads this, so a self-revoke has to take effect now
      // rather than at the next full reload.
      void qc.invalidateQueries({ queryKey: ["admin", "check"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update admin access");
    } finally {
      setBusyId(null);
    }
  };

  const columns: Array<AdminColumn<PlatformUser>> = [
    {
      key: "name",
      header: "Name",
      className: "font-medium text-foreground",
      cell: (u) => (
        <span className="flex items-center gap-1.5">
          {u.fullName ?? "-"}
          {u.isPlatformAdmin && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
              admin
            </span>
          )}
        </span>
      ),
    },
    { key: "email", header: "Email", cell: (u) => u.email ?? "-" },
    {
      key: "team",
      header: "Team",
      cell: (u) => (u.team ? `${u.team.name} (${u.team.role})` : "-"),
    },
    { key: "plan", header: "Plan", className: "capitalize", cell: (u) => u.team?.plan ?? "-" },
    {
      key: "joined",
      header: "Joined",
      cell: (u) => new Date(u.createdAt).toLocaleDateString(),
    },
    {
      key: "admin",
      header: "Admin",
      cell: (u) => (
        <Button
          size="sm"
          variant={u.isPlatformAdmin ? "outline" : "ghost"}
          disabled={busyId === u.id}
          onClick={() => toggleAdmin(u, !u.isPlatformAdmin)}
        >
          {u.isPlatformAdmin ? (
            <>
              <ShieldOff className="mr-1.5 h-3.5 w-3.5" /> Revoke
            </>
          ) : (
            <>
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Make admin
            </>
          )}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, or company…"
          className="h-9 pl-8"
        />
      </div>

      <AdminTable
        className="mt-4"
        columns={columns}
        rows={list.rows}
        getRowKey={(u) => u.id}
        isPending={list.isPending}
        isFetchingMore={list.isFetchingMore}
        hasMore={list.hasMore}
        onLoadMore={list.loadMore}
        error={list.error}
        emptyMessage="No users match."
      />
    </div>
  );
}
