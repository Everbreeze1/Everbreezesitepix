import { useMemo, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import {
  createPhotoShareToken,
  listPhotoShares,
  openShareSheet,
  publicUrl,
  revokePhotoShare,
  type PhotoShare,
} from "@/api/sharing";
import {
  expiryLabel,
  liveShares,
  revokeWarning,
  shareState,
  sortedShares,
} from "@/api/photo-shares-view";
import { radius, spacing, useTheme } from "@/theme";
import { Link2, TriangleAlert } from "./icons";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { EmptyState, SkeletonList } from "./State";
import { Sheet } from "./Sheet";
import { Text } from "./Text";

/**
 * The links handed out for one photograph.
 *
 * Sharing used to be a single tap that minted a token and opened the OS share
 * sheet, and that was the whole of it. Two problems with that, both invisible
 * from the phone:
 *
 * **Every tap minted a fresh token.** Three taps left three independently live
 * URLs pointing at the same site photograph, and nothing on the phone could
 * count them.
 *
 * **Nothing could withdraw one.** A share link is a jobsite photograph on the
 * open internet with no login in front of it. Being able to create those and
 * not to revoke them is the wrong half of the pair to ship first.
 *
 * So Share now opens this: what already exists, how long each has left, and a
 * way to take one back.
 */
export function PhotoSharesSheet({
  visible,
  onClose,
  photoId,
  caption,
}: {
  visible: boolean;
  onClose: () => void;
  photoId: string;
  caption: string;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const queryKey = useMemo(() => ["photo-shares", photoId], [photoId]);

  const query = useQuery({
    queryKey,
    queryFn: () => listPhotoShares(photoId),
    enabled: visible && Boolean(photoId),
  });

  const shares = query.data ?? [];
  const ordered = useMemo(() => sortedShares(shares), [shares]);
  const live = liveShares(shares);

  const create = useMutation({
    mutationFn: async () => {
      const token = await createPhotoShareToken(photoId);
      const url = publicUrl("photos", token);
      if (!url) throw new Error("Sharing is not set up for this workspace.");
      return url;
    },
    onSuccess: async (url) => {
      setFailure(null);
      void queryClient.invalidateQueries({ queryKey });
      await openShareSheet(url, caption);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not create the link."),
  });

  const revoke = useMutation({
    mutationFn: (shareId: string) => revokePhotoShare(shareId),
    onMutate: async (shareId: string) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<PhotoShare[]>(queryKey);
      queryClient.setQueryData<PhotoShare[]>(queryKey, (prev) =>
        (prev ?? []).map((share) =>
          share.id === shareId ? { ...share, revoked_at: new Date().toISOString() } : share,
        ),
      );
      return { previous };
    },
    onError: (error: unknown, _id, context) => {
      /*
       * Put it back, and say so loudly. A link that appears withdrawn and is
       * not is the worst possible outcome here: somebody stops worrying about a
       * photograph that is still public.
       */
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      Alert.alert(
        "The link is still live",
        error instanceof Error
          ? error.message
          : "It could not be withdrawn. Please try again before you rely on it being closed.",
      );
    },
  });

  function confirmRevoke(share: PhotoShare) {
    Alert.alert("Withdraw this link?", revokeWarning(share), [
      { text: "Keep it", style: "cancel" },
      { text: "Withdraw", style: "destructive", onPress: () => revoke.mutate(share.id) },
    ]);
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Share this photo"
      subtitle={
        live.length > 0
          ? `${live.length} link${live.length === 1 ? "" : "s"} already open this photo`
          : "Anyone with the link can see it, without signing in."
      }
      footer={
        <View style={{ gap: spacing.xs }}>
          <Button
            label={create.isPending ? "Creating" : "Create a new link and share"}
            icon={Link2}
            fullWidth
            disabled={create.isPending}
            onPress={() => create.mutate()}
          />
          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : (
            <Text variant="caption" tone="muted">
              New links last a week. Existing ones stay live until they expire or you withdraw them.
            </Text>
          )}
        </View>
      }
    >
      {query.isLoading ? (
        <SkeletonList rows={2} />
      ) : query.error ? (
        <View style={{ gap: spacing.sm }}>
          {/*
            Not silent, and not a bare retry. Failing to LIST links leaves
            somebody unable to see what is already public, which is exactly the
            question this sheet exists to answer.
          */}
          <Badge label="Could not check" tone="warning" icon={TriangleAlert} variant="soft" />
          <Text variant="body" tone="muted">
            The links already open on this photo could not be loaded, so this list may not be
            complete.
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => void query.refetch()} />
        </View>
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="Not shared yet"
          body="Creating a link puts this photo on the open internet for anyone holding it."
        />
      ) : (
        <ScrollView style={{ maxHeight: 320 }}>
          <View style={{ gap: spacing.sm }}>
            {ordered.map((share) => {
              const state = shareState(share);
              return (
                <View
                  key={share.id}
                  style={{
                    gap: spacing.xs,
                    padding: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: state === "live" ? theme.colors.border : "transparent",
                    backgroundColor: state === "live" ? theme.colors.card : theme.colors.muted,
                    opacity: state === "live" ? 1 : 0.7,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Icon icon={Link2} size="sm" tone={state === "live" ? "primary" : "muted"} />
                    <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                      {expiryLabel(share)}
                    </Text>
                    {/*
                      A link with no expiry is permanent, and that is worth a
                      badge rather than a line of small print.
                    */}
                    {state === "live" && !share.expires_at ? (
                      <Badge label="Permanent" tone="warning" variant="soft" />
                    ) : null}
                  </View>

                  <Text variant="caption" tone="muted">
                    Created {relativeTime(share.created_at)}
                    {share.allow_download ? " · download allowed" : " · view only"}
                  </Text>

                  {state === "live" ? (
                    <Button
                      label="Withdraw"
                      variant="secondary"
                      size="sm"
                      disabled={revoke.isPending}
                      onPress={() => confirmRevoke(share)}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </Sheet>
  );
}
