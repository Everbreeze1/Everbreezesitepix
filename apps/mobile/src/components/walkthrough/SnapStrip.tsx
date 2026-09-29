import { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { formatSnapOffset, type WalkthroughSnap } from "@/api/walkthrough-snap-rules";
import { radius, spacing } from "@/theme";
import { Icon } from "@/ui";
import { Video } from "@/ui/icons";

/**
 * The photos snapped so far in a walkthrough, in a row across the bottom of
 * the live view, oldest first and the newest at the end, scrolled to it each
 * time a snap lands.
 *
 * Jon, 2026-09-29: "The snaps we take during walkthrough should be lined up
 * across the bottom of the camera window to show what we have snapped".
 *
 * A snap that is still to be taken from the recording (every snap on Android,
 * where the camera cannot take a still while it records) shows as a tile with
 * its time in the recording until the frame is pulled out at Stop, so each
 * press visibly registers either way.
 */
export function SnapStrip({ snaps, tile = 56 }: { snaps: WalkthroughSnap[]; tile?: number }) {
  const scroller = useRef<ScrollView>(null);

  useEffect(() => {
    if (!snaps.length) return;
    // After layout, or it scrolls to the end of the row before the new tile.
    const timer = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [snaps.length]);

  if (!snaps.length) return null;

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel={`${snaps.length} ${snaps.length === 1 ? "photo" : "photos"} snapped`}
    >
      {snaps.map((snap, index) => (
        <View
          key={snap.id}
          style={[styles.tile, { width: tile, height: tile }]}
          accessible
          accessibilityLabel={`Photo ${index + 1} at ${formatSnapOffset(snap.offsetSeconds)}`}
        >
          {snap.uri ? (
            <Image source={{ uri: snap.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={styles.pending}>
              <Icon icon={Video} size="sm" color="#fff" />
            </View>
          )}
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{formatSnapOffset(snap.offsetSeconds)}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingHorizontal: spacing.sm, alignItems: "center" },
  tile: {
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  pending: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 12 },
  badge: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingVertical: 1,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "600", textAlign: "center" },
});
