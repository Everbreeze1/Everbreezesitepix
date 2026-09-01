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
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth";
import { type SocialProvider } from "@/lib/auth-providers";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

export default function LoginScreen() {
  const { user, loading, signIn, signInWithProvider, sendPasswordReset } = useAuth();
  const theme = useTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "email" | SocialProvider | "reset">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!loading && user) return <Redirect href="/(app)/(tabs)" />;

  async function onSubmit() {
    setBusy("email");
    setError(null);
    setNotice(null);
    const result = await signIn(email.trim(), password);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.replace("/(app)/(tabs)");
  }

  async function onProvider(provider: SocialProvider) {
    setBusy(provider);
    setError(null);
    setNotice(null);
    const result = await signInWithProvider(provider);
    setBusy(null);
    if (result.error) setError(result.error);
    // No redirect on success: the auth listener flips `user`, and the guard at
    // the top of this component moves on by itself.
  }

  async function onForgot() {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email first, then tap Forgot password.");
      return;
    }
    setBusy("reset");
    setError(null);
    setNotice(null);
    const result = await sendPasswordReset(trimmed);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice("Password reset email sent. Open it on any device.");
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
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/*
          The mark, not just the wordmark.

          This is the first screen anybody sees of the product, and it carried
          the name in text and nothing else - so the amber aperture people tap
          on their home screen did not appear anywhere in the app they landed
          in. `BrandMark` is the same vector the launch screen uses, so it
          costs no asset and cannot drift from the web logo.

          `gapColor` is a BACKDROP colour rather than an outline: the seams are
          drawn over the shared blade edges, so the only hairline anyone sees is
          on the rim and around the aperture, where the background shows
          through. Anything darker than the ground puts a keyline round the mark.
        */}
        <BrandMark size={56} gapColor={theme.colors.background} />
        <Text
          style={[typography.display, { color: theme.colors.foreground, marginTop: spacing.lg }]}
        >
          Ever<Text style={{ color: theme.colors.brand }}>lumen</Text>
        </Text>
        <Text
          style={[typography.body, { color: theme.colors.mutedForeground, marginTop: spacing.xs }]}
        >
          Sign in with your Everlumen account
        </Text>

        <View style={{ marginTop: spacing.xxl, gap: spacing.md }}>
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

          <Pressable
            accessibilityRole="button"
            onPress={() => void onForgot()}
            hitSlop={8}
            style={styles.forgot}
          >
            <Text style={[typography.caption, { color: theme.colors.primary, fontWeight: "600" }]}>
              {busy === "reset" ? "Sending…" : "Forgot password?"}
            </Text>
          </Pressable>
        </View>

        {error ? (
          <Text style={[typography.caption, { color: theme.colors.destructive, marginTop: 4 }]}>
            {error}
          </Text>
        ) : null}
        {notice ? (
          <Text style={[typography.caption, { color: theme.colors.primary, marginTop: 4 }]}>
            {notice}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          style={[
            styles.primary,
            { backgroundColor: theme.colors.primary, opacity: busy ? 0.7 : 1 },
          ]}
          disabled={Boolean(busy)}
          onPress={() => void onSubmit()}
        >
          {busy === "email" ? (
            <ActivityIndicator color={theme.colors.primaryForeground} />
          ) : (
            <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
              Sign in
            </Text>
          )}
        </Pressable>

        <SocialSignIn
          onSelect={(provider) => void onProvider(provider)}
          pending={busy === "google" || busy === "apple" ? (busy as SocialProvider) : null}
          disabled={Boolean(busy)}
        />

        <View style={styles.footer}>
          <Text style={[typography.body, { color: theme.colors.mutedForeground }]}>
            No account yet?{" "}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/signup")} hitSlop={8}>
            <Text style={[typography.bodyStrong, { color: theme.colors.primary }]}>Create one</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    minHeight: HIT_TARGET,
  },
  forgot: { alignSelf: "flex-end", minHeight: 32, justifyContent: "center" },
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
