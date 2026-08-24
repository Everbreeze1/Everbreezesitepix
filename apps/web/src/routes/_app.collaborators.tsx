import { createFileRoute } from "@tanstack/react-router";
import { CollaboratorsPage } from "@/features/teams/pages/CollaboratorsPage";

export const Route = createFileRoute("/_app/collaborators")({
  head: () => ({ meta: [{ title: "Collaborators - Everlumen" }] }),
  component: CollaboratorsPage,
});
