import { createFileRoute } from "@tanstack/react-router";
import { ProjectsPage } from "@/features/projects/pages/ProjectsPage";

export const Route = createFileRoute("/_app/projects/")({
  head: () => ({ meta: [{ title: "My Projects — Everbreeze SitePix" }] }),
  component: ProjectsPage,
});
