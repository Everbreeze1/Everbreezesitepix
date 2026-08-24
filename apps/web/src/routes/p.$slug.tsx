import { createFileRoute, Link } from "@tanstack/react-router";
import { ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/portfolio/JsonLd";
import { PortfolioHome } from "@/components/portfolio/PortfolioHome";
import { getPublicPortfolio, type PublicPortfolio } from "@/lib/portfolio.functions";
import { absoluteUrl } from "@/lib/site-url";

/**
 * The portfolio site's home page - /p/<slug>.
 *
 * Loaded in a route `loader` rather than a client-side effect (which is how the
 * older /share pages work) for one reason: this page is meant to be indexed.
 * The loader runs during SSR, so the title, description, OG image and JSON-LD
 * below are in the HTML a crawler receives, not painted in afterwards.
 */
export const Route = createFileRoute("/p/$slug")({
  loader: async ({ params }) => {
    try {
      return await getPublicPortfolio({ data: { slug: params.slug } });
    } catch {
      // A failed load must not 500 a public marketing page - render the same
      // "unavailable" state an unknown slug gets.
      return {
        status: "not_found",
        site: null,
        showcases: [],
        serviceTypes: [],
        locations: [],
        stats: { projects: 0, photos: 0, areas: 0 },
        reviewLinks: [],
      } satisfies PublicPortfolio;
    }
  },
  head: ({ loaderData, params }) => {
    const site = loaderData?.site;
    if (!site) {
      return {
        meta: [{ title: "Portfolio unavailable" }, { name: "robots", content: "noindex" }],
      };
    }
    const name = site.business_name?.trim() || "Our work";
    const title = site.seo_title?.trim() || `${name} - Our work`;
    const description =
      site.seo_description?.trim() ||
      site.hero_subhead?.trim() ||
      `See completed projects from ${name}${
        site.service_areas.length ? ` in ${site.service_areas.slice(0, 3).join(", ")}` : ""
      }. Real photos from real job sites.`;
    const url = absoluteUrl(`/p/${params.slug}`);
    const image = site.hero_image_url ?? undefined;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        // Unlike /share links, a portfolio is meant to be found - this is the
        // "boost your SEO" half of the feature.
        { name: "robots", content: "index,follow" },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: name },
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
  component: PortfolioHomePage,
});

function PortfolioHomePage() {
  const data = Route.useLoaderData();
  const { slug } = Route.useParams();

  if (!data.site) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
        <ImageOff className="h-10 w-10 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold">Portfolio unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {data.status === "unpublished"
            ? "This portfolio hasn't been published yet."
            : "This address doesn't match a portfolio."}
        </p>
        <Button asChild className="mt-6">
          <Link to="/">Back to Everlumen</Link>
        </Button>
      </div>
    );
  }

  const site = data.site;
  const name = site.business_name?.trim() || "Our work";
  const url = absoluteUrl(`/p/${slug}`);

  return (
    <>
      {/* LocalBusiness is what earns the map pack / knowledge panel for a
          contractor; ImageGallery tells Google the project pages are the
          substance of the site rather than boilerplate. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "LocalBusiness",
              "@id": `${url}#business`,
              name,
              url,
              ...(site.logo_url ? { logo: site.logo_url, image: site.logo_url } : {}),
              ...(site.phone ? { telephone: site.phone } : {}),
              ...(site.email ? { email: site.email } : {}),
              ...(site.address ? { address: site.address } : {}),
              ...(site.website_url ? { sameAs: [site.website_url] } : {}),
              ...(site.service_areas.length
                ? { areaServed: site.service_areas.map((a) => ({ "@type": "Place", name: a })) }
                : {}),
              ...(site.services.length ? { knowsAbout: site.services } : {}),
            },
            {
              "@type": "CollectionPage",
              "@id": url,
              name: `${name} - Our work`,
              url,
              isPartOf: { "@id": `${url}#business` },
              hasPart: data.showcases.slice(0, 50).map((s) => ({
                "@type": "CreativeWork",
                name: s.title,
                url: absoluteUrl(`/p/${slug}/${s.slug}`),
                ...(s.cover_image_url ? { image: s.cover_image_url } : {}),
                ...(s.summary ? { description: s.summary } : {}),
              })),
            },
          ],
        }}
      />
      <PortfolioHome
        site={site}
        showcases={data.showcases}
        serviceTypes={data.serviceTypes}
        locations={data.locations}
        stats={data.stats}
        reviewLinks={data.reviewLinks}
      />
    </>
  );
}
