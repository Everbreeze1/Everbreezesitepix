import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Link, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listProjectChecklists } from "@/api/checklists";
import { getProjectContributors } from "@/api/task-comments";
import { memberLabel } from "@/api/task-mentions";
import { QueueBanner } from "@/components/QueueBanner";
import { useAuth } from "@/lib/auth";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

type Filter = "all" | "mine" | "open";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Unfinished" },
  { id: "mine", label: "Mine" },
  { id: "all", label: "All" },
];

export default function ProjectChecklistsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("open");

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["project-checklists", id],
    queryFn: () => listProjectChecklists(id!),
    enabled: Boolean(id),
  });

  /*
   * Names for `assigned_to`, which is a bare user id on the row. Shown rather
   * than hidden because a checklist assigned to someone else is the single most
   * useful thing to know before starting one: two people working the same list
   * is how a job gets signed off twice and inspected once.
   */
  const membersQuery = useQuery({
    queryKey: ["project-contributors", id],
    queryFn: () => getProjectContributors(id!),
    enabled: Boolean(id),
    staleTime: 10 * 60 * 1000,
  });

  const nameById = useMemo(
    () => new Map((membersQuery.data ?? []).map((member) => [member.user_id, member])),
    [membersQuery.data],
  );

  const all = useMemo(() => data ?? [], [data]);

  const checklists = useMemo(() => {
    if (filter === "all") return all;
    if (filter === "mine") return all.filter((row) => row.assigned_to === user?.id);
    return all.filter((row) => row.total === 0 || row.done < row.total);
  }, [all, filter, user?.id]);

  return (
    <>
      <Stack.Screen options={{ title: "Checklists" }} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <QueueBanner />

        {isLoading ? (
          <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={theme.colors.primary} />
        ) : error ? (
          <View style={styles.centered}>
            <Text style={[typography.body, { color: theme.colors.destructive }]}>
              {error instanceof Error ? error.message : "Failed to load checklists"}
            </Text>
          </View>
        ) : (
          <FlatList
            data={checklists}
            keyExtractor={(item) => item.id}
            contentContainerStyle={
              checklists.length
                ? { padding: spacing.lg }
                : { flexGrow: 1, justifyContent: "center", padding: spacing.xl }
            }
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={theme.colors.primary}
              />
            }
            ListHeaderComponent={
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.sm, marginBottom: spacing.lg }}
              >
                {FILTERS.map((option) => {
                  const active = filter === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setFilter(option.id)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? theme.colors.primary : theme.colors.card,
                          borderColor: active ? theme.colors.primary : theme.colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          typography.caption,
                          {
                            fontWeight: "600",
                            color: active
                              ? theme.colors.primaryForeground
                              : theme.colors.mutedForeground,
                          },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            }
            ListEmptyComponent={
              <Text
                style={[
                  typography.body,
                  { color: theme.colors.mutedForeground, textAlign: "center" },
                ]}
              >
                {all.length === 0
                  ? "No checklists on this project. Apply one from the web app."
                  : "Nothing matches that filter."}
              </Text>
            }
            renderItem={({ item }) => {
              const complete = item.total > 0 && item.done === item.total;
              const ratio = item.total > 0 ? item.done / item.total : 0;
              return (
                <Link href={`/checklist/${item.id}`} asChild>
                  <Pressable
                    accessibilityRole="button"
                    style={[
                      styles.row,
                      { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                    ]}
                  >
                    <Text style={[typography.heading, { color: theme.colors.foreground }]}>
                      {item.name}
                    </Text>
                    <Text
                      style={[
                        typography.caption,
                        { color: theme.colors.mutedForeground, marginTop: spacing.xs },
                      ]}
                    >
                      {item.done} of {item.total} done
                      {item.assigned_to
                        ? item.assigned_to === user?.id
                          ? " · assigned to you"
                          : ` · ${memberLabel(nameById.get(item.assigned_to))}`
                        : ""}
                    </Text>

                    <View style={[styles.track, { backgroundColor: theme.colors.muted }]}>
                      <View
                        style={[
                          styles.fill,
                          {
                            // `flex` rather than a percentage width: a
                            // percentage on a zero-width parent renders nothing
                            // on the first layout pass.
                            width: `${Math.round(ratio * 100)}%`,
                            backgroundColor: complete
                              ? theme.colors.primary
                              : theme.colors.primaryGlow,
                          },
                        ]}
                      />
                    </View>
                  </Pressable>
                </Link>
              );
            }}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
  row: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    minHeight: HIT_TARGET,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  track: { height: 6, borderRadius: radius.pill, marginTop: spacing.md, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill },
});
