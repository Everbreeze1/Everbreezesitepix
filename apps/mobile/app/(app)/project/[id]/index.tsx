import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, router, useFocusEffect } from "expo-router";
import {
  formatAddress,
  getProject,
  listProjectPhotos,
  signPhotoUrls,
  type PhotoListItem,
  type ProjectListItem,
} from "@/lib/projects";
import { colors } from "@/theme";

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [project, setProject] = useState<ProjectListItem | null>(null);
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!id) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [p, ph] = await Promise.all([getProject(id), listProjectPhotos(id)]);
        setProject(p);
        setPhotos(ph);
        setUrls(await signPhotoUrls(ph));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load project");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const address = project ? formatAddress(project) : null;

  return (
    <>
      <Stack.Screen options={{ title: project?.name ?? "Project" }} />
      <View style={styles.root}>
        {loading && !refreshing ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.ink} />
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
            <Pressable style={styles.button} onPress={() => void load()}>
              <Text style={styles.buttonText}>Retry</Text>
            </Pressable>
          </View>
        ) : !project ? (
          <Text style={styles.empty}>Project not found</Text>
        ) : (
          <>
            <View style={styles.header}>
              {address ? <Text style={styles.meta}>{address}</Text> : null}
              <Text style={styles.meta}>
                {photos.length} photo{photos.length === 1 ? "" : "s"} · {project.status}
              </Text>
              <Pressable
                style={styles.capture}
                onPress={() => router.push(`/project/${id}/capture`)}
              >
                <Text style={styles.captureText}>Capture photo</Text>
              </Pressable>
            </View>
            <FlatList
              data={photos}
              keyExtractor={(item) => item.id}
              numColumns={2}
              columnWrapperStyle={photos.length ? styles.row : undefined}
              contentContainerStyle={styles.grid}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void load(true)}
                  tintColor={colors.ink}
                />
              }
              ListEmptyComponent={
                <Text style={styles.empty}>No photos yet. Capture one from the field.</Text>
              }
              renderItem={({ item }) => {
                const uri = urls[item.id];
                return (
                  <View style={styles.tile}>
                    {uri ? (
                      <Image source={{ uri }} style={styles.image} />
                    ) : (
                      <View style={[styles.image, styles.imagePlaceholder]} />
                    )}
                    <Text numberOfLines={2} style={styles.caption}>
                      {item.caption ?? "Photo"}
                    </Text>
                  </View>
                );
              }}
            />
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 6 },
  meta: { color: colors.muted, fontSize: 13 },
  capture: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  captureText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  grid: { paddingHorizontal: 12, paddingBottom: 32 },
  row: { gap: 8 },
  tile: {
    flex: 1,
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  image: { width: "100%", aspectRatio: 1, backgroundColor: colors.border },
  imagePlaceholder: { opacity: 0.4 },
  caption: { padding: 8, fontSize: 12, color: colors.ink },
  center: { padding: 24, alignItems: "center", gap: 12 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 32, paddingHorizontal: 24 },
  error: { color: colors.danger, textAlign: "center" },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: { color: "#fff", fontWeight: "600" },
});
