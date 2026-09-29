import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import { getAdminMetrics } from "@/api/admin";
import { ADMIN_SECTIONS, WEB_ONLY_ADMIN, type AdminSectionId } from "@/api/admin-view";
import { AdminGate, StatGrid, StatTile, useAdminCan } from "@/components/admin/AdminKit";
import { spacing } from "@/theme";
import {
  Activity,
  Bell,
  Building2,
  Gauge,
  LifeBuoy,
  ScrollText,
  ShieldCheck,
  Users,
} from "@/ui/icons";
import {
  Badge,
  ErrorState,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
  type LucideIcon,
} from "@/ui";

const SECTION_ICONS: Record<AdminSectionId, LucideIcon> = {
  users: Users,
  teams: Building2,
  feedback: LifeBuoy,
  notifications: Bell,
  health: Activity,
  usage: Gauge,
  security: ShieldCheck,
  "audit-log": ScrollText,
};

/**
 * The admin console: the web's Admin dashboard, on a phone.
 *
 * Platform staff only. The route, the menu row and the Account row all ask
 * `checkIsPlatformAdmin`, the same op the web's AdminLayout asks, and every op
 * behind these screens re-checks membership and role server-side. Subscribers,
 * including account owners, never see any of it: which accounts sign up and
 * what they may do is Everlumen's to control, not theirs.
 *
 * This screen is the web's Overview (the platform totals) with the web's
 * section list under it, each one its own screen.
 */
export default function AdminHomeScreen() {
  return (
    <AdminGate title="Admin">
      <AdminHome />
    </AdminGate>
  );
}

function AdminHome() {
  const { role } = useAdminCan();
  const metricsQuery = useQuery({ queryKey: ["admin", "metrics"], queryFn: getAdminMetrics });
  const m = metricsQuery.data;

  return (
    <Screen
      scroll
      padded={false}
      refreshing={metricsQuery.isRefetching}
      onRefresh={() => void metricsQuery.refetch()}
      bottomInset={spacing.xxl}
    >
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            Platform-wide tools, restricted to Everlumen staff.
          </Text>
          {role ? <Badge label={role} tone="primary" /> : null}
        </View>

        {metricsQuery.isLoading ? (
          <SkeletonList rows={2} />
        ) : metricsQuery.error || !m ? (
          <ErrorState
            title="Could not load the totals"
            message={metricsQuery.error instanceof Error ? metricsQuery.error.message : undefined}
            onRetry={() => void metricsQuery.refetch()}
          />
        ) : (
          <StatGrid>
            <StatTile label="Users" value={String(m.totalUsers)} />
            <StatTile label="Teams" value={String(m.totalTeams)} />
            <StatTile
              label="Projects"
              value={String(m.totalProjects)}
              note={
                m.unattributedProjects === null
                  ? undefined
                  : m.unattributedProjects > 0
                    ? `${m.unattributedProjects} belong to no team`
                    : "All attributed to a team"
              }
            />
            <StatTile label="Photos" value={String(m.totalPhotos)} />
            <StatTile
              label="Plans"
              value={`${m.teamsByPlan.team} team`}
              note={`${m.teamsByPlan.pro} pro, ${m.teamsByPlan.starter} starter`}
            />
            <StatTile
              label="Subscriptions"
              value={`${m.subscriptions.active} active`}
              note={`${m.subscriptions.inactive} inactive`}
            />
            <StatTile
              label="Signups, 30 days"
              value={String(m.signupsLast30Days.reduce((sum, day) => sum + day.count, 0))}
            />
          </StatGrid>
        )}
      </View>

      <SectionHeader title="Sections" />
      <View style={{ paddingHorizontal: spacing.lg }}>
        <ListGroup>
          {ADMIN_SECTIONS.map((section, index) => (
            <View key={section.id}>
              {index > 0 ? <RowDivider /> : null}
              <ListRow
                icon={SECTION_ICONS[section.id]}
                title={section.label}
                subtitle={section.hint}
                onPress={() => router.push(`/admin/${section.id}`)}
              />
            </View>
          ))}
        </ListGroup>
      </View>

      {m && m.recentTeams.length > 0 ? (
        <>
          <SectionHeader title="Recent teams" />
          <View style={{ paddingHorizontal: spacing.lg }}>
            <ListGroup>
              {m.recentTeams.map((team, index) => (
                <View key={team.id}>
                  {index > 0 ? <RowDivider /> : null}
                  <ListRow
                    icon={Building2}
                    title={team.name}
                    subtitle={`${team.plan} · ${team.subscriptionStatus} · ${relativeTime(team.createdAt)}`}
                    onPress={() => router.push(`/admin/team/${team.id}`)}
                  />
                </View>
              ))}
            </ListGroup>
          </View>
        </>
      ) : null}

      <SectionHeader title="Still on the web" />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        <ListGroup>
          {WEB_ONLY_ADMIN.map((item, index) => (
            <View key={item}>
              {index > 0 ? <RowDivider inset={false} /> : null}
              <ListRow title={item} />
            </View>
          ))}
        </ListGroup>
      </View>
    </Screen>
  );
}
