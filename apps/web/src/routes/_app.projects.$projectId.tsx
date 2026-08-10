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
    // `timeline` is the old name for what is now the Calendar tab; keep
    // accepting it so links shared before the rename still open the right tab.
    panel:
      search.panel === "timeline"
        ? "calendar"
        : (
              [
                "tasks",
                "checklists",
                "walkthroughs",
                "reports",
                "workflows",
                "trash",
                "calendar",
              ] as const
            ).includes(search.panel as any)
          ? (search.panel as ProjectDetailSearch["panel"])
          : undefined,
  }),
  component: ProjectDetailPage,
});
