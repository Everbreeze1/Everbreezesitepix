import { createFileRoute } from "@tanstack/react-router";
import { AdminTeamDetailPage } from "@/features/admin/pages/AdminTeamDetailPage";

export const Route = createFileRoute("/_app/admin/teams/$teamId")({
  head: () => ({ meta: [{ title: "Admin - Team - SitePix" }] }),
  component: AdminTeamDetailPage,
});
