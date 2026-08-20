import { createFileRoute } from "@tanstack/react-router";
import { ProjectsPage, type ProjectsIndexSearch } from "@/features/projects/pages/ProjectsPage";

/**
 * `?tab=` on the projects index.
 *
 * The tab used to be local state only, which meant none of the four
 * destinations had an address: nothing could link to Pipelines, and the two
 * "View all …" buttons on a group page pointed at `?tab=tasks` and
 * `?tab=checklists`, both of which had never been read by anything and so did
 * nothing at all. Adding the Calendar made that worse rather than better - a
 * screen whose whole job is "what's due today" is exactly the one someone
 * bookmarks or pastes into a message.
 *
 * Unknown values fall back to the project list rather than erroring, so an old
 * `?tab=tasks` link lands somewhere sensible instead of on a blank page.
 */
const TABS = ["projects", "groups", "boards", "calendar"] as const;

export const Route = createFileRoute("/_app/projects/")({
  head: () => ({ meta: [{ title: "My Projects - Everbreeze SitePix" }] }),
  validateSearch: (search: Record<string, unknown>): ProjectsIndexSearch => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
    tab: TABS.includes(search.tab as never)
      ? (search.tab as ProjectsIndexSearch["tab"])
      : undefined,
  }),
  component: ProjectsPage,
});
