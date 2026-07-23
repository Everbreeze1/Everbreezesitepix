import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Link, router, useFocusEffect } from "expo-router";
import { formatAddress, listProjects, type ProjectListItem } from "@/lib/projects";
import { colors } from "@/theme";

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setProjects(await listProjects());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={styles.hint}>Your SitePix projects</Text>
        <Pressable onPress={() => router.push("/account")} hitSlop={8}>
          <Text style={styles.link}>Account</Text>
        </Pressable>
      </View>

      {loading && !refreshing ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.ink} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.button} onPress={() => void load()}>
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          contentContainerStyle={
            projects.length ? styles.list : styles.emptyList
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={colors.ink}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No projects yet. Create one on the web app.</Text>
          }
          renderItem={({ item }) => {
            const address = formatAddress(item);
            return (
              <Link href={`/project/${item.id}`} asChild>
                <Pressable style={styles.row}>
                  <Text style={styles.name}>{item.name}</Text>
                  {address ? <Text style={styles.meta}>{address}</Text> : null}
                  <Text style={styles.status}>{item.status}</Text>
                </Pressable>
              </Link>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  hint: { color: colors.muted, fontSize: 14 },
  link: { color: colors.ink, fontWeight: "600", fontSize: 14 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  emptyList: { flexGrow: 1, justifyContent: "center", padding: 24 },
  center: { padding: 24, alignItems: "center", gap: 12 },
  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  name: { fontSize: 17, fontWeight: "600", color: colors.ink },
  meta: { marginTop: 4, fontSize: 13, color: colors.muted },
  status: { marginTop: 8, fontSize: 12, color: colors.muted, textTransform: "capitalize" },
  empty: { textAlign: "center", color: colors.muted, fontSize: 15 },
  error: { color: colors.danger, textAlign: "center" },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: { color: "#fff", fontWeight: "600" },
});
