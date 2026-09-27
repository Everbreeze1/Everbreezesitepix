import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { radius, spacing } from "@/theme";
import { Text } from "@/ui";

/**
 * The row of acts under a photo in a lightbox: Annotate, Analyse, Comments.
 *
 * The project grid's lightbox has had these three since the AI analysis
 * screen shipped, drawn inline in that screen. The cross-project library had
 * only Comments, so a photo found by searching the whole workspace could be
 * looked at but not marked up or read, which is backwards: the library is
 * where people go to find the one photo they need to do something with.
 *
 * Same routes and the same params the project grid pushes, so both lightboxes
 * open the same screens with the same data. `onLeave` closes the lightbox
 * first; pushing a screen over an open Modal leaves the Modal on top of it.
 */
export type LightboxPhoto = {
  id: string;
  project_id: string;
  caption: string | null;
  phase: string | null;
};

export function PhotoLightboxActions({
  photo,
  uri,
  onLeave,
}: {
  photo: LightboxPhoto;
  /** The signed URL the lightbox is showing. */
  uri: string | undefined;
  onLeave: () => void;
}) {
  const actions: { label: string; hint: string; go: () => void }[] = [
    {
      label: "Annotate",
      hint: "Annotate this photo",
      go: () =>
        router.push({
          pathname: "/photo/[id]/annotate",
          params: {
            id: photo.id,
            uri: uri ?? "",
            projectId: photo.project_id,
            caption: photo.caption ?? "",
            phase: photo.phase ?? "untagged",
          },
        }),
    },
    {
      /*
       * Next to Annotate because they are the same kind of act: both take this
       * one photograph and add to it. It reads the equipment plate and finds
       * visible defects.
       */
      label: "Analyse",
      hint: "Analyse this photo with AI",
      go: () =>
        router.push({
          pathname: "/photo/[id]/analysis",
          params: { id: photo.id, uri: uri ?? "", caption: photo.caption ?? "" },
        }),
    },
    {
      label: "Comments",
      hint: "Comment on this photo",
      go: () =>
        router.push({
          pathname: "/photo/[id]/comments",
          params: {
            id: photo.id,
            uri: uri ?? "",
            projectId: photo.project_id,
            caption: photo.caption ?? "",
          },
        }),
    },
  ];

  return (
    <View style={styles.row}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          accessibilityRole="button"
          accessibilityLabel={action.hint}
          onPress={() => {
            onLeave();
            action.go();
          }}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text variant="bodyStrong" style={{ color: "#fff" }} numberOfLines={1}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  /* Glass on the black scrim, the project grid's lightbox button look. */
  action: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
});
