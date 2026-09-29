import { Pressable, ScrollView, Text, View } from "react-native";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { Icon } from "@/ui";
import { Mic, Pencil } from "@/ui/icons";
import {
  ADD_CAPTION_LABEL,
  TILE_CAPTION_LINE,
  TILE_CAPTION_SIZE,
  captionText,
  tileCaptionLines,
} from "./caption-line";
import { viewerColors as c } from "./viewer-theme";

/**
 * A photo's caption as a line under its tile in a grid: one or two lines,
 * truncated. Nothing at all when the photo has none, so an uncaptioned grid
 * keeps its spacing.
 */
export function TileCaption({
  caption,
  tileWidth,
}: {
  caption: string | null | undefined;
  tileWidth: number;
}) {
  const theme = useTheme();
  const text = captionText(caption);
  if (!text) return null;
  return (
    <Text
      numberOfLines={tileCaptionLines(tileWidth)}
      ellipsizeMode="tail"
      style={{
        marginTop: 4,
        width: tileWidth,
        fontSize: TILE_CAPTION_SIZE,
        lineHeight: TILE_CAPTION_LINE,
        color: theme.colors.foreground,
      }}
      // The tile's own label already reads the caption.
      importantForAccessibility="no"
      accessibilityElementsHidden
    >
      {text}
    </Text>
  );
}

/**
 * The caption under the photo in the viewer, in full. Tapping it opens the
 * note editor, where it can be typed or spoken again. An uncaptioned photo
 * shows the invitation instead, so the way to add one is where the caption
 * would be.
 *
 * Long captions scroll inside a capped box rather than pushing the photo off
 * the screen, in portrait and landscape alike.
 */
export function ViewerCaption({
  caption,
  onEdit,
  maxHeight,
}: {
  caption: string | null | undefined;
  /** Opens the note editor; "voice" opens it straight into dictation. */
  onEdit: (start?: "voice") => void;
  maxHeight: number;
}) {
  const text = captionText(caption);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radius.md,
        backgroundColor: c.glass,
      }}
    >
      <ScrollView style={{ flex: 1, maxHeight }} showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={text ? `Caption: ${text}` : ADD_CAPTION_LABEL}
          accessibilityHint="Opens the note editor"
          onPress={() => onEdit()}
          style={{ minHeight: HIT_TARGET - spacing.sm * 2, justifyContent: "center" }}
        >
          <Text
            style={{
              color: text ? c.foreground : c.muted,
              fontSize: 15,
              lineHeight: 21,
              fontWeight: text ? "500" : "600",
            }}
          >
            {text ?? ADD_CAPTION_LABEL}
          </Text>
        </Pressable>
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text ? "Edit caption" : "Add voice note"}
        onPress={() => onEdit(text ? undefined : "voice")}
        hitSlop={8}
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: text ? "rgba(233,228,220,0.12)" : c.primary,
        }}
      >
        <Icon
          icon={text ? Pencil : Mic}
          size="sm"
          color={text ? c.foreground : c.primaryForeground}
        />
      </Pressable>
    </View>
  );
}
