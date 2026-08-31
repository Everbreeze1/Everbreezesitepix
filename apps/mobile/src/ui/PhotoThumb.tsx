import { Image } from "expo-image";
import { View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { ImageOff } from "@/ui/icons";
import { radius, useTheme } from "@/theme";
import { Icon } from "./Icon";
import { Text } from "./Text";

/**
 * One photo in a grid, including when there is no photo to show.
 *
 * The reason this exists rather than an `<Image>` at each call site: a tile
 * whose `source` is undefined draws **nothing at all**. Not a box, not a
 * colour, nothing. The gallery on this workspace looked like an empty screen
 * with a date header floating on it, because most rows in `photos` point at
 * storage objects that were never uploaded and `signPhotoUrls` had no URL to
 * give. The grid was correct, the layout was correct, and the screen was blank.
 *
 * So the missing case is drawn, and drawn as an answer rather than a gap: a
 * tinted panel with a struck-through image glyph. Somebody looking at it can
 * tell "this photo is not available" from "the app failed to load", which is
 * the distinction a blank square destroys.
 */
export type PhotoThumbProps = {
  /** The signed URL, or null/undefined when it could not be produced. */
  uri?: string | null;
  /** Square by default. Pass a ratio for a cover strip. */
  aspectRatio?: number;
  width?: DimensionValue;
  height?: DimensionValue;
  rounded?: number;
  contentFit?: "cover" | "contain";
  /** Says what is missing, when it is worth saying. Off in dense grids. */
  showLabel?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function PhotoThumb({
  uri,
  aspectRatio,
  width = "100%",
  height,
  rounded = radius.sm,
  contentFit = "cover",
  showLabel = false,
  style,
}: PhotoThumbProps) {
  const theme = useTheme();

  const frame: ViewStyle = {
    width,
    ...(height !== undefined ? { height } : {}),
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    borderRadius: rounded,
    overflow: "hidden",
    backgroundColor: theme.colors.secondary,
  };

  if (uri) {
    return (
      <View style={[frame, style]}>
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          contentFit={contentFit}
          transition={120}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        frame,
        {
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          /*
           * A dashed edge, which is the convention for "nothing here" rather
           * than "something here that is grey". A solid panel the same colour
           * as a loading skeleton would be read as still loading, forever.
           */
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: theme.colors.border,
        },
        style,
      ]}
      accessible
      accessibilityLabel="Photo unavailable"
    >
      <Icon icon={ImageOff} size="md" tone="muted" />
      {showLabel ? (
        <Text variant="caption" tone="muted" align="center">
          Not available
        </Text>
      ) : null}
    </View>
  );
}
