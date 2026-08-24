import { createFileRoute } from "@tanstack/react-router";
import { ReportsIndexPage } from "@/features/projects/pages/ReportsIndexPage";

export const Route = createFileRoute("/_app/reports")({
  head: () => ({ meta: [{ title: "Reports - Everlumen" }] }),
  component: ReportsIndexPage,
});
