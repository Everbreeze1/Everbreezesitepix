import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import type { Session, User } from "@supabase/supabase-js";
import type { SocialProvider } from "./auth-providers";
import { supabase } from "./supabase";

/*
 * Closes the in-app browser tab automatically when the OAuth redirect fires.
 * Without it the tab stays open on top of the app after a successful sign-in.
 */
WebBrowser.maybeCompleteAuthSession();

type AuthValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signInWithProvider: (provider: SocialProvider) => Promise<{ error: string | null }>;
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    return { error: error?.message ?? null };
  }, []);

  /**
   * OAuth through the system browser.
   *
   * Web hands `signInWithOAuth` a `redirectTo` and lets the page navigate. A
   * native app cannot: there is no page to navigate, so the flow opens an
   * auth session, waits for the redirect back to the app's own scheme, and
   * exchanges the code itself. `skipBrowserRedirect` stops supabase-js trying
   * to do the navigating.
   */
  const signInWithProvider = useCallback(async (provider: SocialProvider) => {
    // Resolves to `everlumen://` in a build and to the Expo Go proxy URL in
    // development, so the same code works in both.
    const redirectTo = AuthSession.makeRedirectUri({ scheme: "everlumen" });

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) return { error: error.message };
    if (!data?.url) return { error: "Could not start sign-in" };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    // Dismissed or cancelled is a choice, not a failure, so it reports no error.
    if (result.type !== "success") return { error: null };

    /*
     * Supabase returns the tokens in the URL fragment for the implicit flow and
     * a `code` for PKCE. Handle both rather than assuming which the project is
     * configured for.
     */
    const url = result.url;
    const code = url.match(/[?&]code=([^&]+)/)?.[1];
    if (code) {
      const exchanged = await supabase.auth.exchangeCodeForSession(decodeURIComponent(code));
      return { error: exchanged.error?.message ?? null };
    }

    const fragment = url.split("#")[1] ?? "";
    const params = new URLSearchParams(fragment);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (access_token && refresh_token) {
      const set = await supabase.auth.setSession({ access_token, refresh_token });
      return { error: set.error?.message ?? null };
    }

    return { error: params.get("error_description") ?? "Sign-in did not complete" };
  }, []);

  /**
   * Password reset.
   *
   * The link lands on the web app rather than deep-linking back into the phone.
   * Handling it natively means a reset screen plus a verified deep link, and
   * `everlumen.co/reset-password` already exists and works today; someone
   * resetting a password is at a keyboard often enough for this to be the right
   * trade until Universal Links are set up.
   */
  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: "https://everlumen.co/reset-password",
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      signIn,
      signUp,
      signInWithProvider,
      sendPasswordReset,
      signOut,
    }),
    [session, loading, signIn, signUp, signInWithProvider, sendPasswordReset, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
