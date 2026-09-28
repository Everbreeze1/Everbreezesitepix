import { router, Stack, useLocalSearchParams } from "expo-router";
import { ReportReader } from "@/components/ReportReader";

/**
 * One hand-built report, ready to read.
 *
 * Tapping a report opens the finished document, as the client sees it, not the
 * builder. Edit opens the editor as its own screen (`report/edit/[reportId]`),
 * and Done there comes back here. Titled "Report" rather than the report's own
 * name: the name is the first thing on the cover, and the nav bar has room for
 * about thirty characters of it, which is the prefix every report on a job
 * shares.
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
        <ReportReader
          reportId={reportId}
          projectId={projectId ?? null}
          onEdit={() =>
            router.push({
              pathname: "/report/edit/[reportId]",
              params: { reportId, ...(projectId ? { projectId } : {}) },
            })
          }
          onDeleted={() => {
            if (router.canGoBack()) router.back();
          }}
        />
      ) : null}
    </>
  );
}
