import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { formatPhotoDateGroup } from "@everlumen/shared";
import { videoDuration, type ProjectVideo } from "@/api/project-videos";
import { radius, spacing, useTheme } from "@/theme";
import { Video, X } from "@/ui/icons";
import { Icon, IconButton, Text } from "@/ui";

/**
 * The project's site videos: the web project page's "Site videos" row.
 *
 * A row of tiles that scrolls sideways, each opening a full-screen player. Shown
 * with the photos unless the grid is filtered to photos only.
 */
export function ProjectVideos({ videos }: { videos: ProjectVideo[] }) {
  const theme = useTheme();
  const [playing, setPlaying] = useState<ProjectVideo | null>(null);

  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="overline" tone="muted">
        {`SITE VIDEOS · ${videos.length}`}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm }}
      >
        {videos.map((video) => (
          <Pressable
            key={video.id}
            accessibilityRole="button"
            accessibilityLabel={`Play ${video.caption?.trim() || "site video"}, ${videoDuration(video.duration_seconds)}`}
            disabled={!video.url}
            onPress={() => setPlaying(video)}
            style={({ pressed }) => ({
              width: 168,
              borderRadius: radius.lg,
              overflow: "hidden",
              backgroundColor: theme.colors.card,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.8 : video.url ? 1 : 0.5,
            })}
          >
            <View
              style={{
                height: 96,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.chrome,
              }}
            >
              <Icon icon={Video} size="lg" color="#ffffff" />
              <View
                style={{
                  position: "absolute",
                  right: spacing.xs,
                  bottom: spacing.xs,
                  paddingHorizontal: 6,
                  borderRadius: radius.sm,
                  backgroundColor: "rgba(0,0,0,0.6)",
                }}
              >
                <Text variant="caption" style={{ color: "#ffffff", fontSize: 12 }}>
                  {videoDuration(video.duration_seconds)}
                </Text>
              </View>
            </View>
            <View style={{ padding: spacing.sm }}>
              <Text variant="caption" numberOfLines={1} style={{ fontWeight: "600" }}>
                {video.caption?.trim() || "Site video"}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {formatPhotoDateGroup(video.created_at)}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <Modal
        visible={Boolean(playing)}
        transparent
        animationType="fade"
        onRequestClose={() => setPlaying(null)}
      >
        {playing?.url ? <Player url={playing.url} onClose={() => setPlaying(null)} /> : null}
      </Modal>
    </View>
  );
}

/** Mounted only while open, so the player is created and released with the modal. */
function Player({ url, onClose }: { url: string; onClose: () => void }) {
  const player = useVideoPlayer(url, (instance) => {
    instance.loop = false;
    instance.play();
  });
  return (
    <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.94)", justifyContent: "center" }}>
      <VideoView
        player={player}
        style={{ width: "100%", height: "70%" }}
        nativeControls
        contentFit="contain"
      />
      <View style={{ position: "absolute", top: 56, right: spacing.lg }}>
        <IconButton icon={X} accessibilityLabel="Close video" onPress={onClose} />
      </View>
    </View>
  );
}
