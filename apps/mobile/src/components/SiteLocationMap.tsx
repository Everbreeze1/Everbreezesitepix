import { useEffect, useRef } from "react";
import { ActivityIndicator, Platform, View, type StyleProp, type ViewStyle } from "react-native";
import Constants from "expo-constants";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { mapUnavailable, type Coord } from "@/api/map-view";
import { radius, spacing, useTheme } from "@/theme";
import { MapPin, TriangleAlert } from "@/ui/icons";
import { Badge, Icon, Text } from "@/ui";

/**
 * The job site on a map, with a pin the crew can drag onto the right building.
 *
 * The phone's fix is usually close but not exact: it lands in the street, on
 * the neighbour's roof, or in the middle of a big lot. The web form shows the
 * same map for the same reason, and this is its native twin. It is drawn the
 * moment the screen opens, before there is anything to show, so the
 * "Locating" state is visibly the map waiting rather than a blank space that
 * later pushes the form down.
 *
 * Provider choice follows `map.tsx`: Google on Android, so it matches the key
 * `app.config.js` writes into the manifest, and the platform default on iOS,
 * which is Apple Maps and needs no key.
 */

/** Set by `app.config.js` when the build was given a Google Maps Android key. */
const googleMapsConfigured = Boolean(
  (Constants.expoConfig?.extra as { googleMapsConfigured?: boolean } | undefined)
    ?.googleMapsConfigured,
);

/** Roughly the middle of the United States, for a map with nothing on it yet. */
const NOWHERE_IN_PARTICULAR: Region = {
  latitude: 39.8283,
  longitude: -98.5795,
  latitudeDelta: 40,
  longitudeDelta: 40,
};

/** About a block across: close enough to tell which house the pin is on. */
const SITE_DELTA = 0.004;

function siteRegion(coord: Coord): Region {
  return { ...coord, latitudeDelta: SITE_DELTA, longitudeDelta: SITE_DELTA };
}

export function SiteLocationMap({
  coords,
  locating,
  showsUserLocation,
  onPinMoved,
  height = 240,
  style,
}: {
  /** Where the pin is. Null draws the map with no pin, zoomed out. */
  coords: Coord | null;
  /** The phone is being asked where it is. */
  locating: boolean;
  /** Only once permission is granted, or iOS logs a warning on every render. */
  showsUserLocation: boolean;
  /** The crew dragged the pin, or long-pressed the map to drop it somewhere. */
  onPinMoved: (coord: Coord) => void;
  /** Ignored when `style` gives the map a flex height instead. */
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const mapRef = useRef<MapView | null>(null);
  /*
   * The last position this component reported itself. When the parent hands it
   * straight back the map is already looking at it, and re-centring there
   * would yank the view away from wherever the crew had panned to while
   * placing the pin.
   */
  const ownMoveRef = useRef<Coord | null>(null);

  useEffect(() => {
    if (!coords) return;
    const own = ownMoveRef.current;
    if (own && own.latitude === coords.latitude && own.longitude === coords.longitude) return;
    mapRef.current?.animateToRegion(siteRegion(coords), 450);
  }, [coords]);

  const move = (coord: Coord) => {
    ownMoveRef.current = coord;
    onPinMoved(coord);
  };

  const frame: StyleProp<ViewStyle> = [
    {
      height,
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: theme.colors.secondary,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    style,
  ];

  const unavailable = mapUnavailable({ googleMapsConfigured, platform: Platform.OS, pinCount: 1 });

  if (unavailable === "no_key") {
    /*
     * Said plainly, as on the Map tab, rather than an empty tile grid. The pin
     * still exists without a map: locating and address search both set it,
     * and the coordinates are shown so the crew can see that they did.
     */
    return (
      <View style={[frame, { padding: spacing.lg, gap: spacing.sm, justifyContent: "center" }]}>
        <Badge label="Map unavailable" tone="warning" icon={TriangleAlert} variant="soft" />
        <Text variant="body">
          This build has no Google Maps key, so the pin cannot be shown. Locating and address search
          still set it.
        </Text>
        {coords ? (
          <Text variant="caption" tone="muted">
            {`Pinned at ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={frame}>
      <MapView
        ref={mapRef}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        style={{ flex: 1 }}
        initialRegion={coords ? siteRegion(coords) : NOWHERE_IN_PARTICULAR}
        showsUserLocation={showsUserLocation}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        // Long-press rather than tap, so a tap meant to scroll the form past
        // the map does not quietly move the job site.
        onLongPress={(event) => move(event.nativeEvent.coordinate)}
      >
        {coords ? (
          <Marker
            coordinate={coords}
            draggable
            pinColor={theme.colors.primary}
            onDragEnd={(event) => move(event.nativeEvent.coordinate)}
            accessibilityLabel="Job site pin. Drag to adjust."
          />
        ) : null}
      </MapView>

      {locating ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: spacing.md,
            alignSelf: "center",
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
            borderRadius: radius.xl,
            backgroundColor: theme.colors.card,
            borderWidth: 1,
            borderColor: theme.colors.border,
            ...theme.elevation.card,
          }}
          accessibilityLiveRegion="polite"
        >
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text variant="caption">Locating</Text>
        </View>
      ) : null}

      {!coords && !locating ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: spacing.md,
            right: spacing.md,
            bottom: spacing.md,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            padding: spacing.sm,
            borderRadius: radius.md,
            backgroundColor: theme.colors.card,
          }}
        >
          <Icon icon={MapPin} size="sm" tone="muted" />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            No pin yet. Search the address, or long-press the map where the job is.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
