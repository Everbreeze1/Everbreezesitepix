import { router, Stack, useLocalSearchParams } from "expo-router";
import { ReportEditor } from "@/components/ReportEditor";

/**
 * One hand-built report, full screen.
 *
 * The editor itself lives in `ReportEditor` so the tablet Reports screen can
 * show it beside the list. Titled "Report" rather than the report's own name:
 * the name is the first field below, and the nav bar has room for about thirty
 * characters of it, which is the prefix every report on a job shares.
 */
export default function ReportScreen() {
  const { reportId, projectId } = useLocalSearchParams<{
    reportId: string;
    projectId?: string;
  }>();

  return (
    <>
      <Stack.Screen options={{ title: "Report" }} />
      {reportId ? (
        <ReportEditor
          reportId={reportId}
          projectId={projectId ?? null}
          onDeleted={() => {
            if (router.canGoBack()) router.back();
          }}
        />
      ) : null}
    </>
  );
}
