import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, router } from "expo-router";
import { SocialSignIn } from "@/components/SocialSignIn";
import { useAuth } from "@/lib/auth";
import { type SocialProvider } from "@/lib/auth-providers";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

export default function SignUpScreen() {
  const { user, loading, signUp, signInWithProvider } = useAuth();
  const theme = useTheme();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [oauth, setOauth] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (!loading && user) return <Redirect href="/(app)/(tabs)" />;

  async function onSubmit() {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError("Email and password are both needed.");
      return;
    }
    /*
     * Checked here rather than left to the server. Supabase's own minimum is 6
     * characters and its rejection arrives as a raw API string; saying it up
     * front costs a round trip less and reads like a sentence.
     */
    if (password.length < 8) {
      setError("Use at least 8 characters for the password.");
      return;
    }

    setBusy(true);
    setError(null);
    const result = await signUp(cleanEmail, password, fullName.trim());
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    /*
     * The project has email confirmation on, so there is no session yet. Saying
     * "check your inbox" is the whole outcome; routing into the app here would
     * bounce straight back to login and look like a failure.
     */
    setSent(true);
  }

  /*
   * Signing up with Google IS signing in with it: the provider creates the
   * account on first use, so there is no separate "register" call. The button
   * behaves identically on both screens, which is why they share a component.
   */
  async function onProvider(provider: SocialProvider) {
    setOauth(provider);
    setError(null);
    const result = await signInWithProvider(provider);
    setOauth(null);
    if (result.error) setError(result.error);
  }

  const inputStyle = [
    styles.input,
    {
      backgroundColor: theme.colors.card,
      borderColor: theme.colors.border,
      color: theme.colors.foreground,
    },
  ];

  if (sent) {
    return (
      <View style={[styles.done, { backgroundColor: theme.colors.background }]}>
        <Text style={[typography.title, { color: theme.colors.foreground }]}>Check your inbox</Text>
        <Text
          style={[
            typography.body,
            { color: theme.colors.mutedForeground, textAlign: "center", marginTop: spacing.md },
          ]}
        >
          We sent a confirmation link to {email.trim()}. Open it to finish setting up your account,
          then come back and sign in.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/login")}
          style={[styles.primary, { backgroundColor: theme.colors.primary, marginTop: spacing.xl }]}
        >
          <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
            Back to sign in
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[typography.display, { color: theme.colors.foreground }]}>Create account</Text>
        <Text
          style={[typography.body, { color: theme.colors.mutedForeground, marginTop: spacing.xs }]}
        >
          Then join or start a team from the web app.
        </Text>

        <View style={{ marginTop: spacing.xxl, gap: spacing.md }}>
          <TextInput
            autoCapitalize="words"
            autoComplete="name"
            placeholder="Full name"
            placeholderTextColor={theme.colors.mutedForeground}
            style={inputStyle}
            value={fullName}
            onChangeText={setFullName}
          />
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
            autoComplete="new-password"
            style={inputStyle}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => void onSubmit()}
          />
        </View>

        {error ? (
          <Text style={[typography.caption, { color: theme.colors.destructive, marginTop: 8 }]}>
            {error}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void onSubmit()}
          style={[
            styles.primary,
            { backgroundColor: theme.colors.primary, opacity: busy ? 0.7 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.primaryForeground} />
          ) : (
            <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
              Create account
            </Text>
          )}
        </Pressable>

        <SocialSignIn
          onSelect={(provider) => void onProvider(provider)}
          pending={oauth}
          disabled={busy || Boolean(oauth)}
        />

        <View style={styles.footer}>
          <Text style={[typography.body, { color: theme.colors.mutedForeground }]}>
            Already have one?{" "}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.replace("/login")} hitSlop={8}>
            <Text style={[typography.bodyStrong, { color: theme.colors.primary }]}>Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  done: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    minHeight: HIT_TARGET,
  },
  primary: {
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
    minHeight: HIT_TARGET,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xxl,
    flexWrap: "wrap",
  },
});
