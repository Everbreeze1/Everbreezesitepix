import { createFileRoute } from "@tanstack/react-router";
import { WorkflowDocumentPage } from "@/features/projects/pages/WorkflowDocumentPage";

export const Route = createFileRoute("/_app/projects/$projectId_/workflows/$workflowId")({
  head: () => ({ meta: [{ title: "Workflow - SitePix" }] }),
  component: WorkflowDocumentPage,
});
