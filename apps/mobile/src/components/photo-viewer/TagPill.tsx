import { Pressable, Text, View } from "react-native";
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
