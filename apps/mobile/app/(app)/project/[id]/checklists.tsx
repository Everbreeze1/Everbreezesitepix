import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Link, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator } from "react-native";
import { listProjectChecklists } from "@/api/checklists";
import { QueueBanner } from "@/components/QueueBanner";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

export default function ProjectChecklistsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["project-checklists", id],
    queryFn: () => listProjectChecklists(id!),
    enabled: Boolean(id),
  });

  const checklists = data ?? [];

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
            ListEmptyComponent={
              <Text
                style={[
                  typography.body,
                  { color: theme.colors.mutedForeground, textAlign: "center" },
                ]}
              >
                No checklists on this project. Apply one from the web app.
              </Text>
            }
            renderItem={({ item }) => {
              const complete = item.total > 0 && item.done === item.total;
              const ratio = item.total > 0 ? item.done / item.total : 0;
              return (
                <Link href={`/checklist/${item.id}`} asChild>
                  <Pressable
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
  track: { height: 6, borderRadius: radius.pill, marginTop: spacing.md, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill },
});
