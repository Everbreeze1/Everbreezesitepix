import { Camera } from "@/ui/icons";
import { Platform, Pressable, View } from "react-native";
import { router } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { radius, spacing, useTheme } from "@/theme";
import { Icon, Text } from "@/ui";

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
 * project and a tab has no argument, so pressing it pushes `/capture-start`
 * onto the parent stack, which asks which job this is and then opens the
 * viewfinder. Modelling it as a tab would leave a tab you can never be "on".
 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const theme = useTheme();

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
    const tint = focused ? theme.colors.primary : theme.colors.mutedForeground;

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
        <Text variant="caption" style={{ color: tint }} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        backgroundColor: theme.colors.card,
        borderTopWidth: 1,
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

      <View style={{ width: 76, alignItems: "center" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photos"
          accessibilityHint="Choose a project, then open the camera"
          onPress={() => router.push("/capture-start")}
          style={({ pressed }) => [
            {
              width: 58,
              height: 58,
              borderRadius: radius.pill,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.colors.primary,
              // Lifted above the bar so it reads as the primary action rather
              // than a fifth tab that happens to be blue.
              marginTop: -22,
              borderWidth: 4,
              borderColor: theme.colors.card,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            },
            Platform.select({
              ios: {
                shadowColor: theme.colors.primary,
                shadowOpacity: 0.35,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
              },
              android: { elevation: 8 },
              default: {},
            }),
          ]}
        >
          <Icon icon={Camera} size="lg" tone="inverse" />
        </Pressable>
      </View>

      {right.map(renderTab)}
    </View>
  );
}
