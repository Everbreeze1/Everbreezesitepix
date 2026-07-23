import { createFileRoute } from "@tanstack/react-router";
import { ProjectTrashPage } from "@/features/projects/pages/ProjectTrashPage";

export const Route = createFileRoute("/_app/projects/trash")({
  head: () => ({ meta: [{ title: "Project Trash — SitePix" }] }),
  component: ProjectTrashPage,
});
