import { StyleSheet, Text, View } from "react-native";
import Animated, {
  SensorType,
  useAnimatedSensor,
  useAnimatedStyle,
  useDerivedValue,
} from "react-native-reanimated";

/** Within this many degrees of level the bar turns green, as on web. */
const LEVEL_TOLERANCE = 2;

/**
 * The camera's level: a short bar that stays parallel to the real horizon and
 * turns green when the phone is square to it.
 *
 * Web reads `deviceorientation.gamma`. The phone reads gravity through
 * Reanimated's sensor hook, which is already in the app, so no sensor package
 * was added for it. The whole thing runs on the UI thread: a level that lags a
 * frame behind the hand holding it is worse than none.
 *
 * Reanimated reports gravity in Android's convention on both platforms: an
 * upright portrait phone reads y = +9.8. Rolling the top of the phone to the
 * right by t gives x = -9.8 sin t, y = 9.8 cos t, so atan2(x, y) is minus the
 * roll, which is exactly the rotation that keeps the bar level on screen.
 */
export function LevelIndicator({ size = 56 }: { size?: number }) {
  const sensor = useAnimatedSensor(SensorType.GRAVITY, { interval: 50 });

  const angle = useDerivedValue(() => {
    const { x, y } = sensor.sensor.value;
    if (!x && !y) return 0;
    const deg = (Math.atan2(x, y) * 180) / Math.PI;
    return Math.max(-45, Math.min(45, deg));
  });

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${angle.value}deg` }],
    backgroundColor: Math.abs(angle.value) < LEVEL_TOLERANCE ? "#34d399" : "#fbbf24",
  }));

  if (!sensor.isAvailable) {
    return (
      <View
        style={[styles.box, { width: size, height: size }]}
        accessibilityLabel="Level not available"
      >
        <Text style={styles.off}>LVL</Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.box, { width: size, height: size }]}
      accessibilityLabel="Level indicator"
      pointerEvents="none"
    >
      <View style={[styles.reference, { width: size * 0.62 }]} />
      <Animated.View style={[styles.bar, { width: size * 0.62 }, barStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  /* Web's rounded square beside the shutter, translucent over the live view. */
  box: {
    borderRadius: 16,
    backgroundColor: "rgba(24, 20, 16, 0.55)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  reference: {
    position: "absolute",
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.45)",
  },
  bar: { position: "absolute", height: 3, borderRadius: 1.5 },
  off: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
});
