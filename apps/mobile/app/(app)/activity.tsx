import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import { actorLabel, activityVerb, getTeamActivity } from "@/api/activity";
import { QueueBanner } from "@/components/QueueBanner";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

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
        // Busiest first. A contribution table sorted by name buries the person
        // who actually did the work this week.
        .sort((a, b) => b.photos + b.tasks - (a.photos + a.tasks)),
    [data?.members],
  );

  return (
    <>
      <Stack.Screen options={{ title: "Activity" }} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <QueueBanner />

        {isLoading ? (
          <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={theme.colors.primary} />
        ) : error ? (
          <View style={styles.centered}>
            <Text style={[typography.body, { color: theme.colors.destructive }]}>
              {error instanceof Error ? error.message : "Could not load team activity"}
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={theme.colors.primary}
              />
            }
          >
            {members.length > 0 ? (
              <View style={{ marginBottom: spacing.xl }}>
                <Text
                  style={[
                    typography.overline,
                    { color: theme.colors.mutedForeground, marginBottom: spacing.sm },
                  ]}
                >
                  THE TEAM
                </Text>
                {members.map((member) => (
                  <View
                    key={member.userId}
                    style={[
                      styles.memberRow,
                      { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                        {member.fullName?.trim() || member.email || "Teammate"}
                      </Text>
                      <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
                        {member.photos} photo{member.photos === 1 ? "" : "s"} · {member.tasks} task
                        {member.tasks === 1 ? "" : "s"}
                        {member.lastActivityAt
                          ? ` · ${relativeTime(member.lastActivityAt)}`
                          : " · nothing yet"}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <Text
              style={[
                typography.overline,
                { color: theme.colors.mutedForeground, marginBottom: spacing.sm },
              ]}
            >
              RECENT
            </Text>

            {recent.length === 0 ? (
              <Text
                style={[
                  typography.body,
                  {
                    color: theme.colors.mutedForeground,
                    textAlign: "center",
                    marginTop: spacing.xl,
                  },
                ]}
              >
                Nothing yet. Activity from everyone on your team shows up here.
              </Text>
            ) : (
              recent.map((item) => {
                const openable = Boolean(item.projectId);
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={`${item.kind}-${item.id}`}
                    disabled={!openable}
                    onPress={() => {
                      if (item.projectId) router.push(`/project/${item.projectId}`);
                    }}
                    style={[
                      styles.activityRow,
                      { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                    ]}
                  >
                    <Text style={[typography.body, { color: theme.colors.foreground }]}>
                      <Text style={typography.bodyStrong}>{actorLabel(item)}</Text>{" "}
                      {activityVerb(item.kind)}
                      {item.projectName ? ` on ${item.projectName}` : ""}
                    </Text>
                    {item.title ? (
                      <Text
                        numberOfLines={1}
                        style={[typography.caption, { color: theme.colors.mutedForeground }]}
                      >
                        {item.title}
                      </Text>
                    ) : null}
                    <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
                      {relativeTime(item.at)}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    minHeight: HIT_TARGET,
  },
  activityRow: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    gap: 2,
    minHeight: HIT_TARGET,
  },
});
