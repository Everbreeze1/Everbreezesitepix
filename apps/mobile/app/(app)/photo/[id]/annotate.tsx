import { useRef } from "react";
import { useWindowDimensions, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { annotatedCaption, annotationCanvasSize } from "@/api/annotation";
import { getPhotoCapturedAt, saveAnnotatedPhoto } from "@/api/photo-annotations";
import { getMyTeam } from "@/api/team";
import {
  PhotoAnnotator,
  type AnnotatorSaveOutput,
  type PhotoAnnotatorHandle,
} from "@/components/annotator/PhotoAnnotator";
import { useAuth } from "@/lib/auth";

/**
 * Annotate a saved photo: web's lightbox Annotate.
 *
 * The editor is the shared `PhotoAnnotator` (the camera uses it too). The
 * save is web's: the photo flattened with its markup into one JPEG at the
 * photo's own pixel size, filed as a NEW photo captioned "Annotated: ...", so
 * the original is left as evidence. It goes through the offline queue like a
 * camera capture, so marking up a defect does not need signal.
 */
export default function AnnotateScreen() {
  const { id, uri, projectId, caption, phase, width, height, takenAt } = useLocalSearchParams<{
    id: string;
    uri: string;
    projectId: string;
    caption?: string;
    phase?: string;
    width?: string;
    height?: string;
    /** Optional: the viewer may pass the capture time it already has. */
    takenAt?: string;
  }>();

  const { user } = useAuth();
  const queryClient = useQueryClient();
  const window = useWindowDimensions();
  const editor = useRef<PhotoAnnotatorHandle>(null);

  /*
   * Measure is Pro/Team, the same rule the camera applies (web's `isPro`: an
   * active pro or team plan). Until the plan is known the tool is hidden
   * rather than shown and then taken away.
   */
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });
  const team = teamQuery.data;
  const canMeasure = Boolean(team?.isActive && (team.plan === "pro" || team.plan === "team"));

  const capturedQuery = useQuery({
    queryKey: ["photo-captured-at", id],
    queryFn: () => getPhotoCapturedAt(id),
    enabled: !!id && !takenAt,
    retry: false,
  });
  const capturedAt = takenAt || capturedQuery.data || null;

  const hintW = Number(width) || null;
  const hintH = Number(height) || null;
  /*
   * The placeholder frame while the photo loads, sized by the shared helper
   * so it has the photo's shape (the editor then fits the real file itself).
   */
  const aspect = hintW && hintH ? hintW / hintH : 4 / 3;
  const placeholder = annotationCanvasSize(window, aspect);

  async function save(out: AnnotatorSaveOutput) {
    if (!user || !projectId) throw new Error("Sign in again to save this photo.");
    await saveAnnotatedPhoto({
      canvas: out.canvas,
      userId: user.id,
      projectId,
      caption: annotatedCaption(caption),
      phase: phase ?? "untagged",
      // The flattened file's real size: rotate and crop change it.
      width: out.width,
      height: out.height,
    });
    await queryClient.invalidateQueries({ queryKey: ["project-photos", projectId] });
    router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
      {/* No swipe-back: an edge swipe mid-stroke would throw the markup away. */}
      <Stack.Screen options={{ title: "Annotate", headerShown: false, gestureEnabled: false }} />
      {uri ? (
        <PhotoAnnotator
          ref={editor}
          uri={uri}
          width={hintW}
          height={hintH}
          canMeasure={canMeasure}
          capturedAt={capturedAt}
          onCancel={() => router.back()}
          onSave={save}
        />
      ) : (
        <View style={{ width: placeholder.width, height: placeholder.height }} />
      )}
    </View>
  );
}
