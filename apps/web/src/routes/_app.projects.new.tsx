import { createFileRoute } from "@tanstack/react-router";
import { NewProjectPage } from "@/features/projects/pages/NewProjectPage";

export const Route = createFileRoute("/_app/projects/new")({
  head: () => ({ meta: [{ title: "New Project — SitePix" }] }),
  component: NewProjectPage,
});
