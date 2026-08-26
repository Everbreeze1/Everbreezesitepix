import { useCallback, useEffect, useState } from "react";
import { FlatList, View } from "react-native";
import { Image } from "expo-image";
import { relativeTime } from "@everlumen/shared";
import { discard, listRows, retryFailed, type OutboxRow } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import { useQueue } from "@/offline/use-queue";
import { radius, spacing, useTheme } from "@/theme";
import { CircleCheck, RefreshCw, Trash2 } from "@/ui/icons";
import { Badge, Button, Card, EmptyState, Text, type BadgeTone } from "@/ui";

/**
 * What is still on the phone, and why.
 *
 * The queue has to be inspectable. A row that cannot send is holding a photo
 * that exists nowhere else, so "something went wrong" is not good enough: the
 * user needs the actual error, a way to try again, and a deliberate way to
 * throw it away.
 *
 * The three states are badged rather than written as a bold word, because a
 * list where every row starts with bold text at the same size gives the eye no
 * way to find the failed one. That is the only row anybody opens this screen
 * for.
 */

const STATE_LABEL: Record<OutboxRow["state"], string> = {
  pending: "Waiting",
  sending: "Uploading",
  failed: "Failed",
  done: "Sent",
};

const STATE_TONE: Record<OutboxRow["state"], BadgeTone> = {
  pending: "neutral",
  sending: "primary",
  failed: "danger",
  done: "success",
};

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
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
        ListHeaderComponent={
          counts.failed > 0 ? (
            <Button
              label={`Retry ${counts.failed} failed`}
              icon={RefreshCw}
              fullWidth
              onPress={() => void onRetryAll()}
            />
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon={CircleCheck}
            title="Everything is uploaded"
            body="Photos captured without signal wait here until there is a connection, then send on their own."
          />
        }
        renderItem={({ item }) => {
          const isFailed = item.state === "failed";
          return (
            <Card padded={false}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.md,
                  padding: spacing.md,
                }}
              >
                {/*
                 * The thumbnail is the local copy, not a signed URL. This row
                 * exists precisely because the photo has not reached the server,
                 * so there is nothing remote to point at.
                 */}
                <Image
                  source={item.local_uri ? { uri: item.local_uri } : undefined}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: radius.sm,
                    backgroundColor: theme.colors.muted,
                  }}
                  contentFit="cover"
                />

                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Badge label={STATE_LABEL[item.state]} tone={STATE_TONE[item.state]} />
                  <Text variant="caption" tone="muted">
                    {`Captured ${relativeTime(new Date(item.created_at).toISOString())}`}
                    {item.attempts > 0
                      ? ` · ${item.attempts} attempt${item.attempts === 1 ? "" : "s"}`
                      : ""}
                  </Text>
                  {isFailed && item.last_error ? (
                    // The real error text, verbatim. A rewritten one costs the
                    // person the only clue they have and support the only clue
                    // they will get.
                    <Text variant="caption" tone="destructive" numberOfLines={3}>
                      {item.last_error}
                    </Text>
                  ) : null}
                </View>

                {isFailed ? (
                  <Button
                    label="Discard"
                    variant="destructive"
                    size="sm"
                    icon={Trash2}
                    onPress={() => void onDiscard(item.id)}
                    accessibilityLabel="Discard this upload permanently"
                  />
                ) : null}
              </View>
            </Card>
          );
        }}
      />
    </View>
  );
}
