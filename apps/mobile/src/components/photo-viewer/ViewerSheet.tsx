import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { radius } from "@/theme";
import { viewerColors as c } from "./viewer-theme";

export type SheetSnap = "peek" | "half" | "full";

/**
 * The phone's details panel: a sheet over the bottom of the photo that drags
 * up. Web's mobile layout puts the same panel in a bottom drawer.
 *
 * Three rests. Peek shows the project line and the tabs, so the photo gets the
 * screen and the panel is one drag away. Half is enough for the tags and the
 * description. Full is for typing a comment or reading a long thread, and stops
 * under the top bar so Close is always reachable.
 *
 * Only the handle (grab bar, project header and tabs) drags the sheet. The tab
 * contents scroll on their own, so reading a thread never yanks the panel.
 * Animated on the UI thread with Reanimated; no sheet library was added.
 * Settles on a critically damped spring that carries the fling's velocity,
 * so a flick glides into place instead of snapping on a fixed timer.
 */

/** Firm and without bounce: a panel of text should not wobble. */
const SPRING = { damping: 28, stiffness: 260, mass: 0.9, overshootClamping: true } as const;
export function ViewerSheet({
  height,
  topLimit,
  bottomInset,
  snap,
  hidden,
  onSnap,
  handle,
  children,
}: {
  /** Height of the area the sheet lives in. */
  height: number;
  /** The lowest the sheet's top may rise to: the bottom of the top bar. */
  topLimit: number;
  bottomInset: number;
  snap: SheetSnap;
  /** Chrome hidden: the sheet slides fully away. */
  hidden: boolean;
  onSnap: (snap: SheetSnap) => void;
  handle: ReactNode;
  children: ReactNode;
}) {
  const [handleHeight, setHandleHeight] = useState(150);
  const positions = {
    full: topLimit,
    half: Math.max(topLimit, Math.round(height * 0.42)),
    peek: Math.max(topLimit, height - handleHeight - bottomInset),
  };
  const target = hidden ? height : positions[snap];

  const top = useSharedValue(target);
  const start = useSharedValue(target);

  useEffect(() => {
    top.value = withSpring(target, SPRING);
  }, [target, top]);

  const { full, half, peek } = positions;

  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onStart(() => {
      start.value = top.value;
    })
    .onUpdate((e) => {
      top.value = Math.min(Math.max(start.value + e.translationY, full), peek + 40);
    })
    .onEnd((e) => {
      const projected = top.value + e.velocityY * 0.12;
      const options: [SheetSnap, number][] = [
        ["full", full],
        ["half", half],
        ["peek", peek],
      ];
      let best = options[0];
      for (const option of options) {
        if (Math.abs(option[1] - projected) < Math.abs(best[1] - projected)) best = option;
      }
      top.value = withSpring(best[1], { ...SPRING, velocity: e.velocityY });
      scheduleOnRN(onSnap, best[0]);
    });

  const style = useAnimatedStyle(() => ({ top: top.value }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: c.chrome,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          borderTopWidth: 1,
          borderColor: c.border,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.5,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: -8 },
          elevation: 16,
        },
        style,
      ]}
    >
      <GestureDetector gesture={pan}>
        <View
          onLayout={(e) => {
            const next = Math.round(e.nativeEvent.layout.height);
            if (Math.abs(next - handleHeight) > 1) setHandleHeight(next);
          }}
        >
          {handle}
        </View>
      </GestureDetector>
      <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
    </Animated.View>
  );
}
