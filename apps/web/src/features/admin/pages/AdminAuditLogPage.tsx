import { listAdminAuditLog, type AdminAuditLogRow } from "@/lib/admin.functions";
import { AdminList } from "../components/AdminTable";
import { useAdminList } from "../hooks/use-admin-list";

const ACTION_LABELS: Record<string, string> = {
  grant_platform_admin: "Granted admin access",
  revoke_platform_admin: "Revoked admin access",
  send_admin_notification: "Sent broadcast notification",
  sync_team_billing: "Synced team billing from Stripe",
};

export function AdminAuditLogPage() {
  /*
   * Paginated, because an audit log that stops at the fiftieth entry is not one.
   * This screen exists to answer "what happened, and who did it" - a question
   * that is almost always about something older than the last few actions, and
   * the answer was previously unreachable from the product entirely.
   */
  const list = useAdminList<
    { entries: AdminAuditLogRow[]; nextCursor: string | null },
    AdminAuditLogRow
  >({
    queryKey: ["admin", "audit-log"],
    fetchPage: (cursor) => listAdminAuditLog({ data: { cursor } }),
    rowsOf: (page) => page.entries,
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <p className="text-sm font-extrabold text-foreground">Admin action history</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Every grant/revoke, broadcast, and billing sync performed from this admin dashboard.
      </p>

      <AdminList
        count={list.rows.length}
        isPending={list.isPending}
        isFetchingMore={list.isFetchingMore}
        hasMore={list.hasMore}
        onLoadMore={list.loadMore}
        error={list.error}
        emptyMessage="No admin actions logged yet."
      >
        <div className="mt-4 space-y-2">
          {list.rows.map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-foreground">{ACTION_LABELS[e.action] ?? e.action}</p>
                <span className="text-xs text-muted-foreground">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                By {e.actor?.name ?? e.actor?.email ?? "unknown"}
                {e.targetType && e.targetId && ` · ${e.targetType}: ${e.targetId}`}
              </p>
              {e.metadata && (
                <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
                  {JSON.stringify(e.metadata)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </AdminList>
    </div>
  );
}
