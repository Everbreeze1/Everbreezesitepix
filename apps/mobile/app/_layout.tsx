import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import * as NativeSplash from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LaunchScreen } from "@/components/LaunchScreen";
import { AuthProvider, useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/query";
import { startSync } from "@/offline/sync";
import { useTheme } from "@/theme";

/**
 * Cached server state, so the app opens with something on screen.
 *
 * AsyncStorage rather than the SQLite database: this is a single JSON blob
 * rewritten wholesale, which is the one shape key-value storage is actually
 * good at. SQLite is reserved for the outbox, where rows need to be queried and
 * claimed individually.
 */
const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "everlumen-query-cache",
  // Writing on every cache mutation would mean a full re-serialise per photo
  // during a drain.
  throttleTime: 2_000,
});

/*
 * Hold the native splash until the launch screen has painted.
 *
 * Without this there is a white flash between the two: the native splash tears
 * down as soon as the first frame is ready, which is before React has drawn
 * anything. Failures are swallowed because a splash that will not hide must
 * never be the reason the app does not start.
 */
void NativeSplash.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const theme = useTheme();

  useEffect(() => {
    // Recovers anything interrupted by the last process death, then starts
    // listening for reconnects and foregrounds.
    void startSync();
  }, []);

  return (
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 24 * 60 * 60 * 1000,
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => {
              /*
               * Never persist signed URLs. They carry a one-hour expiry, so a
               * restored cache from this morning would hand every tile a URL
               * the storage API now rejects, and the grid would come back as a
               * screen of broken images that a refresh does not fix.
               */
              if (query.queryKey[0] === "photo-urls") return false;
              return query.state.status === "success";
            },
          },
        }}
      >
        <AuthProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.background },
            }}
          />
          <Launch />
        </AuthProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}

/**
 * Decides when the launch screen goes away.
 *
 * It covers the wait that actually exists: reading the stored session out of
 * the Keychain and refreshing the token. Hiding it the moment React mounts
 * would just show the login screen for an instant before replacing it with the
 * project list, which is the flicker a launch screen is there to prevent.
 *
 * Once that wait is over the screen behaves differently depending on who is
 * there:
 *
 *   signed in      it dismisses itself and gets out of the way
 *   not signed in  it becomes a welcome screen with a button through to sign in
 *
 * Waiting for a tap from someone already signed in would be a step between them
 * and their work, and offering "Sign in" to them would be a dead end.
 */
function Launch() {
  const { loading, user } = useAuth();
  const [mounted, setMounted] = useState(true);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  /*
   * A floor of 900ms keeps it from flashing past on a warm start. Below roughly
   * that, an appearing-and-vanishing screen reads as a glitch rather than as
   * branding.
   */
  useEffect(() => {
    const timer = setTimeout(() => setMinimumElapsed(true), 900);
    return () => clearTimeout(timer);
  }, []);

  // The launch screen has painted by now, so the native one can go without a
  // gap between them.
  useEffect(() => {
    void NativeSplash.hideAsync().catch(() => {});
  }, []);

  const settling = loading || !minimumElapsed;
  const awaitingTap = !settling && !user && !dismissed;
  const showing = mounted && (settling || awaitingTap);

  /*
   * One StatusBar, owned here rather than inside LaunchScreen.
   *
   * `expo-status-bar` applies its style in an effect and does not restore the
   * previous style when it unmounts, so a second instance inside the launch
   * screen would pin the bar to light for the rest of the session: white glyphs
   * on the app's #F9FCFF canvas, which is about 1.03:1. `auto` resolves from
   * the system scheme, matching every other screen.
   */
  return (
    <>
      <StatusBar style={showing ? "light" : "auto"} animated />
      {mounted ? (
        <LaunchScreen
          visible={settling || awaitingTap}
          actionLabel={awaitingTap ? "Sign in" : undefined}
          onAction={() => setDismissed(true)}
          onHidden={() => setMounted(false)}
        />
      ) : null}
    </>
  );
}
