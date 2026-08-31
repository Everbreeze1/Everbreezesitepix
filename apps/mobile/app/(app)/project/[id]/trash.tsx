import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { displayCaption, relativeTime } from "@everlumen/shared";
import {
  asPhotoListItem,
  listTrashedPhotos,
  restorePhotos,
  type TrashedPhoto,
} from "@/api/photo-edit";
import { signPhotoUrls } from "@/api/photos";
import { photoPatchRowId, type PhotoPatchPayload } from "@/offline/handlers";
import { enqueue } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";
import { gridColumns, radius, spacing, useTheme } from "@/theme";
import { CheckCheck, CircleCheck, RotateCcw, Trash2 } from "@/ui/icons";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  PhotoThumb,
  SkeletonList,
  Text,
} from "@/ui";

const GAP = spacing.xs;

/**
 * A project's deleted photos.
 *
 * The counterpart to bulk trash, and the reason trashing is safe to offer on a
 * phone at all. Without somewhere to undo it, a mis-tap on a three-column grid
 * with forty photos selected is unrecoverable from the device that made it.
 *
 * Permanent deletion is deliberately absent. The API has a `purgePhotos` op and
 * this screen does not call it: purging is irreversible, the trash is already
 * swept by a scheduled job, and nobody standing on scaffolding needs to free
 * disk space that urgently. Restore is the action a phone should have.
 */
export default function ProjectTrashScreen() {
  // Live width: a value read once never updates when an iPad rotates.
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const queryKey = useMemo(() => ["project-trash", id], [id]);

  const trashQuery = useQuery({
    queryKey,
    queryFn: () => listTrashedPhotos(id!),
    enabled: Boolean(id),
  });

  const photos = useMemo(() => trashQuery.data ?? [], [trashQuery.data]);

  const urlsQuery = useQuery({
    queryKey: ["project-trash-urls", id, photos.length],
    queryFn: () => signPhotoUrls(photos.map(asPhotoListItem)),
    enabled: photos.length > 0,
    // Signed URLs last an hour; re-signing sooner only spends requests.
    staleTime: 45 * 60 * 1000,
  });

  const urls = urlsQuery.data ?? {};
  const selecting = selected.size > 0;

  const toggle = useCallback((photoId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  /**
   * Put photos back.
   *
   * Optimistic and queued like every other write. `restorePhotos()` returns the
   * same `{ deleted_at: null }` patch the server op applies, so this goes
   * through the ordinary photo queue rather than needing a live connection.
   */
  const restore = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBusy(true);

    queryClient.setQueryData<TrashedPhoto[]>(queryKey, (current) =>
      (current ?? []).filter((photo) => !selected.has(photo.id)),
    );

    const payload: PhotoPatchPayload & { invalidate: unknown[][] } = {
      photoIds: ids,
      patch: restorePhotos(),
      invalidate: [queryKey, ["project-photos", id], ["gallery-photos"]],
    };

    await enqueue({
      id: photoPatchRowId("restore", ids),
      kind: "photo_patch",
      projectId: id ?? null,
      payload,
    });

    await refreshQueue();
    requestSync();
    setSelected(new Set());
    setBusy(false);
  }, [selected, queryClient, queryKey, id]);

  /*
   * Columns and tile size from the LIVE width.
   *
   * Was a hardcoded 3 and a one-off `Dimensions.get("window")`. Both are wrong
   * on a tablet: three tiles at 1024pt are over 300pt each, a contact sheet
   * showing nine photos where it could show twenty-five, and a width read once
   * never updates when an iPad rotates or is put into split screen.
   */
  const columns = gridColumns(width - spacing.lg * 2);
  const tile = (width - spacing.lg * 2 - GAP * (columns - 1)) / columns;

  return (
    <>
      <Stack.Screen
        options={{
          title: selecting ? `${selected.size} selected` : "Trash",
          headerRight: () =>
            photos.length > 0 ? (
              <IconButton
                icon={CheckCheck}
                accessibilityLabel="Select all"
                surface={false}
                tone="primary"
                onPress={() => setSelected(new Set(photos.map((photo) => photo.id)))}
              />
            ) : null,
        }}
      />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {trashQuery.isLoading ? (
          <SkeletonList rows={4} />
        ) : trashQuery.error ? (
          <ErrorState
            message={
              trashQuery.error instanceof Error ? trashQuery.error.message : "Could not load trash"
            }
            onRetry={() => void trashQuery.refetch()}
          />
        ) : photos.length === 0 ? (
          <EmptyState
            icon={Trash2}
            title="Trash is empty"
            body="Photos you delete land here first, so a mis-tap on site can be undone."
          />
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
            refreshControl={
              <RefreshControl
                refreshing={trashQuery.isRefetching}
                onRefresh={() => void trashQuery.refetch()}
                tintColor={theme.colors.mutedForeground}
                colors={[theme.colors.primary]}
              />
            }
          >
            <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>
              {`${photos.length} ${photos.length === 1 ? "photo" : "photos"}. Tap to select, then restore.`}
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
              {photos.map((photo) => {
                const picked = selected.has(photo.id);
                return (
                  <Pressable
                    key={photo.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${displayCaption(photo.caption, "Photo")}, deleted ${relativeTime(photo.deleted_at)}`}
                    accessibilityState={{ selected: picked }}
                    onPress={() => toggle(photo.id)}
                    style={{ width: tile, height: tile }}
                  >
                    <PhotoThumb uri={urls[photo.id]} width="100%" height="100%" />
                    <View
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        borderRadius: radius.sm,
                        borderWidth: 3,
                        borderColor: picked ? theme.colors.primary : "transparent",
                        // Everything here is deleted, so the whole grid is dimmed
                        // by default and selecting a tile brings it back.
                        backgroundColor: picked ? "transparent" : "rgba(0,0,0,0.4)",
                        alignItems: "flex-end",
                        padding: 4,
                      }}
                    >
                      {picked ? <Icon icon={CircleCheck} size="lg" tone="inverse" /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        )}

        {selecting ? (
          <View
            style={[
              {
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
                padding: spacing.md,
                backgroundColor: theme.colors.card,
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
              },
              theme.elevation.sheet,
            ]}
          >
            <Badge label={`${selected.size} selected`} tone="primary" variant="solid" />
            <View style={{ flex: 1 }} />
            <Button
              label="Cancel"
              variant="ghost"
              size="sm"
              disabled={busy}
              onPress={() => setSelected(new Set())}
            />
            <Button
              label="Restore"
              icon={RotateCcw}
              size="sm"
              loading={busy}
              onPress={() => void restore()}
            />
          </View>
        ) : null}
      </View>
    </>
  );
}
