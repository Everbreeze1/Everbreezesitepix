import { useState } from "react";
import { View } from "react-native";
import { router, Stack } from "expo-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  exportTeams,
  getBillingReconciliation,
  getTeamIndustryMix,
  listTeamDirectory,
  syncTeamBilling,
} from "@/api/admin";
import { formatBytes, PLANS, TEAM_FILTERS, type Plan } from "@/api/admin-view";
import { openShareSheet } from "@/api/sharing";
import { AdminGate, CapabilityNotice, useAdminCan, useSettled } from "@/components/admin/AdminKit";
import { spacing } from "@/theme";
import { Building2, Download, RefreshCw } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipGroup,
  EmptyState,
  ErrorState,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SearchField,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

const PAGE = 30;

/**
 * Teams: the web console's team directory.
 *
 * The same search, status and plan filters, paging, export, a Stripe sync per
 * team, the billing reconciliation and the industry mix. Each team opens its
 * own page for plan, billing and members.
 */
export default function AdminTeamsScreen() {
  return (
    <AdminGate title="Teams">
      <TeamsDirectory />
    </AdminGate>
  );
}

function TeamsDirectory() {
  const queryClient = useQueryClient();
  const { denyReason } = useAdminCan();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [plan, setPlan] = useState<Plan | "all">("all");
  const [offset, setOffset] = useState(0);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showChecks, setShowChecks] = useState(false);
  const settled = useSettled(search.trim());
  const deniedBilling = denyReason("billing");

  const filters = {
    search: settled || undefined,
    status: status === "all" ? undefined : status,
    plan: plan === "all" ? undefined : plan,
  };
  const query = useQuery({
    queryKey: ["admin", "teams", filters, offset],
    queryFn: () => listTeamDirectory({ ...filters, offset, limit: PAGE }),
    placeholderData: keepPreviousData,
  });
  const mixQuery = useQuery({ queryKey: ["admin", "industry-mix"], queryFn: getTeamIndustryMix });
  const reconQuery = useQuery({
    queryKey: ["admin", "billing-reconciliation"],
    queryFn: getBillingReconciliation,
    enabled: showChecks,
  });
  const teams = query.data?.teams ?? [];
  const total = query.data?.total ?? 0;

  const setFilter = (apply: () => void) => {
    apply();
    setOffset(0);
  };

  const sync = async (teamId: string) => {
    setSyncing(teamId);
    try {
      const result = await syncTeamBilling(teamId);
      setNotice(`Synced from Stripe: ${result.plan}, ${result.subscriptionStatus}.`);
      void queryClient.invalidateQueries({ queryKey: ["admin", "teams"] });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "The sync did not work.");
    } finally {
      setSyncing(null);
    }
  };

  const doExport = async () => {
    try {
      const result = await exportTeams(filters);
      if (!result.csv) {
        setNotice("Nothing to export with these filters.");
        return;
      }
      await openShareSheet(result.csv, `Everlumen teams (${result.rows})`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "The export did not work.");
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <IconButton
              icon={Download}
              accessibilityLabel="Export the filtered list"
              surface={false}
              onPress={() => void doExport()}
            />
          ),
        }}
      />
      <Screen
        scroll
        padded={false}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        bottomInset={spacing.xxl}
      >
        <View style={{ paddingTop: spacing.lg, gap: spacing.sm }}>
          <SearchField
            value={search}
            onChangeText={(next) => setFilter(() => setSearch(next))}
            placeholder="Team or owner"
          />
          <ChipGroup
            label="Team status"
            options={TEAM_FILTERS.map((f) => ({ id: f.id as string, label: f.label }))}
            value={status}
            onChange={(next) => setFilter(() => setStatus(next))}
          />
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: spacing.xs,
              paddingHorizontal: spacing.lg,
            }}
          >
            {(["all", ...PLANS] as const).map((option) => (
              <Chip
                key={option}
                label={option === "all" ? "Any plan" : option}
                selected={plan === option}
                onPress={() => setFilter(() => setPlan(option))}
              />
            ))}
          </View>
          <View style={{ paddingHorizontal: spacing.lg }}>
            <Text variant="caption" tone="muted">
              {query.isLoading ? "Loading" : `${total} team${total === 1 ? "" : "s"}`}
            </Text>
            {notice ? <Text variant="caption">{notice}</Text> : null}
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md }}>
          {query.isLoading ? (
            <SkeletonList rows={6} />
          ) : query.error ? (
            <ErrorState
              title="Could not load teams"
              message={query.error instanceof Error ? query.error.message : undefined}
              onRetry={() => void query.refetch()}
            />
          ) : teams.length === 0 ? (
            <EmptyState icon={Building2} title="No teams match" />
          ) : (
            teams.map((team) => (
              <Card key={team.id} onPress={() => router.push(`/admin/team/${team.id}`)}>
                <View style={{ gap: spacing.xs }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                      {team.name}
                    </Text>
                    <Badge
                      label={team.isInternal ? "complimentary" : team.plan}
                      tone={team.isInternal ? "success" : "neutral"}
                    />
                  </View>
                  <Text variant="caption" tone="muted">
                    {team.owner.name || team.owner.email || "No owner"} · {team.subscriptionStatus}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {team.memberCount} members · {team.projectCount} projects ·{" "}
                    {formatBytes(team.storageBytes)}
                  </Text>
                  {team.stripeCustomerId ? (
                    <Button
                      label={syncing === team.id ? "Syncing" : "Sync from Stripe"}
                      icon={RefreshCw}
                      size="sm"
                      variant="secondary"
                      disabled={syncing !== null || Boolean(deniedBilling)}
                      onPress={() => void sync(team.id)}
                    />
                  ) : null}
                </View>
              </Card>
            ))
          )}
          <CapabilityNotice reason={deniedBilling} />

          {total > PAGE ? (
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button
                label="Previous"
                variant="secondary"
                size="sm"
                disabled={offset === 0}
                onPress={() => setOffset((o) => Math.max(0, o - PAGE))}
              />
              <Text variant="caption" tone="muted" style={{ flex: 1, alignSelf: "center" }}>
                {offset + 1} to {Math.min(offset + PAGE, total)} of {total}
              </Text>
              <Button
                label="Next"
                variant="secondary"
                size="sm"
                disabled={offset + PAGE >= total}
                onPress={() => setOffset((o) => o + PAGE)}
              />
            </View>
          ) : null}
        </View>

        <SectionHeader
          title="Billing checks"
          action={{
            label: showChecks ? "Hide" : "Run",
            onPress: () => setShowChecks((v) => !v),
          }}
        />
        {showChecks ? (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
            {reconQuery.isLoading ? (
              <SkeletonList rows={2} />
            ) : reconQuery.data ? (
              <>
                {reconQuery.data.stripeError ? (
                  <Text variant="caption" tone="destructive">
                    {reconQuery.data.stripeError}
                  </Text>
                ) : null}
                <Text variant="caption" tone="muted">
                  {reconQuery.data.checkedAgainstStripe} checked against Stripe.{" "}
                  {reconQuery.data.paidWithoutSubscription.length} on a paid plan with no
                  subscription, {reconQuery.data.statusMismatch.length} with a status that
                  disagrees.
                </Text>
                <ListGroup>
                  {[
                    ...reconQuery.data.paidWithoutSubscription.map((t) => ({
                      id: t.id,
                      title: t.name,
                      subtitle: `${t.plan} plan, no subscription (${t.subscriptionStatus})`,
                    })),
                    ...reconQuery.data.statusMismatch.map((t) => ({
                      id: t.id,
                      title: t.name,
                      subtitle: `Ours: ${t.localStatus}, Stripe: ${t.stripeStatus}`,
                    })),
                  ].map((row, index) => (
                    <View key={`${row.id}-${index}`}>
                      {index > 0 ? <RowDivider inset={false} /> : null}
                      <ListRow
                        title={row.title}
                        subtitle={row.subtitle}
                        onPress={() => router.push(`/admin/team/${row.id}`)}
                      />
                    </View>
                  ))}
                </ListGroup>
              </>
            ) : null}
          </View>
        ) : null}

        {mixQuery.data && mixQuery.data.mix.length > 0 ? (
          <>
            <SectionHeader title="Industry mix" />
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
              <Text variant="caption" tone="muted">
                {mixQuery.data.answered} of {mixQuery.data.totalTeams} teams answered.
              </Text>
              <ListGroup>
                {mixQuery.data.mix.map((row, index) => (
                  <View key={row.industry}>
                    {index > 0 ? <RowDivider inset={false} /> : null}
                    <ListRow title={row.industry} value={String(row.count)} />
                  </View>
                ))}
              </ListGroup>
            </View>
          </>
        ) : null}
      </Screen>
    </>
  );
}
