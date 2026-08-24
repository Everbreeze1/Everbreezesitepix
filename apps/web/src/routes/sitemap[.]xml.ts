import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { everlumenApi } from "@/lib/everlumen-api";

const BASE_URL = "https://www.everlumen.co";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
  lastmod?: string;
}

interface PortfolioUrls {
  entries: Array<{
    slug: string;
    updated_at: string;
    showcases: Array<{ slug: string; updated_at: string }>;
  }>;
}

/**
 * Published portfolio sites and their project pages.
 *
 * Being indexable is half of what a portfolio site is *for* - a contractor
 * ranks on "<trade> <city>" through project pages, and none of that happens if
 * Google is never told they exist. Failures are swallowed: a marketing sitemap
 * losing its long tail for one cache cycle beats returning a 500 to a crawler.
 */
async function portfolioEntries(): Promise<SitemapEntry[]> {
  try {
    const data = await everlumenApi.rpc<PortfolioUrls>("listPublicPortfolioUrls", undefined);
    return data.entries.flatMap((p) => [
      {
        path: `/p/${p.slug}`,
        changefreq: "weekly" as const,
        priority: "0.8",
        lastmod: p.updated_at?.slice(0, 10),
      },
      ...p.showcases.map((s) => ({
        path: `/p/${p.slug}/${s.slug}`,
        changefreq: "monthly" as const,
        priority: "0.6",
        lastmod: s.updated_at?.slice(0, 10),
      })),
    ]);
  } catch (error) {
    console.error("[sitemap] could not load portfolio URLs", error);
    return [];
  }
}

/**
 * & < > " ' are all illegal raw in an XML text node. Slugs are ASCII by
 * construction, but escaping centrally keeps that from being load-bearing.
 */
const escapeXml = (s: string) =>
  s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c,
  );

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/features", changefreq: "monthly", priority: "0.8" },
          { path: "/how-it-works", changefreq: "monthly", priority: "0.8" },
          { path: "/pricing", changefreq: "monthly", priority: "0.8" },
          { path: "/faq", changefreq: "monthly", priority: "0.7" },
          { path: "/contact", changefreq: "yearly", priority: "0.4" },
          { path: "/privacy-policy", changefreq: "yearly", priority: "0.3" },
          { path: "/terms-of-service", changefreq: "yearly", priority: "0.3" },
          ...(await portfolioEntries()),
        ];

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${escapeXml(BASE_URL + e.path)}</loc>`,
            e.lastmod ? `    <lastmod>${escapeXml(e.lastmod)}</lastmod>` : null,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
