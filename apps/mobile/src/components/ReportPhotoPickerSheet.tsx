import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { displayCaption } from "@everlumen/shared";
import { listProjectPhotoPage, type PhotoListItem } from "@/api/photos";
import { spacing, useTheme } from "@/theme";
import { Images } from "@/ui/icons";
import { Badge, Button, EmptyState, PhotoThumb, Sheet, SkeletonList, Text } from "@/ui";

/** How many of the job's photos the pickers load. Newest first. */
export const REPORT_PHOTO_LIMIT = 150;

/** The job's photos for any report picker, cached under one key. */
export function useReportPhotos(projectId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["report-photos", projectId],
    queryFn: () => listProjectPhotoPage(projectId!, null, REPORT_PHOTO_LIMIT),
    enabled: Boolean(projectId) && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Choose photos from a job, for any report kind: a section, the cover, the
 * legacy report grid, or the photos an AI document is drafted from.
 *
 * A grid, because the picture is the answer. The result is in the job's own
 * order rather than tap order, so a report reads chronologically.
 */
export function ReportPhotoPickerSheet({
  visible,
  projectId,
  title,
  initial = [],
  exclude,
  max,
  confirmLabel = "Use these",
  busy = false,
  options,
  onClose,
  onDone,
}: {
  visible: boolean;
  projectId: string | null | undefined;
  title: string;
  initial?: string[];
  /** Photos already placed, shown dimmed and not selectable. */
  exclude?: ReadonlySet<string>;
  max?: number;
  confirmLabel?: string;
  busy?: boolean;
  /** Extra controls above the button, such as photos per page. */
  options?: ReactNode;
  onClose: () => void;
  onDone: (ids: string[]) => void;
}) {
  const theme = useTheme();
  const photosQuery = useReportPhotos(projectId, visible);
  const photos: PhotoListItem[] = photosQuery.data?.photos ?? [];
  const urls = photosQuery.data?.urls ?? {};
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));

  // Re-seed each time it opens, so a cancelled choice does not carry over.
  const [openFor, setOpenFor] = useState(false);
  if (visible !== openFor) {
    setOpenFor(visible);
    if (visible) setSelected(new Set(initial));
  }

  const overMax = max !== undefined && selected.size > max;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={
        max !== undefined ? `${selected.size} of up to ${max} chosen` : `${selected.size} chosen`
      }
      footer={
        <View style={{ gap: spacing.sm }}>
          {options}
          {overMax ? (
            <Text variant="caption" tone="destructive">
              Choose {max} photos or fewer.
            </Text>
          ) : null}
          <Button
            label={confirmLabel}
            fullWidth
            loading={busy}
            disabled={busy || selected.size === 0 || overMax}
            onPress={() => onDone(photos.filter((p) => selected.has(p.id)).map((p) => p.id))}
          />
        </View>
      }
    >
      {photosQuery.isLoading ? (
        <SkeletonList rows={3} />
      ) : photosQuery.error ? (
        <Text variant="body" tone="destructive">
          {photosQuery.error instanceof Error
            ? photosQuery.error.message
            : "Could not load the photos."}
        </Text>
      ) : photos.length === 0 ? (
        <EmptyState icon={Images} title="No photos on this project yet" />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
          {photos.map((photo) => {
            const placed = exclude?.has(photo.id) ?? false;
            const on = selected.has(photo.id);
            return (
              <Pressable
                key={photo.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: placed }}
                accessibilityLabel={displayCaption(photo.caption, "Photo")}
                disabled={placed}
                onPress={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(photo.id)) next.delete(photo.id);
                    else next.add(photo.id);
                    return next;
                  })
                }
                style={{ width: "31.5%", aspectRatio: 1, opacity: placed ? 0.4 : 1 }}
              >
                <PhotoThumb
                  uri={urls[photo.id]}
                  width="100%"
                  height="100%"
                  // A ring, not a tint: a tint is invisible on half of all photos.
                  style={on ? { borderWidth: 3, borderColor: theme.colors.primary } : undefined}
                />
                {on || placed ? (
                  <View style={{ position: "absolute", right: 4, bottom: 4 }}>
                    <Badge label={placed ? "Added" : "On"} tone={placed ? "neutral" : "primary"} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </Sheet>
  );
}
