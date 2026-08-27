import { useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { typography } from "@/theme/tokens";

/**
 * The primary call to action on a dark surface.
 *
 * Four things make a button on a dark background read as pressable, and the
 * flat rectangle this replaces had none of them:
 *
 * 1. **Shape.** A 10px radius on something 700px wide is a rectangle with the
 *    corners barely touched. Radius has to scale with the element, so this is a
 *    full pill.
 * 2. **Width.** A control spanning the whole screen reads as a bar or a banner.
 *    Constrained to roughly two thirds, it reads as a button.
 * 3. **Contrast.** Flat `#00599C` against `#171B24` is too close in value; it
 *    sinks. The fill is the gold the aperture blades are cut from, which parts
 *    hard from the dark screen and ties the action to the mark above it. The
 *    label had to flip to dark ink to follow the mark: white on `#FFB020`
 *    measures 1.8:1, where the brand navy on it measures 9.4:1.
 * 4. **Depth.** A coloured glow rather than a black drop shadow. Black shadows
 *    are invisible on a dark background; light is what separates a surface from
 *    the dark around it.
 */

export type BrandButtonProps = {
  label: string;
  onPress?: () => void;
  width: number;
  accessibilityLabel?: string;
  /** Caps OS font scaling so the label cannot outgrow the pill. */
  maxFontSizeMultiplier?: number;
};

const HEIGHT = 58;

export function BrandButton({
  label,
  onPress,
  width,
  accessibilityLabel,
  maxFontSizeMultiplier,
}: BrandButtonProps) {
  const press = useRef(new Animated.Value(0)).current;

  const animate = (to: number) =>
    Animated.timing(press, {
      toValue: to,
      duration: to === 1 ? 90 : 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

  return (
    <Animated.View
      style={{
        transform: [
          // A small dip on press. Without it the button looks painted on, since
          // a gradient fill cannot darken the way a flat one does.
          { scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) },
        ],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        onPress={onPress}
        onPressIn={() => animate(1)}
        onPressOut={() => animate(0)}
        style={[styles.pressable, { width, height: HEIGHT, borderRadius: HEIGHT / 2 }]}
      >
        <View style={[styles.fill, { borderRadius: HEIGHT / 2 }]}>
          <Svg width={width} height={HEIGHT} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="cta" x1="0" y1="0" x2="1" y2="1">
                {/*
                 * Deep gold into blade gold, and it cannot start any deeper.
                 * The label is dark ink now, so the constraint runs the other
                 * way round to the blue this replaced: #D97C0A still measures
                 * 5.6:1 behind the label where the blade end gives 9.4:1, and
                 * anything darker drops the top of the pill under AA.
                 */}
                <Stop offset="0" stopColor="#D97C0A" />
                <Stop offset="1" stopColor="#FFB020" />
              </LinearGradient>
            </Defs>
            <Rect width={width} height={HEIGHT} rx={HEIGHT / 2} ry={HEIGHT / 2} fill="url(#cta)" />
          </Svg>
          <Text
            maxFontSizeMultiplier={maxFontSizeMultiplier}
            numberOfLines={1}
            style={styles.label}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pressable: {
    /*
     * The glow is tinted with the button's own gold. A black shadow on a dark
     * background does nothing at all; a coloured one reads as the button
     * casting light, which is also what the mark above it is doing.
     */
    shadowColor: "#FFB020",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  fill: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  label: {
    ...typography.bodyStrong,
    /* The mark's own ground, so the label reads as cut out of the gold. */
    color: "#171A2C",
    letterSpacing: 0.4,
  },
});
