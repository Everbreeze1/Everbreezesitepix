import { useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getContentLibrary, getPlatformUsage } from "@/api/admin";
import { formatBytes, formatUsd } from "@/api/admin-view";
import { AdminGate, StatGrid, StatTile } from "@/components/admin/AdminKit";
import { spacing } from "@/theme";
import {
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
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

/** Usage and cost: AI calls, storage and estimated spend per team, and the content library. */
export default function AdminUsageScreen() {
  return (
    <AdminGate title="Usage and cost">
      <Usage />
    </AdminGate>
  );
}

function Usage() {
  const [windowDays, setWindowDays] = useState<number>(30);
  const usageQuery = useQuery({
    queryKey: ["admin", "usage", windowDays],
    queryFn: () => getPlatformUsage(windowDays),
  });
  const libraryQuery = useQuery({
    queryKey: ["admin", "content-library"],
    queryFn: getContentLibrary,
  });
  const usage = usageQuery.data;

  return (
    <Screen
      scroll
      padded={false}
      refreshing={usageQuery.isRefetching}
      onRefresh={() => void usageQuery.refetch()}
      bottomInset={spacing.xxl}
    >
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
          {WINDOWS.map((w) => (
            <Chip
              key={w.days}
              label={w.label}
              selected={windowDays === w.days}
              onPress={() => setWindowDays(w.days)}
            />
          ))}
        </View>
        {usageQuery.isLoading ? (
          <SkeletonList rows={3} />
        ) : usageQuery.error || !usage ? (
          <ErrorState
            title="Could not load usage"
            message={usageQuery.error instanceof Error ? usageQuery.error.message : undefined}
            onRetry={() => void usageQuery.refetch()}
          />
        ) : (
          <>
            <StatGrid>
              <StatTile
                label="Estimated AI cost"
                value={formatUsd(usage.totals.estimatedAiCostUsd)}
              />
              <StatTile label="Storage" value={formatBytes(usage.totals.storageBytes)} />
              <StatTile label="Photo analyses" value={String(usage.totals.photoAnalyses)} />
              <StatTile
                label="Walkthrough summaries"
                value={String(usage.totals.walkthroughSummaries)}
              />
              <StatTile label="Auto reports" value={String(usage.totals.autoReports)} />
            </StatGrid>
            {usage.unavailable.length > 0 ? (
              <Text variant="caption" tone="muted">
                Not counted: {usage.unavailable.join(", ")}
              </Text>
            ) : null}
          </>
        )}
      </View>

      {/* Upright one list; on its side the two tables sit side by side. */}
      <Columns minColumn={340} max={2}>
        {usage && usage.rows.length > 0 ? (
          <View style={{ gap: spacing.md }}>
            <SectionHeader title="By team" />
            <View style={{ paddingHorizontal: spacing.lg }}>
              <ListGroup>
                {usage.rows.slice(0, 50).map((row, index) => (
                  <View key={row.teamId ?? `none-${index}`}>
                    {index > 0 ? <RowDivider inset={false} /> : null}
                    <ListRow
                      title={row.teamName}
                      subtitle={`${row.photoAnalyses} analyses · ${row.walkthroughSummaries} summaries · ${row.autoReports} reports · ${formatBytes(row.storageBytes)}`}
                      value={formatUsd(row.estimatedAiCostUsd)}
                    />
                  </View>
                ))}
              </ListGroup>
            </View>
          </View>
        ) : null}

        {(libraryQuery.data ?? []).length > 0 ? (
          <View style={{ gap: spacing.md }}>
            <SectionHeader title="Content library" />
            <View style={{ paddingHorizontal: spacing.lg }}>
              <ListGroup>
                {(libraryQuery.data ?? []).map((entry, index) => (
                  <View key={entry.kind}>
                    {index > 0 ? <RowDivider inset={false} /> : null}
                    <ListRow
                      title={entry.kind}
                      subtitle={entry.available ? `${entry.global} global` : "Not available"}
                      value={String(entry.total)}
                    />
                  </View>
                ))}
              </ListGroup>
            </View>
          </View>
        ) : null}
      </Columns>
    </Screen>
  );
}
