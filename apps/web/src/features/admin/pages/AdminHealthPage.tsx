import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { getApiHealth, listJobRuns } from "@/lib/admin.functions";

const WINDOWS = [
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
] as const;

function Tile({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warn" | "bad" | "good";
  hint?: string;
}) {
  const toneClass =
    tone === "bad"
      ? "text-red-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "good"
          ? "text-emerald-600"
          : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function AdminHealthPage() {
  const [windowHours, setWindowHours] = useState<number>(24);

  const { data: health, isPending } = useQuery({
    queryKey: ["admin", "health", windowHours],
    queryFn: () => getApiHealth({ data: { windowHours } }),
  });
  const { data: jobs } = useQuery({
    queryKey: ["admin", "jobs"],
    queryFn: () => listJobRuns(),
  });

  if (isPending || !health) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  /*
   * One banner rather than three empty panels. Without it, a database that has
   * not had the observability migration applied renders as "zero traffic",
   * which is indistinguishable from a genuinely idle API and is the more
   * alarming of the two readings.
   */
  if (health.unavailable) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-extrabold text-foreground">Not set up yet</p>
            <p className="mt-1 text-sm text-muted-foreground">{health.unavailable}</p>
          </div>
        </div>
      </div>
    );
  }

  const errorTone =
    health.totals.errorRate >= 5 ? "bad" : health.totals.errorRate >= 1 ? "warn" : "good";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {WINDOWS.map((w) => (
          <Button
            key={w.hours}
            size="sm"
            variant={windowHours === w.hours ? "default" : "outline"}
            onClick={() => setWindowHours(w.hours)}
          >
            {w.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Requests" value={health.totals.requests.toLocaleString()} />
        <Tile
          label="Error rate"
          value={`${health.totals.errorRate}%`}
          tone={errorTone}
          hint={`${health.totals.errors4xx} client, ${health.totals.errors5xx} server`}
        />
        <Tile
          label="p95 latency"
          value={health.totals.p95Ms === null ? "-" : `${health.totals.p95Ms} ms`}
          hint={
            health.totals.p50Ms === null
              ? undefined
              : `p50 ${health.totals.p50Ms} ms · p99 ${health.totals.p99Ms ?? "-"} ms`
          }
        />
        <Tile label="Active accounts" value={health.totals.distinctUsers} />
      </div>

      {health.timeseries.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm font-extrabold text-foreground">Requests per hour</p>
          <div className="mt-4 h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={health.timeseries}>
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(b: string) =>
                    new Date(b).toLocaleString(undefined, { hour: "numeric", day: "numeric" })
                  }
                  interval="preserveStartEnd"
                  minTickGap={40}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10 }}
                  width={32}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(b) => new Date(b as string).toLocaleString()}
                />
                <Area
                  type="monotone"
                  dataKey="requests"
                  stroke="var(--primary)"
                  fill="var(--primary)"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="errors"
                  stroke="#dc2626"
                  fill="#dc2626"
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-extrabold text-foreground">Scheduled jobs</p>
        {jobs?.unavailable ? (
          <p className="mt-2 text-xs text-amber-600">{jobs.unavailable}</p>
        ) : (
          <div className="mt-3 space-y-2">
            {(jobs?.jobs ?? []).map((j) => {
              const never = !j.lastRunAt;
              return (
                <div
                  key={j.job}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm"
                >
                  {never ? (
                    <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : j.lastOk === false ? (
                    <XCircle className="h-4 w-4 shrink-0 text-red-600" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  )}
                  <span className="font-bold text-foreground">{j.job}</span>
                  <span className="text-xs text-muted-foreground">
                    {never
                      ? "has never recorded a run"
                      : `last ran ${new Date(j.lastRunAt!).toLocaleString()}`}
                    {j.lastRowsAffected !== null && ` · ${j.lastRowsAffected} rows`}
                    {j.lastDurationMs !== null && ` · ${j.lastDurationMs} ms`}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {j.runs24h} run(s) in 24h
                    {j.failures24h > 0 && (
                      <span className="ml-1 font-bold text-red-600">{j.failures24h} failed</span>
                    )}
                  </span>
                  {j.lastError && (
                    <p className="w-full truncate text-xs text-red-600" title={j.lastError}>
                      {j.lastError}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-extrabold text-foreground">
          Slowest and most-failing operations
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-4">Operation</th>
                <th className="pb-2 pr-4">Requests</th>
                <th className="pb-2 pr-4">Errors</th>
                <th className="pb-2 pr-4">Error rate</th>
                <th className="pb-2 pr-4">p50</th>
                <th className="pb-2 pr-4">p95</th>
                <th className="pb-2">Max</th>
              </tr>
            </thead>
            <tbody>
              {health.ops.map((o) => (
                <tr key={o.op} className="border-t border-border">
                  <td className="py-2 pr-4 font-medium text-foreground">{o.op}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{o.requests.toLocaleString()}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{o.errors}</td>
                  <td
                    className={`py-2 pr-4 font-bold ${o.errorRate >= 5 ? "text-red-600" : o.errorRate >= 1 ? "text-amber-600" : "text-muted-foreground"}`}
                  >
                    {o.errorRate}%
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {o.p50Ms === null ? "-" : `${o.p50Ms} ms`}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {o.p95Ms === null ? "-" : `${o.p95Ms} ms`}
                  </td>
                  <td className="py-2 text-muted-foreground">
                    {o.maxMs === null ? "-" : `${o.maxMs} ms`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-extrabold text-foreground">Recent server errors</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The last 50 responses of 500 or worse. This is what answers &quot;it broke this
          afternoon&quot;.
        </p>
        {health.recentFailures.length === 0 ? (
          <p className="py-6 text-center text-sm text-emerald-600">
            No server errors in this window.
          </p>
        ) : (
          <div className="mt-3 max-h-[420px] space-y-1 overflow-y-auto">
            {health.recentFailures.map((f) => (
              <div key={f.id} className="rounded-lg border border-border px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-red-500/10 px-2 py-0.5 font-bold text-red-600">
                    {f.httpStatus}
                  </span>
                  <span className="font-bold text-foreground">{f.op ?? f.route}</span>
                  {f.errorCode && <span className="text-red-600">{f.errorCode}</span>}
                  <span className="ml-auto text-muted-foreground">
                    {new Date(f.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {f.user ? (
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: f.user.id }}
                      className="hover:underline"
                    >
                      {f.user.name ?? f.user.email}
                    </Link>
                  ) : (
                    "no signed-in user"
                  )}
                  {f.requestId && ` · request ${f.requestId}`}
                  {f.durationMs !== null && ` · ${f.durationMs} ms`}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
