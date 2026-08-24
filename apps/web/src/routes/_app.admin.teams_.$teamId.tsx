import { createFileRoute } from "@tanstack/react-router";
import { AdminTeamDetailPage } from "@/features/admin/pages/AdminTeamDetailPage";

export const Route = createFileRoute("/_app/admin/teams_/$teamId")({
  head: () => ({ meta: [{ title: "Admin - Team - Everlumen" }] }),
  component: AdminTeamDetailPage,
});
