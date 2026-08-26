import { Image } from "expo-image";
import { View } from "react-native";
import { radius, useTheme } from "@/theme";
import { Text } from "./Text";

/**
 * A person, as a circle.
 *
 * Tasks, comments, mentions, the activity feed and the crew list all name
 * people, and a list of names in one grey weight is a wall of text. The tint is
 * derived from the name rather than stored, so the same person is the same
 * colour on every screen without a column to keep in sync.
 *
 * Six hues, all at a fixed saturation and lightness, so none of them can land
 * on a value that makes the initials unreadable. That is the trade for deriving
 * the colour: a hash cannot be trusted to pick a legible one on its own.
 */

const HUES = [210, 260, 340, 25, 150, 190];

export type AvatarSize = "sm" | "md" | "lg";

const boxes: Record<AvatarSize, number> = { sm: 28, md: 36, lg: 56 };

export function Avatar({
  name,
  uri,
  size = "md",
}: {
  name?: string | null;
  uri?: string | null;
  size?: AvatarSize;
}) {
  const theme = useTheme();
  const box = boxes[size];
  const label = (name ?? "").trim();

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: box, height: box, borderRadius: radius.pill }}
        contentFit="cover"
        accessibilityLabel={label || undefined}
      />
    );
  }

  const hue = HUES[hash(label || "?") % HUES.length];
  // Lightness differs by scheme so the circle sits on the surface rather than
  // glowing off a dark canvas or vanishing into a light one.
  const fill = `hsl(${hue}, 55%, ${theme.scheme === "dark" ? 32 : 88}%)`;
  const ink = `hsl(${hue}, 60%, ${theme.scheme === "dark" ? 82 : 28}%)`;

  return (
    <View
      style={{
        width: box,
        height: box,
        borderRadius: radius.pill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: fill,
      }}
      accessible
      accessibilityLabel={label || "Unknown person"}
    >
      <Text variant={size === "lg" ? "heading" : "overline"} style={{ color: ink }}>
        {initials(label)}
      </Text>
    </View>
  );
}

/**
 * Overlapping avatars with a "+3" when the list is longer than `max`.
 *
 * The overflow count is not optional. A row that silently shows the first three
 * of nine assignees reads as a task with three people on it.
 */
export function AvatarStack({
  people,
  max = 3,
  size = "sm",
}: {
  people: { name?: string | null; uri?: string | null }[];
  max?: number;
  size?: AvatarSize;
}) {
  const theme = useTheme();
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  const box = boxes[size];

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {shown.map((person, i) => (
        <View
          key={`${person.name ?? "person"}-${i}`}
          style={{
            marginLeft: i === 0 ? 0 : -box / 3,
            borderRadius: radius.pill,
            borderWidth: 2,
            borderColor: theme.colors.card,
          }}
        >
          <Avatar name={person.name} uri={person.uri} size={size} />
        </View>
      ))}
      {extra > 0 ? (
        <View
          style={{
            marginLeft: -box / 3,
            width: box,
            height: box,
            borderRadius: radius.pill,
            borderWidth: 2,
            borderColor: theme.colors.card,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.secondary,
          }}
        >
          <Text variant="overline" tone="muted">
            {`+${extra}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
