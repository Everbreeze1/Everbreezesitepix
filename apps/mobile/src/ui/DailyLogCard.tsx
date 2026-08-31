import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import { listProjectDailyLogs, type DailyLogSummary } from "@/api/daily-log";
import {
  dayLabel,
  INTERNAL_NOTICE,
  photoCountLabel,
  previewEntries,
  shouldShowLog,
} from "@/api/daily-log-view";
import { radius, spacing, useTheme } from "@/theme";
import { ChevronDown, ChevronRight, Lock, NotebookPen } from "./icons";
import { Badge } from "./Badge";
import { Icon } from "./Icon";
import { Text } from "./Text";

/**
 * The Daily Log, on the project it belongs to.
 *
 * The technician's own record, and the only AI artefact here that nobody asks
 * for: a walkthrough summary and a client report are things you go and
 * generate, whereas this is supposed to be there already when you look. It is
 * written by the capture session itself (`src/offline/capture-session.ts`),
 * which on a phone means when the outbox finishes rather than when the camera
 * closes.
 *
 * Two things it is careful about:
 *
 * **It never draws an empty state.** A permanent "no daily log yet" box under
 * every photo grid explains a feature instead of being one. The log introduces
 * itself by appearing the first time somebody adds photos.
 *
 * **It says it is internal.** The loudest thing on the card after the title is
 * the notice that no client ever reads this. The register is terse and
 * unpolished on purpose, and somebody who mistook it for a client-facing report
 * would send a rough one.
 */
export function DailyLogCard({ projectId, pending }: { projectId: string; pending?: boolean }) {
  const theme = useTheme();
  const [showEarlier, setShowEarlier] = useState(false);

  const query = useQuery({
    queryKey: ["daily-logs", projectId],
    queryFn: () => listProjectDailyLogs(projectId),
    enabled: Boolean(projectId),
    /*
     * Refetched while a capture session is still draining, because that is
     * precisely when a new section is about to appear and the card would
     * otherwise sit there stale until something else invalidated it.
     */
    refetchInterval: pending ? 15_000 : false,
  });

  const logs = query.data ?? [];
  if (!shouldShowLog(logs, Boolean(pending))) return null;

  const [latest, ...earlier] = logs;

  return (
    <View
      style={{
        marginBottom: spacing.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          padding: spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Icon icon={NotebookPen} size="md" tone="safety" />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">Daily Log</Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            Written automatically from each capture session
          </Text>
        </View>
      </View>

      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <Badge label={INTERNAL_NOTICE} tone="warning" icon={Lock} variant="soft" />

        {!latest ? (
          // A session has been queued but its log has not been written yet.
          // Saying so beats an empty card, and beats a spinner with no words.
          <Text variant="body" tone="muted">
            Writing today&apos;s log once these photos finish uploading.
          </Text>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.sm }}>
              <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                {dayLabel(latest.createdAt)} · {relativeTime(latest.updatedAt)}
              </Text>
              <Text variant="caption" tone="muted">
                {photoCountLabel(latest.photoCount)}
              </Text>
            </View>

            <LogEntries log={latest} />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open the full daily log"
              onPress={() =>
                router.push({ pathname: "/page/[pageId]", params: { pageId: latest.pageId } })
              }
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                paddingVertical: spacing.xs,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text variant="caption" tone="primary">
                Open full log
              </Text>
              <Icon icon={ChevronRight} size="sm" tone="primary" />
            </Pressable>
          </>
        )}

        {earlier.length > 0 ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                showEarlier ? "Hide earlier days" : `Show ${earlier.length} earlier days`
              }
              onPress={() => setShowEarlier((value) => !value)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                paddingVertical: spacing.xs,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Icon icon={showEarlier ? ChevronDown : ChevronRight} size="sm" tone="muted" />
              <Text variant="caption" tone="muted">
                {showEarlier ? "Hide earlier days" : `${earlier.length} earlier days`}
              </Text>
            </Pressable>

            {showEarlier
              ? earlier.map((log) => (
                  <Pressable
                    key={log.pageId}
                    accessibilityRole="button"
                    accessibilityLabel={`Open the log for ${dayLabel(log.createdAt)}`}
                    onPress={() =>
                      router.push({ pathname: "/page/[pageId]", params: { pageId: log.pageId } })
                    }
                    style={({ pressed }) => ({
                      gap: spacing.xs,
                      paddingVertical: spacing.sm,
                      borderTopWidth: 1,
                      borderTopColor: theme.colors.border,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.sm }}>
                      <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                        {dayLabel(log.createdAt)}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {photoCountLabel(log.photoCount)}
                      </Text>
                    </View>
                    <LogEntries log={log} limit={2} />
                  </Pressable>
                ))
              : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

function LogEntries({ log, limit }: { log: DailyLogSummary; limit?: number }) {
  const theme = useTheme();
  const { shown, hidden } = previewEntries(log.entries, limit);

  if (shown.length === 0) {
    /*
     * A log with photos but no bullets is a real state, not a bug: Gemini is
     * geo-blocked on some networks, and the service falls back to a stub
     * section rather than failing the upload. Saying the photos are filed is
     * true and useful; showing nothing looks broken.
     */
    return (
      <Text variant="body" tone="muted">
        {log.photoCount > 0
          ? `${photoCountLabel(log.photoCount)} filed, with no notes written yet.`
          : "Nothing written yet."}
      </Text>
    );
  }

  return (
    <View style={{ gap: spacing.xs }}>
      {shown.map((entry, index) => (
        <View key={index} style={{ flexDirection: "row", gap: spacing.sm }}>
          <View
            style={{
              width: 4,
              height: 4,
              borderRadius: 2,
              marginTop: 8,
              backgroundColor: theme.colors.primary,
            }}
          />
          <Text variant="body" style={{ flex: 1 }}>
            {entry}
          </Text>
        </View>
      ))}
      {hidden > 0 ? (
        <Text variant="caption" tone="muted">
          +{hidden} more
        </Text>
      ) : null}
    </View>
  );
}
