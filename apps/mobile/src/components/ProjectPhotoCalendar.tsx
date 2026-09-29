import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { listProjectDayPhotos, listProjectPhotoActivity } from "@/api/project-calendar";
import type { PhotoListItem } from "@/api/photos";
import {
  byDate,
  densityOf,
  isFutureMonth,
  monthGrid,
  monthLabel,
  monthRange,
  monthSummary,
  shiftMonth,
  thisMonth,
  weekdayLabels,
  type Month,
} from "@/api/timeline-view";
import { TileCaption } from "@/components/photo-viewer/PhotoCaption";
import { ThumbTagBadge } from "@/components/photo-viewer/TagPill";
import { withAlpha } from "@/components/ProjectStatusPill";
import { radius, spacing, useTheme } from "@/theme";
import { Calendar, ChevronLeft, ChevronRight } from "@/ui/icons";
import { EmptyState, IconButton, PhotoThumb, Text } from "@/ui";

/**
 * This project's photos by day: the web project page's Calendar tab.
 *
 * A month grid shaded by how much was shot each day, counted on the server so
 * a busy month is not undercounted by whatever page of photos the grid had
 * loaded. Tapping a day lists that day's photos underneath; tapping a photo
 * opens the day in the photo viewer.
 */
export function ProjectPhotoCalendar({
  projectId,
  width,
  onOpenPhoto,
}: {
  projectId: string;
  /** The content width the grid is laid out in. */
  width: number;
  /**
   * `day` is every photo of the picked day with its URLs, so the photo viewer
   * can page through the day rather than open one photo on its own.
   */
  onOpenPhoto: (
    photo: PhotoListItem,
    url: string | null,
    day?: { photos: PhotoListItem[]; urls: Record<string, string> },
  ) => void;
}) {
  const theme = useTheme();
  const [month, setMonth] = useState<Month>(() => thisMonth());
  const [day, setDay] = useState<string | null>(null);

  const range = monthRange(month);
  const activity = useQuery({
    queryKey: ["project-calendar", projectId, range.from],
    queryFn: () => listProjectPhotoActivity({ projectId, ...range }),
  });
  const days = useMemo(() => byDate(activity.data?.days ?? []), [activity.data]);
  const cells = useMemo(() => monthGrid(month), [month]);
  const summary = monthSummary(activity.data?.days ?? [], activity.data?.capped ?? false);

  const dayPhotos = useQuery({
    queryKey: ["project-calendar-day", projectId, day],
    queryFn: () => listProjectDayPhotos(projectId, day!),
    enabled: Boolean(day),
  });

  const cell = Math.floor(width / 7);
  const thumbColumns = 4;
  const thumbGap = spacing.xs;
  const thumb = (width - thumbGap * (thumbColumns - 1)) / thumbColumns;
  const atPresent = isFutureMonth(month);

  const page = (by: number) => {
    setMonth((current) => shiftMonth(current, by));
    setDay(null);
  };

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <IconButton
          icon={ChevronLeft}
          accessibilityLabel="Previous month"
          surface={false}
          onPress={() => page(-1)}
        />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text variant="heading" style={{ fontWeight: "700" }}>
            {monthLabel(month)}
          </Text>
          <Text variant="caption" tone="muted">
            {activity.isLoading ? "Counting photos" : summary.text}
          </Text>
        </View>
        <IconButton
          icon={ChevronRight}
          accessibilityLabel="Next month"
          surface={false}
          disabled={atPresent}
          onPress={() => page(1)}
        />
      </View>

      <View style={{ flexDirection: "row" }}>
        {weekdayLabels().map((label, index) => (
          <Text
            key={`${label}-${index}`}
            variant="overline"
            tone="muted"
            align="center"
            style={{ width: cell }}
          >
            {label}
          </Text>
        ))}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {cells.map((entry, index) => {
          if (!entry) return <View key={`blank-${index}`} style={{ width: cell, height: cell }} />;
          const count = days.get(entry.date)?.photoCount ?? 0;
          const density = densityOf(count);
          const picked = entry.date === day;
          const fill =
            density === 0
              ? "transparent"
              : withAlpha(theme.colors.primary, [0, 0.16, 0.34, 0.6][density]);
          return (
            <Pressable
              key={entry.date}
              accessibilityRole="button"
              accessibilityLabel={`${entry.date}, ${count} photo${count === 1 ? "" : "s"}`}
              accessibilityState={{ selected: picked, disabled: count === 0 }}
              disabled={count === 0}
              onPress={() => setDay(picked ? null : entry.date)}
              style={{ width: cell, height: cell, padding: 2 }}
            >
              <View
                style={{
                  flex: 1,
                  borderRadius: radius.md,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: fill,
                  borderWidth: picked ? 2 : 0,
                  borderColor: theme.colors.primary,
                }}
              >
                <Text
                  variant="caption"
                  tone={count > 0 ? "default" : "muted"}
                  style={{ fontWeight: count > 0 ? "700" : "400" }}
                >
                  {entry.day}
                </Text>
                {count > 0 ? (
                  <Text variant="overline" tone="muted" style={{ fontSize: 10 }}>
                    {count}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {activity.error ? (
        <Text variant="caption" tone="destructive">
          {activity.error instanceof Error
            ? activity.error.message
            : "Could not load the calendar."}
        </Text>
      ) : null}

      {!day ? (
        summary.photos === 0 && !activity.isLoading ? (
          <EmptyState
            icon={Calendar}
            title="Nothing this month"
            body="Page back to a month the crew was on site, or take photos to fill this one."
          />
        ) : (
          <Text variant="caption" tone="muted" align="center">
            Tap a shaded day to see its photos.
          </Text>
        )
      ) : dayPhotos.isLoading ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : dayPhotos.error ? (
        <Text variant="caption" tone="destructive">
          {dayPhotos.error instanceof Error ? dayPhotos.error.message : "Could not load that day."}
        </Text>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Text variant="overline" tone="muted">
            {new Date(`${day}T12:00:00`)
              .toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
              .toUpperCase()}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: thumbGap }}>
            {(dayPhotos.data?.photos ?? []).map((photo) => (
              <Pressable
                key={photo.id}
                accessibilityRole="button"
                accessibilityLabel={photo.caption?.trim() || "Photo"}
                accessibilityHint="Opens the photo full screen"
                onPress={() =>
                  onOpenPhoto(
                    photo,
                    dayPhotos.data?.urls[photo.id] ?? null,
                    dayPhotos.data ?? undefined,
                  )
                }
                style={{ width: thumb }}
              >
                <View style={{ width: thumb, height: thumb }}>
                  <PhotoThumb
                    uri={dayPhotos.data?.urls[photo.id]}
                    width="100%"
                    height="100%"
                    rounded={radius.md}
                  />
                  {thumb >= 72 ? <ThumbTagBadge tags={photo.tags} /> : null}
                </View>
                {/* The photo's note, as a caption under it. */}
                <TileCaption caption={photo.caption} tileWidth={thumb} />
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
