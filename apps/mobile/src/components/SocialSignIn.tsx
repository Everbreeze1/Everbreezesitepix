import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import {
  fetchEnabledProviders,
  PROVIDER_LABEL,
  type SocialProvider,
} from "@/lib/auth-providers";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

/**
 * The "or continue with" block, shared by sign in and sign up.
 *
 * One component rather than the same markup twice, because the two screens
 * offering different providers is a bug waiting to happen: the web app carries
 * this block on both `login.tsx` and `signup.tsx`, and keeping two copies in
 * step by hand is exactly the kind of thing that silently stops being true.
 *
 * Which providers appear is decided by the Supabase project, not by this file.
 * See `@/lib/auth-providers` for why that check exists.
 */

export type SocialSignInProps = {
  /** Called with the chosen provider; the caller owns the sign-in itself. */
  onSelect: (provider: SocialProvider) => void;
  /** The provider currently signing in, so its button can show a spinner. */
  pending?: SocialProvider | null;
  /** Disables every button, for when something else on the screen is busy. */
  disabled?: boolean;
};

export function SocialSignIn({ onSelect, pending, disabled }: SocialSignInProps) {
  const theme = useTheme();
  const [providers, setProviders] = useState<SocialProvider[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchEnabledProviders().then((list) => {
      if (!cancelled) setProviders(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing enabled means nothing rendered, not an empty divider.
  if (providers.length === 0) return null;

  return (
    <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
      <View style={styles.dividerRow}>
        <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />
        <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>or</Text>
        <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />
      </View>

      {providers.map((provider) => (
        <Pressable
          key={provider}
          accessibilityRole="button"
          accessibilityLabel={PROVIDER_LABEL[provider]}
          disabled={disabled}
          onPress={() => onSelect(provider)}
          style={[
            styles.social,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
              opacity: disabled ? 0.7 : 1,
            },
          ]}
        >
          {pending === provider ? (
            <ActivityIndicator color={theme.colors.foreground} />
          ) : (
            <>
              {provider === "google" ? <GoogleGlyph /> : null}
              <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                {PROVIDER_LABEL[provider]}
              </Text>
            </>
          )}
        </Pressable>
      ))}
    </View>
  );
}

/** Google's mark, drawn rather than shipped as a PNG so it stays crisp. */
function GoogleGlyph() {
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48">
      <Path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <Path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <Path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <Path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  social: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    minHeight: HIT_TARGET,
  },
});
