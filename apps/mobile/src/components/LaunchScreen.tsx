import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { BrandButton } from "./BrandButton";
import { BrandMark } from "./BrandMark";
import { spacing, typography } from "@/theme/tokens";

/**
 * The branded launch screen, drawn rather than photographed.
 *
 * A splash *image* fails in three ways no amount of art direction fixes: one
 * raster has one resolution across screens from 720x1280 to 1440x3200, a dark
 * gradient across three thousand pixels of 8-bit PNG bands visibly on OLED, and
 * a redrawn mark drifts from the web app. Rendered from vector, none of those
 * exist.
 */

/**
 * The mark occupies only 75% of its own box.
 *
 * `BrandMark`'s blades are `A 192 192` arcs inside a 512 viewBox, so a quarter
 * of the height it is given is transparent padding. Sizing it naively makes the
 * logo look undersized and every surrounding gap read about 25% looser than the
 * spacing tokens claim, which is what made the first version float.
 */
const MARK_INK_RATIO = 0.75;

/** Visible diameter of the mark, before the box padding is added back. */
const MARK_INK = { fraction: 0.4, max: 180 };

/**
 * Cap on OS font scaling for the lockup.
 *
 * At scale 2.0 the wordmark and the button label are clipped outright rather
 * than merely large. Capping keeps the lockup intact; the rest of the app
 * scales normally, and nothing here is content anyone needs to read.
 */
const MAX_FONT_SCALE = 1.3;

export type LaunchScreenProps = {
  /** Fades out when the app is ready, then unmounts itself. */
  visible: boolean;
  onHidden?: () => void;
  /**
   * Shown once there is nothing left to wait for and the person is not signed
   * in, turning the screen into a welcome rather than a loading state.
   *
   * Absent while the session is still resolving, and absent entirely for
   * someone already signed in: offering "Sign in" to a signed-in user is a
   * dead end, and a launch screen that waits for a tap it does not need is
   * just a step between them and their work.
   */
  actionLabel?: string;
  onAction?: () => void;
};

