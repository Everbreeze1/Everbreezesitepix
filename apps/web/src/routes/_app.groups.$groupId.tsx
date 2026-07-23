import { createFileRoute } from "@tanstack/react-router";
import { GroupPage } from "@/features/projects/pages/GroupPage";

export const Route = createFileRoute("/_app/groups/$groupId")({
  head: () => ({ meta: [{ title: "Project Group — Everbreeze SitePix" }] }),
  component: GroupPage,
});
