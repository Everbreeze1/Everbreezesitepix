import { createFileRoute } from "@tanstack/react-router";
import { PortfolioPage } from "@/features/showcases/pages/PortfolioPage";

// URL kept as /showcases so links people have already saved keep working; the
// page itself is now the Portfolio (site + projects + embeds).
export const Route = createFileRoute("/_app/showcases")({
  head: () => ({ meta: [{ title: "Portfolio — SitePix" }] }),
  component: PortfolioPage,
});
