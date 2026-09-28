import { useEffect } from "react";
import { Pressable } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { ReportEditor } from "@/components/ReportEditor";
import { HIT_TARGET, spacing } from "@/theme";
import { Text } from "@/ui";

/**
 * The report builder, full screen, opened from a report's Edit button.
 *
 * Everything saves as it goes, so Done only closes. On the way out the
 * report and its sections are read again, because the editor keeps its
 * sections in local state and the reader it returns to should show what was
 * just written rather than what was there before.
 */
export default function EditReportScreen() {
  const { reportId, projectId } = useLocalSearchParams<{
    reportId: string;
    projectId?: string;
  }>();
  const queryClient = useQueryClient();

  useEffect(
    () => () => {
      if (!reportId) return;
      void queryClient.invalidateQueries({ queryKey: ["report", reportId] });
      void queryClient.invalidateQueries({ queryKey: ["report-sections", reportId] });
      void queryClient.invalidateQueries({ queryKey: ["report-photo-urls", reportId] });
    },
    [queryClient, reportId],
  );

  const close = () => {
    if (router.canGoBack()) router.back();
    else if (reportId) router.replace({ pathname: "/report/[reportId]", params: { reportId } });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Edit report",
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Done editing"
              onPress={close}
              hitSlop={8}
              style={({ pressed }) => ({
                minHeight: HIT_TARGET - 8,
                paddingHorizontal: spacing.sm,
                justifyContent: "center",
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Text variant="bodyStrong" tone="primary">
                Done
              </Text>
            </Pressable>
          ),
        }}
      />
      {reportId ? (
        <ReportEditor
          reportId={reportId}
          projectId={projectId ?? null}
          onDeleted={() => {
            /*
             * Deleted from inside the editor. One step back: the reader under
             * this screen reads the row again, finds it gone and closes itself.
             */
            if (router.canGoBack()) router.back();
          }}
        />
      ) : null}
    </>
  );
}
