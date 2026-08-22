import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getContentLibrary, getPlatformUsage } from "@/lib/admin.functions";
import { formatBytes } from "@/hooks/use-storage-usage";

const WINDOWS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

export function AdminUsagePage() {
  const [windowDays, setWindowDays] = useState<number>(30);

  const { data: usage, isPending } = useQuery({
    queryKey: ["admin", "usage", windowDays],
    queryFn: () => getPlatformUsage({ data: { windowDays } }),
  });
  const { data: library } = useQuery({
    queryKey: ["admin", "content-library"],
    queryFn: () => getContentLibrary(),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {WINDOWS.map((w) => (
          <Button
            key={w.days}
            size="sm"
            variant={windowDays === w.days ? "default" : "outline"}
            onClick={() => setWindowDays(w.days)}
          >
            {w.label}
          </Button>
        ))}
      </div>

      {isPending || !usage ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Estimated AI spend
              </p>
              <p className="mt-2 text-3xl font-bold text-foreground">
                ${usage.totals.estimatedAiCostUsd.toFixed(2)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Estimate only. The invoice is the truth.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Photo analyses
              </p>
              <p className="mt-2 text-3xl font-bold text-foreground">
                {usage.totals.photoAnalyses}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Summaries and reports
              </p>
              <p className="mt-2 text-3xl font-bold text-foreground">
                {usage.totals.walkthroughSummaries + usage.totals.autoReports}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Stored
              </p>
              <p className="mt-2 text-3xl font-bold text-foreground">
                {formatBytes(usage.totals.storageBytes)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">Lifetime, not windowed.</p>
            </div>
          </div>

          {usage.unavailable.length > 0 && (
            <p className="text-xs text-amber-600">
              Not counted, missing from this database: {usage.unavailable.join(", ")}.
            </p>
          )}

          <div className="rounded-2xl border border-border bg-card p-6">
            <p className="text-sm font-extrabold text-foreground">Usage by team</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ordered by estimated cost. A team well above the rest is worth a look before the
              invoice arrives.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4">Team</th>
                    <th className="pb-2 pr-4">Analyses</th>
                    <th className="pb-2 pr-4">Summaries</th>
                    <th className="pb-2 pr-4">Reports</th>
                    <th className="pb-2 pr-4">Photos</th>
                    <th className="pb-2 pr-4">Storage</th>
                    <th className="pb-2">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.rows.map((r) => (
                    <tr key={r.teamId ?? "orphan"} className="border-t border-border">
                      <td className="py-2 pr-4 font-medium text-foreground">
                        {r.teamId ? (
                          <Link
                            to="/admin/teams/$teamId"
                            params={{ teamId: r.teamId }}
                            className="hover:underline"
                          >
                            {r.teamName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{r.teamName}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.photoAnalyses}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.walkthroughSummaries}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.autoReports}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.photoCount}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {formatBytes(r.storageBytes)}
                      </td>
                      <td className="py-2 font-bold text-foreground">
                        ${r.estimatedAiCostUsd.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-extrabold text-foreground">Content library</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Templates that ship to every customer are the rows with no owning team.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(library?.entries ?? []).map((e) => (
            <div key={e.table} className="rounded-xl border border-border p-4">
              <p className="text-sm font-bold text-foreground">{e.kind}</p>
              {e.available ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="text-lg font-extrabold text-foreground">{e.global}</span> global
                  {" · "}
                  {e.total} total
                </p>
              ) : (
                <p className="mt-1 text-xs text-amber-600">Not present in this database.</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
