import { createFileRoute } from "@tanstack/react-router";
import { ShowcaseBuilderPage } from "@/features/showcases/pages/ShowcaseBuilderPage";

// `showcases_` (trailing underscore) keeps this OUT of the /showcases route's
// layout - same escape hatch as _app.projects.$projectId_.pages.*. Nested under
// it, the builder never rendered at all: PortfolioPage has no <Outlet />, so
// navigating here only changed the URL while the list stayed on screen, which
// read as "Create did nothing" and "Edit doesn't work".
export const Route = createFileRoute("/_app/showcases_/$showcaseId")({
  head: () => ({ meta: [{ title: "Edit project - Everlumen" }] }),
  component: ShowcaseBuilderPage,
});
