import { createFileRoute } from "@tanstack/react-router";
import { NewProjectPage } from "@/features/projects/pages/NewProjectPage";

export type NewProjectSearch = {
  /** Blueprint to pre-select, so "New project from this" arrives ready to go. */
  blueprint?: string;
};

export const Route = createFileRoute("/_app/projects/new")({
  head: () => ({ meta: [{ title: "New Project - Everlumen" }] }),
  validateSearch: (search: Record<string, unknown>): NewProjectSearch => ({
    blueprint: typeof search.blueprint === "string" ? search.blueprint : undefined,
  }),
  component: NewProjectPage,
});
