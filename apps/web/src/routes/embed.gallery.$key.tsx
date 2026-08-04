import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { readableTextOn } from "@/lib/contrast";
import { DEFAULT_ACCENT } from "@/components/portfolio/PortfolioChrome";
import { ShowcaseCard } from "@/components/portfolio/ShowcaseCard";
import { useEmbedHeight } from "@/components/portfolio/use-embed-height";
import { getPortfolioEmbed, type PortfolioEmbedData } from "@/lib/portfolio.functions";
import { SITE_ORIGIN } from "@/lib/site-url";

/**
 * The website gallery widget — /embed/gallery/<embed-key>.
 *
 * Meant to be iframed into the contractor's own website (Wix, Squarespace,
 * WordPress, whatever), so it deliberately renders no chrome, no router links
 * and no fonts of its own: it inherits nothing from the host page and imposes
 * nothing on it beyond its own box.
 *
 * Project links open in a new tab. Navigating the host page away to the
 * portfolio would be a hostile thing for a widget to do, and inside an iframe a
 * same-tab navigation would trap the visitor in a frame with no way back.
 */
interface GallerySearch {
  columns?: unknown;
  filters?: unknown;
  limit?: unknown;
}

export const Route = createFileRoute("/embed/gallery/$key")({
  /**
   * Echoes the params back untouched and clamps them at read time instead of
   * normalising here. Returning defaults would make the validated search differ
   * from the requested URL, and the router answers that with a 307 to the
   * canonical form — an extra round trip on every single iframe load, before
   * the host page has rendered anything.
   */
  validateSearch: (search: Record<string, unknown>): GallerySearch => {
    const out: GallerySearch = {};
    if (search.columns !== undefined) out.columns = search.columns;
    if (search.filters !== undefined) out.filters = search.filters;
    if (search.limit !== undefined) out.limit = search.limit;
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
    // A widget must never compete with the host page for search results.
    meta: [{ title: "Project gallery" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: GalleryEmbed,
});

function clampColumns(value: unknown): 2 | 3 | 4 {
  const n = Number(value);
  return n === 2 || n === 4 ? n : 3;
}

function clampLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 60;
  return Math.min(Math.floor(n), 60);
}

function GalleryEmbed() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const columns = clampColumns(search.columns);
  const limit = clampLimit(search.limit);
  // Host pages often sit in a narrow content column where chips wrap badly, so
  // filters are opt-out via data-filters="0" in the install snippet.
  const filters = search.filters !== "0" && search.filters !== 0 && search.filters !== false;
  const [filter, setFilter] = useState<string | null>(null);
  useEmbedHeight();

  const accent = data.accent_color || DEFAULT_ACCENT;
  const visible = useMemo(() => {
    const list = filter ? data.showcases.filter((s) => s.service_type === filter) : data.showcases;
    return list.slice(0, limit);
  }, [data.showcases, filter, limit]);

  if (data.status !== "ok" || !data.slug) {
    return (
      <div className="grid min-h-[220px] place-items-center bg-white p-8 text-center">
        <p className="text-sm text-neutral-400">
          {data.status === "unpublished"
            ? "This gallery isn't published yet."
            : "This gallery is no longer available."}
        </p>
      </div>
    );
  }

  // Absolute: the host page is on another domain, so a relative href would
  // resolve against theirs.
  const hrefBase = `${SITE_ORIGIN}/p/${data.slug}`;

  return (
    <div className="bg-white p-1 antialiased">
      {filters && data.serviceTypes.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2">
          <Chip active={filter === null} accent={accent} onClick={() => setFilter(null)}>
            All
          </Chip>
          {data.serviceTypes.map((t) => (
            <Chip
              key={t}
              active={filter === t}
              accent={accent}
              onClick={() => setFilter(filter === t ? null : t)}
            >
              {t}
            </Chip>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-400">No projects to show yet.</p>
      ) : (
        <div
          className={cn(
            "grid gap-5",
            columns === 2 && "sm:grid-cols-2",
            columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
            columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
          )}
        >
          {visible.map((card) => (
            <ShowcaseCard
              key={card.slug}
              card={card}
              accent={accent}
              hrefBase={hrefBase}
              target="_blank"
            />
          ))}
        </div>
      )}

      <p className="mt-6 text-center">
        <a
          href={hrefBase}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-bold uppercase tracking-[0.14em]"
          style={{ color: accent }}
        >
          See all our work →
        </a>
      </p>
    </div>
  );
}

function Chip({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-3.5 py-1.5 text-xs font-bold transition",
        !active && "border border-neutral-200 text-neutral-600 hover:border-neutral-400",
      )}
      style={active ? { backgroundColor: accent, color: readableTextOn(accent) } : undefined}
    >
      {children}
    </button>
  );
}
