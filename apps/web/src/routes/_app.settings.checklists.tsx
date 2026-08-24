import { createFileRoute } from "@tanstack/react-router";
import { ChecklistTemplatesPage } from "@/features/settings/pages/ChecklistTemplatesPage";

export const Route = createFileRoute("/_app/settings/checklists")({
  head: () => ({ meta: [{ title: "Checklist templates - Everlumen" }] }),
  component: () => <ChecklistTemplatesPage embedded={false} />,
});
