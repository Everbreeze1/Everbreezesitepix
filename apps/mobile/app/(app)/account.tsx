import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ApiClientError } from "@everlumen/api-client";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

export default function AccountScreen() {
  const { user, signOut } = useAuth();
  const theme = useTheme();
  const [health, setHealth] = useState("Checking API…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.health();
        if (!cancelled) setHealth(`${res.service} ${res.version} - ok`);
      } catch (e) {
        if (cancelled) return;
        setHealth(
          e instanceof ApiClientError
            ? `${e.code}: ${e.message}`
            : e instanceof Error
              ? e.message
              : "Health check failed",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Text style={[typography.title, { color: theme.colors.foreground }]}>Everlumen</Text>
      <Text style={[typography.body, { color: theme.colors.foreground, marginTop: spacing.md }]}>
        {user?.email ?? "Signed in"}
      </Text>
      <Text
        style={[
          typography.caption,
          { color: theme.colors.mutedForeground, marginTop: spacing.xs, marginBottom: spacing.xxl },
        ]}
      >
        {health}
      </Text>
      <Pressable
        accessibilityRole="button"
        style={[styles.button, { backgroundColor: theme.colors.primary }]}
        onPress={() => void onSignOut()}
      >
        <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
          Sign out
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.xl },
  button: {
    alignSelf: "flex-start",
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: HIT_TARGET,
    justifyContent: "center",
  },
});
