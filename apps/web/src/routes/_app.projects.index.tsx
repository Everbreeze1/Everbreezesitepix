import { createFileRoute } from "@tanstack/react-router";
import { ProjectsPage, type ProjectsIndexSearch } from "@/features/projects/pages/ProjectsPage";

/**
 * `?tab=` on the projects index.
 *
 * The tab used to be local state only, which meant none of the four
 * destinations had an address: nothing could link to Pipelines, and the two
 * "View all …" buttons on a group page pointed at `?tab=tasks` and
 * `?tab=checklists`, both of which had never been read by anything and so did
 * nothing at all. The Schedule tab made that worse rather than better - a
 * screen whose whole job is "what's due today" is exactly the one someone
 * bookmarks or pastes into a message.
 *
 * Unknown values fall back to the project list rather than erroring, so an old
 * `?tab=tasks` link lands somewhere sensible instead of on a blank page.
 */
const TABS = ["projects", "groups", "boards", "schedule"] as const;

/**
 * `calendar` is the old key for what is now `schedule`, kept accepting so the
 * links shared while the tab still carried that name keep opening it. Exactly
 * the treatment `panel=timeline` gets on the project route, and for the same
 * reason: renaming a tab must not break an address somebody already sent.
 */
const RENAMED: Record<string, (typeof TABS)[number]> = { calendar: "schedule" };

export const Route = createFileRoute("/_app/projects/")({
  head: () => ({ meta: [{ title: "My Projects - Everbreeze SitePix" }] }),
  validateSearch: (search: Record<string, unknown>): ProjectsIndexSearch => {
    const raw = typeof search.tab === "string" ? search.tab : "";
    const tab = RENAMED[raw] ?? (TABS.includes(raw as never) ? (raw as never) : undefined);
    return {
      q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
      tab,
    };
  },
  component: ProjectsPage,
});
