import { createFileRoute, Link } from "@tanstack/react-router";
import { ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/portfolio/JsonLd";
import { PortfolioProject } from "@/components/portfolio/PortfolioProject";
import {
  getPublicPortfolioShowcase,
  type PublicPortfolioShowcase,
} from "@/lib/portfolio.functions";
import { absoluteUrl } from "@/lib/site-url";

/**
 * One project inside the portfolio site - /p/<slug>/<project-slug>.
 *
 * Sibling of p.$slug.tsx rather than a child of it (note the trailing `_` on
 * the slug segment): the two pages share the chrome component, not a layout
 * route, so each one loads exactly the data it needs in a single round trip.
 *
 * These pages are the SEO surface that matters. A contractor's site ranks on
 * "roof replacement <city>" through project pages like this one, not through
 * the home page - hence the per-project title, description and JSON-LD.
 */
export const Route = createFileRoute("/p/$slug_/$showcaseSlug")({
  loader: async ({ params }) => {
    try {
      return await getPublicPortfolioShowcase({
        data: { slug: params.slug, showcaseSlug: params.showcaseSlug },
      });
    } catch {
      return {
        status: "not_found",
        site: null,
        showcase: null,
        prev: null,
        next: null,
        related: [],
        reviewLinks: [],
      } satisfies PublicPortfolioShowcase;
    }
  },
  head: ({ loaderData, params }) => {
    const site = loaderData?.site;
    const showcase = loaderData?.showcase;
    if (!site || !showcase) {
      return {
        meta: [{ title: "Project unavailable" }, { name: "robots", content: "noindex" }],
      };
    }
    const business = site.business_name?.trim() || "Our work";
    const location = [showcase.city, showcase.state].filter(Boolean).join(", ");
    // Title reads "<Project> | <Service> in <City> | <Business>" - the shape
    // that actually matches how someone searches for a local trade.
    const title = [
      showcase.title,
      [showcase.service_type, location && `in ${location}`].filter(Boolean).join(" "),
      business,
    ]
      .filter(Boolean)
      .join(" | ");
    const description =
      showcase.summary?.trim() ||
      showcase.tagline?.trim() ||
      `${showcase.service_type ? `${showcase.service_type} project` : "A project"} completed by ${business}${
        location ? ` in ${location}` : ""
      }. Photographed on site.`;
    const url = absoluteUrl(`/p/${params.slug}/${params.showcaseSlug}`);
    const image = showcase.cover_image_url ?? undefined;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "robots", content: "index,follow" },
        { property: "og:type", content: "article" },
        { property: "og:site_name", content: business },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
        ...(image ? [{ property: "og:image", content: image }] : []),
        { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...(image ? [{ name: "twitter:image", content: image }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: PortfolioProjectPage,
});

function PortfolioProjectPage() {
  const data = Route.useLoaderData();
  const { slug, showcaseSlug } = Route.useParams();

  if (!data.site || !data.showcase) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
        <ImageOff className="h-10 w-10 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold">Project unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {data.status === "unpublished"
            ? "This portfolio hasn't been published yet."
            : "This project has been removed or is no longer listed."}
        </p>
        <Button asChild className="mt-6">
          {/* Sends them to the portfolio rather than SitePix - if the site
              exists, the visitor almost certainly wants the rest of its work. */}
          <Link to="/p/$slug" params={{ slug }}>
            See all work
          </Link>
        </Button>
      </div>
    );
  }

  const site = data.site;
  const s = data.showcase;
  const url = absoluteUrl(`/p/${slug}/${showcaseSlug}`);
  const photos = s.sections.flatMap((sec) => sec.items).filter((i) => i.image_url);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ImageGallery",
          "@id": url,
          name: s.title,
          url,
          ...(s.summary ? { description: s.summary } : {}),
          ...(s.completed_on ? { dateCreated: s.completed_on } : {}),
          ...(s.city || s.state
            ? {
                contentLocation: {
                  "@type": "Place",
                  address: {
                    "@type": "PostalAddress",
                    ...(s.city ? { addressLocality: s.city } : {}),
                    ...(s.state ? { addressRegion: s.state } : {}),
                  },
                },
              }
            : {}),
          provider: {
            "@type": "LocalBusiness",
            name: site.business_name?.trim() || "Our work",
            url: absoluteUrl(`/p/${slug}`),
            ...(site.phone ? { telephone: site.phone } : {}),
          },
          // Capped: a 60-photo job would otherwise emit a wall of JSON that
          // dwarfs the page content it is meant to describe.
          image: photos.slice(0, 20).map((p) => ({
            "@type": "ImageObject",
            contentUrl: p.image_url,
            ...(p.caption ? { caption: p.caption } : {}),
          })),
        }}
      />
      <PortfolioProject data={data} />
    </>
  );
}
