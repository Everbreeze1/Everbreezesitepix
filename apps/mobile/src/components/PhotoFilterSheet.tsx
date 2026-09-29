import { Switch, View } from "react-native";
import type { MediaFilter, PhotoOrder, PhotoSize, TagLogic } from "@/api/photo-filter-view";
import { spacing, useTheme } from "@/theme";
import { Button, Chip, Sheet, Text } from "@/ui";

/**
 * The project grid's extra filters, the phone version of the web "Filters"
 * popover: whether to show the photo tags row, whether several tags must all
 * match or any one of them, photos against videos, how big the tiles are and
 * which end of the job comes first.
 */
export function PhotoFilterSheet({
  visible,
  onClose,
  showTags,
  onShowTags,
  logic,
  onLogic,
  media,
  onMedia,
  hasVideos,
  size,
  onSize,
  order,
  onOrder,
}: {
  visible: boolean;
  onClose: () => void;
  showTags: boolean;
  onShowTags: (next: boolean) => void;
  logic: TagLogic;
  onLogic: (next: TagLogic) => void;
  media: MediaFilter;
  onMedia: (next: MediaFilter) => void;
  hasVideos: boolean;
  size: PhotoSize;
  onSize: (next: PhotoSize) => void;
  order: PhotoOrder;
  onOrder: (next: PhotoOrder) => void;
}) {
  const theme = useTheme();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filter photos"
      footer={<Button label="Done" fullWidth onPress={onClose} />}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.md,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Show photo tags</Text>
          <Text variant="caption" tone="muted">
            A row of the tags on these photos, to filter by.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Show photo tags"
          value={showTags}
          onValueChange={onShowTags}
          trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="overline" tone="muted">
          FILTER TAGS BY
        </Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Chip label="Any tag (Or)" selected={logic === "or"} onPress={() => onLogic("or")} />
          <Chip label="Every tag (And)" selected={logic === "and"} onPress={() => onLogic("and")} />
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="overline" tone="muted">
          TYPE
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          <Chip label="All" selected={media === "all"} onPress={() => onMedia("all")} />
          <Chip
            label="Photos only"
            selected={media === "photos"}
            onPress={() => onMedia("photos")}
          />
          <Chip
            label="Videos only"
            selected={media === "videos"}
            onPress={() => onMedia("videos")}
          />
        </View>
        {!hasVideos ? (
          <Text variant="caption" tone="muted">
            No site videos on this project yet.
          </Text>
        ) : null}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="overline" tone="muted">
          PHOTO SIZE
        </Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Chip label="Small" selected={size === "sm"} onPress={() => onSize("sm")} />
          <Chip label="Medium" selected={size === "md"} onPress={() => onSize("md")} />
          <Chip label="Large" selected={size === "lg"} onPress={() => onSize("lg")} />
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="overline" tone="muted">
          ORDER
        </Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Chip
            label="Newest first"
            selected={order === "newest"}
            onPress={() => onOrder("newest")}
          />
          <Chip
            label="Oldest first"
            selected={order === "oldest"}
            onPress={() => onOrder("oldest")}
          />
        </View>
      </View>
    </Sheet>
  );
}
