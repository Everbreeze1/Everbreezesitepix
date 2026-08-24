import { createFileRoute } from "@tanstack/react-router";
import { PublicRecordView } from "@/features/projects/components/PublicRecordView";

export const Route = createFileRoute("/share/workflows/$token")({
  head: () => ({
    meta: [
      { title: "Shared workflow - Everlumen" },
      { name: "description", content: "A workflow record shared from Everlumen." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublicWorkflowPage,
});

function PublicWorkflowPage() {
  const { token } = Route.useParams();
  return <PublicRecordView token={token} kind="workflow" />;
}
