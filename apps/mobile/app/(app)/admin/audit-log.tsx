import { useState } from "react";
import { FlatList, Switch, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import { listAdminAuditLog } from "@/api/admin";
import { AUDIT_FILTERS, auditLabel } from "@/api/admin-view";
import { AdminGate } from "@/components/admin/AdminKit";
import { spacing, useTheme } from "@/theme";
import { ScrollText } from "@/ui/icons";
import { Button, Card, Chip, EmptyState, ErrorState, Screen, SkeletonList, Text } from "@/ui";

/**
 * Audit log: every admin action with who did it and why.
 *
 * The web page's quick filters and its "include page views" switch. Views are
 * off by default for the same reason: reading an account is logged too, and
 * those rows drown the writes somebody opened this to find.
 */
export default function AdminAuditLogScreen() {
  return (
    <AdminGate title="Audit log">
      <AuditLog />
    </AdminGate>
  );
}

function AuditLog() {
  const theme = useTheme();
  const [action, setAction] = useState("");
  const [includeViews, setIncludeViews] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ["admin", "audit", action, includeViews],
    queryFn: ({ pageParam }) =>
      listAdminAuditLog({ cursor: pageParam, includeViews, action: action || undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <Screen padded={false} scroll={false} bottomInset={0}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
          {AUDIT_FILTERS.map((f) => (
            <Chip
              key={f.id || "all"}
              label={f.label}
              selected={action === f.id}
              onPress={() => setAction(f.id)}
            />
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            Include page views
          </Text>
          <Switch
            accessibilityLabel="Include page views"
            value={includeViews}
            onValueChange={setIncludeViews}
            trackColor={{ false: theme.colors.secondary, true: theme.colors.primary }}
            thumbColor={theme.colors.card}
            ios_backgroundColor={theme.colors.secondary}
          />
        </View>
      </View>
      {query.isLoading ? (
        <SkeletonList rows={6} />
      ) : query.error ? (
        <ErrorState
          title="Could not load the audit log"
          message={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      ) : entries.length === 0 ? (
        <EmptyState icon={ScrollText} title="Nothing logged here" />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(entry) => entry.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          onEndReachedThreshold={0.6}
          renderItem={({ item: entry }) => {
            const reason =
              entry.metadata && typeof entry.metadata.reason === "string"
                ? entry.metadata.reason
                : null;
            return (
              <Card>
                <View style={{ gap: 2 }}>
                  <Text variant="bodyStrong">{auditLabel(entry.action)}</Text>
                  {reason ? <Text variant="caption">Reason: {reason}</Text> : null}
                  <Text variant="caption" tone="muted">
                    {entry.actor?.name || entry.actor?.email || "System"} ·{" "}
                    {relativeTime(entry.createdAt)}
                    {entry.targetType ? ` · ${entry.targetType}` : ""}
                  </Text>
                </View>
              </Card>
            );
          }}
          ListFooterComponent={
            query.hasNextPage ? (
              <Button
                label={query.isFetchingNextPage ? "Loading" : "Load older"}
                variant="secondary"
                fullWidth
                disabled={query.isFetchingNextPage}
                onPress={() => void query.fetchNextPage()}
              />
            ) : null
          }
        />
      )}
    </Screen>
  );
}
