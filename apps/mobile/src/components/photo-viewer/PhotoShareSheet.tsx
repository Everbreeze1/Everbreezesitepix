import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Share, Switch, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPhotoShareToken,
  listPhotoShares,
  publicUrl,
  revokePhotoShare,
  type PhotoShare,
} from "@/api/sharing";
import { CAN_SHARE_PHOTO_FILE, sharePhotoFile } from "@/api/photo-viewer";
import { expiryLabel, revokeWarning } from "@/api/photo-shares-view";
import { liveShareRows } from "@/api/photo-viewer-view";
import { radius, spacing, useTheme } from "@/theme";
import { AtSign, Globe, Link2, Share2 } from "@/ui/icons";
import { Icon, Sheet, Text, type LucideIcon } from "@/ui";

/**
 * Share one photo: web's `SharePhotoDialog`, plus the two things a phone adds.
 *
 * The link half is the web dialog exactly: one switch. On mints a link with no
 * expiry (the value reports and documents use); off withdraws every live link
 * the photo has, including ones minted by the older per-tap flow, because
 * "sharing off" has to mean the customer's copy stops opening too.
 *
 * Above it, the photograph itself through the system share sheet (web's
 * `sharePhotoNative`), where the platform can carry a file. Below it, asking a
 * teammate: web has no separate "send to teammate" and neither does this; it
 * opens the Comments tab with an @ ready, which is how a teammate is pulled
 * into a photo in both apps and what raises their notification.
 */
