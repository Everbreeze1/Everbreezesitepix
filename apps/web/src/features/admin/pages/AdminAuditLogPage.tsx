import { useState } from "react";
import { Eye, EyeOff, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listAdminAuditLog, type AdminAuditLogRow } from "@/lib/admin.functions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { AdminList } from "../components/AdminTable";
import { useAdminList } from "../hooks/use-admin-list";

const ACTION_LABELS: Record<string, string> = {
  grant_platform_admin: "Granted admin access",
  revoke_platform_admin: "Revoked admin access",
  set_admin_role: "Changed admin role",
  send_admin_notification: "Sent broadcast notification",
  sync_team_billing: "Synced team billing from Stripe",
  set_feedback_status: "Changed feedback status",
  reply_to_feedback: "Replied to feedback",
  override_team_plan: "Changed a team's plan",
  subscription_cancel_at_period_end: "Cancelled subscription at period end",
  subscription_resume: "Resumed subscription",
  subscription_cancel_now: "Cancelled subscription immediately",
  subscription_extend_trial: "Extended trial",
  revoke_share_links: "Revoked share links",
  set_user_team_role: "Changed a team role",
  export_users: "Exported the user list",
  delete_user: "Deleted an account",
  user_suspend: "Suspended an account",
  user_reinstate: "Reinstated an account",
  user_send_password_reset: "Sent a password reset",
  user_resend_confirmation: "Resent a confirmation email",
  bulk_user_suspend: "Bulk suspended accounts",
  bulk_user_reinstate: "Bulk reinstated accounts",
  bulk_user_resend_confirmation: "Bulk resent confirmations",
};

/** `view_user` -> "Viewed a user". Read rows are generated, not enumerated. */
function labelFor(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  if (action.startsWith("view_")) return `Viewed a ${action.slice(5).replace(/_/g, " ")}`;
  return action;
}

const QUICK_FILTERS = [
  { id: "", label: "Everything" },
  { id: "admin", label: "Admin access" },
  { id: "plan", label: "Plans" },
  { id: "subscription", label: "Subscriptions" },
  { id: "delete", label: "Deletions" },
  { id: "revoke", label: "Revocations" },
];

export function AdminAuditLogPage() {
  /*
   * Views are hidden by default.
   *
   * Read logging is what makes "who opened this customer's account" answerable,
   * and it is also what turned this page into a scroll of routine browsing:
   * every visit to a user or team writes a row, and there are far more of those
   * than there are real actions. The page whose whole job is "who changed
   * this" cannot have "who looked at this" as its loudest content.
   */
  const [includeViews, setIncludeViews] = useState(false);
  const [action, setAction] = useState("");
  const debouncedAction = useDebouncedValue(action, 300);

  const list = useAdminList<
    { entries: AdminAuditLogRow[]; nextCursor: string | null },
    AdminAuditLogRow
  >({
    queryKey: ["admin", "audit-log", includeViews, debouncedAction],
    fetchPage: (cursor) =>
      listAdminAuditLog({
        data: { cursor, includeViews, action: debouncedAction || undefined },
      }),
    rowsOf: (page) => page.entries,
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <p className="text-sm font-extrabold text-foreground">Admin action history</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Every change made from this console, and every time an admin opened a customer's account.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {QUICK_FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={action === f.id ? "default" : "outline"}
            onClick={() => setAction(f.id)}
          >
            {f.label}
          </Button>
        ))}

        <div className="relative w-full max-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Filter by action…"
            className="h-9 pl-8"
          />
        </div>

        <Button
          size="sm"
          variant={includeViews ? "secondary" : "ghost"}
          className="ml-auto"
          onClick={() => setIncludeViews((v) => !v)}
          title={
            includeViews
              ? "Hide the rows recording that an admin opened an account"
              : "Show them as well as the changes"
          }
        >
          {includeViews ? (
            <>
              <Eye className="mr-1.5 h-3.5 w-3.5" /> Showing views
            </>
          ) : (
            <>
              <EyeOff className="mr-1.5 h-3.5 w-3.5" /> Views hidden
            </>
          )}
        </Button>
      </div>

      <AdminList
        count={list.rows.length}
        isPending={list.isPending}
        isFetchingMore={list.isFetchingMore}
        hasMore={list.hasMore}
        onLoadMore={list.loadMore}
        error={list.error}
        emptyMessage={
          action || !includeViews
            ? "Nothing matches. Try Everything, or turn views on."
            : "No admin actions logged yet."
        }
      >
        <div className="mt-4 space-y-2">
          {list.rows.map((e) => {
            const isView = e.action.startsWith("view_");
            return (
              <div
                key={e.id}
                className={`rounded-lg border p-3 text-sm ${
                  isView ? "border-dashed border-border/70" : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p
                    className={
                      isView ? "font-medium text-muted-foreground" : "font-bold text-foreground"
                    }
                  >
                    {labelFor(e.action)}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  By {e.actor?.name ?? e.actor?.email ?? "unknown"}
                  {e.targetType && e.targetId && ` · ${e.targetType}: ${e.targetId}`}
                </p>
                {/*
                  The reason lives in metadata and is the most useful thing on
                  the row, so it is pulled out rather than left inside the JSON.
                */}
                {typeof e.metadata?.reason === "string" && (
                  <p className="mt-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs text-foreground">
                    {e.metadata.reason as string}
                  </p>
                )}
                {e.metadata && !isView && (
                  <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
                    {JSON.stringify(e.metadata)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      </AdminList>
    </div>
  );
}
