import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { relativeTime } from "@everlumen/shared";
import { discard, listRows, retryFailed, type OutboxRow } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import { useQueue } from "@/offline/use-queue";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

/**
 * What is still on the phone, and why.
 *
 * The queue has to be inspectable. A row that cannot send is holding a photo
 * that exists nowhere else, so "something went wrong" is not good enough: the
 * user needs the actual error, a way to try again, and a deliberate way to
 * throw it away.
 */
export default function QueueScreen() {
  const theme = useTheme();
  const counts = useQueue();
  const [rows, setRows] = useState<OutboxRow[]>([]);

  const load = useCallback(async () => {
    setRows(await listRows().catch(() => []));
  }, []);

  // `counts` changes whenever the drain finishes a row, which is exactly when
  // this list is out of date.
  useEffect(() => {
    void load();
  }, [load, counts.outstanding, counts.failed]);

  async function onRetryAll() {
    await retryFailed();
    await refreshQueue();
    requestSync();
    await load();
  }

  async function onDiscard(id: string) {
    await discard(id);
    await refreshQueue();
    await load();
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={
          rows.length
            ? { padding: spacing.lg }
            : { flexGrow: 1, justifyContent: "center", padding: spacing.xl }
        }
        ListHeaderComponent={
          counts.failed > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void onRetryAll()}
              style={[styles.retryAll, { backgroundColor: theme.colors.primary }]}
            >
              <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
                Retry {counts.failed} failed
              </Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          <Text
            style={[typography.body, { color: theme.colors.mutedForeground, textAlign: "center" }]}
          >
            Everything has been uploaded.
          </Text>
        }
        renderItem={({ item }) => {
          const isFailed = item.state === "failed";
          return (
            <View
              style={[
                styles.row,
                { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
              ]}
            >
              {item.local_uri ? (
                <Image
                  source={{ uri: item.local_uri }}
                  style={[styles.thumb, { backgroundColor: theme.colors.muted }]}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.thumb, { backgroundColor: theme.colors.muted }]} />
              )}

              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                  {isFailed ? "Failed" : item.state === "sending" ? "Uploading" : "Waiting"}
                </Text>
                <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
                  Captured {relativeTime(new Date(item.created_at).toISOString())}
                  {item.attempts > 0
                    ? ` · ${item.attempts} attempt${item.attempts === 1 ? "" : "s"}`
                    : ""}
                </Text>
                {isFailed && item.last_error ? (
                  <Text
                    numberOfLines={3}
                    style={[typography.caption, { color: theme.colors.destructive }]}
                  >
                    {item.last_error}
                  </Text>
                ) : null}
              </View>

              {isFailed ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => void onDiscard(item.id)}
                  style={styles.discard}
                >
                  <Text style={[typography.caption, { color: theme.colors.destructive }]}>
                    Discard
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  thumb: { width: 56, height: 56, borderRadius: radius.sm },
  discard: { minHeight: HIT_TARGET, justifyContent: "center", paddingHorizontal: spacing.sm },
  retryAll: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: HIT_TARGET,
    marginBottom: spacing.lg,
  },
});
