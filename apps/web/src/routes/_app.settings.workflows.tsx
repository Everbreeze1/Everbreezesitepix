import { createFileRoute, redirect } from "@tanstack/react-router";
import { SHOW_WORKFLOWS } from "@everlumen/shared";
import { WorkflowTemplatesPage } from "@/features/settings/pages/WorkflowTemplatesPage";

export const Route = createFileRoute("/_app/settings/workflows")({
  // Workflows are hidden (SHOW_WORKFLOWS): old links land on Blueprints.
  beforeLoad: () => {
    if (!SHOW_WORKFLOWS) throw redirect({ to: "/templates", replace: true });
  },
  head: () => ({ meta: [{ title: "Workflow templates - Everlumen" }] }),
  component: () => <WorkflowTemplatesPage embedded={false} />,
});
