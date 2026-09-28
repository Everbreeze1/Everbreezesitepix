import { useMemo } from "react";
import { Pressable, View } from "react-native";
import type { ResolvedSummaryPhoto } from "@/api/summaries";
import {
  isNarrated,
  offsetLabel,
  orderedNotes,
  plainBody,
  type WalkthroughSummary,
} from "@/api/summary-view";
import { summarySections } from "@/api/walkthrough-list-view";
import { radius, spacing, useTheme } from "@/theme";
import { Play, Quote } from "@/ui/icons";
import { Card, Icon, PhotoThumb, SectionHeader, Text } from "@/ui";

/**
 * The body of an AI Summary: the write-up in its headed sections, then every
 * photo with the note written for it and what was said around it.
 *
 * Shared by the walkthrough screen, where it sits under the video, and by the
 * write-up's own screen. One renderer, so the two cannot drift into showing
 * the same report two ways.
 */
export function SummaryReport({
  summary,
  photos,
  onSeek,
}: {
  summary: WalkthroughSummary;
  photos: ResolvedSummaryPhoto[];
  /** When the recording is on screen, a photo's time jumps the player there. */
  onSeek?: (offsetSeconds: number) => void;
}) {
  const theme = useTheme();
  const sections = useMemo(() => summarySections(summary.markdown), [summary.markdown]);
  const notes = useMemo(() => orderedNotes(summary.photoNotes ?? []), [summary.photoNotes]);
  const photoById = useMemo(() => new Map(photos.map((p) => [p.photoId, p])), [photos]);

  return (
    <View style={{ gap: spacing.md }}>
      {sections.length > 0 ? (
        <Card style={{ gap: spacing.lg }}>
          {sections.map((section, index) => (
            <View
              key={`${section.heading ?? "intro"}-${index}`}
              style={{
                gap: spacing.xs,
                paddingTop: index === 0 ? 0 : spacing.lg,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.colors.border,
              }}
            >
              {section.heading ? (
                <Text variant="overline" tone="primary">
                  {section.heading.toUpperCase()}
                </Text>
              ) : null}
              {section.body ? <Text variant="body">{plainBody(section.body)}</Text> : null}
            </View>
          ))}
        </Card>
      ) : null}

      {notes.length > 0 ? (
        <>
          <SectionHeader title="Photos" count={notes.length} />
          <View style={{ gap: spacing.md }}>
            {notes.map((note) => {
              const photo = photoById.get(note.photoId);
              const time = offsetLabel(note, Boolean(summary.walkthroughId));
              return (
                <Card key={note.photoId} padded={false}>
                  <PhotoThumb
                    uri={photo?.imageUrl}
                    width="100%"
                    height={200}
                    contentFit="cover"
                    rounded={0}
                    showLabel
                  />
                  <View style={{ padding: spacing.lg, gap: spacing.sm }}>
                    {time ? (
                      onSeek ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Play the video from ${time}`}
                          onPress={() => onSeek(note.offsetSeconds)}
                          style={({ pressed }) => ({
                            alignSelf: "flex-start",
                            flexDirection: "row",
                            alignItems: "center",
                            gap: spacing.xs,
                            paddingHorizontal: spacing.sm,
                            paddingVertical: 2,
                            borderRadius: radius.pill,
                            backgroundColor: theme.colors.accent,
                            opacity: pressed ? 0.7 : 1,
                          })}
                        >
                          <Icon icon={Play} size="xs" tone="primary" />
                          <Text variant="caption" tone="primary">
                            {`${time} into the walk`}
                          </Text>
                        </Pressable>
                      ) : (
                        <Text variant="caption" tone="muted">
                          {time} into the walk
                        </Text>
                      )
                    ) : null}

                    <Text variant="body">{note.note}</Text>

                    {/*
                      What was SAID, kept apart from what was done. The service
                      is explicit that this distinction is load-bearing: the
                      model wrote the note, the person on site said this.
                    */}
                    {isNarrated(note) ? (
                      <View
                        style={{
                          flexDirection: "row",
                          gap: spacing.sm,
                          paddingTop: spacing.sm,
                          borderTopWidth: 1,
                          borderTopColor: theme.colors.border,
                        }}
                      >
                        <Icon icon={Quote} size="sm" tone="primary" />
                        <Text variant="body" tone="muted" style={{ flex: 1 }}>
                          {note.spoken}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Card>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}
