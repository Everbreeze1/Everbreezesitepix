import { Redirect, Stack, router } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { AppMenuProvider, MenuButton } from "@/components/AppMenu";
import { HeaderBackButton, useFirstScreenHardwareBack } from "@/components/HeaderBack";
import { parentHref } from "@/lib/back-fallback";
import { goBack } from "@/lib/navigation";
import { useAuth } from "@/lib/auth";
import { usePush } from "@/push/use-push";
import { useTheme } from "@/theme";

/**
 * What the screens the app menu opens share: the menu in the header's right
 * end, so moving on to the next one does not mean backing out first. A screen
 * that draws its own header action replaces it, and Back is still there.
 */
const MENU_DESTINATION = { headerRight: () => <MenuButton /> };

/**
 * Modal routes keep the platform's own modal transition. The stack-wide
 * slide below is for screens pushed in the app's shell, not for the camera
 * or an editor rising over it.
 */
const MODAL_ANIMATION = { animation: "default" } as const;

/**
 * A modal opened over the stack: the platform draws no back arrow on one, so
 * it gets a close button in the same corner.
 */
const MODAL_CLOSE = {
  headerLeft: () => <HeaderBackButton variant="close" onPress={() => goBack("/")} />,
};

type StackOptionsArgs = {
  route: { key: string; name: string; params?: object };
  navigation: { getState: () => { routes: { key: string }[] } };
};

/**
 * Every pushed screen shows a way back (Jon, 2026-09-29: "some of the pages
 * have back buttons some of them dont"). The stack draws its own arrow when
 * there is a screen underneath. A screen that is first in the stack (opened
 * from a notification or a link) has none, so it gets one here that goes to
 * the page it belongs under, the same place Android's Back goes
 * (`useFirstScreenHardwareBack`).
 */
function fallbackBack({ route, navigation }: StackOptionsArgs) {
  const first = navigation.getState().routes[0]?.key === route.key;
  if (!first || route.name === "(tabs)") return {};
  const target = parentHref(route.name, route.params as Record<string, unknown> | undefined);
  return {
    headerLeft: () => <HeaderBackButton onPress={() => router.replace(target as never)} />,
  };
}

