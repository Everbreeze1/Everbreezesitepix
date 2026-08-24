import { createFileRoute } from "@tanstack/react-router";
import { WorkflowTemplatesPage } from "@/features/settings/pages/WorkflowTemplatesPage";

export const Route = createFileRoute("/_app/settings/workflows")({
  head: () => ({ meta: [{ title: "Workflow templates - Everlumen" }] }),
  component: () => <WorkflowTemplatesPage embedded={false} />,
});
