import { Camera } from "@/ui/icons";
import { Platform, Pressable, View } from "react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { radius, spacing, useRightRail, useTheme } from "@/theme";
import { Icon, Text } from "@/ui";
import { useQuickCapture } from "@/lib/use-quick-capture";

/**
 * The bottom tab bar.
 *
 * Until now the app was a single 18-screen `Stack`, so every top-level surface
 * was reached by going back to the project list first and the app had less
 * navigation than the website has when you open it on the same phone: web ships
 * a `MobileTabBar` with Projects, Map, Gallery and Account, and the native app
 * shipped none.
 *
 * The bar is written by hand rather than configured, for one reason: the camera
 * button. Capture is not a peer of the other tabs, it is the reason the app is
 * installed, and the field-app convention the client keeps sending screenshots
 * of puts it in the middle, raised, and larger than its neighbours. A tab that
 * looks like the other four does not get used on a job site with gloves on.
 *
 * The camera is not a route in this navigator. It cannot be: capture needs a
 * project and a tab has no argument. Pressing it opens the viewfinder straight
 * away on the job the phone is standing at, or the one last worked on (see
 * `useQuickCapture`), and the job's name on the viewfinder switches it. A list
 * of jobs in between read as the camera button opening Projects. Modelling it
 * as a tab would leave a tab you can never be "on".
 *
 * **On a tablet, or any screen in landscape, the bar becomes a rail down the
 * right edge**, with the camera at its foot. A bottom bar is right for a phone
 * held in one hand, where the thumb sweeps the bottom of the screen. A tablet is
 * held with a hand on each side, most often by someone right handed, and on a
 * landscape 11 inch screen the bottom centre is the one spot neither thumb can
 * reach without letting go of the device. The right edge is where the tapping
 * thumb already rests, so the tabs stack there and the camera sits lowest,
 * where that thumb lands without moving. A left-hand rail, the Material
 * default, was rejected for the same reason: it puts navigation under the hand
 * that is holding the tablet. `_layout.tsx` sets `tabBarPosition` to match, so
 * the screens lay out beside the rail rather than under it.
 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const theme = useTheme();
  const rail = useRightRail();
  const openCamera = useQuickCapture();

  /*
   * The bar is always-dark chrome, in both schemes, so the inactive tint is the
   * chrome's own foreground dimmed rather than `mutedForeground`: that token is
   * a mid-brown chosen for a cream canvas and all but disappears on near-black.
   * Dimmed with alpha rather than a second token, so it moves with the chrome.
   */
  const inactive = withAlpha(theme.colors.chromeForeground, 0.6);

  // The camera sits between the second and third tab. With four tabs that is
  // the middle; the slice keeps it centred if a fifth is ever added.
  const middle = Math.ceil(state.routes.length / 2);
  const left = state.routes.slice(0, middle);
  const right = state.routes.slice(middle);

  const renderTab = (route: (typeof state.routes)[number]) => {
    const index = state.routes.indexOf(route);
    const focused = state.index === index;
    const { options } = descriptors[route.key];
    const label =
      typeof options.tabBarLabel === "string" ? options.tabBarLabel : (options.title ?? route.name);
    const tint = focused ? theme.colors.primary : inactive;

    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
        onPress={() => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          /*
           * `navigate` rather than a fresh push, so returning to a tab restores
           * where it was left. Someone who scrolled a long photo grid, stepped
           * into the camera and came back should land on the same rows.
           */
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        }}
        style={({ pressed }) => ({
          // Rows of a fixed height on the rail, columns sharing the width on the bar.
          ...(rail ? { alignSelf: "stretch" as const, minHeight: 56 } : { flex: 1 }),
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
          paddingVertical: rail ? spacing.xs : spacing.sm,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        {options.tabBarIcon?.({ focused, color: tint, size: 22 })}
        {/*
          Sentence case, not caps.
         
          `overline` is the right size and weight for a tab label and the wrong
          casing: it exists for section headings like TODAY and WORKSPACE, where
          caps mark a divider between blocks of content. Applied to the five
          words a person reads most often it does two things, both bad. It dates
          the app - full-caps navigation is a 2014 look. And it is measurably
          slower to read, because capitals strip the ascender and descender
          shapes the eye uses to recognise a word without spelling it out, which
          is exactly the recognition a tab bar depends on.
         
          `caption` keeps the size and drops the caps and the letter-spacing.
        */}
        {/*
          Semibold, which the caption variant is not: light text on a dark bar
          loses weight to halation, and a regular-weight label at this size
          reads thinner on the chrome than the same label did on a white bar.
        */}
        <Text variant="caption" style={{ color: tint, fontWeight: "600" }} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  };

  const cameraButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Take photos"
      accessibilityHint="Opens the camera on the nearest or most recent job"
      onPress={openCamera}
      style={({ pressed }) => [
        {
          width: 64,
          height: 64,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.primary,
          // Lifted above the bar so it reads as the primary action rather
          // than a fifth tab that happens to be orange. The rail has the
          // height to give it its own space instead.
          marginTop: rail ? 0 : -26,
          // The ring is the bar's own colour, so the button looks cut into
          // the chrome rather than stuck on top of it.
          borderWidth: 5,
          borderColor: theme.colors.chrome,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
        Platform.select({
          ios: {
            shadowColor: theme.colors.primary,
            shadowOpacity: 0.45,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 4 },
          },
          android: { elevation: 8 },
          default: {},
        }),
      ]}
    >
      <Icon icon={Camera} size="lg" tone="inverse" />
    </Pressable>
  );

  if (rail) {
    return (
      <View
        style={{
          width: 96 + insets.right,
          alignItems: "center",
          backgroundColor: theme.colors.chrome,
          borderLeftWidth: theme.scheme === "dark" ? 1 : 0,
          borderLeftColor: theme.colors.border,
          paddingTop: insets.top + spacing.md,
          paddingBottom: insets.bottom + spacing.lg,
          paddingRight: insets.right,
          gap: spacing.xs,
        }}
      >
        {/*
          The spacer pushes the tabs down towards the thumb: the top of a
          tablet's right edge is as far from a resting hand as the bottom
          centre is, so nothing that is tapped often lives there.
        */}
        <View style={{ flex: 1 }} />
        {state.routes.map(renderTab)}
        <View style={{ marginTop: spacing.md }}>{cameraButton}</View>
      </View>
    );
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        backgroundColor: theme.colors.chrome,
        /*
         * No keyline on the light palette, where the dark bar already separates
         * itself from a cream screen. On the dark palette the chrome and the
         * canvas are a few shades apart, so the hairline is what marks the edge.
         */
        borderTopWidth: theme.scheme === "dark" ? 1 : 0,
        borderTopColor: theme.colors.border,
        paddingTop: spacing.xs,
        /*
         * The home indicator occupies the bottom 34pt on a modern iPhone. Without
         * the inset the tab labels sit under it, and on Android with gesture
         * navigation the bar competes with the system swipe area.
         */
        paddingBottom: insets.bottom > 0 ? insets.bottom : spacing.sm,
      }}
    >
      {left.map(renderTab)}

      <View style={{ width: 76, alignItems: "center" }}>{cameraButton}</View>

      {right.map(renderTab)}
    </View>
  );
}

/**
 * A `#rrggbb` token at the given opacity.
 *
 * Anything that is not a six-digit hex comes back unchanged: the dark palette
 * already writes some tokens as `rgba()`, and guessing at those would be worse
 * than leaving the colour at full strength.
 */
function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hex;
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