export default function AppLayout() {
  const { user, loading } = useAuth();
  const theme = useTheme();

  /*
   * Push is set up here, once, for the whole authenticated tree.
   *
   * Not in a screen: registration has to survive tab switches, and a tapped
   * notification arriving on a cold start has to be handled before any screen
   * has mounted. Hooks cannot be called conditionally, so this runs above the
   * `!user` redirect and the hook itself does nothing without a user.
   */
  usePush();
  useFirstScreenHardwareBack();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.background,
        }}
      >
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  return (
    <AppMenuProvider>
      <Stack
        screenOptions={(args) => ({
          ...fallbackBack(args as unknown as StackOptionsArgs),
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.foreground,
          headerTitleStyle: { fontWeight: "600" },
          // A flat header on the page's own colour: the shadow read as a second
          // bar laid over the first.
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.colors.background },
          /*
           * A push slides in from the right on both platforms. Android's
           * default rises from the bottom and fades, which is how a dialog
           * arrives: Reports and Map opened looking like separate windows
           * rather than the next page of the same app.
           */
          animation: "slide_from_right",
          fullScreenGestureEnabled: true,
        })}
      >
        {/*
          The four tabs. Header off here because each tab draws its own with
          `PageHeader`, which is what lets Projects keep a search field pinned
          under the title while the list scrolls beneath it.
        */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="capture-start"
          options={{
            presentation: "modal",
            title: "New photos",
            ...MODAL_ANIMATION,
            ...MODAL_CLOSE,
          }}
        />
        <Stack.Screen name="project/[id]/index" options={{ title: "Project" }} />
        <Stack.Screen
          name="project/[id]/capture"
          // Full-screen so the viewfinder is not boxed inside a card, and the
          // camera screen manages its own header.
          options={{ presentation: "fullScreenModal", headerShown: false, ...MODAL_ANIMATION }}
        />
        <Stack.Screen name="project/[id]/trash" options={{ title: "Trash" }} />
        <Stack.Screen name="project/[id]/checklists" options={{ title: "Checklists" }} />
        <Stack.Screen name="project/[id]/tasks" options={{ title: "Tasks" }} />
        <Stack.Screen name="task/[id]" options={{ title: "Task" }} />
        <Stack.Screen name="project/[id]/workflows" options={{ title: "Workflows" }} />
        <Stack.Screen name="project/[id]/walkthroughs" options={{ title: "Walkthroughs" }} />
        <Stack.Screen name="walkthrough/[id]" options={{ title: "Walkthrough" }} />
        <Stack.Screen
          name="project/[id]/walkthrough-record"
          options={{ presentation: "fullScreenModal", headerShown: false, ...MODAL_ANIMATION }}
        />
        <Stack.Screen name="workflow/[id]" options={{ title: "Workflow" }} />
        <Stack.Screen name="checklist/[id]" options={{ title: "Checklist" }} />
        <Stack.Screen name="project-new" options={{ title: "New project" }} />
        <Stack.Screen
          name="photo/[id]/annotate"
          options={{ presentation: "fullScreenModal", headerShown: false, ...MODAL_ANIMATION }}
        />
        <Stack.Screen name="photo/[id]/location" options={{ title: "Photo location" }} />
        <Stack.Screen name="queue" options={{ title: "Upload queue" }} />
        <Stack.Screen name="activity" options={{ title: "Team activity", ...MENU_DESTINATION }} />
        <Stack.Screen name="reports" options={{ title: "Reports", ...MENU_DESTINATION }} />
        <Stack.Screen
          name="notifications"
          options={{ title: "Notifications", ...MENU_DESTINATION }}
        />
        <Stack.Screen name="map" options={{ title: "Map", ...MENU_DESTINATION }} />
        <Stack.Screen name="timeline" options={{ title: "Timeline", ...MENU_DESTINATION }} />
        <Stack.Screen name="pipelines" options={{ title: "Pipelines", ...MENU_DESTINATION }} />
        <Stack.Screen name="groups" options={{ title: "Groups", ...MENU_DESTINATION }} />
        <Stack.Screen name="portfolio" options={{ title: "Portfolio", ...MENU_DESTINATION }} />
        <Stack.Screen name="team" options={{ title: "Team", ...MENU_DESTINATION }} />
        <Stack.Screen name="collaborators" options={{ title: "Collaborators" }} />
        <Stack.Screen
          name="report-issue"
          options={{ title: "Report a problem", ...MENU_DESTINATION }}
        />
        <Stack.Screen name="admin" options={{ title: "Feedback queue", ...MENU_DESTINATION }} />
        <Stack.Screen name="close-account" options={{ title: "Close account" }} />
        <Stack.Screen name="settings/profile" options={{ title: "Profile" }} />
        <Stack.Screen
          name="settings/notification-preferences"
          options={{ title: "Email notifications" }}
        />
        <Stack.Screen name="settings/security" options={{ title: "Email and password" }} />
        <Stack.Screen name="settings/appearance" options={{ title: "Appearance" }} />
        <Stack.Screen name="workspace" options={{ title: "Workspace" }} />
        <Stack.Screen name="labels" options={{ title: "Labels" }} />
        <Stack.Screen name="templates" options={{ title: "Templates", ...MENU_DESTINATION }} />
        <Stack.Screen
          name="workflow-template/[templateId]"
          options={{ title: "Workflow template" }}
        />
        <Stack.Screen name="template/[id]" options={{ title: "Template" }} />
        <Stack.Screen name="project/[id]/site-logs" options={{ title: "Site logs" }} />
        <Stack.Screen name="site-log/[logId]" options={{ title: "Site log" }} />
        <Stack.Screen name="project/[id]/reports" options={{ title: "Reports" }} />
        <Stack.Screen name="report/[reportId]" options={{ title: "Report" }} />
        <Stack.Screen name="project/[id]/documents" options={{ title: "Documents" }} />
        <Stack.Screen name="page/[pageId]" options={{ title: "Page" }} />
      </Stack>
    </AppMenuProvider>
  );
}
