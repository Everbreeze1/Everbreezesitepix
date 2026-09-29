import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, useWindowDimensions, View } from "react-native";
import Constants from "expo-constants";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { listProjects, type ProjectListItem } from "@/api/projects";
import {
  byDistance,
  initialMapRegion,
  locatable,
  mapStatusOf,
  mapStyleFor,
  mapUnavailable,
  matchesMapFilter,
  pinColorFor,
  regionFor,
  type Coord,
  type MapFilter,
} from "@/api/map-view";
import {
  MapStatusChips,
  MapStatusLegend,
  NearbyRow,
  NearbySheet,
  type MapStatusCounts,
} from "@/components/MapPanels";
import { MapProjectPreview } from "@/components/MapProjectPreview";
import { useDeviceLocation } from "@/lib/use-device-location";
import { elevation, radius, spacing, useRightRail, useTheme } from "@/theme";
import { FolderKanban, LocateFixed, MapPin, Maximize, TriangleAlert } from "@/ui/icons";
import { Badge, Button, EmptyState, ErrorState, IconButton, SkeletonList, Text } from "@/ui";

/**
 * Projects on a map, laid out the way the web's Maps page is.
 *
 * The map fills the screen and opens on where the team's work is, never on
 * the whole world: fitted to the main cluster of pins (the ones around the
 * phone when it is near any), else to the phone's own location, else to a
 * country-sized default. Pins are coloured by status in the web's four
 * colours, and the status chips are both the legend and the filter.
 *
 * Beside the map is the Nearby list, because a crew in a van asks "which of
 * these am I at" far more often than "where is everything". On a phone it is a
 * sheet over the bottom of the map; on a tablet, or a phone on its side, it is
 * a panel down the right, where the thumb that is free already rests. Tapping
 * a pin or a row opens a preview card with the job's photo, and the card is
 * the way into the job.
 *
 * Nothing here writes. It reads the same `projects` rows the list tab does and
 * puts the ones that have coordinates on a map.
 */

/** Set by `app.config.js` when the build was given a Google Maps Android key. */
const googleMapsConfigured = Boolean(
  (Constants.expoConfig?.extra as { googleMapsConfigured?: boolean } | undefined)
    ?.googleMapsConfigured,
);

/** How much of the phone's Nearby sheet shows while it rests. */
const SHEET_PEEK = 200;
/** Room for the status chips floating over the top of the map. */
const CHIPS_HEIGHT = 58;
/** The tablet's side panel, the web rail's width. */
const PANEL_WIDTH = 340;

type Pinned = ProjectListItem & Coord;

