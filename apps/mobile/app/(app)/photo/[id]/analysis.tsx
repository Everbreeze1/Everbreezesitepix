import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { displayCaption } from "@everlumen/shared";
import { analyzePhoto, extractPhotoText, getPhotoAnalysis } from "@/api/photo-ai";
import {
  isAnalysisEmpty,
  severityLabel,
  severityOf,
  usableDefects,
  usableLabels,
  usableOcr,
  usableRecommendations,
} from "@/api/photo-ai-view";
import { radius, spacing } from "@/theme";
import { Search, Sparkles, TriangleAlert } from "@/ui/icons";
import {
  Badge,
  Button,
  ButtonRow,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * What the model saw in one photograph.
 *
 * The analysis has existed server-side since long before the app did: it sends
 * the image to Gemini with a field-inspector prompt and writes defects, a
 * report, recommendations and any readable text to `ai_analyses`. The phone had
 * neither the trigger nor the result view, which is backwards for a feature
 * whose input is a photograph somebody is standing in front of. The whole point
 * is to run it on the equipment while still on the ladder.
 *
 * Every field below is written by a language model, so every field is optional
 * in practice whatever the column says. A run can complete with nothing in it,
 * which is the correct answer for a photo of a clean wall, and the screen has
 * to say "nothing found" rather than render five empty headings.
 *
 * Gemini is geo-blocked from some networks, so a failed run in development is
 * expected rather than a bug. The failure path says which one it was.
 */
export default function PhotoAnalysisScreen() {
  const { id, uri, caption } = useLocalSearchParams<{
    id: string;
    uri?: string;
    caption?: string;
  }>();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const queryKey = useMemo(() => ["photo-analysis", id], [id]);

  const query = useQuery({
    queryKey,
    queryFn: () => getPhotoAnalysis(id!),
    enabled: Boolean(id),
  });

  const analysis = query.data ?? null;

  /**
   * Both runs share one mutation, because the screen state is the same either
   * way: something is running, and when it stops the row is re-read.
   *
   * They are separate ops rather than one with a flag because they cost
   * different amounts. OCR is the cheap one, and somebody who only wants the
   * serial number off a nameplate should not pay for a defect survey.
   */
  const run = useMutation({
    mutationFn: async (work: () => Promise<void>) => work(),
    onMutate: () => setFailure(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error: unknown) =>
      setFailure(
        error instanceof Error
          ? error.message
          : "The analysis did not run. Check the connection and try again.",
      ),
  });

  const busy = run.isPending || analysis?.status === "processing";

  const runFull = useCallback(() => run.mutate(() => analyzePhoto(id!)), [run, id]);
  const runOcr = useCallback(() => run.mutate(() => extractPhotoText(id!)), [run, id]);

  const defects = analysis ? usableDefects(analysis) : [];
  const recommendations = analysis ? usableRecommendations(analysis) : [];
  const labels = analysis ? usableLabels(analysis) : [];
  const ocr = analysis ? usableOcr(analysis) : null;

  return (
    <>
      <Stack.Screen options={{ title: "Photo analysis" }} />

      <Screen scroll padded={false} bottomInset={spacing.xxl}>
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: "100%", aspectRatio: 4 / 3, backgroundColor: "#000" }}
            contentFit="contain"
          />
        ) : null}

        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
          {/*
            Through `displayCaption`, like every other surface that shows one.
            A caption is often the camera's filename, and this screen was the
            one place rendering it raw: the same photo read "Photo" in the
            lightbox and "1 (9).jpg" here. That is the "unfriendly info"
            complaint, and it is exactly what `isFilenameLikeCaption` in
            `@everlumen/shared` exists to stop.
          */}
          <Text variant="bodyStrong" numberOfLines={2}>
            {displayCaption(caption ?? null, "Photo")}
          </Text>

          <ButtonRow>
            <Button
              label={busy ? "Analysing" : analysis ? "Analyse again" : "Analyse"}
              icon={Sparkles}
              disabled={busy}
              onPress={runFull}
            />
            <Button
              label="Read text"
              variant="secondary"
              icon={Search}
              disabled={busy}
              onPress={runOcr}
            />
          </ButtonRow>

          {failure ? (
            <Badge label={failure} tone="danger" variant="soft" icon={TriangleAlert} />
          ) : null}
        </View>

        {query.isLoading ? (
          <SkeletonList rows={4} />
        ) : query.error ? (
          <ErrorState
            title="Could not load the analysis"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : !analysis ? (
          <EmptyState
            icon={Sparkles}
            title="Not analysed yet"
            body="Analyse reads the equipment plate, finds visible defects and writes a field report. It takes about ten seconds."
          />
        ) : analysis.status === "processing" ? (
          <EmptyState
            icon={Sparkles}
            title="Working on it"
            body="The model is reading the photo. Pull down in a moment to see the result."
          />
        ) : analysis.status === "failed" ? (
          <EmptyState
            icon={TriangleAlert}
            title="That run failed"
            body="Nothing was charged for it. Try again, and if it keeps failing the model may be unreachable from this network."
          />
        ) : isAnalysisEmpty(analysis) ? (
          /*
           * A completed run with nothing in it. Correct for a photo of a clean
           * wall, and it has to read as an answer rather than as a screen that
           * failed to load.
           */
          <EmptyState
            icon={Sparkles}
            title="Nothing found"
            body="No defects, no readable text and nothing worth reporting in this photo."
          />
        ) : (
          <>
            {defects.length > 0 ? (
              <>
                <SectionHeader title={`Defects (${defects.length})`} />
                <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
                  {defects.map((defect, index) => {
                    const severity = severityOf(defect);
                    return (
                      <Card key={index}>
                        <View style={{ gap: spacing.sm }}>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: spacing.sm,
                            }}
                          >
                            <Badge
                              label={severityLabel(severity)}
                              tone={
                                severity === "high"
                                  ? "danger"
                                  : severity === "medium"
                                    ? "warning"
                                    : "neutral"
                              }
                            />
                            {defect.location ? (
                              <Text variant="caption" tone="muted" numberOfLines={1}>
                                {defect.location}
                              </Text>
                            ) : null}
                          </View>
                          <Text variant="body">{defect.description}</Text>
                        </View>
                      </Card>
                    );
                  })}
                </View>
              </>
            ) : null}

            {recommendations.length > 0 ? (
              <>
                <SectionHeader title="What to do next" />
                <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
                  {recommendations.map((line, index) => (
                    <View
                      key={index}
                      style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}
                    >
                      {/*
                        A numbered list, not bullets. Recommendations come back
                        in the order the model would do them, and a number is
                        what makes that visible.
                      */}
                      <Text variant="bodyStrong" tone="muted">
                        {index + 1}.
                      </Text>
                      <Text variant="body" style={{ flex: 1 }}>
                        {line}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {ocr ? (
              <>
                <SectionHeader title="Text in the photo" />
                <View style={{ paddingHorizontal: spacing.lg }}>
                  <Card>
                    {/*
                      Selectable, and line for line. This is where the model
                      and serial number end up, and the reason anybody reads
                      them off a phone is to paste them into an order.
                    */}
                    <Text variant="body" selectable>
                      {ocr}
                    </Text>
                  </Card>
                </View>
              </>
            ) : null}

            {analysis.report_text?.trim() ? (
              <>
                <SectionHeader title="Field report" />
                <View style={{ paddingHorizontal: spacing.lg }}>
                  <Card>
                    <Text variant="body">{analysis.report_text.trim()}</Text>
                  </Card>
                </View>
              </>
            ) : null}

            {labels.length > 0 ? (
              <>
                <SectionHeader title="What is in it" />
                <View
                  style={{
                    paddingHorizontal: spacing.lg,
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: spacing.sm,
                  }}
                >
                  {labels.map((label) => (
                    <Chip key={label} label={label} />
                  ))}
                </View>
              </>
            ) : null}

            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
              <View style={{ borderRadius: radius.sm }}>
                <Text variant="caption" tone="muted">
                  Written by an AI model from this photograph alone. Check anything you are going to
                  act on.
                </Text>
              </View>
            </View>
          </>
        )}
      </Screen>
    </>
  );
}
