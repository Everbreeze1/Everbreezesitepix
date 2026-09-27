import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { MapProjectPreview } from "@/components/MapProjectPreview";
import { ProjectFilterPills, type ProjectFilterOption } from "@/components/ProjectStatusPill";
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
/*
 * The web map's status filter. Active is the default there and here: the map
 * is opened to find a live job, and completed ones are most of a board's pins
 * after a year. Archived is the `archived` flag, not a status, and is only
 * plotted when asked for.
 */
type MapFilter = "active" | "on_hold" | "completed" | "archived" | "all";

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
  const [filter, setFilter] = useState<MapFilter>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Every job that can be drawn, before the status filter.
  const drawable = useMemo(
    () =>
      // `locatable` drops rows with no fix, an out-of-range value, or the 0,0
      // that half the systems producing a coordinate default to.
      locatable((query.data ?? []) as (ProjectListItem & { latitude: number | null })[]),
    [query.data],
  );

  const pinned = useMemo(
    () =>
      drawable.filter((project) => {
        if (filter === "archived") return Boolean(project.archived);
        if (project.archived) return false;
        return filter === "all" || project.status === filter;
      }),
    [drawable, filter],
  );

  // Counted over what can be drawn, so a pill promises exactly the pins it shows.
  const filters = useMemo<ProjectFilterOption<MapFilter>[]>(() => {
    const count = (test: (p: ProjectListItem) => boolean) => drawable.filter(test).length;
    return [
      { id: "active", label: "Active", count: count((p) => !p.archived && p.status === "active") },
      {
        id: "on_hold",
        label: "On hold",
        count: count((p) => !p.archived && p.status === "on_hold"),
      },
      {
        id: "completed",
        label: "Completed",
        count: count((p) => !p.archived && p.status === "completed"),
      },
      { id: "archived", label: "Archived", count: count((p) => Boolean(p.archived)) },
      { id: "all", label: "All", count: count((p) => !p.archived) },
    ];
  }, [drawable]);

  const selected = useMemo(
    () => pinned.find((project) => project.id === selectedId) ?? null,
    [pinned, selectedId],
  );

  const nearest = useMemo(() => byDistance(pinned, here), [pinned, here]);
  const region = useMemo(() => regionFor(pinned), [pinned]);

  const unavailable = mapUnavailable({
    googleMapsConfigured,
    platform: Platform.OS,
    // Every drawable job, not the filtered ones: a filter that matches nothing
    // should empty the map, not remove it.
    pinCount: drawable.length,
  });

  const focus = useCallback((coord: Coord) => {
    mapRef.current?.animateToRegion({ ...coord, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
  }, []);

  /*
   * The region the map opened on belongs to the filter it opened with. A new
   * filter reframes to its own pins, or the pins it just revealed would be off
   * screen with nothing to say they exist.
   */
  const changeFilter = useCallback((next: MapFilter) => {
    setFilter(next);
    setSelectedId(null);
  }, []);
  const lastFitted = useRef<MapFilter>(filter);
  useEffect(() => {
    if (lastFitted.current === filter || !region) return;
    lastFitted.current = filter;
    mapRef.current?.animateToRegion(region as Region, 400);
  }, [filter, region]);

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
        <View style={{ paddingVertical: spacing.md }}>
          <ProjectFilterPills
            options={filters}
            value={filter}
            onChange={changeFilter}
            label="Show projects by status"
          />
        </View>

        {unavailable === null ? (
          <View style={{ height: 320, backgroundColor: theme.colors.secondary }}>
            <MapView
              ref={mapRef}
              // Pinned to Google on Android so the provider matches the key in
              // the manifest. Left to the default on iOS, which is Apple Maps
              // and needs no key.
              provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
              style={{ flex: 1 }}
              initialRegion={(region ?? regionFor(drawable) ?? undefined) as Region}
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
                  pinColor={
                    project.id === selectedId ? theme.colors.foreground : theme.colors.primary
                  }
                  // The preview card below replaces the platform callout: a
                  // tap opens the card, and the card is the way into the job.
                  onPress={() => setSelectedId(project.id)}
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

        {selected ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
            <MapProjectPreview project={selected} onClose={() => setSelectedId(null)} />
          </View>
        ) : null}

        {pinned.length === 0 && drawable.length > 0 ? (
          <EmptyState
            icon={MapPin}
            title="Nothing with this status on the map"
            body="No project with this status has a location. Try another filter."
            action={{ label: "Show all", onPress: () => changeFilter("all") }}
          />
        ) : pinned.length === 0 ? (
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
                      // Tapping the row moves the map and opens the preview
                      // card rather than leaving the screen. Opening the
                      // project is the card's button, the deliberate second
                      // step, the same as tapping the pin.
                      onPress={() => {
                        setSelectedId(project.id);
                        focus(project);
                      }}
                      accessibilityHint="Centres the map on this project and shows its preview"
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
