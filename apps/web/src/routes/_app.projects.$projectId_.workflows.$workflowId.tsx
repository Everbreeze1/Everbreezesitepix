import { createFileRoute, redirect } from "@tanstack/react-router";
import { SHOW_WORKFLOWS } from "@everlumen/shared";
import { WorkflowDocumentPage } from "@/features/projects/pages/WorkflowDocumentPage";

export const Route = createFileRoute("/_app/projects/$projectId_/workflows/$workflowId")({
  // Workflows are hidden (SHOW_WORKFLOWS): old links land on the project.
  beforeLoad: ({ params }) => {
    if (!SHOW_WORKFLOWS)
      throw redirect({
        to: "/projects/$projectId",
        params: { projectId: params.projectId },
        replace: true,
      });
  },
  head: () => ({ meta: [{ title: "Workflow - Everlumen" }] }),
  component: WorkflowDocumentPage,
});
