import { createFileRoute } from "@tanstack/react-router";
import {
  TemplatesPage,
  TEMPLATE_TAB_KEYS,
  type TemplatesSearch,
} from "@/features/settings/pages/TemplatesPage";

export const Route = createFileRoute("/_app/templates")({
  head: () => ({ meta: [{ title: "Templates - Everlumen" }] }),
  // Deep-linkable, because half the point of the hub is that other screens can
  // send you to it: "Save as template" toasts land on the tab the thing was
  // saved to, and a blueprint can be opened by id from a project.
  validateSearch: (search: Record<string, unknown>): TemplatesSearch => ({
    // `projects` was the old key for the blueprints tab; keep honouring it so
    // links shared before the rename still open the right tab.
    tab:
      search.tab === "projects"
        ? "blueprints"
        : TEMPLATE_TAB_KEYS.includes(search.tab as any)
          ? (search.tab as TemplatesSearch["tab"])
          : undefined,
    blueprint: typeof search.blueprint === "string" ? search.blueprint : undefined,
  }),
  component: TemplatesPage,
});
