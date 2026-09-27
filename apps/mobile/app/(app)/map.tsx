import { useCallback, useMemo, useRef } from "react";
import { Platform, View } from "react-native";
import Constants from "expo-constants";
import { router, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { listProjects, type ProjectListItem } from "@/api/projects";
import {
  byDistance,
  distanceLabel,
  locatable,
  mapUnavailable,
  regionFor,
  type Coord,
} from "@/api/map-view";
import { useDeviceLocation } from "@/lib/use-device-location";
import { radius, spacing, useTheme } from "@/theme";
import { FolderKanban, LocateFixed, MapPin, TriangleAlert } from "@/ui/icons";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Projects on a map.
 *
 * The first genuinely new native dependency since Phase 5, and the reason it
 * was left until now: `react-native-maps` cannot run in Expo Go, so adding it
 * ends testing on anything but a development build.
 *
 * The screen is a map **and** a list, not a map alone, and that is the point.
 * A map answers "where is everything", which somebody asks once. A crew in a
 * van asks "which of these am I at", which is a sorted list with distances on
 * it, and that half keeps working when the map cannot draw at all: no Maps key
 * on Android, no location fix, or a device that simply will not render one.
 *
 * Nothing here writes. It reads the same `projects` rows the list tab does and
 * puts the ones that have coordinates on a map.
 */

/** Set by `app.config.js` when the build was given a Google Maps Android key. */
const googleMapsConfigured = Boolean(
  (Constants.expoConfig?.extra as { googleMapsConfigured?: boolean } | undefined)
    ?.googleMapsConfigured,
);

export default function MapScreen() {
  const theme = useTheme();
  const mapRef = useRef<MapView | null>(null);
  // Nearest-first sorting; the map itself needs no permission at all.
  const { here, noFix } = useDeviceLocation();

  const query = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  const pinned = useMemo(() => {
    const rows = (query.data ?? []).filter((project) => !project.archived);
    // `locatable` drops rows with no fix, an out-of-range value, or the 0,0
    // that half the systems producing a coordinate default to.
    return locatable(rows as (ProjectListItem & { latitude: number | null })[]);
  }, [query.data]);

  const nearest = useMemo(() => byDistance(pinned, here), [pinned, here]);
  const region = useMemo(() => regionFor(pinned), [pinned]);

  const unavailable = mapUnavailable({
    googleMapsConfigured,
    platform: Platform.OS,
    pinCount: pinned.length,
  });

  const focus = useCallback((coord: Coord) => {
    mapRef.current?.animateToRegion({ ...coord, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
  }, []);

  if (query.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Map" }} />
        <SkeletonList rows={5} />
      </>
    );
  }

  if (query.error) {
    return (
      <>
        <Stack.Screen options={{ title: "Map" }} />
        <ErrorState
          title="Could not load your projects"
          message={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Map",
          headerRight: () =>
            here && region ? (
              <IconButton
                icon={LocateFixed}
                accessibilityLabel="Centre on me"
                surface={false}
                onPress={() => focus(here)}
              />
            ) : null,
        }}
      />

      <Screen scroll padded={false} bottomInset={spacing.xxl}>
        {unavailable === null ? (
          <View style={{ height: 320, backgroundColor: theme.colors.secondary }}>
            <MapView
              ref={mapRef}
              // Pinned to Google on Android so the provider matches the key in
              // the manifest. Left to the default on iOS, which is Apple Maps
              // and needs no key.
              provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
              style={{ flex: 1 }}
              initialRegion={region as Region}
              showsUserLocation={here !== null}
              showsMyLocationButton={false}
              toolbarEnabled={false}
            >
              {pinned.map((project) => (
                <Marker
                  key={project.id}
                  coordinate={{ latitude: project.latitude, longitude: project.longitude }}
                  title={project.name}
                  description={project.client_name ?? project.city ?? undefined}
                  pinColor={theme.colors.primary}
                  onCalloutPress={() =>
                    router.push({ pathname: "/project/[id]", params: { id: project.id } })
                  }
                />
              ))}
            </MapView>
          </View>
        ) : unavailable === "no_key" ? (
          /*
           * Said plainly rather than shown as a grey box.
           *
           * Without a Maps key the Android SDK renders an empty tile grid with
           * a watermark and logs nothing a person would find. Someone looking
           * at that spends an afternoon hunting a bug in the wrong place, so
           * the screen names the actual cause and keeps the list below working.
           */
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
            <View
              style={{
                backgroundColor: theme.colors.secondary,
                borderRadius: radius.lg,
                padding: spacing.lg,
                gap: spacing.sm,
              }}
            >
              <Badge label="Map unavailable" tone="warning" icon={TriangleAlert} variant="soft" />
              <Text variant="body">
                This build has no Google Maps key, so Android cannot draw the map. Everything below
                still works.
              </Text>
              <Text variant="caption" tone="muted">
                Set EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY as an EAS secret and rebuild.
              </Text>
            </View>
          </View>
        ) : null}

        {pinned.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No projects have a location yet"
            body="A project gets one when it is created with GPS or a full address. Add an address to an existing job and it appears here."
            action={{
              label: "All projects",
              onPress: () => router.push("/projects"),
              icon: FolderKanban,
            }}
          />
        ) : (
          <>
            <SectionHeader
              title={here ? `Nearest first (${pinned.length})` : `On the map (${pinned.length})`}
            />
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
              {noFix ? (
                <Text variant="caption" tone="muted">
                  {/*
                    Order is left alone without a fix rather than guessed at. A
                    list that claims to be sorted by distance and is sorted by
                    something else is worse than an unsorted one.
                  */}
                  No location fix, so these are in the order they were last worked on rather than by
                  distance. Location may be off, or the phone may not have a signal here.
                </Text>
              ) : null}

              <ListGroup>
                {nearest.map((project, index) => (
                  <View key={project.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      icon={MapPin}
                      title={project.name}
                      subtitle={project.client_name ?? project.city ?? undefined}
                      right={
                        project.metres !== null ? (
                          <Badge label={distanceLabel(project.metres)} tone="neutral" />
                        ) : undefined
                      }
                      // Tapping the row moves the map rather than leaving the
                      // screen. Opening the project is the callout on the pin,
                      // which is the deliberate second step.
                      onPress={() => focus(project)}
                      accessibilityHint="Centres the map on this project"
                    />
                  </View>
                ))}
              </ListGroup>

              <Button
                label="All projects"
                icon={FolderKanban}
                variant="ghost"
                fullWidth
                onPress={() => router.push("/projects")}
              />
            </View>
          </>
        )}
      </Screen>
    </>
  );
}
