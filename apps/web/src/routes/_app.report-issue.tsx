import { createFileRoute } from "@tanstack/react-router";
import { ReportIssuePage } from "@/features/settings/pages/ReportIssuePage";

export const Route = createFileRoute("/_app/report-issue")({
  head: () => ({ meta: [{ title: "Report an issue - SitePix" }] }),
  component: ReportIssuePage,
});
