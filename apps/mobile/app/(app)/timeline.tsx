import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { router, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listTimelineActivity } from "@/api/timeline";
import {
  byDate,
  dayHeading,
  densityOf,
  isFutureMonth,
  monthGrid,
  monthLabel,
  monthRange,
  monthSummary,
  shiftMonth,
  thisMonth,
  weekdayLabels,
  type Density,
  type Month,
} from "@/api/timeline-view";
import { radius, spacing, useTheme } from "@/theme";
import { Calendar, ChevronLeft, ChevronRight, Images } from "@/ui/icons";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * The timeline: a month of site work at a glance.
 *
 * The web version is a calendar plus a year heatmap plus filters. On a phone the
 * year view is forty pixels of unreadable squares, so this is one month at a
 * time with a tapped day opening below it. What the calendar is actually for is
 * the same on both: finding the day something was photographed when nobody can
 * remember which job it was on.
 *
 * Counts come from the server aggregate rather than from downloading photos and
 * counting them. A busy month overruns any row limit, and a count that has
 * quietly come up short is worse than no count.
 */
export default function TimelineScreen() {
  const theme = useTheme();
  const [month, setMonth] = useState<Month>(() => thisMonth());
  const [selected, setSelected] = useState<string | null>(null);

  const range = useMemo(() => monthRange(month), [month]);

  const query = useQuery({
    queryKey: ["timeline", range.from, range.to],
    queryFn: () => listTimelineActivity(range),
    // A month that has already been drawn does not change often, and paging
    // back and forth is the normal way this screen is used.
    staleTime: 5 * 60 * 1000,
  });

  /*
   * Its own memo, not a `?? []` inline. A fresh array literal per render
   * changes the identity of every dependency list it appears in, which
   * re-derives the whole grid index on every tap of a day cell.
   */
  const days = useMemo(() => query.data?.days ?? [], [query.data]);
  const index = useMemo(() => byDate(days), [days]);
  const cells = useMemo(() => monthGrid(month), [month]);
  const summary = monthSummary(days, query.data?.capped ?? false);

  const selectedDay = selected ? index.get(selected) : undefined;

  const shades: Record<Density, string> = {
    0: theme.colors.secondary,
    // Three steps of the brand blue rather than a continuous ramp: on a 6 inch
    // screen in daylight, more than three shades are not distinguishable.
    1: `${theme.colors.primary}33`,
    2: `${theme.colors.primary}80`,
    3: theme.colors.primary,
  };

  return (
    <>
      <Stack.Screen options={{ title: "Timeline" }} />

      <Screen
        scroll
        padded={false}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        bottomInset={spacing.xxl}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.lg,
          }}
        >
          <IconButton
            icon={ChevronLeft}
            accessibilityLabel="Previous month"
            surface={false}
            onPress={() => {
              setSelected(null);
              setMonth((current) => shiftMonth(current, -1));
            }}
          />
          <Text variant="bodyStrong">{monthLabel(month)}</Text>
          <IconButton
            icon={ChevronRight}
            accessibilityLabel="Next month"
            surface={false}
            /*
              Disabled at the current month. A calendar of photographs has
              nothing in the future, and letting somebody page into empty grids
              reads as the app failing to load rather than as there being
              nothing there.
            */
            disabled={isFutureMonth(month)}
            onPress={() => {
              setSelected(null);
              setMonth((current) => shiftMonth(current, 1));
            }}
          />
        </View>

        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <View style={{ flexDirection: "row" }}>
            {weekdayLabels().map((label, i) => (
              <View key={i} style={{ flex: 1, alignItems: "center" }}>
                <Text variant="caption" tone="muted">
                  {label}
                </Text>
              </View>
            ))}
          </View>

          {query.isLoading ? (
            <SkeletonList rows={5} />
          ) : query.error ? (
            <ErrorState
              title="Could not load the timeline"
              message={query.error instanceof Error ? query.error.message : undefined}
              onRetry={() => void query.refetch()}
            />
          ) : (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                paddingTop: spacing.xs,
              }}
            >
              {cells.map((cell, i) => {
                if (!cell) {
                  // A leading or trailing blank. Rendered as an empty cell so
                  // every row keeps seven columns.
                  return <View key={`blank-${i}`} style={{ width: `${100 / 7}%`, padding: 2 }} />;
                }
                const day = index.get(cell.date);
                const density = densityOf(day?.photoCount ?? 0);
                const on = selected === cell.date;

                return (
                  <View key={cell.date} style={{ width: `${100 / 7}%`, padding: 2 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${cell.date}. ${dayHeading(day)}`}
                      onPress={() => setSelected(on ? null : cell.date)}
                      style={{
                        aspectRatio: 1,
                        borderRadius: radius.sm,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: shades[density],
                        // The selection ring, not a fill: a fill would compete
                        // with the density shading the cell already carries.
                        borderWidth: on ? 2 : 0,
                        borderColor: theme.colors.foreground,
                      }}
                    >
                      <Text
                        variant="caption"
                        // Inverse on the two darkest shades, which the muted
                        // tone does not survive.
                        tone={density >= 2 ? "inverse" : "muted"}
                      >
                        {cell.day}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}

          <Text variant="caption" tone="muted" style={{ paddingTop: spacing.md }}>
            {summary.text}
            {query.data?.capped ? " (a floor, the month is busier than the limit)" : ""}
          </Text>
        </View>

        {selected ? (
          <>
            <SectionHeader title={selected} />
            <View style={{ paddingHorizontal: spacing.lg }}>
              <Card>
                <View style={{ gap: spacing.md }}>
                  {selectedDay?.coverUrl ? (
                    <Image
                      source={{ uri: selectedDay.coverUrl }}
                      style={{
                        width: "100%",
                        aspectRatio: 16 / 9,
                        borderRadius: radius.md,
                        backgroundColor: theme.colors.secondary,
                      }}
                      contentFit="cover"
                    />
                  ) : null}

                  <Text variant="bodyStrong">{dayHeading(selectedDay)}</Text>

                  {selectedDay && selectedDay.projectNames.length > 0 ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                      {selectedDay.projectNames.map((name) => (
                        <Badge key={name} label={name} tone="neutral" variant="outline" />
                      ))}
                    </View>
                  ) : null}

                  {selectedDay && selectedDay.photoCount > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Open the gallery"
                      onPress={() => router.push("/gallery")}
                      style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
                    >
                      <Icon icon={Images} size="md" tone="primary" />
                      <Text variant="body" tone="primary">
                        See these in the gallery
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </Card>
            </View>
          </>
        ) : days.length === 0 && !query.isLoading && !query.error ? (
          <EmptyState
            icon={Calendar}
            title="Nothing captured this month"
            body="Page back to a month you were on site, or take some photos and they will appear here the same day."
          />
        ) : null}
      </Screen>
    </>
  );
}
