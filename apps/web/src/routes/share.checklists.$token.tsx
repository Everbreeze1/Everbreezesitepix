import { createFileRoute } from "@tanstack/react-router";
import { PublicRecordView } from "@/features/projects/components/PublicRecordView";

export const Route = createFileRoute("/share/checklists/$token")({
  head: () => ({
    meta: [
      { title: "Shared checklist - SitePix" },
      { name: "description", content: "A checklist record shared from SitePix." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublicChecklistPage,
});

function PublicChecklistPage() {
  const { token } = Route.useParams();
  return <PublicRecordView token={token} kind="checklist" />;
}
