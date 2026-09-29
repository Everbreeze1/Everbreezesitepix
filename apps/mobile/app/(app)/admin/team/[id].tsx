import { useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { relativeTime } from "@everlumen/shared";
import {
  getPlatformTeamDetail,
  getTeamBilling,
  manageTeamSubscription,
  overrideTeamPlan,
  type SubscriptionAction,
} from "@/api/admin";
import { formatBytes, PLANS } from "@/api/admin-view";
import {
  AdminGate,
  CapabilityNotice,
  useAdminCan,
  useReasonPrompt,
} from "@/components/admin/AdminKit";
import { CreateUserSheet } from "@/components/admin/CreateUserSheet";
import { spacing } from "@/theme";
import { UserPlus, UserRound } from "@/ui/icons";
import {
  Badge,
  Button,
  Chip,
  ErrorState,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * One team, as the web's team page shows it.
 *
 * The business profile from the setup wizard, the plan and complimentary
 * overrides, the Stripe subscription (cancel at period end, resume, extend the
 * trial, cancel now), invoices, members and projects, and adding a person to
 * the team. Every write asks for a reason; cancelling now says what it costs.
 */
export default function AdminTeamScreen() {
  return (
    <AdminGate title="Team">
      <TeamDetail />
    </AdminGate>
  );
}

function TeamDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { denyReason } = useAdminCan();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin", "team", id],
    queryFn: () => getPlatformTeamDetail(id),
    enabled: Boolean(id),
  });
  const billingQuery = useQuery({
    queryKey: ["admin", "team-billing", id],
    queryFn: () => getTeamBilling(id),
    enabled: Boolean(id),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "team", id] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "team-billing", id] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "teams"] });
  };
  const { ask, sheet } = useReasonPrompt((error) => {
    if (!error) refresh();
  });

  const team = query.data;
  const billing = billingQuery.data;
  const deniedBilling = denyReason("billing");
  const deniedCreate = denyReason("owner");

  if (query.isLoading) return <SkeletonList rows={6} />;
  if (query.error || !team) {
    return (
      <ErrorState
        title="Could not load this team"
        message={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const subscription = (
    action: SubscriptionAction,
    title: string,
    description: string,
    trialDays?: number,
  ) =>
    ask({
      title,
      description,
      confirmLabel: action === "cancel_now" ? "Cancel now" : "Continue",
      destructive: action === "cancel_now",
      run: async (reason) =>
        setMessage(await manageTeamSubscription({ teamId: team.id, action, trialDays, reason })),
    });

  const profile = team.businessProfile;
  const profileLine = profile
    ? [profile.industry, profile.teamSize, profile.serviceArea].filter(Boolean).join(" · ")
    : "";

  return (
    <>
      <Stack.Screen
        options={{
          title: team.name,
          headerRight: () =>
            deniedCreate ? null : (
              <IconButton
                icon={UserPlus}
                accessibilityLabel="Add a person to this team"
                surface={false}
                tone="primary"
                onPress={() => setAdding(true)}
              />
            ),
        }}
      />
      <Screen
        scroll
        padded={false}
        refreshing={query.isRefetching}
        onRefresh={() => {
          void query.refetch();
          void billingQuery.refetch();
        }}
        bottomInset={spacing.xxl}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xs }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            <Badge label={team.plan} tone="primary" />
            <Badge label={team.subscriptionStatus} />
            {team.isInternal ? <Badge label="complimentary" tone="success" /> : null}
          </View>
          <Text variant="caption" tone="muted">
            Created {relativeTime(team.createdAt)}
          </Text>
          {profileLine ? <Text variant="caption">{profileLine}</Text> : null}
          {profile && profile.goals.length > 0 ? (
            <Text variant="caption" tone="muted">
              Goals: {profile.goals.join(", ")}
            </Text>
          ) : null}
          {profile?.heardFrom ? (
            <Text variant="caption" tone="muted">
              Heard from: {profile.heardFrom}
            </Text>
          ) : null}
          {message ? <Text variant="caption">{message}</Text> : null}
        </View>

        <SectionHeader title="Plan" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <Text variant="caption" tone="muted">
            Writes our own database and does not touch Stripe. Their card is unaffected.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            {PLANS.map((plan) => (
              <Chip
                key={plan}
                label={plan}
                selected={team.plan === plan}
                onPress={
                  deniedBilling || team.plan === plan
                    ? undefined
                    : () =>
                        ask({
                          title: `Move this team to the ${plan} plan?`,
                          description: "This changes the plan for every member of the team.",
                          confirmLabel: "Change plan",
                          run: (reason) => overrideTeamPlan({ teamId: team.id, plan, reason }),
                        })
                }
              />
            ))}
            <Chip
              label={team.isInternal ? "Remove complimentary" : "Make complimentary"}
              onPress={
                deniedBilling
                  ? undefined
                  : () =>
                      ask({
                        title: team.isInternal
                          ? "Remove complimentary access?"
                          : "Give this team complimentary access?",
                        description: team.isInternal
                          ? "They fall back to whatever their subscription allows."
                          : "Full access regardless of subscription, until someone turns this off.",
                        confirmLabel: "Change access",
                        run: (reason) =>
                          overrideTeamPlan({
                            teamId: team.id,
                            isInternal: !team.isInternal,
                            reason,
                          }),
                      })
              }
            />
          </View>
          <CapabilityNotice reason={deniedBilling} />
        </View>

        <SectionHeader title="Subscription" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          {billingQuery.isLoading ? (
            <SkeletonList rows={2} />
          ) : !billing ? (
            <Text variant="caption" tone="muted">
              Billing could not be read.
            </Text>
          ) : !billing.stripeSubscriptionId ? (
            <Text variant="caption" tone="muted">
              No Stripe subscription on this team. Use the plan overrides above.
            </Text>
          ) : (
            <>
              <Text variant="caption" tone="muted">
                {billing.stripe
                  ? [
                      `Stripe: ${billing.stripe.status}`,
                      billing.stripe.currentPeriodEnd
                        ? `renews ${new Date(billing.stripe.currentPeriodEnd).toLocaleDateString()}`
                        : null,
                      billing.stripe.trialEnd
                        ? `trial ends ${new Date(billing.stripe.trialEnd).toLocaleDateString()}`
                        : null,
                      billing.stripe.cancelAtPeriodEnd ? "cancels at period end" : null,
                    ]
                      .filter(Boolean)
                      .join(", ")
                  : "Stripe details unavailable."}
                {billing.stripe?.unavailableReason ? ` ${billing.stripe.unavailableReason}` : ""}
              </Text>
              {billing.stripe?.cancelAtPeriodEnd ? (
                <Button
                  label="Resume subscription"
                  variant="secondary"
                  fullWidth
                  disabled={Boolean(deniedBilling)}
                  onPress={() =>
                    subscription(
                      "resume",
                      "Withdraw the cancellation?",
                      "The subscription renews as normal at the end of this period.",
                    )
                  }
                />
              ) : (
                <Button
                  label="Cancel at period end"
                  variant="secondary"
                  fullWidth
                  disabled={Boolean(deniedBilling)}
                  onPress={() =>
                    subscription(
                      "cancel_at_period_end",
                      "Cancel at the end of the period?",
                      "They keep access until the end of the period they have paid for.",
                    )
                  }
                />
              )}
              <Button
                label="Extend trial 14 days"
                variant="secondary"
                fullWidth
                disabled={Boolean(deniedBilling)}
                onPress={() =>
                  subscription(
                    "extend_trial",
                    "Extend the trial by 14 days?",
                    "Adds 14 days from whichever is later: the current trial end, or today.",
                    14,
                  )
                }
              />
              <Button
                label="Cancel now"
                variant="destructive"
                fullWidth
                disabled={Boolean(deniedBilling)}
                onPress={() =>
                  subscription(
                    "cancel_now",
                    "Cancel immediately?",
                    "The subscription ends now, not at the end of the period already paid for. Prefer cancelling at period end unless they asked for this.",
                  )
                }
              />
            </>
          )}
          {billing && billing.invoices.length > 0 ? (
            <ListGroup>
              {billing.invoices.map((invoice, index) => (
                <View key={invoice.id}>
                  {index > 0 ? <RowDivider inset={false} /> : null}
                  <ListRow
                    title={invoice.number ?? "Invoice"}
                    subtitle={`${invoice.status ?? ""} · ${new Date(invoice.created).toLocaleDateString()}`}
                    value={`${(invoice.amountPaid / 100).toFixed(2)} ${invoice.currency.toUpperCase()}`}
                    onPress={
                      invoice.hostedUrl
                        ? () => void WebBrowser.openBrowserAsync(invoice.hostedUrl!)
                        : undefined
                    }
                  />
                </View>
              ))}
            </ListGroup>
          ) : null}
        </View>

        <SectionHeader title="Members" count={team.members.length} />
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ListGroup>
            {team.members.map((member, index) => (
              <View key={member.id}>
                {index > 0 ? <RowDivider /> : null}
                <ListRow
                  icon={UserRound}
                  title={member.fullName || member.email || "Unnamed"}
                  subtitle={member.email ?? undefined}
                  value={member.role}
                  onPress={() => router.push(`/admin/user/${member.id}`)}
                />
              </View>
            ))}
          </ListGroup>
        </View>

        {team.projects.length > 0 ? (
          <>
            <SectionHeader title="Projects" count={team.projects.length} />
            <View style={{ paddingHorizontal: spacing.lg }}>
              <ListGroup>
                {team.projects.slice(0, 50).map((project, index) => (
                  <View key={project.id}>
                    {index > 0 ? <RowDivider inset={false} /> : null}
                    <ListRow
                      title={project.name}
                      subtitle={`${project.status} · ${project.photoCount} photos · ${formatBytes(project.storageBytes)}`}
                    />
                  </View>
                ))}
              </ListGroup>
            </View>
          </>
        ) : null}
      </Screen>
      {sheet}
      <CreateUserSheet
        visible={adding}
        onClose={() => setAdding(false)}
        team={{ id: team.id, name: team.name }}
        onCreated={refresh}
      />
    </>
  );
}
