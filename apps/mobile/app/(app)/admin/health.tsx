import { useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import { getApiHealth, listJobRuns } from "@/api/admin";
import { formatRate } from "@/api/admin-view";
import { AdminGate, StatGrid, StatTile } from "@/components/admin/AdminKit";
import { spacing } from "@/theme";
import {
  Card,
  Chip,
  ErrorState,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  Columns,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

const WINDOWS = [
  { label: "1 hour", hours: 1 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
] as const;

/** Health: the web page's API totals, busiest ops, recent failures and scheduled jobs. */
export default function AdminHealthScreen() {
  return (
    <AdminGate title="Health">
      <Health />
    </AdminGate>
  );
}

function Health() {
  const [windowHours, setWindowHours] = useState<number>(24);
  const healthQuery = useQuery({
    queryKey: ["admin", "health", windowHours],
    queryFn: () => getApiHealth(windowHours),
  });
  const jobsQuery = useQuery({ queryKey: ["admin", "jobs"], queryFn: listJobRuns });
  const health = healthQuery.data;

  return (
    <Screen
      scroll
      padded={false}
      refreshing={healthQuery.isRefetching}
      onRefresh={() => {
        void healthQuery.refetch();
        void jobsQuery.refetch();
      }}
      bottomInset={spacing.xxl}
    >
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
          {WINDOWS.map((w) => (
            <Chip
              key={w.hours}
              label={w.label}
              selected={windowHours === w.hours}
              onPress={() => setWindowHours(w.hours)}
            />
          ))}
        </View>
        {healthQuery.isLoading ? (
          <SkeletonList rows={3} />
        ) : healthQuery.error || !health ? (
          <ErrorState
            title="Could not load health"
            message={healthQuery.error instanceof Error ? healthQuery.error.message : undefined}
            onRetry={() => void healthQuery.refetch()}
          />
        ) : health.unavailable ? (
          <Text variant="caption" tone="muted">
            {health.unavailable}
          </Text>
        ) : (
          <StatGrid>
            <StatTile label="Requests" value={String(health.totals.requests)} />
            <StatTile label="Error rate" value={formatRate(health.totals.errorRate)} />
            <StatTile label="Server errors" value={String(health.totals.errors5xx)} />
            <StatTile label="Client errors" value={String(health.totals.errors4xx)} />
            <StatTile label="p50" value={`${health.totals.p50Ms ?? 0} ms`} />
            <StatTile label="p95" value={`${health.totals.p95Ms ?? 0} ms`} />
            <StatTile label="People" value={String(health.totals.distinctUsers)} />
          </StatGrid>
        )}
      </View>

      {/* Upright one list; on its side the sections sit in columns. */}
      <Columns minColumn={340}>
        {health && !health.unavailable && health.ops.length > 0 ? (
          <View style={{ gap: spacing.md }}>
            <SectionHeader title="Busiest ops" />
            <View style={{ paddingHorizontal: spacing.lg }}>
              <ListGroup>
                {health.ops.slice(0, 20).map((op, index) => (
                  <View key={op.op}>
                    {index > 0 ? <RowDivider inset={false} /> : null}
                    <ListRow
                      title={op.op}
                      subtitle={`${op.requests} requests · ${op.errors} errors (${formatRate(op.errorRate)}) · p95 ${op.p95Ms ?? 0} ms`}
                    />
                  </View>
                ))}
              </ListGroup>
            </View>
          </View>
        ) : null}

        {health && !health.unavailable && health.recentFailures.length > 0 ? (
          <View style={{ gap: spacing.md }}>
            <SectionHeader title="Recent failures" />
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
              {health.recentFailures.slice(0, 30).map((failure) => (
                <Card key={failure.id}>
                  <View style={{ gap: 2 }}>
                    <Text variant="bodyStrong">
                      {failure.httpStatus} {failure.op ?? failure.route}
                    </Text>
                    {failure.message ? (
                      <Text variant="caption" numberOfLines={3}>
                        {failure.message}
                      </Text>
                    ) : null}
                    <Text variant="caption" tone="muted">
                      {failure.errorCode ?? "error"} · {relativeTime(failure.createdAt)}
                    </Text>
                  </View>
                </Card>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ gap: spacing.md }}>
          <SectionHeader title="Scheduled jobs" />
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
            {jobsQuery.data?.unavailable ? (
              <Text variant="caption" tone="muted">
                {jobsQuery.data.unavailable}
              </Text>
            ) : (
              <ListGroup>
                {(jobsQuery.data?.jobs ?? []).map((job, index) => (
                  <View key={job.job}>
                    {index > 0 ? <RowDivider inset={false} /> : null}
                    <ListRow
                      title={job.job}
                      subtitle={[
                        job.lastRunAt ? `Last ran ${relativeTime(job.lastRunAt)}` : "Never ran",
                        `${job.runs24h} runs, ${job.failures24h} failed in 24h`,
                        job.lastError,
                      ]
                        .filter(Boolean)
                        .join("\n")}
                      value={job.lastOk === false ? "Failing" : job.lastOk ? "OK" : undefined}
                    />
                  </View>
                ))}
              </ListGroup>
            )}
          </View>
        </View>
      </Columns>
    </Screen>
  );
}
