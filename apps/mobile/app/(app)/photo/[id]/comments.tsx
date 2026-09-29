import { KeyboardAvoidingView, Platform, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listPhotoComments } from "@/api/photo-comments";
import { commentsSummary } from "@/api/photo-comments-view";
import {
  PhotoCommentsThread,
  photoCommentsKey,
} from "@/components/photo-viewer/PhotoCommentsThread";
import type { ThreadColors } from "@/components/photo-viewer/viewer-theme";
import { spacing, useTheme } from "@/theme";
import { MessageSquare } from "@/ui/icons";
import { EmptyState, PhotoThumb, ScreenNote, Text } from "@/ui";

/**
 * Comments on one photograph, as a screen of its own.
 *
 * The photo viewer shows the same thread in its Comments tab, and that is where
 * most people read and write them now. This route stays for the links that
 * land here directly (older notifications, deep links), and is a thin wrapper
 * around the viewer's `PhotoCommentsThread` so the two cannot drift: same
 * list, same @mention picker, same notification on post.
 */
export default function PhotoCommentsScreen() {
  const { id, uri, projectId, caption } = useLocalSearchParams<{
    id: string;
    uri?: string;
    projectId?: string;
    caption?: string;
  }>();
  const theme = useTheme();

  // The thread owns this query; reading the same key here costs nothing.
  const commentsQuery = useQuery({
    queryKey: photoCommentsKey(String(id)),
    queryFn: () => listPhotoComments(String(id)),
    enabled: Boolean(id),
  });
  const comments = commentsQuery.data ?? [];

  const colors: ThreadColors = {
    background: theme.colors.background,
    card: theme.colors.card,
    border: theme.colors.border,
    foreground: theme.colors.foreground,
    muted: theme.colors.mutedForeground,
    primary: theme.colors.primary,
    primaryForeground: theme.colors.primaryForeground,
    destructive: theme.colors.destructive,
    input: theme.colors.input,
  };

  return (
    <>
      <Stack.Screen options={{ title: "Comments" }} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // The header is already on screen, so the offset is what the navigation
        // bar takes. Without it the composer sits under the keyboard on iOS.
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
      >
        {/*
          Nothing while there are none: `commentsSummary(0)` and the empty
          state's title are both "No comments yet".
        */}
        <ScreenNote
          text={
            commentsQuery.isLoading || comments.length === 0
              ? undefined
              : commentsSummary(comments.length)
          }
        />
        <PhotoCommentsThread
          photoId={String(id)}
          projectId={projectId}
          colors={colors}
          header={
            uri ? (
              <View style={{ paddingBottom: spacing.sm }}>
                <PhotoThumb uri={uri} width="100%" height={160} contentFit="cover" showLabel />
                {caption ? (
                  <Text variant="caption" tone="muted" style={{ paddingTop: spacing.xs }}>
                    {caption}
                  </Text>
                ) : null}
              </View>
            ) : null
          }
          empty={
            <EmptyState
              icon={MessageSquare}
              title="No comments yet"
              body="Ask a question about this photo, or use @ to pull a teammate in."
            />
          }
        />
      </KeyboardAvoidingView>
    </>
  );
}
