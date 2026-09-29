import { Pressable, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useQuery } from "@tanstack/react-query";
import { listTagLibrary, type LibraryTag } from "@/api/photo-viewer";
import { fallbackTagColor, readableOn, tagTitle } from "@/api/photo-viewer-view";
import { radius, spacing } from "@/theme";
import { X } from "@/ui/icons";

/**
 * The workspace tag library, cached once for every pill on screen.
 *
 * Web keeps an in-memory map so every chip across the app paints the same
 * colour; a shared query key does the same job here.
 */
export const TAG_LIBRARY_KEY = ["tag-library"] as const;

export function useTagLibrary(enabled = true) {
  return useQuery({
    queryKey: TAG_LIBRARY_KEY,
    queryFn: listTagLibrary,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function tagColorOf(library: LibraryTag[] | undefined, name: string): string {
  const hit = library?.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
  return hit?.color || fallbackTagColor(name);
}

/**
 * One tag, in its workspace colour: web's `TagPill`.
 *
 * Title-cased and on the tag's own colour with black or white text, whichever
 * reads better, so a tag looks the same in the viewer as on the web gallery.
 */
export function TagPill({
  name,
  onRemove,
  size = "md",
}: {
  name: string;
  onRemove?: () => void;
  size?: "sm" | "md";
}) {
  const library = useTagLibrary();
  const bg = tagColorOf(library.data, name);
  const fg = readableOn(bg);
  const small = size === "sm";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderRadius: radius.pill,
        backgroundColor: bg,
        paddingLeft: small ? spacing.sm : spacing.md,
        paddingRight: onRemove ? spacing.xs : small ? spacing.sm : spacing.md,
        minHeight: small ? 26 : 32,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: fg, opacity: 0.55 }} />
      <Text style={{ color: fg, fontSize: small ? 12 : 14, fontWeight: "800" }} numberOfLines={1}>
        {tagTitle(name)}
      </Text>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove tag ${name}`}
          onPress={onRemove}
          hitSlop={10}
          style={({ pressed }) => ({
            width: 24,
            height: 24,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 1 : 0.7,
          })}
        >
          <X size={14} color={fg} strokeWidth={2.75} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A photo's tags on the photo itself, for the full-screen viewer.
 *
 * Jon (2026-09-29): a tag that only shows in the details panel is a tag
 * nobody sees. So the pills sit over the bottom-left of the photograph on a
 * soft dark fade, the way the web gallery paints them on its tiles, and stay
 * clear of the controls. Positioned by the caller, which knows where the
 * sheet or the zoom controls are.
 */
export function PhotoTagOverlay({
  tags,
  bottom,
  left,
  right,
  max = 4,
}: {
  tags: string[];
  bottom: number;
  left: number;
  right: number;
  max?: number;
}) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const extra = tags.length - shown.length;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom }}>
      {/* The fade, from nothing to a soft dark under the pills. */}
      <Svg
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <Defs>
          <LinearGradient id="photoTagFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0.55" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#photoTagFade)" />
      </Svg>
      <View
        accessible
        accessibilityLabel={`Tags: ${tags.map(tagTitle).join(", ")}`}
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6,
          paddingTop: spacing.xl,
          paddingBottom: spacing.sm,
          paddingLeft: left,
          paddingRight: right,
        }}
      >
        {shown.map((name) => (
          <TagPill key={name} name={name} size="sm" />
        ))}
        {extra > 0 ? <MoreChip count={extra} /> : null}
      </View>
    </View>
  );
}

/**
 * The compact tag mark on a grid tile: the first tag as a small pill, and
 * "+2" when there are more. Bottom-left, so it never sits on the phase pill
 * (top-left) or the selection tick (top-right).
 */
export function ThumbTagBadge({ tags }: { tags: string[] | null | undefined }) {
  const library = useTagLibrary(Boolean(tags && tags.length > 0));
  if (!tags || tags.length === 0) return null;
  const first = tags[0];
  const bg = tagColorOf(library.data, first);
  const fg = readableOn(bg);
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 5,
        right: 5,
        bottom: 5,
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
      }}
    >
      <View
        style={{
          flexShrink: 1,
          borderRadius: radius.pill,
          backgroundColor: bg,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderWidth: 1,
          borderColor: "rgba(0,0,0,0.2)",
        }}
      >
        <Text style={{ color: fg, fontSize: 10, fontWeight: "800" }} numberOfLines={1}>
          {tagTitle(first)}
        </Text>
      </View>
      {tags.length > 1 ? <MoreChip count={tags.length - 1} small /> : null}
    </View>
  );
}

function MoreChip({ count, small = false }: { count: number; small?: boolean }) {
  return (
    <View
      style={{
        borderRadius: radius.pill,
        backgroundColor: "rgba(17, 13, 9, 0.78)",
        paddingHorizontal: small ? 5 : spacing.sm,
        paddingVertical: small ? 2 : 0,
        minHeight: small ? undefined : 26,
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#ffffff", fontSize: small ? 10 : 12, fontWeight: "800" }}>
        +{count}
      </Text>
    </View>
  );
}
