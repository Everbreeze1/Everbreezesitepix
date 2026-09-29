import { ActivityIndicator, Linking, Platform, View } from "react-native";
import Constants from "expo-constants";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { mapUnavailable } from "@/api/map-view";
import { getPhotoDetail } from "@/api/photo-viewer";
import { formatCoords, photoLocationTarget } from "@/api/photo-viewer-view";
import { formatAddress, getProject } from "@/api/projects";
import { radius, spacing, useLayout, useTheme } from "@/theme";
import { ExternalLink, MapPin, TriangleAlert } from "@/ui/icons";
import { Badge, Button, Icon, Text } from "@/ui";

/**
 * Where one photo was taken, on the app's own map.
 *
 * The photo viewer's location button used to open Google Maps, which took the
 * whole phone and left no way back to the photo or the job (Jon, 2026-09-29).
 * This is a pushed screen instead: the header's Back returns to the viewer on
 * the same photo, because the viewer only hides while another screen is on
 * top. Google Maps is still one tap away, as the secondary button on the card,
 * for directions.
 *
 * The pin is the photo's own GPS; a photo without any falls back to the
 * project's site pin, and one whose project has only an address shows the
 * address with no pin. Provider as on the Map page: Google on Android, the
 * platform map on iOS.
 */

/** Set by `app.config.js` when the build was given a Google Maps Android key. */
const googleMapsConfigured = Boolean(
  (Constants.expoConfig?.extra as { googleMapsConfigured?: boolean } | undefined)
    ?.googleMapsConfigured,
);

/** About a block across: close enough to tell which house the pin is on. */
const PIN_DELTA = 0.004;

/** The card's width where it sits on the right (tablet, or a phone on its side). */
const CARD_WIDTH = 340;

export default function PhotoLocationScreen() {
  const theme = useTheme();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const { id, projectId: projectParam } = useLocalSearchParams<{
    id: string;
    projectId?: string;
  }>();

  // The same key the viewer reads, so this is usually a cache hit.
  const detailQuery = useQuery({
    queryKey: ["photo-detail", id],
    queryFn: () => getPhotoDetail(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
  const projectId = projectParam || detailQuery.data?.project_id || null;
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const project = projectQuery.data ?? null;
  const address = project ? formatAddress(project) : null;
  const target = photoLocationTarget(detailQuery.data, project, address);
  const loading = detailQuery.isLoading || (Boolean(projectId) && projectQuery.isLoading);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  const unavailable = mapUnavailable({
    googleMapsConfigured,
    platform: Platform.OS,
    pinCount: target.coord ? 1 : 0,
  });
  const drawMap = target.coord && unavailable === null;

  const heading =
    target.kind === "photo"
      ? "Where this photo was taken"
      : target.kind === "none"
        ? "No location for this photo"
        : "Project location";
  const detail =
    target.kind === "photo" && target.coord
      ? formatCoords(target.coord.latitude, target.coord.longitude)
      : target.kind === "none"
        ? "This photo has no GPS and its project has no address."
        : (address ??
          (target.coord ? formatCoords(target.coord.latitude, target.coord.longitude) : ""));
  const note =
    target.kind === "project" || target.kind === "address"
      ? "This photo has no GPS, so this is the project's site."
      : null;

  const card = (
    <View
      style={{
        gap: spacing.sm,
        padding: spacing.lg,
        borderRadius: radius.lg,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        ...theme.elevation.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon icon={MapPin} size="sm" tone={target.kind === "photo" ? "success" : "muted"} />
        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
          {heading}
        </Text>
      </View>
      {detail ? (
        <Text variant="caption" tone="muted" selectable>
          {detail}
        </Text>
      ) : null}
      {note ? (
        <Text variant="caption" tone="muted">
          {note}
        </Text>
      ) : null}
      {target.coord && unavailable === "no_key" ? (
        <Badge label="Map unavailable" tone="warning" icon={TriangleAlert} variant="soft" />
      ) : null}
      {target.mapsUrl ? (
        <Button
          label="Open in Google Maps"
          icon={ExternalLink}
          variant="outline"
          size="sm"
          fullWidth={!layout.rail}
          onPress={() => void Linking.openURL(target.mapsUrl!)}
        />
      ) : null}
    </View>
  );

  /*
   * Upright on a phone the card spans the foot of the screen. On a tablet or
   * on its side it sits in the lower right, where the free thumb rests, and
   * leaves the rest of the map clear.
   */
  const bottom = insets.bottom + spacing.lg;
  const cardPosition = layout.rail
    ? { right: spacing.lg + layout.safeSide, bottom, width: CARD_WIDTH }
    : { left: spacing.lg + insets.left, right: spacing.lg + insets.right, bottom };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {drawMap && target.coord ? (
        <MapView
          provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
          style={{ flex: 1 }}
          initialRegion={{
            ...target.coord,
            latitudeDelta: PIN_DELTA,
            longitudeDelta: PIN_DELTA,
          }}
          showsMyLocationButton={false}
          toolbarEnabled={false}
        >
          <Marker
            coordinate={target.coord}
            pinColor={theme.colors.primary}
            accessibilityLabel={heading}
          />
        </MapView>
      ) : (
        <View style={{ flex: 1, backgroundColor: theme.colors.secondary }} />
      )}
      <View style={{ position: "absolute", ...cardPosition }}>{card}</View>
    </View>
  );
}
