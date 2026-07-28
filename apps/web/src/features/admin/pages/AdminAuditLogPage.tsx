import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { listAdminAuditLog } from "@/lib/admin.functions";

const ACTION_LABELS: Record<string, string> = {
  grant_platform_admin: "Granted admin access",
  revoke_platform_admin: "Revoked admin access",
  send_admin_notification: "Sent broadcast notification",
  sync_team_billing: "Synced team billing from Stripe",
};

export function AdminAuditLogPage() {
  const { data, isPending } = useQuery({
    queryKey: ["admin", "audit-log"],
    queryFn: () => listAdminAuditLog({ data: {} }),
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <p className="text-sm font-extrabold text-foreground">Admin action history</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Every grant/revoke, broadcast, and billing sync performed from this admin dashboard.
      </p>

      {isPending || !data ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : data.entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No admin actions logged yet.</p>
      ) : (
        <div className="mt-4 max-h-[600px] space-y-2 overflow-y-auto">
          {data.entries.map((e) => (
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
      )}
    </div>
  );
}