export default function MapScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const rail = useRightRail();
  const mapRef = useRef<MapView | null>(null);
  // Nearest-first sorting and the fallback frame; the map needs no permission.
  const { here, noFix } = useDeviceLocation();

  const query = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  // Active first, as on the web: the map is opened to find a live job.
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
    () => drawable.filter((project) => matchesMapFilter(project, filter)),
    [drawable, filter],
  );

  // Counted over what can be drawn, so a chip promises exactly the pins it shows.
  const counts = useMemo<MapStatusCounts>(() => {
    const out: MapStatusCounts = { active: 0, on_hold: 0, completed: 0, archived: 0 };
    for (const project of drawable) {
      const status = mapStatusOf(project);
      if (status) out[status] += 1;
    }
    return out;
  }, [drawable]);

  const selected = useMemo(
    () => pinned.find((project) => project.id === selectedId) ?? null,
    [pinned, selectedId],
  );

  const nearest = useMemo(() => byDistance(pinned, here), [pinned, here]);
  const opening = useMemo(() => initialMapRegion(pinned, here), [pinned, here]);

  const unavailable = mapUnavailable({
    googleMapsConfigured,
    platform: Platform.OS,
    pinCount: drawable.length,
  });

  const focus = useCallback((coord: Coord) => {
    mapRef.current?.animateToRegion({ ...coord, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 400);
  }, []);

  const fitAll = useCallback(() => {
    const all = regionFor(pinned);
    if (all) mapRef.current?.animateToRegion(all as Region, 400);
  }, [pinned]);

  /*
   * Reframe when what should frame the map changes: a new filter, the pins
   * arriving, or a location fix landing on a map that had nothing else to
   * show. Keyed on the region's own numbers so a refetch returning the same
   * jobs does not yank the map out from under somebody's pinch.
   */
  const frameKey = `${filter}:${opening.latitude.toFixed(4)}:${opening.longitude.toFixed(4)}:${opening.latitudeDelta.toFixed(4)}`;
  const lastFrame = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    if (!mapReady || lastFrame.current === frameKey) return;
    const first = lastFrame.current === null;
    lastFrame.current = frameKey;
    mapRef.current?.animateToRegion(opening as Region, first ? 0 : 400);
  }, [mapReady, frameKey, opening]);

  /*
   * Custom pin views on Android are snapshotted to bitmaps. Tracking changes
   * for a moment after the pins or the selection change lets the new colours
   * and sizes land, then stops, because tracking every pin all the time is
   * what makes a busy map stutter.
   */
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    setTracking(true);
    const timer = setTimeout(() => setTracking(false), 700);
    return () => clearTimeout(timer);
  }, [pinned, selectedId, theme.scheme]);

  const changeFilter = useCallback((next: MapFilter) => {
    setFilter(next);
    setSelectedId(null);
  }, []);

  const select = useCallback(
    (project: Pinned) => {
      setSelectedId(project.id);
      focus(project);
    },
    [focus],
  );

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

  const noteForList = noFix
    ? "No location fix, so these are in the order they were last worked on rather than by distance."
    : null;

  const listBody =
    pinned.length === 0 && drawable.length > 0 ? (
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
      nearest.map((project) => (
        <NearbyRow
          key={project.id}
          project={project}
          selected={project.id === selectedId}
          onPress={() => select(project)}
        />
      ))
    );

  const nearbyTitle = `NEARBY (${pinned.length})`;

  /*
   * Said plainly rather than shown as a grey box. Without a Maps key the
   * Android SDK renders an empty tile grid with a watermark and logs nothing a
   * person would find, so the screen names the actual cause and keeps the
   * list working.
   */
  const noKeyNotice = (
    <View
      style={{
        margin: spacing.lg,
        backgroundColor: theme.colors.secondary,
        borderRadius: radius.lg,
        padding: spacing.lg,
        gap: spacing.sm,
      }}
    >
      <Badge label="Map unavailable" tone="warning" icon={TriangleAlert} variant="soft" />
      <Text variant="body">
        This build has no Google Maps key, so Android cannot draw the map. The list still works.
      </Text>
      <Text variant="caption" tone="muted">
        Set EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY as an EAS secret and rebuild.
      </Text>
    </View>
  );

  const mapPadding = rail
    ? {
        top: spacing.lg,
        right: spacing.lg,
        bottom: selected ? 300 : spacing.lg,
        // Clear of the notch of a phone on its side; zero on a tablet.
        left: spacing.lg + insets.left,
      }
    : {
        top: CHIPS_HEIGHT,
        right: spacing.md,
        bottom: selected ? 330 : SHEET_PEEK + insets.bottom,
        left: spacing.md,
      };

  const map =
    unavailable === "no_key" ? (
      noKeyNotice
    ) : (
      <MapView
        ref={mapRef}
        // Pinned to Google on Android so the provider matches the key in the
        // manifest. Left to the default on iOS, which is Apple Maps and needs
        // no key.
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        style={{ flex: 1 }}
        initialRegion={opening as Region}
        onMapReady={() => setMapReady(true)}
        mapPadding={mapPadding}
        // The warm style on Google; Apple Maps takes only light or dark.
        customMapStyle={Platform.OS === "android" ? mapStyleFor(theme.scheme) : undefined}
        userInterfaceStyle={theme.scheme}
        showsUserLocation={here !== null}
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        showsCompass={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        onPress={(event) => {
          // A tap on open map closes the card; a tap on a pin is its own event.
          if (event.nativeEvent.action !== "marker-press") setSelectedId(null);
        }}
      >
        {pinned.map((project) => {
          const on = project.id === selectedId;
          const size = on ? 22 : 16;
          return (
            <Marker
              key={project.id}
              identifier={project.id}
              coordinate={{ latitude: project.latitude, longitude: project.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={tracking}
              zIndex={on ? 10 : 1}
              accessibilityLabel={project.name}
              // The preview card replaces the platform callout: a tap opens
              // the card, and the card is the way into the job.
              onPress={() => setSelectedId(project.id)}
            >
              <View
                style={{
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  borderWidth: on ? 3 : 2.5,
                  borderColor: "#ffffff",
                  backgroundColor: pinColorFor(project),
                  ...elevation.card,
                }}
              />
            </Marker>
          );
        })}
      </MapView>
    );

  const mapControls =
    unavailable === "no_key" ? null : (
      <View
        style={{
          position: "absolute",
          right: spacing.md,
          top: rail ? spacing.md : CHIPS_HEIGHT + spacing.xs,
          gap: spacing.sm,
        }}
      >
        {here ? (
          <View style={{ borderRadius: radius.pill, ...elevation.card }}>
            <IconButton
              icon={LocateFixed}
              accessibilityLabel="Centre on me"
              onPress={() => focus(here)}
            />
          </View>
        ) : null}
        {pinned.length > 1 ? (
          <View style={{ borderRadius: radius.pill, ...elevation.card }}>
            <IconButton icon={Maximize} accessibilityLabel="Fit to all" onPress={fitAll} />
          </View>
        ) : null}
      </View>
    );

  if (rail) {
    return (
      <>
        <Stack.Screen options={{ title: "Map" }} />
        <View style={{ flex: 1, flexDirection: "row", backgroundColor: theme.colors.background }}>
          <View style={{ flex: 1, backgroundColor: theme.colors.secondary }}>
            {map}
            {mapControls}
            {selected ? (
              <View
                style={{
                  position: "absolute",
                  left: spacing.lg + insets.left,
                  bottom: spacing.lg + insets.bottom,
                  width: 340,
                }}
              >
                <MapProjectPreview project={selected} onClose={() => setSelectedId(null)} />
              </View>
            ) : null}
          </View>
          <View
            style={{
              width: PANEL_WIDTH,
              borderLeftWidth: 1,
              borderLeftColor: theme.colors.border,
              backgroundColor: theme.colors.background,
            }}
          >
            <ScrollView
              contentContainerStyle={{
                padding: spacing.lg,
                paddingRight: spacing.lg + insets.right,
                paddingBottom: spacing.xxl + insets.bottom,
                gap: spacing.md,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                  {`${pinned.length} on the map`}
                </Text>
                {filter !== "all" ? (
                  <Button
                    label="Show all"
                    size="sm"
                    variant="outline"
                    onPress={() => changeFilter("all")}
                  />
                ) : null}
              </View>
              <MapStatusLegend counts={counts} filter={filter} onChange={changeFilter} />
              <Text variant="caption" tone="muted" style={{ fontSize: 11 }}>
                Pipeline stages roll up into Active, On hold and Completed.
              </Text>
              <Text
                variant="overline"
                tone="muted"
                style={{ fontSize: 12, letterSpacing: 1, marginTop: spacing.sm }}
              >
                {nearbyTitle}
              </Text>
              {noteForList ? (
                <Text variant="caption" tone="muted">
                  {noteForList}
                </Text>
              ) : null}
              <View>{listBody}</View>
            </ScrollView>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Map" }} />
      <View style={{ flex: 1, backgroundColor: theme.colors.secondary }}>
        {unavailable === "no_key" ? (
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl + insets.bottom }}>
            <View style={{ paddingTop: spacing.md }}>
              <MapStatusChips counts={counts} filter={filter} onChange={changeFilter} />
            </View>
            {noKeyNotice}
            {noteForList ? (
              <Text variant="caption" tone="muted" style={{ paddingHorizontal: spacing.lg }}>
                {noteForList}
              </Text>
            ) : null}
            <View style={{ paddingHorizontal: spacing.sm }}>{listBody}</View>
          </ScrollView>
        ) : (
          <>
            {map}
            <View
              style={{ position: "absolute", top: spacing.md, left: 0, right: 0 }}
              pointerEvents="box-none"
            >
              <MapStatusChips counts={counts} filter={filter} onChange={changeFilter} />
            </View>
            {mapControls}
            {selected ? (
              <View
                style={{
                  position: "absolute",
                  left: spacing.md,
                  right: spacing.md,
                  bottom: spacing.md + insets.bottom,
                }}
              >
                <MapProjectPreview project={selected} onClose={() => setSelectedId(null)} />
              </View>
            ) : (
              <NearbySheet
                title={nearbyTitle}
                note={noteForList}
                peekHeight={SHEET_PEEK}
                maxHeight={Math.round(windowHeight * 0.62)}
                bottomInset={insets.bottom}
              >
                {listBody}
              </NearbySheet>
            )}
          </>
        )}
      </View>
    </>
  );
}
