import { useMemo } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import {
  actorLabel,
  activityVerb,
  getTeamActivity,
  type ActivityKind,
  type ActivityItem,
} from "@/api/activity";
import { QueueBanner } from "@/components/QueueBanner";
import { spacing, useTheme } from "@/theme";
import { Camera, FileText, FolderKanban, Inbox, ListTodo } from "@/ui/icons";
import {
  Avatar,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListGroup,
  ListRow,
  PageHeader,
  RowDivider,
  SectionHeader,
  SkeletonList,
  Text,
  type LucideIcon,
} from "@/ui";

/**
 * What the team has been doing.
 *
 * Two questions, in the order people ask them: who is working (the contribution
 * list, busiest first, because a table sorted by name buries whoever actually
 * did the work this week) and what happened most recently.
 *
 * This screen is a tab, and tabs run with the navigator header switched off so
 * each one can own its top area. It therefore has to draw `PageHeader` itself:
 * the `Stack.Screen` title it used to carry is inert now, and without a header
 * the first row would sit under the status bar.
 */

/**
 * An icon per activity kind.
 *
 * `ActivityKind` is a string column upstream, so a value outside the union can
 * arrive. The lookup falls back rather than rendering a blank square, which is
 * the same defensive shape `activityVerb` already uses.
 */
const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  photo: Camera,
  task: ListTodo,
  report: FileText,
  project: FolderKanban,
};

export default function ActivityScreen() {
  const theme = useTheme();

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["team-activity"],
    queryFn: getTeamActivity,
  });

  const recent = data?.recent ?? [];
  const members = useMemo(
    () =>
      (data?.members ?? [])
        .slice()
        .sort((a, b) => b.photos + b.tasks - (a.photos + a.tasks)),
    [data?.members],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <PageHeader title="Activity" subtitle="Your team, most recent first" />
      <QueueBanner />

      {isLoading ? (
        <SkeletonList rows={6} />
      ) : error ? (
        <ErrorState
          message={error instanceof Error ? error.message : "Could not load team activity"}
          onRetry={() => void refetch()}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 120, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              tintColor={theme.colors.mutedForeground}
              colors={[theme.colors.primary]}
            />
          }
        >
          {members.length > 0 ? (
            <>
              <SectionHeader title="The team" count={members.length} />
              <View style={{ paddingHorizontal: spacing.lg }}>
                <ListGroup>
                  {members.map((member, index) => {
                    const name = member.fullName?.trim() || member.email || "Teammate";
                    return (
                      <View key={member.userId}>
                        {index === 0 ? null : <RowDivider />}
                        <ListRow
                          title={name}
                          subtitle={contributionLine(member)}
                          /*
                           * An avatar rather than the generic person glyph every
                           * row would otherwise share. Six names in one grey
                           * weight is a wall of text; a tinted initial is the
                           * cheapest thing that makes a row findable again, and
                           * the tint derives from the name so it matches
                           * wherever else that person appears.
                           */
                          right={<Avatar name={name} size="sm" />}
                        />
                      </View>
                    );
                  })}
                </ListGroup>
              </View>
            </>
          ) : null}

          <SectionHeader title="Recent" />

          {recent.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Nothing yet"
              body="Photos, tasks and reports from everyone on your team show up here as they happen."
            />
          ) : (
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
              {recent.map((item) => (
                <ActivityCard key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function ActivityCard({ item }: { item: ActivityItem }) {
  const openable = Boolean(item.projectId);
  const glyph = KIND_ICON[item.kind] ?? FolderKanban;

  return (
    <Card
      padded={false}
      onPress={
        openable
          ? () => {
              if (item.projectId) router.push(`/project/${item.projectId}`);
            }
          : undefined
      }
      accessibilityLabel={`${actorLabel(item)} ${activityVerb(item.kind)}${
        item.projectName ? ` on ${item.projectName}` : ""
      }`}
    >
      <View
        style={{
          flexDirection: "row",
          gap: spacing.md,
          padding: spacing.lg,
          alignItems: "flex-start",
        }}
      >
        <Icon icon={glyph} size="md" tone="primary" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="body">
            <Text variant="bodyStrong">{actorLabel(item)}</Text> {activityVerb(item.kind)}
            {item.projectName ? ` on ${item.projectName}` : ""}
          </Text>
          {item.title ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {item.title}
            </Text>
          ) : null}
          <Text variant="caption" tone="muted">
            {relativeTime(item.at)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function contributionLine(member: {
  photos: number;
  tasks: number;
  lastActivityAt: string | null;
}): string {
  const photos = `${member.photos} photo${member.photos === 1 ? "" : "s"}`;
  const tasks = `${member.tasks} task${member.tasks === 1 ? "" : "s"}`;
  const when = member.lastActivityAt ? relativeTime(member.lastActivityAt) : "nothing yet";
  return `${photos} · ${tasks} · ${when}`;
}
