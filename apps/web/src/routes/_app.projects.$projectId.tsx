import { createFileRoute } from "@tanstack/react-router";
import {
  ProjectDetailPage,
  type ProjectDetailSearch,
} from "@/features/projects/pages/ProjectDetailPage";

export const Route = createFileRoute("/_app/projects/$projectId")({
  head: () => ({ meta: [{ title: "Project — SitePix" }] }),
  validateSearch: (search: Record<string, unknown>): ProjectDetailSearch => ({
    camera: search.camera === 1 || search.camera === "1" ? 1 : undefined,
    walkthrough: search.walkthrough === 1 || search.walkthrough === "1" ? 1 : undefined,
  }),
  component: ProjectDetailPage,
});
