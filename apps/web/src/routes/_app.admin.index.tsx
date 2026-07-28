import { createFileRoute } from "@tanstack/react-router";
import { AdminOverviewPage } from "@/features/admin/pages/AdminOverviewPage";

export const Route = createFileRoute("/_app/admin/")({
  component: AdminOverviewPage,
});
