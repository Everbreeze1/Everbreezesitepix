import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ApiClientError } from "@everlumen/api-client";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors } from "@/theme";

export default function AccountScreen() {
  const { user, signOut } = useAuth();
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
    <View style={styles.root}>
      <Text style={styles.brand}>Everlumen</Text>
      <Text style={styles.line}>{user?.email ?? "Signed in"}</Text>
      <Text style={styles.meta}>{health}</Text>
      <Pressable style={styles.button} onPress={() => void onSignOut()}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 24 },
  brand: { fontSize: 28, fontWeight: "700", color: colors.ink, marginBottom: 12 },
  line: { fontSize: 16, color: colors.ink, marginBottom: 8 },
  meta: { fontSize: 14, color: colors.muted, marginBottom: 28 },
  button: {
    alignSelf: "flex-start",
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonText: { color: "#fff", fontWeight: "600" },
});
