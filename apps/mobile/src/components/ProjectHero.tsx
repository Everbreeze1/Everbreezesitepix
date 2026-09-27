import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { Text } from "@/ui";

/**
 * The top of a project: its cover, or a warm gradient when it has none, with
 * the name set large in white over the bottom edge.
 *
 * The screen runs with the navigator header switched off so the cover can go
 * edge to edge under the status bar, which means this owns the top safe area
 * and draws its own back and overflow buttons. They sit on translucent dark
 * discs so they stay legible on any photograph.
 */

const HERO_HEIGHT = 240;

export function ProjectHero({
  title,
  subtitle,
  coverUri,
  left,
  right,
}: {
  title: string;
  subtitle?: string | null;
  coverUri?: string | null;
  /** The back button, or the selection's cancel. */
  left?: ReactNode;
  /** Overflow and other actions, right-aligned. */
  right?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ height: HERO_HEIGHT + insets.top, backgroundColor: theme.colors.chrome }}>
      {coverUri ? (
        <Image
          source={{ uri: coverUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            {/* Primary orange darkened toward the chrome brown: warm, never flat. */}
            <LinearGradient id="projectHeroFill" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#a8663a" />
              <Stop offset="1" stopColor="#5a3820" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#projectHeroFill)" />
        </Svg>
      )}

      {/* The scrim the title reads against, on a cover or on the gradient. */}
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="projectHeroScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.colors.chrome} stopOpacity={0.35} />
            <Stop offset="0.45" stopColor={theme.colors.chrome} stopOpacity={0} />
            <Stop offset="1" stopColor={theme.colors.chrome} stopOpacity={0.85} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#projectHeroScrim)" />
      </Svg>

      <View
        style={{
          position: "absolute",
          top: insets.top + spacing.sm,
          left: spacing.lg,
          right: spacing.lg,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
        }}
      >
        {left}
        <View style={{ flex: 1 }} />
        {right}
      </View>

      <View
        style={{
          position: "absolute",
          left: spacing.xl,
          right: spacing.xl,
          bottom: spacing.xl,
          gap: 2,
        }}
      >
        <Text
          variant="title"
          numberOfLines={2}
          accessibilityRole="header"
          style={{ color: "#ffffff", fontSize: 28, lineHeight: 34 }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="body" numberOfLines={1} style={{ color: "rgba(255,255,255,0.85)" }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A round translucent button for the hero's corners. */
export function ProjectHeroButton({
  accessibilityLabel,
  onPress,
  children,
}: {
  accessibilityLabel: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.disc, { opacity: pressed ? 0.7 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disc: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
});
