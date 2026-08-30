import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/lib/auth";
import { usePush } from "@/push/use-push";
import { useTheme } from "@/theme";

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
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.foreground,
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      {/*
        The four tabs. Header off here because each tab draws its own with
        `PageHeader`, which is what lets Projects keep a search field pinned
        under the title while the list scrolls beneath it.
      */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="capture-start" options={{ presentation: "modal", title: "New photos" }} />
      <Stack.Screen name="project/[id]/index" options={{ title: "Project" }} />
      <Stack.Screen
        name="project/[id]/capture"
        // Full-screen so the viewfinder is not boxed inside a card, and the
        // camera screen manages its own header.
        options={{ presentation: "fullScreenModal", headerShown: false }}
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
        options={{ presentation: "fullScreenModal", headerShown: false }}
      />
      <Stack.Screen name="workflow/[id]" options={{ title: "Workflow" }} />
      <Stack.Screen name="checklist/[id]" options={{ title: "Checklist" }} />
      <Stack.Screen name="project-new" options={{ title: "New project" }} />
      <Stack.Screen
        name="photo/[id]/annotate"
        options={{ presentation: "fullScreenModal", headerShown: false }}
      />
      <Stack.Screen name="queue" options={{ title: "Upload queue" }} />
      <Stack.Screen name="activity" options={{ title: "Team activity" }} />
      <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
      <Stack.Screen name="map" options={{ title: "Map" }} />
      <Stack.Screen name="timeline" options={{ title: "Timeline" }} />
      <Stack.Screen name="pipelines" options={{ title: "Pipelines" }} />
      <Stack.Screen name="groups" options={{ title: "Groups" }} />
      <Stack.Screen name="portfolio" options={{ title: "Portfolio" }} />
      <Stack.Screen name="team" options={{ title: "Team" }} />
      <Stack.Screen name="collaborators" options={{ title: "Collaborators" }} />
      <Stack.Screen name="workspace" options={{ title: "Workspace" }} />
      <Stack.Screen name="labels" options={{ title: "Labels" }} />
      <Stack.Screen name="templates" options={{ title: "Templates" }} />
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
      <Stack.Screen name="photo/[id]/analysis" options={{ title: "Photo analysis" }} />
    </Stack>
  );
}
