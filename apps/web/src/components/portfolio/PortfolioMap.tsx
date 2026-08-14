import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { readableTextOn } from "@/lib/contrast";
import type { PortfolioShowcaseCard } from "@/lib/portfolio.functions";

/**
 * "We've worked in your neighbourhood" - the single most persuasive thing a
 * local contractor can show, and the reason CompanyCam ships a map alongside
 * the gallery.
 *
 * Pins come from the project's geocoded address, denormalised onto the showcase
 * at build time, so a published map keeps its pins after the project is gone.
 *
 * Renders nothing at all when no showcase has coordinates - an empty grey
 * rectangle centred on the Atlantic is worse than no map.
 */
export function PortfolioMap({
  showcases,
  accent,
  /** Where a pin's info window links. Omit inside embeds that can't navigate. */
  linkBase,
  linkTarget,
  className,
}: {
  showcases: PortfolioShowcaseCard[];
  accent: string;
  linkBase?: string;
  linkTarget?: "_blank";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Memoised so the effect below can depend on the array itself. Keying on
  // `pins.length` instead would silently keep stale markers whenever a filter
  // swaps one project for another without changing the count.
  const pins = useMemo(
    () =>
      showcases.filter((s) => typeof s.latitude === "number" && typeof s.longitude === "number"),
    [showcases],
  );

  useEffect(() => {
    if (!pins.length || !ref.current) return;
    let cancelled = false;
    let clusterer: MarkerClusterer | null = null;

    (async () => {
      try {
        await loadGoogleMaps();
        if (cancelled || !ref.current) return;
        const g = window.google;

        const map = new g.maps.Map(ref.current, {
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          // Anonymous visitors scroll past this on the way down the page;
          // capturing the wheel would trap them. Ctrl+wheel still zooms.
          gestureHandling: "cooperative",
          zoomControl: true,
          styles: MUTED_STYLE,
        });

        const bounds = new g.maps.LatLngBounds();
        const info = new g.maps.InfoWindow();
        const icon = pinIcon(accent);

        const markers = pins.map((p) => {
          const position = { lat: p.latitude as number, lng: p.longitude as number };
          bounds.extend(position);
          const marker = new g.maps.Marker({ position, title: p.title, icon });
          marker.addListener("click", () => {
            info.setContent(infoHtml(p, accent, linkBase, linkTarget));
            info.open({ map, anchor: marker });
          });
          return marker;
        });

        clusterer = new MarkerClusterer({ map, markers });
        map.fitBounds(bounds, 64);

        // fitBounds on a single pin zooms to street level, which reads as an
        // accident rather than a decision. Pull back to neighbourhood scale.
        const once = g.maps.event.addListenerOnce(map, "idle", () => {
          if (map.getZoom() > 14) map.setZoom(13);
        });
        if (cancelled) g.maps.event.removeListener(once);
      } catch {
        if (!cancelled) setError("Map unavailable");
      }
    })();

    return () => {
      cancelled = true;
      clusterer?.clearMarkers();
    };
  }, [pins, accent, linkBase, linkTarget]);

  if (!pins.length) return null;

  if (error) {
    return (
      <div
        className={
          className ??
          "grid h-[420px] place-items-center rounded-2xl border border-neutral-200 bg-neutral-50"
        }
      >
        <p className="inline-flex items-center gap-2 text-sm text-neutral-400">
          <MapPin className="h-4 w-4" /> {error}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={
        className ?? "h-[420px] w-full overflow-hidden rounded-2xl bg-neutral-100 lg:h-[520px]"
      }
    />
  );
}

const escapeHtml = (s: string) =>
  s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&#39;", '"': "&quot;" })[c] ?? c,
  );

/** Teardrop in the brand colour. Inline SVG so there is no extra request. */
function pinIcon(accent: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">
    <path d="M17 1C8.7 1 2 7.7 2 16c0 10.5 13.2 25.2 13.8 25.8a1.7 1.7 0 0 0 2.4 0C18.8 41.2 32 26.5 32 16 32 7.7 25.3 1 17 1z"
      fill="${escapeHtml(accent)}" stroke="#ffffff" stroke-width="2.5"/>
    <circle cx="17" cy="16" r="5.5" fill="#ffffff"/>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(34, 44),
    anchor: new window.google.maps.Point(17, 44),
  };
}

/**
 * Info window markup. Google renders this as raw HTML, so every interpolated
 * value is escaped - these strings come from user-entered project data.
 */
function infoHtml(
  p: PortfolioShowcaseCard,
  accent: string,
  linkBase?: string,
  linkTarget?: "_blank",
): string {
  const location = [p.city, p.state].filter(Boolean).join(", ");
  const img = p.cover_image_url
    ? `<img src="${escapeHtml(p.cover_image_url)}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px" />`
    : "";
  const link = linkBase
    ? `<a href="${escapeHtml(`${linkBase}/${p.slug}`)}"${linkTarget ? ` target="${linkTarget}" rel="noreferrer"` : ""} style="display:inline-block;margin-top:8px;font:700 12px/1 system-ui,sans-serif;color:${escapeHtml(accent)};text-decoration:none">View project &rarr;</a>`
    : "";
  return `<div style="max-width:230px;font-family:system-ui,-apple-system,sans-serif">
    ${img}
    <div style="font:800 14px/1.3 system-ui,sans-serif;color:#171717">${escapeHtml(p.title)}</div>
    ${location ? `<div style="margin-top:2px;font:500 12px/1.4 system-ui,sans-serif;color:#737373">${escapeHtml(location)}</div>` : ""}
    ${link}
  </div>`;
}

/**
 * Desaturated basemap. The photos are the content; a full-colour Google basemap
 * competes with them and drags the whole page toward "dashboard".
 */
const MUTED_STYLE = [
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#e8eef2" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#f6f6f4" }] },
];
