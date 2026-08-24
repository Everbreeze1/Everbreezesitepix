import { createFileRoute } from "@tanstack/react-router";
import { AdminTeamsPage } from "@/features/admin/pages/AdminTeamsPage";

export const Route = createFileRoute("/_app/admin/teams")({
  head: () => ({ meta: [{ title: "Admin - Teams - Everlumen" }] }),
  component: AdminTeamsPage,
});
