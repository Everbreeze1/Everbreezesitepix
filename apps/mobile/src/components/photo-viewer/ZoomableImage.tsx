import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { PhotoThumb } from "@/ui";
import { viewerColors as c } from "./viewer-theme";

export type ZoomControls = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
};

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;
const STEP = 1.6;
const EASE = { duration: 180 };

/**
 * One photograph that pinches, pans and double-taps to zoom.
 *
 * Web uses `react-zoom-pan-pinch`; this is the same three gestures on
 * Reanimated and Gesture Handler, both already in the app. Pan is only live
 * while zoomed in, so at 1x a horizontal drag belongs to the pager and swipes
 * to the next photo, and at 2x it moves around the photo instead.
 *
 * `ref` exposes zoom in, zoom out and reset for the tablet's zoom controls.
 */
export const ZoomableImage = forwardRef<
  ZoomControls,
  {
    /** The full-size original, once signed. */
    uri: string | null | undefined;
    /** The grid's thumbnail, shown while the original loads. */
    placeholder: string | null | undefined;
    width: number;
    height: number;
    /** False once paged away from, which snaps the zoom back. */
    active: boolean;
    onZoomChange?: (zoomed: boolean) => void;
    onSingleTap?: () => void;
    accessibilityLabel?: string;
  }
>(function ZoomableImage(
  { uri, placeholder, width, height, active, onZoomChange, onSingleTap, accessibilityLabel },
  ref,
) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const report = (next: boolean) => {
    setZoomed(next);
    onZoomChange?.(next);
  };

  const clampTranslate = (s: number) => {
    "worklet";
    const maxX = Math.max(0, (width * s - width) / 2);
    const maxY = Math.max(0, (height * s - height) / 2);
    return { maxX, maxY };
  };

  const animateTo = (s: number) => {
    "worklet";
    const next = Math.min(Math.max(s, MIN_SCALE), MAX_SCALE);
    const { maxX, maxY } = clampTranslate(next);
    const nx = Math.min(Math.max(tx.value, -maxX), maxX);
    const ny = Math.min(Math.max(ty.value, -maxY), maxY);
    scale.value = withTiming(next, EASE);
    tx.value = withTiming(next === 1 ? 0 : nx, EASE);
    ty.value = withTiming(next === 1 ? 0 : ny, EASE);
    savedScale.value = next;
    savedTx.value = next === 1 ? 0 : nx;
    savedTy.value = next === 1 ? 0 : ny;
    scheduleOnRN(report, next > 1.01);
  };

  useImperativeHandle(ref, () => ({
    zoomIn: () => scheduleOnUI(animateTo, savedScale.value * STEP),
    zoomOut: () => scheduleOnUI(animateTo, savedScale.value / STEP),
    reset: () => scheduleOnUI(animateTo, 1),
  }));

  /* Paging away leaves the photo you come back to at its normal size. */
  useEffect(() => {
    if (active) return;
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
    setZoomed(false);
  }, [active, scale, savedScale, tx, ty, savedTx, savedTy]);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 0.8), MAX_SCALE + 1);
    })
    .onEnd(() => {
      animateTo(scale.value);
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .averageTouches(true)
    .onStart(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    })
    .onUpdate((e) => {
      const { maxX, maxY } = clampTranslate(scale.value);
      tx.value = Math.min(Math.max(savedTx.value + e.translationX, -maxX), maxX);
      ty.value = Math.min(Math.max(savedTy.value + e.translationY, -maxY), maxY);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((_e, success) => {
      if (!success) return;
      animateTo(savedScale.value > 1.01 ? 1 : DOUBLE_TAP_SCALE);
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd((_e, success) => {
      if (success && onSingleTap) scheduleOnRN(onSingleTap);
    });

  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const source = uri || placeholder;

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={{ width, height, overflow: "hidden", backgroundColor: c.stage }}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Pinch or double tap to zoom"
      >
        {source ? (
          <Animated.View style={[{ width, height }, style]}>
            <Image
              source={{ uri: source }}
              placeholder={uri && placeholder ? { uri: placeholder } : undefined}
              placeholderContentFit="contain"
              contentFit="contain"
              transition={120}
              recyclingKey={source}
              onLoad={() => setLoaded(true)}
              style={{ width, height }}
            />
          </Animated.View>
        ) : (
          <View style={{ width, height, justifyContent: "center" }}>
            {/* No file to show: say so on the dark stage instead of drawing black. */}
            <PhotoThumb
              uri={null}
              width="100%"
              height="60%"
              contentFit="contain"
              rounded={0}
              showLabel
              onDark
            />
          </View>
        )}
        {source && !loaded && !placeholder ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              inset: 0,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActivityIndicator color={c.muted} size="large" />
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
});
