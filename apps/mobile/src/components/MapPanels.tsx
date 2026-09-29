import { useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, Pressable, ScrollView, View } from "react-native";
import {
  distanceLabel,
  MAP_STATUS_COLORS,
  MAP_STATUS_LABELS,
  MAP_STATUSES,
  nearbyLine,
  pinColorFor,
  type MapFilter,
  type MapStatus,
} from "@/api/map-view";
import { elevation, radius, spacing, useTheme } from "@/theme";
import { Text } from "@/ui";

/**
 * The pieces of the Map screen around the map itself, drawn after the web's
 * Maps page: the status legend that is also the filter, and the Nearby list.
 */

export type MapStatusCounts = Record<MapStatus, number>;

/** A dot in a status colour. */
function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
      }}
    />
  );
}

/**
 * The status chips that float over a phone's map: Active, On hold, Completed,
 * Archived, each with its colour and count. Tapping one shows only that
 * status; tapping it again goes back to all, as the web's legend does.
 */
export function MapStatusChips({
  counts,
  filter,
  onChange,
}: {
  counts: MapStatusCounts;
  filter: MapFilter;
  onChange: (next: MapFilter) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel="Show projects by status"
      contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.sm }}
    >
      {MAP_STATUSES.map((status) => {
        const on = filter === status;
        return (
          <Pressable
            key={status}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${MAP_STATUS_LABELS[status]}, ${counts[status]}`}
            accessibilityHint={on ? "Tap again to show all" : undefined}
            onPress={() => onChange(on ? "all" : status)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              height: 38,
              paddingHorizontal: spacing.md,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: on ? theme.colors.foreground : theme.colors.border,
              backgroundColor: on ? theme.colors.foreground : theme.colors.card,
              opacity: pressed ? 0.8 : 1,
              ...elevation.card,
            })}
          >
            <Dot color={MAP_STATUS_COLORS[status]} size={9} />
            <Text
              variant="caption"
              style={{
                fontWeight: "600",
                color: on ? theme.colors.background : theme.colors.foreground,
              }}
            >
              {MAP_STATUS_LABELS[status]}
            </Text>
            <Text
              variant="caption"
              style={{ color: on ? theme.colors.background : theme.colors.mutedForeground }}
            >
              {counts[status]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * The web's legend card, for the tablet's side panel: one row per status with
 * its dot and count, and the row is the filter.
 */
export function MapStatusLegend({
  counts,
  filter,
  onChange,
}: {
  counts: MapStatusCounts;
  filter: MapFilter;
  onChange: (next: MapFilter) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Show projects by status"
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        paddingHorizontal: spacing.md,
      }}
    >
      {MAP_STATUSES.map((status, index) => {
        const on = filter === status;
        return (
          <Pressable
            key={status}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${MAP_STATUS_LABELS[status]}, ${counts[status]}`}
            onPress={() => onChange(on ? "all" : status)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              minHeight: 44,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: theme.colors.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Dot color={MAP_STATUS_COLORS[status]} size={9} />
            <Text variant="body" style={{ flex: 1, fontSize: 14, fontWeight: on ? "700" : "400" }}>
              {MAP_STATUS_LABELS[status]}
            </Text>
            <Text variant="caption" tone="muted">
              {counts[status]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type NearbyProject = {
  id: string;
  name: string;
  status: string;
  archived: boolean | null;
  city?: string | null;
  state?: string | null;
  location?: string | null;
  street?: string | null;
  metres: number | null;
};

/** One row of the Nearby list: the job's colour, name, town, and how far. */
export function NearbyRow({
  project,
  selected,
  onPress,
}: {
  project: NearbyProject;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={project.name}
      accessibilityHint="Centres the map on this project and shows its preview"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        minHeight: 56,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.sm,
        borderRadius: radius.md,
        backgroundColor: selected || pressed ? theme.colors.secondary : "transparent",
      })}
    >
      <Dot color={pinColorFor(project)} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14, lineHeight: 19 }}>
          {project.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ fontSize: 12 }}>
          {nearbyLine(project)}
        </Text>
      </View>
      {project.metres !== null ? (
        <Text variant="caption" tone="muted">
          {distanceLabel(project.metres)}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * The phone's Nearby list: a sheet over the bottom of the map with a handle.
 *
 * It rests low, showing its heading and the first couple of jobs, so the map
 * keeps most of the screen. Dragging the handle up (or tapping it) opens it to
 * read the whole list, and down again to go back to the map. No sheet library:
 * two resting heights and a drag between them is all this needs.
 */
export function NearbySheet({
  title,
  note,
  peekHeight,
  maxHeight,
  bottomInset,
  children,
}: {
  title: string;
  note?: string | null;
  peekHeight: number;
  maxHeight: number;
  bottomInset: number;
  children: ReactNode;
}) {
  const theme = useTheme();
  const low = peekHeight + bottomInset;
  const high = Math.max(low, maxHeight);
  const height = useRef(new Animated.Value(low)).current;
  const current = useRef(low);
  const start = useRef(low);
  const [open, setOpen] = useState(false);

  const settle = (to: number) => {
    current.current = to;
    setOpen(to === high);
    Animated.spring(height, {
      toValue: to,
      useNativeDriver: false,
      bounciness: 2,
      speed: 14,
    }).start();
  };

  // The responder outlives renders; it reaches the latest `settle` through this.
  const settleRef = useRef(settle);
  settleRef.current = settle;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          start.current = current.current;
        },
        onPanResponderMove: (_e, g) => {
          const next = Math.min(high, Math.max(low, start.current - g.dy));
          height.setValue(next);
        },
        onPanResponderRelease: (_e, g) => {
          const at = Math.min(high, Math.max(low, start.current - g.dy));
          const goUp = g.vy < -0.3 || (g.vy <= 0.3 && at > (low + high) / 2);
          settleRef.current(goUp ? high : low);
        },
      }),
    [low, high, height],
  );

  return (
    <Animated.View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height,
        borderTopLeftRadius: radius.xl,
        borderTopRightRadius: radius.xl,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: theme.colors.border,
        ...elevation.sheet,
      }}
    >
      <Pressable
        {...responder.panHandlers}
        accessibilityRole="button"
        accessibilityLabel={open ? `${title}, collapse` : `${title}, expand`}
        onPress={() => settle(open ? low : high)}
        style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm }}
      >
        <View
          style={{
            alignSelf: "center",
            width: 40,
            height: 5,
            borderRadius: 3,
            backgroundColor: theme.colors.border,
            marginBottom: spacing.sm,
          }}
        />
        <Text variant="overline" tone="muted" style={{ fontSize: 12, letterSpacing: 1 }}>
          {title}
        </Text>
        {note ? (
          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
            {note}
          </Text>
        ) : null}
      </Pressable>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.sm,
          paddingBottom: bottomInset + spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
}