export function LaunchScreen({ visible, onHidden, actionLabel, onAction }: LaunchScreenProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [reduceMotion, setReduceMotion] = useState(false);

  const screenFade = useRef(new Animated.Value(1)).current;
  const markScale = useRef(new Animated.Value(0.94)).current;
  const markFade = useRef(new Animated.Value(0)).current;
  const wordFade = useRef(new Animated.Value(0)).current;
  const actionFade = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduceMotion(enabled);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    /*
     * Someone who has asked the OS for reduced motion gets the finished state
     * immediately. That matters more than usual here: the glow below runs on an
     * infinite loop, and an infinite loop is exactly what the setting exists to
     * stop.
     */
    if (reduceMotion) {
      markFade.setValue(1);
      markScale.setValue(1);
      wordFade.setValue(1);
      glow.setValue(0.5);
      return;
    }

    Animated.parallel([
      Animated.timing(markFade, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(markScale, {
        toValue: 1,
        duration: 560,
        // Plain deceleration. The previous `Easing.back(1.2)` overshot by under
        // a point on an element this size, so it cost a spring curve and
        // rendered as nothing.
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(wordFade, {
        toValue: 1,
        delay: 160,
        duration: 420,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    /*
     * A slow breath on the glow. Without it a launch screen waiting on a slow
     * connection looks frozen, and frozen reads as hung.
     */
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    // Stops the loop rather than leaving it running against an unmounted tree.
    return () => loop.stop();
  }, [reduceMotion, glow, markFade, markScale, wordFade]);

  // The button arrives after the brand has landed: a call to action should not
  // appear before someone has read what the app is.
  useEffect(() => {
    if (!actionLabel) return;
    Animated.timing(actionFade, {
      toValue: 1,
      duration: reduceMotion ? 0 : 340,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [actionLabel, actionFade, reduceMotion]);

  useEffect(() => {
    if (visible) return;
    Animated.timing(screenFade, {
      toValue: 0,
      duration: reduceMotion ? 0 : 380,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onHidden?.();
    });
  }, [visible, screenFade, onHidden, reduceMotion]);

  const markInk = Math.min(width * MARK_INK.fraction, MARK_INK.max);
  const markBox = Math.round(markInk / MARK_INK_RATIO);
  const bloomSize = Math.round(markBox * 1.55);
  const buttonWidth = Math.round(Math.min(width * 0.66, 300));

  return (
    <Animated.View
      // Without this a screen reader walks straight past the overlay into the
      // app underneath and reads a screen nobody can see.
      accessibilityViewIsModal
      importantForAccessibility="yes"
      pointerEvents={visible ? "auto" : "none"}
      style={[StyleSheet.absoluteFill, styles.root, { opacity: screenFade }]}
    >
      <Svg
        width={width}
        height={height}
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Defs>
          {/* Centred on the lockup rather than the screen, so the lightest part
              of the wash sits behind the mark. */}
          <RadialGradient id="wash" cx="50%" cy="38%" r="82%">
            <Stop offset="0%" stopColor="#22304A" />
            <Stop offset="45%" stopColor="#1A2130" />
            <Stop offset="100%" stopColor="#0D1017" />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#wash)" />
      </Svg>

      <View
        style={[
          styles.center,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingHorizontal: Math.max(insets.left, insets.right, spacing.xl),
          },
        ]}
      >
        <View style={styles.lockup}>
          {/*
           * The bloom lives inside the mark's own wrapper. Previously it was
           * absolutely positioned in the outer flex box, so it centred on the
           * container while the mark sat well above it, and the glow haloed the
           * wordmark instead of the logo.
           */}
          <Animated.View
            style={[
              styles.markWrap,
              { width: markBox, height: markBox },
              { opacity: markFade, transform: [{ scale: markScale }] },
            ]}
          >
            <Animated.View
              pointerEvents="none"
              style={[
                styles.bloom,
                {
                  width: bloomSize,
                  height: bloomSize,
                  marginLeft: -bloomSize / 2,
                  marginTop: -bloomSize / 2,
                  opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.42, 0.82] }),
                  transform: [
                    { scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.05] }) },
                  ],
                },
              ]}
            >
              <Svg width={bloomSize} height={bloomSize}>
                <Defs>
                  <RadialGradient id="bloom" cx="50%" cy="50%" r="50%">
                    {/* Warm at the core, matching the light the mark itself
                        emits, cooling out into the blade blue. */}
                    <Stop offset="0%" stopColor="#FFF8EC" stopOpacity={0.1} />
                    <Stop offset="42%" stopColor="#3E8ADF" stopOpacity={0.22} />
                    <Stop offset="100%" stopColor="#1E5AA6" stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Rect width={bloomSize} height={bloomSize} fill="url(#bloom)" />
              </Svg>
            </Animated.View>

            <BrandMark size={markBox} gapColor="#141A26" />
          </Animated.View>

          <Animated.View style={[styles.words, { opacity: wordFade }]}>
            <Text
              accessibilityRole="header"
              accessibilityLabel="Everlumen"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={styles.wordmark}
            >
              EVERLUMEN
            </Text>
            <Text
              accessibilityLabel="Field documentation"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={styles.tagline}
            >
              FIELD DOCUMENTATION
            </Text>
          </Animated.View>
        </View>

        {/*
         * The row is always present, whether or not it holds a button.
         * Mounting the button into the flex column shifted the whole lockup
         * upward by its height, so the logo visibly jumped a second after it
         * had finished settling.
         */}
        <View style={styles.actionRow}>
          {actionLabel ? (
            <Animated.View
              style={{
                opacity: actionFade,
                transform: [
                  {
                    translateY: actionFade.interpolate({
                      inputRange: [0, 1],
                      outputRange: [10, 0],
                    }),
                  },
                ],
              }}
            >
              <BrandButton
                label={actionLabel}
                onPress={onAction}
                width={buttonWidth}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              />
            </Animated.View>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

/** Height reserved for the action row, so its arrival moves nothing. */
const ACTION_ROW_HEIGHT = 58 + spacing.xl;

const styles = StyleSheet.create({
  root: { backgroundColor: "#171B24", zIndex: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  /** Mark, wordmark and tagline are one object; the gaps inside it are tight. */
  lockup: { alignItems: "center" },
  markWrap: { alignItems: "center", justifyContent: "center" },
  bloom: { position: "absolute", left: "50%", top: "50%" },
  words: { alignItems: "center", marginTop: spacing.xl },
  wordmark: {
    ...typography.title,
    color: "#F9FCFF",
    letterSpacing: 4,
    fontWeight: "700",
    /*
     * Letter-spacing is applied after every glyph including the last, which
     * drags centred text left of true centre by half a space. Nudging by half
     * the tracking puts it back on the mark's axis.
     */
    marginLeft: 2,
  },
  tagline: {
    /*
     * Overline, not caption. At 13pt with 2pt tracking "FIELD DOCUMENTATION"
     * measures wider than "EVERLUMEN" does at 24pt, so the subordinate line was
     * physically the widest thing in the lockup and outranked the brand name.
     */
    ...typography.overline,
    // 5.12:1 on the lightest part of the wash. The previous #7E8C9E measured
    // 3.86:1 there, which fails AA for text this size, in an app used outdoors.
    color: "#93A3B5",
    letterSpacing: 1.6,
    marginLeft: 0.8,
    marginTop: spacing.sm,
  },
  actionRow: {
    height: ACTION_ROW_HEIGHT,
    marginTop: spacing.xxxl,
    alignItems: "center",
    justifyContent: "center",
  },
});