export function PhotoShareSheet({
  visible,
  onClose,
  photoId,
  caption,
  imageUrl,
  localFileUri,
  onAskTeammate,
}: {
  visible: boolean;
  onClose: () => void;
  photoId: string;
  caption: string;
  /** The best URL for the image itself, for the native share. */
  imageUrl: string | null;
  /**
   * The photo as a file on this phone (the camera's just-taken shot), sent
   * as it is rather than downloaded first. iOS only, as the download is.
   */
  localFileUri?: string | null;
  onAskTeammate?: () => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const queryKey = ["photo-shares", photoId];
  const [failure, setFailure] = useState<string | null>(null);
  const [sendingFile, setSendingFile] = useState(false);

  const query = useQuery({
    queryKey,
    queryFn: () => listPhotoShares(photoId),
    enabled: visible && Boolean(photoId),
  });

  const live = liveShareRows(query.data ?? []);
  const current = live[0] ?? null;
  const url = current ? publicUrl("photos", current.token) : null;

  const toggle = useMutation({
    mutationFn: async (enable: boolean) => {
      if (enable) {
        const token = await createPhotoShareToken(photoId, 0, true);
        if (!token) throw new Error("Sharing is not set up for this workspace.");
        return;
      }
      // Every live row, not just the one on show: see the note above.
      for (const row of live) await revokePhotoShare(row.id);
    },
    onMutate: () => setFailure(null),
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not change sharing."),
    /*
     * Always re-read. Turning sharing off is several writes when a photo
     * carries older links, so a failure halfway leaves some revoked and some
     * not; the server's answer beats an optimistic guess that would show the
     * switch on beside a link that no longer opens, or off beside one that does.
     */
    onSettled: () => void queryClient.invalidateQueries({ queryKey }),
  });

  async function sendLink() {
    if (!url) return;
    try {
      await Share.share({ message: url, title: caption });
    } catch {
      // Dismissing the share sheet is not a failure.
    }
  }

  async function sendFile() {
    if (!imageUrl && !localFileUri) return;
    setSendingFile(true);
    setFailure(null);
    try {
      if (localFileUri) await Share.share({ url: localFileUri, title: caption });
      else if (imageUrl) await sharePhotoFile(imageUrl, caption);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not share the photo.");
    } finally {
      setSendingFile(false);
    }
  }

  function onSwitch(next: boolean) {
    if (toggle.isPending) return;
    if (next) {
      toggle.mutate(true);
      return;
    }
    Alert.alert(
      "Turn off link sharing?",
      current ? revokeWarning(current) : "The link stops working immediately.",
      [
        { text: "Keep it on", style: "cancel" },
        { text: "Turn off", style: "destructive", onPress: () => toggle.mutate(false) },
      ],
    );
  }

  const expiring: PhotoShare | null = current?.expires_at ? current : null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Share photo"
      subtitle="Anyone with the link can view this photo. They see nothing else on the project."
    >
      <View style={{ gap: spacing.md }}>
        {/*
          The three ways a photo leaves the viewer, as icon tiles with a short
          label under each, the way a phone's own share row looks, rather than
          three full-width buttons of text stacked on top of each other.
        */}
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {CAN_SHARE_PHOTO_FILE ? (
            <ShareTile
              icon={Share2}
              label="Send photo"
              accessibilityLabel="Send the photo"
              accessibilityHint="Opens the share sheet with the photo itself"
              busy={sendingFile}
              disabled={!imageUrl && !localFileUri}
              onPress={() => void sendFile()}
            />
          ) : null}
          <ShareTile
            icon={Link2}
            label="Send link"
            accessibilityLabel="Copy or send link"
            accessibilityHint={
              url
                ? "Opens the share sheet, which can copy the link or send it"
                : "Turn on link sharing below first"
            }
            disabled={!url}
            onPress={() => void sendLink()}
          />
          {onAskTeammate ? (
            <ShareTile
              icon={AtSign}
              label="Ask teammate"
              accessibilityLabel="Ask a teammate about it"
              accessibilityHint="Opens the comments with an @ mention ready, which notifies them"
              onPress={onAskTeammate}
            />
          ) : null}
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
            padding: spacing.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.card,
          }}
        >
          <Icon icon={Globe} size="md" tone={current ? "primary" : "muted"} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">
              {current ? "Anyone with the link" : "Link sharing off"}
            </Text>
            <Text variant="caption" tone="muted">
              {current
                ? "Turn this off and the link stops working immediately."
                : "Only your team can see this photo."}
            </Text>
          </View>
          {query.isLoading || toggle.isPending ? (
            <ActivityIndicator color={theme.colors.mutedForeground} />
          ) : (
            <Switch
              value={Boolean(current)}
              onValueChange={onSwitch}
              disabled={Boolean(query.error)}
              trackColor={{ true: theme.colors.primary, false: theme.colors.input }}
              accessibilityLabel="Public link"
            />
          )}
        </View>

        {query.error ? (
          <Text variant="caption" tone="destructive">
            Could not check whether this photo is shared.{" "}
            <Text variant="caption" tone="primary" onPress={() => void query.refetch()}>
              Try again
            </Text>
          </Text>
        ) : null}

        {current && url ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Share link ${url}`}
            onPress={() => void sendLink()}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              padding: spacing.md,
              borderRadius: radius.md,
              backgroundColor: pressed ? theme.colors.secondary : theme.colors.muted,
            })}
          >
            <Icon icon={Link2} size="sm" tone="muted" />
            <Text variant="caption" selectable numberOfLines={2} style={{ flex: 1 }}>
              {url}
            </Text>
            <Icon icon={Share2} size="sm" tone="primary" />
          </Pressable>
        ) : null}

        {/*
          Only ever shown for a link minted by the older flow. New ones do not
          expire, so saying nothing would let a dated link look permanent right
          up until the morning it stopped working.
        */}
        {expiring?.expires_at ? (
          <Text variant="caption" tone="safety">
            {expiryLabel(expiring)}. This link was set to expire on{" "}
            {new Date(expiring.expires_at).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            . Turn sharing off and on again to replace it with one that does not.
          </Text>
        ) : null}

        {failure ? (
          <Text variant="caption" tone="destructive">
            {failure}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

/** One way to share: a round icon over a short label. */
function ShareTile({
  icon,
  label,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  disabled,
  busy,
}: {
  icon: LucideIcon;
  label: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const theme = useTheme();
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        gap: spacing.sm,
        paddingVertical: spacing.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.secondary : theme.colors.card,
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.accent,
        }}
      >
        {busy ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : (
          <Icon icon={icon} size="md" tone="primary" />
        )}
      </View>
      <Text variant="caption" style={{ fontWeight: "700" }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
