import { createFileRoute } from "@tanstack/react-router";
import {
  ProjectDetailPage,
  type ProjectDetailSearch,
} from "@/features/projects/pages/ProjectDetailPage";

export const Route = createFileRoute("/_app/projects/$projectId")({
  head: () => ({ meta: [{ title: "Project - SitePix" }] }),
  validateSearch: (search: Record<string, unknown>): ProjectDetailSearch => ({
    camera: search.camera === 1 || search.camera === "1" ? 1 : undefined,
    walkthrough: search.walkthrough === 1 || search.walkthrough === "1" ? 1 : undefined,
    /*
     * ?photo=<uuid> opens the viewer on one photo. This is what a "task
     * assigned to you" or "mentioned you" notification carries, so the tap
     * lands on the picture the message is about.
     *
     * Shape-checked rather than passed through: the value goes straight into a
     * lookup against the loaded photos, and anything that is not an id can only
     * produce a "that photo is not here" toast for a photo nobody linked.
     */
    photo:
      typeof search.photo === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search.photo)
        ? search.photo
        : undefined,
    /*
     * ?task=<uuid> opens the Tasks tab with one task expanded. Carried by every
     * notification a task raises - assigned, reassigned, completed, commented
     * on - so a bell that says "waiting on part" lands on the thread it was
     * written in rather than on a tab with forty rows.
     *
     * Same shape check as `photo`, for the same reason: the value is only ever
     * matched against loaded rows, so anything else is a lookup that finds
     * nothing.
     */
    task:
      typeof search.task === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search.task)
        ? search.task
        : undefined,
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
