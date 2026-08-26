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
      <Stack.Screen name="index" options={{ title: "Projects" }} />
      <Stack.Screen name="project/[id]/index" options={{ title: "Project" }} />
      <Stack.Screen
        name="project/[id]/capture"
        // Full-screen so the viewfinder is not boxed inside a card, and the
        // camera screen manages its own header.
        options={{ presentation: "fullScreenModal", headerShown: false }}
      />
      <Stack.Screen name="queue" options={{ title: "Upload queue" }} />
      <Stack.Screen name="account" options={{ title: "Account" }} />
    </Stack>
  );
}
