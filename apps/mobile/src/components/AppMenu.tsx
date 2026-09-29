import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { checkIsPlatformAdmin } from "@/api/admin";
import { webAppLink } from "@/lib/api";
import { APP_MENU, isMenuItemActive, type AppMenuIcon, type AppMenuItem } from "@/lib/app-menu";
import { radius, spacing, useTheme } from "@/theme";
import {
  Activity,
  Bell,
  Calendar,
  CircleQuestionMark,
  ExternalLink,
  FileText,
  FolderKanban,
  Folders,
  Images,
  Kanban,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  MapPin,
  Menu,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from "@/ui/icons";
import { Icon, Text, type LucideIcon } from "@/ui";

const ICONS: Record<AppMenuIcon, LucideIcon> = {
  overview: LayoutDashboard,
  projects: FolderKanban,
  photos: Images,
  reports: FileText,
  map: MapPin,
  pipelines: Kanban,
  timeline: Calendar,
  groups: Folders,
  activity: Activity,
  templates: LayoutTemplate,
  team: Users,
  portfolio: Layers,
  notifications: Bell,
  account: UserRound,
  help: CircleQuestionMark,
  feedback: LifeBuoy,
  admin: ShieldCheck,
};

/** How wide the panel is when the screen has room for more. */
const PANEL_WIDTH = 320;

type AppMenuContextValue = { open: () => void; close: () => void };

const AppMenuContext = createContext<AppMenuContextValue>({
  open: () => {},
  close: () => {},
});

/** Opens and closes the app menu from anywhere inside the signed-in app. */
export function useAppMenu(): AppMenuContextValue {
  return useContext(AppMenuContext);
}

/**
 * The app menu: every destination the web sidebar has, one tap away.
 *
 * It replaced a dark rail that ran the full height of a tablet's right edge
 * and carried four tabs. The rail spent a strip of screen on chrome that was
 * mostly empty, and it still reached less of the product than the website's
 * sidebar does. The menu is the other way round: nothing on screen until it is
 * asked for, then the whole list, and gone again once a row is picked, so the
 * page underneath gets the full width.
 *
 * A panel over a light scrim rather than a drawer that pushes the page: the
 * page stays visible behind it, which keeps the sense of where you are, and a
 * tap anywhere outside the panel is a way out that needs no aiming.
 *
 * Mounted once, around the signed-in stack, so the floating button on a tablet,
 * the Home header on a phone and a pushed screen's header all open the same
 * panel through `useAppMenu`.
 */
export function AppMenuProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <AppMenuContext.Provider value={value}>
      {children}
      <AppMenuPanel visible={visible} onClose={close} />
    </AppMenuContext.Provider>
  );
}

function AppMenuPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pathname = usePathname();

  // Same query, and the same cache entry, as the staff row on Account.
  const adminQuery = useQuery({
    queryKey: ["is-platform-admin"],
    queryFn: checkIsPlatformAdmin,
    staleTime: 10 * 60 * 1000,
    enabled: visible,
  });
  const canOpenWeb = webAppLink("/") !== null;

  const go = (item: AppMenuItem) => {
    onClose();
    if (item.web) {
      const url = webAppLink(item.href);
      if (url) void WebBrowser.openBrowserAsync(url);
      return;
    }
    if (isMenuItemActive(item, pathname)) return;
    if (item.tab) {
      /*
       * Back to the tabs first. Pushing Home from inside Reports would stack
       * a second Home on top of it, and Back would then lead somewhere odd.
       */
      if (router.canDismiss()) router.dismissAll();
      router.navigate(item.href as never);
      return;
    }
    router.push(item.href as never);
  };

  const groups = APP_MENU.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => (!item.adminOnly || adminQuery.data === true) && (!item.web || canOpenWeb),
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1 }}>
        {/* Anywhere outside the panel closes it. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={onClose}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: withAlpha(theme.colors.chrome, 0.28),
          }}
        />

        <View
          accessibilityViewIsModal
          style={[
            {
              position: "absolute",
              top: insets.top + spacing.sm,
              right: insets.right + spacing.md,
              bottom: insets.bottom + spacing.md,
              width: Math.min(PANEL_WIDTH, width - spacing.md * 2),
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
              /*
               * Translucent rather than blurred: a blur view is a native
               * dependency, and a nearly opaque themed surface reads as glass
               * over the page while keeping every label legible.
               */
              backgroundColor: withAlpha(theme.colors.card, 0.94),
              overflow: "hidden",
            },
            Platform.select({
              ios: {
                shadowColor: "#000",
                shadowOpacity: 0.2,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: 8 },
              },
              android: { elevation: 12 },
              default: {},
            }),
          ]}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: spacing.lg,
              paddingRight: spacing.xs,
              paddingVertical: spacing.xs,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
              Menu
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close menu"
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 48,
                height: 48,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Icon icon={X} size="lg" />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.sm, gap: spacing.md }}>
            {groups.map((group) => (
              <View key={group.title ?? "more"} style={{ gap: 2 }}>
                {group.title ? (
                  <Text
                    variant="overline"
                    tone="muted"
                    style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                  >
                    {group.title.toUpperCase()}
                  </Text>
                ) : (
                  <View
                    style={{
                      height: 1,
                      backgroundColor: theme.colors.border,
                      marginHorizontal: spacing.md,
                      marginBottom: spacing.xs,
                    }}
                  />
                )}
                {group.items.map((item) => {
                  const active = isMenuItemActive(item, pathname);
                  const tint = active ? theme.colors.primary : theme.colors.foreground;
                  return (
                    <Pressable
                      key={item.href}
                      accessibilityRole="button"
                      accessibilityLabel={item.label}
                      accessibilityState={{ selected: active }}
                      onPress={() => go(item)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: spacing.md,
                        minHeight: 48,
                        paddingHorizontal: spacing.md,
                        borderRadius: radius.md,
                        backgroundColor: active
                          ? withAlpha(theme.colors.primary, 0.12)
                          : pressed
                            ? theme.colors.secondary
                            : "transparent",
                      })}
                    >
                      <Icon
                        icon={ICONS[item.icon]}
                        size="md"
                        color={active ? theme.colors.primary : theme.colors.mutedForeground}
                      />
                      <Text variant="bodyStrong" style={{ flex: 1, color: tint }} numberOfLines={1}>
                        {item.label}
                      </Text>
                      {item.web ? <Icon icon={ExternalLink} size="sm" tone="muted" /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The button that opens the menu, for a header.
 *
 * Tablets have their own floating one in `TabBar`; this is the phone's way in,
 * and a pushed screen's, drawn at the header's own icon size.
 */
export function MenuButton() {
  const { open } = useAppMenu();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      accessibilityHint="Lists every part of the app"
      onPress={open}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon icon={Menu} size="lg" />
    </Pressable>
  );
}

/** Diameter of the floating menu button: a size a gloved thumb finds blind. */
export const FLOATING_MENU_SIZE = 62;

/**
 * The floating button that opens the menu, on the right edge.
 *
 * Jon (2026-09-29): "I like the floating three lines that pops the whole
 * menu. Can we make that closer to lower third of the page, give it a good
 * color contrast and make it bigger?" So it is 62pt, and drawn inverted: the
 * foreground colour as its fill and the page colour as its glyph, which is
 * near-black with a cream icon on the light palette and the reverse on the
 * dark one. Either way it is the strongest contrast the palette has, where
 * the old see-through card fill melted into the page behind it. A ring in
 * the page colour and a shadow lift it off whatever scrolls underneath.
 *
 * Placed by the caller, which knows what else floats on its screen.
 */
export function FloatingMenuButton() {
  const theme = useTheme();
  const { open } = useAppMenu();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      accessibilityHint="Lists every part of the app"
      onPress={open}
      style={({ pressed }) => [
        {
          width: FLOATING_MENU_SIZE,
          height: FLOATING_MENU_SIZE,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.foreground,
          borderWidth: 2,
          borderColor: theme.colors.background,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
        Platform.select({
          ios: {
            shadowColor: "#000",
            shadowOpacity: 0.3,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
          },
          android: { elevation: 10 },
          default: {},
        }),
      ]}
    >
      <Icon icon={Menu} size="xl" color={theme.colors.background} strokeWidth={2.5} />
    </Pressable>
  );
}

/**
 * A `#rrggbb` token at the given opacity.
 *
 * Anything that is not a six-digit hex comes back unchanged: the dark palette
 * already writes some tokens as `rgba()`, and guessing at those would be worse
 * than leaving the colour at full strength.
 */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hex;
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
