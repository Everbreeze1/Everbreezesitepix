import NetInfo from "@react-native-community/netinfo";
import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { AppState, type AppStateStatus } from "react-native";

/**
 * TanStack Query, configured for a phone on a jobsite rather than a desktop
 * browser. `apps/web` runs the same major version, so query keys and cache
 * idioms carry over; only the defaults below differ.
 */

/**
 * Query's browser default treats "no network" as a reason to fail fast. On a
 * site with one bar that is exactly wrong: we would rather serve the cached
 * answer and refetch when signal returns.
 */
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    // `isInternetReachable` is null until the first probe resolves. Treat that
    // as online, because assuming offline on boot suppresses the first fetch.
    setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
  }),
);

function onAppStateChange(status: AppStateStatus) {
  // React Native has no window focus event; app foregrounding is the analogue.
  focusManager.setFocused(status === "active");
}

AppState.addEventListener("change", onAppStateChange);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /*
       * `offlineFirst` serves cache and holds the fetch until reachable,
       * instead of erroring immediately when offline. Paired with the
       * persister added in Phase 2, this is what makes the project list
       * readable in a basement.
       */
      networkMode: "offlineFirst",
      staleTime: 30_000,
      // Long enough that a persisted cache survives a shift change.
      gcTime: 24 * 60 * 60 * 1000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      refetchOnReconnect: true,
      // Refetching on every screen focus burns data on a metered connection.
      // Screens that need it opt in per query.
      refetchOnWindowFocus: false,
    },
    mutations: {
      networkMode: "offlineFirst",
      // Mutations that must survive a dead connection belong in the Phase 2
      // outbox, not in a retry loop that dies with the process.
      retry: 0,
    },
  },
});
