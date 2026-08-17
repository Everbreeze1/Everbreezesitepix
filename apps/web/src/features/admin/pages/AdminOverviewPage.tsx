import { useQuery } from "@tanstack/react-query";
import { Loader2, Users, Building2, FolderKanban, Image as ImageIcon } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { getAdminMetrics } from "@/lib/admin.functions";

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: any;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-3 text-3xl font-bold text-foreground">{value}</p>
    </div>
  );
}

export function AdminOverviewPage() {
  const { data: metrics, isPending } = useQuery({
    queryKey: ["admin", "metrics"],
    queryFn: () => getAdminMetrics(),
  });

  if (isPending || !metrics) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total users" value={metrics.totalUsers} icon={Users} />
        <StatTile label="Total teams" value={metrics.totalTeams} icon={Building2} />
        <StatTile label="Total projects" value={metrics.totalProjects} icon={FolderKanban} />
        <StatTile label="Total photos" value={metrics.totalPhotos} icon={ImageIcon} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm font-extrabold text-foreground">Signups - last 30 days</p>
          <div className="mt-4 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics.signupsLast30Days}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(d: string) => d.slice(5)}
                  interval={4}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                  width={24}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm font-extrabold text-foreground">Teams by plan</p>
          <div className="mt-4 space-y-3">
            {(["starter", "pro", "team"] as const).map((plan) => (
              <div key={plan} className="flex items-center justify-between">
                <span className="text-sm capitalize text-muted-foreground">{plan}</span>
                <span className="text-sm font-bold text-foreground">
                  {metrics.teamsByPlan[plan]}
                </span>
              </div>
            ))}
            <div className="mt-4 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Active subscriptions</span>
                <span className="text-sm font-bold text-foreground">
                  {metrics.subscriptions.active}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Inactive</span>
                <span className="text-sm font-bold text-foreground">
                  {metrics.subscriptions.inactive}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-extrabold text-foreground">Recent teams</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Plan</th>
                <th className="pb-2 pr-4">Subscription</th>
                <th className="pb-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {metrics.recentTeams.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="py-2 pr-4 font-medium text-foreground">{t.name}</td>
                  <td className="py-2 pr-4 capitalize text-muted-foreground">{t.plan}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{t.subscriptionStatus}</td>
                  <td className="py-2 text-muted-foreground">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
