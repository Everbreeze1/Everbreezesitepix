import { createFileRoute } from "@tanstack/react-router";
import { TeamsPage } from "@/features/teams/pages/TeamsPage";

export const Route = createFileRoute("/_app/teams")({
  head: () => ({ meta: [{ title: "Team — SitePix" }] }),
  component: TeamsPage,
});
