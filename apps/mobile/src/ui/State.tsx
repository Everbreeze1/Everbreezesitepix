import { useEffect, useRef } from "react";
import { Inbox, TriangleAlert, WifiOff } from "@/ui/icons";
import { Animated, Easing, View, type DimensionValue } from "react-native";
import { radius, spacing, useTheme } from "@/theme";
import { Button } from "./Button";
import { Icon, type LucideIcon } from "./Icon";
import { Text } from "./Text";

/**
 * The three states a screen is in when it has nothing to show.
 *
 * Every list screen had been rendering `<Text>No projects yet</Text>` centred
 * on an otherwise blank canvas, and a blank canvas is the same picture whether
 * the query returned zero rows, threw, or is still running. On a phone that
 * happens to be out of signal those three are genuinely hard to tell apart, and
 * telling them apart is the difference between "keep working" and "go and find
 * a bar of signal".
 */

export function EmptyState({
  icon = Inbox,
  title,
  body,
  action,
  secondaryAction,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void; icon?: LucideIcon };
  secondaryAction?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: "center", padding: spacing.xxl, gap: spacing.md }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.secondary,
        }}
      >
        <Icon icon={icon} size="xxl" tone="muted" />
      </View>
      <Text variant="heading" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="muted" align="center" style={{ maxWidth: 320 }}>
          {body}
        </Text>
      ) : null}
      {action ? (
        <Button
          label={action.label}
          icon={action.icon}
          onPress={action.onPress}
          style={{ marginTop: spacing.sm }}
        />
      ) : null}
      {secondaryAction ? (
        <Button label={secondaryAction.label} variant="ghost" onPress={secondaryAction.onPress} />
      ) : null}
    </View>
  );
}

/**
 * A failed query.
 *
 * `message` is the real error text, not a friendly rewrite of it. A field app
 * that says "Something went wrong" gives the person holding it nothing to act
 * on and gives whoever they call nothing to go on either. The offline case gets
 * its own icon because it is the one the user can actually fix by walking.
 */
export function ErrorState({
  title = "Could not load this",
  message,
  offline = false,
  onRetry,
}: {
  title?: string;
  message?: string;
  offline?: boolean;
  onRetry?: () => void;
}) {
  return (
    <View style={{ alignItems: "center", padding: spacing.xxl, gap: spacing.md }}>
      <Icon
        icon={offline ? WifiOff : TriangleAlert}
        size="xxl"
        tone={offline ? "muted" : "safety"}
      />
      <Text variant="heading" align="center">
        {offline ? "No connection" : title}
      </Text>
      {message ? (
        <Text variant="caption" tone="muted" align="center" style={{ maxWidth: 320 }}>
          {message}
        </Text>
      ) : null}
      {onRetry ? <Button label="Try again" variant="outline" onPress={onRetry} /> : null}
    </View>
  );
}

/**
 * A shimmering placeholder block.
 *
 * A spinner says "wait"; a skeleton says "wait, and here is the shape of what
 * is coming", which stops the layout jumping when the data lands. The animation
 * runs on the native driver, so it keeps moving during the JS work that the
 * loading state exists to cover.
 */
export function Skeleton({
  width = "100%",
  height = 16,
  rounded = radius.sm,
}: {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
}) {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: rounded,
        backgroundColor: theme.colors.secondary,
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
      }}
    />
  );
}

/** A stack of skeleton rows shaped like the list that is loading. */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Skeleton width={44} height={44} rounded={radius.md} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Skeleton width="60%" height={14} />
            <Skeleton width="35%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}
