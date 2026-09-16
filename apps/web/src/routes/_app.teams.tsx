import { createFileRoute } from "@tanstack/react-router";
import { TeamsLibraryContent } from "@/features/teams/pages/TeamsLibraryContent";

export const Route = createFileRoute("/_app/teams")({
  head: () => ({ meta: [{ title: "Teams - Everlumen" }] }),
  component: TeamsLibraryContent,
});
