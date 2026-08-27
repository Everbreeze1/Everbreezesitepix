import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/theme";

export default function AppLayout() {
  const { user, loading } = useAuth();
  const theme = useTheme();

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
    </Stack>
  );
}
