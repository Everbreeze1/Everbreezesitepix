import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/features/projects/pages/DashboardPage";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Overview - Everlumen" }] }),
  component: DashboardPage,
});
