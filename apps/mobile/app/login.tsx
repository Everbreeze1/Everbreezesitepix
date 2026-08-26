import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "@/lib/auth";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

export default function LoginScreen() {
  const { user, loading, signIn } = useAuth();
  const theme = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) return <Redirect href="/(app)" />;

  async function onSubmit() {
    setBusy(true);
    setError(null);
    const result = await signIn(email.trim(), password);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.replace("/(app)");
  }

  const inputStyle = [
    styles.input,
    {
      backgroundColor: theme.colors.card,
      borderColor: theme.colors.border,
      color: theme.colors.foreground,
    },
  ];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.root, { backgroundColor: theme.colors.background }]}
    >
      <Text style={[typography.display, { color: theme.colors.foreground }]}>Everlumen</Text>
      <Text
        style={[
          typography.body,
          { color: theme.colors.mutedForeground, marginBottom: spacing.xxl, marginTop: spacing.xs },
        ]}
      >
        Sign in with your Everlumen account
      </Text>

      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="Email"
        placeholderTextColor={theme.colors.mutedForeground}
        style={inputStyle}
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        placeholder="Password"
        placeholderTextColor={theme.colors.mutedForeground}
        secureTextEntry
        autoComplete="current-password"
        style={inputStyle}
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={() => void onSubmit()}
      />

      {error ? (
        <Text style={[typography.caption, { color: theme.colors.destructive, marginBottom: 8 }]}>
          {error}
        </Text>
      ) : null}

      <Pressable
        style={[styles.button, { backgroundColor: theme.colors.primary, opacity: busy ? 0.7 : 1 }]}
        disabled={busy}
        onPress={() => void onSubmit()}
      >
        {busy ? (
          <ActivityIndicator color={theme.colors.primaryForeground} />
        ) : (
          <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
            Sign in
          </Text>
        )}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xl },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    fontSize: 16,
    minHeight: HIT_TARGET,
  },
  button: {
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: HIT_TARGET,
  },
});
