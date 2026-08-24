import { createFileRoute } from "@tanstack/react-router";
import { ProjectPageEditorPage } from "@/features/projects/pages/ProjectPageEditorPage";

export const Route = createFileRoute("/_app/projects/$projectId_/pages/$pageId")({
  head: () => ({ meta: [{ title: "Document - Everlumen" }] }),
  component: ProjectPageEditorPage,
});
