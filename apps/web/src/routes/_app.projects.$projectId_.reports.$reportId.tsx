import { createFileRoute } from "@tanstack/react-router";
import { ReportBuilderPage } from "@/features/projects/pages/ReportBuilderPage";

export const Route = createFileRoute("/_app/projects/$projectId_/reports/$reportId")({
  head: () => ({ meta: [{ title: "Report builder - Everlumen" }] }),
  component: ReportBuilderPage,
});
