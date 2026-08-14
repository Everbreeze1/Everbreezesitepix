import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { DEFAULT_ACCENT } from "@/components/portfolio/PortfolioChrome";
import { PortfolioMap } from "@/components/portfolio/PortfolioMap";
import { useEmbedHeight } from "@/components/portfolio/use-embed-height";
import { getPortfolioEmbed, type PortfolioEmbedData } from "@/lib/portfolio.functions";
import { SITE_ORIGIN } from "@/lib/site-url";

/**
 * The website map widget - /embed/map/<embed-key>.
 *
 * "We've worked on your street" is the argument this makes, and it is the one
 * a homeowner actually responds to. Same iframe contract as the gallery embed.
 *
 * Unlike the gallery this has a fixed height: a map has no natural content
 * height to grow into, so the host picks one via ?height and embed.js honours
 * it instead of auto-sizing.
 */
interface MapSearch {
  pin?: unknown;
  height?: unknown;
}

export const Route = createFileRoute("/embed/map/$key")({
  /**
   * Pass-through, clamped at read time - see the gallery embed for why
   * normalising here would cost every iframe load a 307 redirect first.
   */
  validateSearch: (search: Record<string, unknown>): MapSearch => {
    const out: MapSearch = {};
    if (search.pin !== undefined) out.pin = search.pin;
    if (search.height !== undefined) out.height = search.height;
    return out;
  },
  loader: async ({ params }) => {
    try {
      return await getPortfolioEmbed({ data: { key: params.key } });
    } catch {
      return {
        status: "not_found",
        site_url: null,
        slug: null,
        business_name: null,
        accent_color: null,
        showcases: [],
        serviceTypes: [],
      } satisfies PortfolioEmbedData;
    }
  },
  head: () => ({
    meta: [{ title: "Project map" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: MapEmbed,
});

/** Accepts `#rrggbb` with or without the hash; anything else falls through. */
function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined;
}

function clampHeight(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 460;
  return Math.min(Math.max(Math.floor(n), 240), 900);
}

function MapEmbed() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const pin = normalizeHex(search.pin);
  const height = clampHeight(search.height);
  useEmbedHeight();

  const accent = pin || data.accent_color || DEFAULT_ACCENT;
  // Memoised: PortfolioMap rebuilds its markers whenever this array's identity
  // changes, so handing it a fresh one each render would re-init the map.
  const pinned = useMemo(
    () => data.showcases.filter((s) => s.latitude != null && s.longitude != null),
    [data.showcases],
  );

  if (data.status !== "ok" || !data.slug || pinned.length === 0) {
    return (
      <div
        className="grid place-items-center bg-white p-8 text-center"
        style={{ minHeight: height }}
      >
        <p className="text-sm text-neutral-400">
          {data.status === "unpublished"
            ? "This map isn't published yet."
            : data.status === "ok"
              ? "No mapped projects yet."
              : "This map is no longer available."}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white antialiased" style={{ height }}>
      <PortfolioMap
        showcases={pinned}
        accent={accent}
        linkBase={`${SITE_ORIGIN}/p/${data.slug}`}
        linkTarget="_blank"
        className="h-full w-full overflow-hidden rounded-xl bg-neutral-100"
      />
    </div>
  );
}
