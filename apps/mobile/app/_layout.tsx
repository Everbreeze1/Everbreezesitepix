import { useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/lib/auth";
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
          <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.background },
            }}
          />
        </AuthProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}
