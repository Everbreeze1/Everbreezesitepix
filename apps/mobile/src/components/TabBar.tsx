import { Pressable, View } from "react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { spacing, useRightRail, useTheme } from "@/theme";
import { Text } from "@/ui";
import { FloatingMenuButton, withAlpha } from "./AppMenu";

/**
 * The bottom tab bar.
 *
 * Until now the app was a single 18-screen `Stack`, so every top-level surface
 * was reached by going back to the project list first and the app had less
 * navigation than the website has when you open it on the same phone: web ships
 * a `MobileTabBar` with Projects, Map, Gallery and Account, and the native app
 * shipped none.
 *
 * **No camera here.** It used to sit raised in the middle of this bar, and
 * float under the menu button on a tablet, on every tab. That put a camera on
 * Account and on the photo library with no job behind it, so pressing it had
 * to guess where the pictures should go (Jon, 2026-09-29: "right now I am
 * navigating account settings and when i open the camera its not sure where
 * to saved"). Capture now lives where a project is: the Capture button on
 * each project page, which opens the camera for that job. Home keeps its own
 * "Capture photo" action for the nearest or most recent job, drawn by Home
 * itself (in its hero row on a phone, in its `ActionRail` on a tablet).
 *
 * **On a tablet, or any screen in landscape, there is no bar at all.** One
 * round button floats on the right edge instead: the menu. A tablet is held
 * with a hand on each side, most often by someone right handed, and on a
 * landscape 11 inch screen the bottom centre is the one spot neither thumb can
 * reach without letting go; the right edge is where the tapping thumb already
 * rests.
 *
 * This replaced a full-height dark rail on that edge. The rail cost a strip of
 * the screen for four tabs and a lot of empty chrome, and still reached less
 * of the product than the website's sidebar. The menu button opens
 * `AppMenu`, which lists every destination the web sidebar has, and the page
 * keeps the full width. The button sits on the lower third of the edge
 * (Jon, 2026-09-29), where the resting thumb is, and stops above the create
 * actions `ActionRail` keeps in the lower right corner.
 */
/**
 * How far the floating menu button sits above the bottom edge: clear of a pair
 * of `ActionRail` buttons (64 + 52 + gaps) in the same corner.
 */
const RAIL_LIFT = 184;

export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const theme = useTheme();
  const rail = useRightRail();

  /*
   * The bar is always-dark chrome, in both schemes, so the inactive tint is the
   * chrome's own foreground dimmed rather than `mutedForeground`: that token is
   * a mid-brown chosen for a cream canvas and all but disappears on near-black.
   * Dimmed with alpha rather than a second token, so it moves with the chrome.
   */
  const inactive = withAlpha(theme.colors.chromeForeground, 0.6);

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
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
          paddingVertical: spacing.sm,
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

  if (rail) {
    return (
      <View
        pointerEvents="box-none"
        style={{
          /*
           * Out of the layout, so the screens take the full width. Pinned to
           * the whole height of the edge with the button at the foot of it,
           * lifted to the lower third, and never lower than the corner the
           * `ActionRail` create buttons use.
           */
          position: "absolute",
          top: insets.top + spacing.md,
          bottom: 0,
          right: insets.right + spacing.md,
          justifyContent: "flex-end",
          alignItems: "center",
          gap: spacing.md,
          paddingBottom: RAIL_LIFT + insets.bottom,
        }}
      >
        <FloatingMenuButton />
      </View>
    );
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
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
      {state.routes.map(renderTab)}
    </View>
  );
}
