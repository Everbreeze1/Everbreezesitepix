import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { getPlatformTeamDetail } from "@/lib/admin.functions";
import { formatBytes } from "@/hooks/use-storage-usage";

export function AdminTeamDetailPage() {
  const { teamId } = useParams({ from: "/_app/admin/teams/$teamId" });

  const { data, isPending } = useQuery({
    queryKey: ["admin", "teams", "detail", teamId],
    queryFn: () => getPlatformTeamDetail({ data: { teamId } }),
  });

  if (isPending || !data) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/admin/teams"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to teams
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-foreground">{data.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.plan} plan · {data.subscriptionStatus} ·{" "}
            {new Date(data.createdAt).toLocaleDateString()}
          </p>
        </div>
        {data.stripeCustomerId && (
          <a
            href={`https://dashboard.stripe.com/customers/${data.stripeCustomerId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open in Stripe
          </a>
        )}
      </div>

      <p className="mt-4 rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
        Read-only inspection view - for support debugging. You are not signed in as this team and
        cannot take actions on its behalf here.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm font-extrabold text-foreground">
            Members <span className="text-muted-foreground">({data.members.length})</span>
          </p>
          <div className="mt-3 space-y-2">
            {data.members.map((m) => (
              <div key={m.id} className="flex items-center justify-between border-t border-border pt-2 text-sm first:border-t-0 first:pt-0">
                <div>
                  <p className="font-medium text-foreground">{m.fullName ?? "-"}</p>
                  <p className="text-xs text-muted-foreground">{m.email ?? "-"}</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold capitalize text-muted-foreground">
                  {m.role}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm font-extrabold text-foreground">
            Projects <span className="text-muted-foreground">({data.projects.length})</span>
          </p>
          <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
            {data.projects.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No projects yet.</p>
            ) : (
              data.projects.map((p) => (
                <div key={p.id} className="border-t border-border pt-2 text-sm first:border-t-0 first:pt-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-foreground">{p.name}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold capitalize text-muted-foreground">
                      {p.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {p.photoCount} photos · {formatBytes(p.storageBytes)} · updated{" "}
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
