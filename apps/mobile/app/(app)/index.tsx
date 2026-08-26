import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { projectDisplayName } from "@everlumen/shared";
import { formatAddress, listProjects } from "@/api/projects";
import { QueueBanner } from "@/components/QueueBanner";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

export default function ProjectsScreen() {
  const theme = useTheme();
  const [search, setSearch] = useState("");

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });

  const projects = useMemo(() => {
    const all = data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((project) => {
      const address = formatAddress(project) ?? "";
      return (
        projectDisplayName(project).toLowerCase().includes(needle) ||
        address.toLowerCase().includes(needle)
      );
    });
  }, [data, search]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <QueueBanner />
      <View style={styles.toolbar}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search projects"
          placeholderTextColor={theme.colors.mutedForeground}
          autoCapitalize="none"
          style={[
            styles.search,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
              color: theme.colors.foreground,
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/activity")}
          hitSlop={8}
          style={styles.accountLink}
        >
          <Text style={[typography.bodyStrong, { color: theme.colors.primary }]}>Activity</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/account")}
          hitSlop={8}
          style={styles.accountLink}
        >
          <Text style={[typography.bodyStrong, { color: theme.colors.primary }]}>Account</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={theme.colors.primary} />
      ) : error ? (
        <View style={styles.centered}>
          <Text style={[typography.body, { color: theme.colors.destructive, textAlign: "center" }]}>
            {error instanceof Error ? error.message : "Failed to load projects"}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={[styles.primaryButton, { backgroundColor: theme.colors.primary }]}
            onPress={() => void refetch()}
          >
            <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          contentContainerStyle={
            projects.length ? styles.list : [styles.list, { flexGrow: 1, justifyContent: "center" }]
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
              {search.trim()
                ? "No projects match that search."
                : "No projects yet. Start one from the site."}
            </Text>
          }
          renderItem={({ item }) => {
            const address = formatAddress(item);
            return (
              <Link href={`/project/${item.id}`} asChild>
                <Pressable
                  accessibilityRole="button"
                  style={[
                    styles.row,
                    { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                  ]}
                >
                  <Text style={[typography.heading, { color: theme.colors.foreground }]}>
                    {projectDisplayName(item)}
                  </Text>
                  {address ? (
                    <Text
                      style={[
                        typography.caption,
                        { color: theme.colors.mutedForeground, marginTop: 4 },
                      ]}
                      numberOfLines={1}
                    >
                      {address}
                    </Text>
                  ) : null}
                  <Text
                    style={[
                      typography.overline,
                      { color: theme.colors.mutedForeground, marginTop: spacing.sm },
                    ]}
                  >
                    {item.status?.toUpperCase()}
                  </Text>
                </Pressable>
              </Link>
            );
          }}
        />
      )}

      <Pressable
        accessibilityRole="button"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => router.push("/project-new")}
      >
        <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
          New project
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  search: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    minHeight: HIT_TARGET,
  },
  accountLink: { minHeight: HIT_TARGET, justifyContent: "center" },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 120 },
  centered: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
  row: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.xl,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    minHeight: HIT_TARGET,
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  primaryButton: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: HIT_TARGET,
    justifyContent: "center",
  },
});
