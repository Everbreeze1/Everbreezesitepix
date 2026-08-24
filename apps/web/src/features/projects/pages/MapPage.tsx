import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Layers, Maximize2 } from "lucide-react";
import { MarkerClusterer, SuperClusterAlgorithm } from "@googlemaps/markerclusterer";
import { supabase } from "@/integrations/everlumen/client";
import { useAuth } from "@/hooks/use-auth";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { geocodeAddress } from "@/lib/geocode.functions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/PageLoader";
import { qk } from "@/lib/query-keys";
import { listProjectBoards } from "@/lib/project-boards.functions";

/*
 * The one status vocabulary this page speaks, in the order it says it.
 *
 * The filter row at the top and the legend over the map are two views of the
 * same four statuses, and they used to be two hand-written lists: the legend
 * learned about Archived, the filter row did not, and the page ended up
 * offering a colour it gave you no way to filter by. Both now read this, so
 * neither can drift from the other again. Adding a status here adds a chip, a
 * legend row and a pin colour together or not at all.
 */
const STATUSES = ["active", "on_hold", "completed", "archived"] as const;
type ProjectStatus = (typeof STATUSES)[number];
type StatusFilter = ProjectStatus | "all";

interface ProjectPin {
  id: string;
  name: string;
  status: string;
  /**
   * Where the job is in the team's own words. The three statuses below are the
   * roll-up of it - see packages/shared/src/pipeline-stages.ts - so this is
   * what a pin is labelled with when the project is in a pipeline, and the
   * bucket is what colours it, filters it and counts it.
   */
  pipeline_stage_id: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
}

/*
 * Archived is the fourth status a project can hold - see the archive action on
 * the project page - and archived jobs are plotted like any other under the All
 * filter. The map had no entry for it, so an archived pin fell through to the
 * same slate as Completed and the legend documented neither.
 *
 * The two greys are the pair STATUS_DOT already uses in features/projects/
 * constants, deliberately: a finished job and a filed one both read as "not
 * live work", so they share a family and differ by one step, and the map now
 * says it the same way the project page does. Going darker than slate-500 for
 * Archived was the first attempt and it failed in the dark theme - the legend
 * swatch came out at 1.75:1 against its own card, documenting a colour nobody
 * could see. Anything added here has to survive both themes.
 */
const statusColor: Record<string, string> = {
  active: "#16a34a",
  on_hold: "#eab308",
  completed: "#94a3b8",
  archived: "#64748b",
};

// Anything outside the four above is an unknown status; it borrows Completed's
// slate rather than inventing a fifth colour the legend cannot explain.
const FALLBACK_PIN_COLOR = "#94a3b8";

const statusLabel: Record<string, string> = {
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  archived: "Archived",
};

const statusBadgeStyle: Record<string, { bg: string; text: string }> = {
  active: { bg: "#ECFDF5", text: "#047857" },
  on_hold: { bg: "#FEFCE8", text: "#A16207" },
  completed: { bg: "#F1F5F9", text: "#475569" },
  archived: { bg: "#E2E8F0", text: "#334155" },
};

/*
 * That every status above has a colour, a word and a badge is enforced by
 * tests/map-status-vocabulary.test.ts, not by a check here. A guard at module
 * scope would only ever fire on a developer's own edit, and it would fire by
 * taking down the whole bundle rather than by mislabelling one pin - a worse
 * failure than the one it guards against, and one CI catches earlier anyway.
 */

const formatAddress = (p: ProjectPin) =>
  [p.street, [p.city, p.state].filter(Boolean).join(", "), p.zip].filter(Boolean).join(" ");

const hasAddress = (p: ProjectPin) =>
  Boolean((p.street && p.street.trim()) || (p.city && p.city.trim()) || (p.zip && p.zip.trim()));

const escapeXml = (s: string) =>
  s.replace(
    /[<>&'"]/g,
    (c) =>
      (
        ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }) as Record<
          string,
          string
        >
      )[c] ?? c,
  );

const PIN_W = 48;
const PIN_H = 60;
const PILL_H = 30;
const PILL_GAP = 6;

/*
 * How much of a pin gets drawn. Every pin used to bake its project name into
 * the icon, which reads fine right up until a cluster opens into a dozen
 * neighbouring jobs and the name pills overlap into mush. The name is now
 * painted only for the pin under the cursor and the pin whose preview card is
 * open; the rest stay bare teardrops.
 */
type PinState = "idle" | "hover" | "selected";

const truncateLabel = (label: string) => (label.length > 24 ? label.slice(0, 23) + "…" : label);

// rough character-width estimate at font-size 14, weight 600, plus padding
const labelPillWidth = (label: string) =>
  Math.max(48, Math.min(240, Math.round(truncateLabel(label).length * 8.4))) + 24;

const pinIconWidth = (label: string | null) =>
  label ? PIN_W + PILL_GAP + labelPillWidth(label) : PIN_W;

const pinSvg = (color: string, label: string | null, selected: boolean) => {
  const totalW = pinIconWidth(label);
  const totalH = PIN_H + 4;
  const ring = selected
    ? `<circle cx="24" cy="22" r="15.5" fill="none" stroke="#0ea5e9" stroke-width="3"/>`
    : "";
  let pill = "";
  if (label) {
    const text = escapeXml(truncateLabel(label));
    const pillW = labelPillWidth(label);
    const pillX = PIN_W + PILL_GAP;
    const pillY = (PIN_H - PILL_H) / 2;
    pill = `<rect x="${pillX}" y="${pillY}" rx="15" ry="15" width="${pillW}" height="${PILL_H}" fill="#ffffff" stroke="${selected ? "#0ea5e9" : color}" stroke-width="2"/>
        <text x="${pillX + pillW / 2}" y="${pillY + 20}" text-anchor="middle" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="14" font-weight="600" fill="#0f172a">${text}</text>`;
  }
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
      <defs>
        <filter id="s" x="-30%" y="-20%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity="0.4"/>
        </filter>
      </defs>
      <g filter="url(#s)">
        ${pill}
        <path d="M24 2 C13 2 4 11 4 22 c0 14 20 36 20 36 s20 -22 20 -36 C44 11 35 2 24 2 z" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>
        <circle cx="24" cy="22" r="7" fill="#ffffff"/>
        ${ring}
      </g>
    </svg>`,
  )}`;
};

// Repaints one marker for the state it is in. Module-level so both the effect
// that builds the marker layer and the one that follows the selection can call
// it without threading a callback between them.
const paintMarker = (marker: any, p: ProjectPin, state: PinState) => {
  const label = state === "idle" ? null : p.name;
  marker.setIcon({
    url: pinSvg(statusColor[p.status] ?? FALLBACK_PIN_COLOR, label, state === "selected"),
    scaledSize: new window.google.maps.Size(pinIconWidth(label), PIN_H + 4),
    anchor: new window.google.maps.Point(PIN_W / 2, PIN_H),
  });
  marker.setZIndex(state === "idle" ? 10 : state === "hover" ? 40 : 60);
};

/*
 * Past this zoom SuperCluster hands every point back on its own, so a cluster
 * click that lands beyond it is guaranteed to break into individual pins. That
 * is what stops a tight knot of neighbouring jobs from needing two or three
 * clicks to open.
 */
const CLUSTER_MAX_ZOOM = 15;

// The zoom at which `bounds` fits inside the map's viewport, less padding.
const zoomForBounds = (map: any, bounds: any, padding = 64) => {
  const div = map.getDiv() as HTMLElement | null;
  const width = Math.max(64, (div?.clientWidth ?? 800) - padding * 2);
  const height = Math.max(64, (div?.clientHeight ?? 600) - padding * 2);
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const latRad = (lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return Math.log((1 + s) / (1 - s)) / 2;
  };
  const latFraction = Math.abs(latRad(ne.lat()) - latRad(sw.lat())) / (2 * Math.PI);
  let lngSpan = ne.lng() - sw.lng();
  if (lngSpan < 0) lngSpan += 360;
  const zoomFor = (px: number, fraction: number) =>
    fraction <= 0 ? 21 : Math.log2(px / 256 / fraction);
  return Math.min(
    21,
    Math.floor(Math.min(zoomFor(height, latFraction), zoomFor(width, lngSpan / 360))),
  );
};

/*
 * Where the map was left, deliberately kept outside the component. Opening a
 * project unmounts MapPage, so the browser's back button used to rebuild it at
 * the default country-wide zoom and throw away whichever cluster had been
 * drilled into. The module-level copy covers that back trip; the sessionStorage
 * copy covers a reload.
 */
interface MapView {
  center: { lat: number; lng: number };
  zoom: number;
  filter: StatusFilter;
}

const VIEW_STORAGE_KEY = "everlumen:map-view";
let lastMapView: MapView | null = null;

const readMapView = (): MapView | null => {
  if (lastMapView) return lastMapView;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MapView;
    if (typeof parsed?.zoom !== "number" || typeof parsed?.center?.lat !== "number") return null;
    lastMapView = parsed;
    return parsed;
  } catch {
    return null;
  }
};

const writeMapView = (view: MapView) => {
  lastMapView = view;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // Private mode, or a full quota: the module-level copy still covers back.
  }
};

interface ProjectStats {
  photoCount: number;
  lastActivity: string | null;
  /** Object path of the newest photo, signed in one batch below. */
  thumbPath: string | null;
  thumbUrl: string | null;
}

export function MapPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const geocode = geocodeAddress;

  /*
   * The map used to speak only in Active / On hold / Completed, which is how a
   * job could read "Invoiced" on its own page and "Active" here. The stage now
   * owns the bucket, so the two can no longer disagree - and where a team has
   * named the step themselves, the map says their word for it rather than the
   * roll-up of it. The pin colours, the filter and the counts stay on the three
   * buckets: that is what makes one legend cover every pipeline a team invents.
   */
  const boardsQuery = useQuery({
    queryKey: qk.projectBoards(user?.id ?? ""),
    queryFn: async () => (await listProjectBoards()).boards,
    enabled: !!user,
    staleTime: 60_000,
  });
  const stageLookup = useMemo(() => {
    const out: Record<string, { name: string; color: string }> = {};
    for (const b of boardsQuery.data ?? []) {
      for (const s of b.stages) out[s.id] = { name: s.name, color: s.color };
    }
    return out;
  }, [boardsQuery.data]);
  /*
   * Archiving a project leaves its pipeline_stage_id alone, so an archived job
   * is still standing in whatever stage it was in when it was filed. Showing
   * that stage would put a live-looking "Scheduled" chip next to an archived
   * pin, which is the contradiction the legend then has to explain away. The
   * project page already resolves it this way - see ProjectStatusChip, where an
   * archived project keeps its own status rather than the stage's.
   */
  const stageOf = (p: ProjectPin) =>
    (p.status !== "archived" && p.pipeline_stage_id ? stageLookup[p.pipeline_stage_id] : null) ??
    null;
  const [projects, setProjects] = useState<ProjectPin[]>([]);
  const [stats, setStats] = useState<Record<string, ProjectStats>>({});
  // The filter is part of "where I was", so a return trip restores it with the
  // rest of the view rather than snapping back to Active.
  const [filter, setFilter] = useState<StatusFilter>(() => readMapView()?.filter ?? "active");
  const [selected, setSelected] = useState<ProjectPin | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [geocoding, setGeocoding] = useState(0);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const clusterer = useRef<MarkerClusterer | null>(null);
  const infoWindow = useRef<any>(null);
  const markersById = useRef<Record<string, any>>({});
  const statsRef = useRef<Record<string, ProjectStats>>({});
  // Marker listeners are attached once when the layer is built, so anything
  // they need to read at click time lives in a ref rather than in that closure.
  const selectedIdRef = useRef<string | null>(null);
  // Whether a card is on screen, as opposed to a row merely being selected.
  const previewOpenRef = useRef(false);
  const filterRef = useRef<StatusFilter>(filter);
  // Which filter the map has already framed. Null until the first fit.
  const fittedFilter = useRef<StatusFilter | null>(null);
  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const saveCurrentView = useCallback(() => {
    const map = mapInstance.current;
    const center = map?.getCenter?.();
    const zoom = map?.getZoom?.();
    if (!center || typeof zoom !== "number") return;
    writeMapView({
      center: { lat: center.lat(), lng: center.lng() },
      zoom,
      filter: filterRef.current,
    });
  }, []);

  /*
   * The preview card. Clicking a pin used to navigate straight to the project,
   * which made checking a handful of nearby jobs a series of round trips. The
   * card answers "which job is this" on the map itself, and keeps the trip to
   * the full page as one deliberate button.
   *
   * Built as a real DOM node rather than an HTML string so the button can carry
   * a router navigation instead of a global callback hung off `window`.
   */
  const buildPreviewCard = useCallback(
    (p: ProjectPin) => {
      const st = statsRef.current[p.id];
      // Same rule as stageOf, inlined so this callback depends on the lookup
      // rather than on a function rebuilt every render.
      const stage =
        (p.status !== "archived" && p.pipeline_stage_id
          ? stageLookup[p.pipeline_stage_id]
          : null) ?? null;
      const name = escapeXml(p.name);
      const addr = escapeXml(formatAddress(p) || "No address on file");
      const badgeText = escapeXml(stage?.name ?? statusLabel[p.status] ?? p.status);
      const badgeColor = escapeXml(stage?.color ?? statusColor[p.status] ?? FALLBACK_PIN_COLOR);
      const photoCount = st?.photoCount ?? 0;
      const activity = st?.lastActivity
        ? `Last activity ${new Date(st.lastActivity).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}`
        : "No activity yet";
      const thumbSrc = st?.thumbUrl
        ? encodeURI(st.thumbUrl).replace(/'/g, "%27").replace(/"/g, "%22")
        : null;
      const thumb = thumbSrc
        ? `<div style="width:100%;height:132px;border-radius:10px;margin-bottom:10px;background:#e2e8f0 center/cover no-repeat url('${thumbSrc}');"></div>`
        : `<div style="width:100%;height:132px;border-radius:10px;margin-bottom:10px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;font-weight:600;">No photos yet</div>`;

      const el = document.createElement("div");
      // The API's own bubble pads the left edge only, so the card carries the
      // other three itself. Without them the button hangs off the white.
      el.innerHTML = `<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;width:258px;padding:0 12px 12px 0;color:#0f172a;">
        ${thumb}
        <div style="font-size:15px;font-weight:700;line-height:1.25;">${name}</div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0 8px;">
          <span style="padding:2px 9px;border-radius:999px;background:${badgeColor};color:#ffffff;font-size:10px;font-weight:700;">${badgeText}</span>
          <span style="font-size:11px;color:#475569;">${photoCount} photo${photoCount === 1 ? "" : "s"}</span>
        </div>
        <div style="display:flex;gap:6px;font-size:12px;line-height:1.35;color:#475569;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;margin-top:1px;"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>${addr}</span>
        </div>
        <div style="font-size:11px;color:#64748b;margin-top:6px;">${activity}</div>
        <button type="button" data-open-project style="margin-top:12px;width:100%;border:0;border-radius:9px;background:#0f172a;color:#ffffff;font-size:13px;font-weight:700;padding:9px 12px;cursor:pointer;">View project</button>
      </div>`;
      el.querySelector("[data-open-project]")?.addEventListener("click", () => {
        // Stamp the view before leaving, so back lands on this framing even if
        // the map never went idle after the last pan.
        saveCurrentView();
        navigate({ to: "/projects/$projectId", params: { projectId: p.id }, search: {} as any });
      });
      return el;
    },
    [navigate, saveCurrentView, stageLookup],
  );

  const openPreview = useCallback(
    (p: ProjectPin) => {
      const map = mapInstance.current;
      if (!map || !infoWindow.current || !window.google?.maps) return;
      selectedIdRef.current = p.id;
      previewOpenRef.current = true;
      setSelected(p);
      infoWindow.current.setContent(buildPreviewCard(p));
      const marker = markersById.current[p.id];
      if (marker?.getMap?.()) {
        infoWindow.current.setOptions({ pixelOffset: new window.google.maps.Size(0, 0) });
        infoWindow.current.open({ anchor: marker, map });
      } else if (p.latitude != null && p.longitude != null) {
        // Still folded into a cluster: open on the coordinates instead, so the
        // card appears on the first click rather than after the cluster opens.
        infoWindow.current.setOptions({ pixelOffset: new window.google.maps.Size(0, -PIN_H) });
        infoWindow.current.setPosition({ lat: Number(p.latitude), lng: Number(p.longitude) });
        infoWindow.current.open({ map });
      }
    },
    [buildPreviewCard],
  );

  const closePreview = useCallback(() => {
    infoWindow.current?.close();
    selectedIdRef.current = null;
    previewOpenRef.current = false;
    setSelected(null);
  }, []);

  const load = useCallback(async () => {
    // `as any`, like every other read of this column: the generated Supabase
    // types predate 20260917000000_pipeline_stages.sql and do not know
    // `pipeline_stage_id` exists.
    const { data } = await (supabase as any)
      .from("projects")
      .select("id, name, status, pipeline_stage_id, street, city, state, zip, latitude, longitude");
    const all = ((data as ProjectPin[]) ?? []).filter(hasAddress);

    /*
     * Per-project stats, WITHOUT downloading the tenant's photo table.
     *
     * This used to be a single unbounded `select("project_id, image_url,
     * created_at, archived")` over every non-archived photo, on every visit to
     * the map, purely to derive three numbers per project. On a real contractor
     * account - thousands of photos - that is megabytes of JSON transferred and
     * parsed to render a handful of pins.
     *
     * Two bounded queries per project instead: the first returns the exact count
     * in the Content-Range header plus the newest row (for last activity), the
     * second the newest row that actually has a thumbnail. Both transfer at most
     * one row, so the payload is now O(projects) rather than O(photos) - and
     * projects are what the map is already bounded by.
     *
     * A single GROUP BY would be better still, but PostgREST cannot aggregate
     * without a database view, and that needs a migration.
     */
    const agg: Record<string, ProjectStats> = {};
    await Promise.all(
      all.map(async (p) => {
        const [latest, thumb] = await Promise.all([
          supabase
            .from("photos")
            .select("created_at", { count: "exact" })
            .eq("project_id", p.id)
            .eq("archived", false)
            .order("created_at", { ascending: false })
            .limit(1),
          supabase
            .from("photos")
            .select("thumb_path, storage_path, image_url")
            .eq("project_id", p.id)
            .eq("archived", false)
            .order("created_at", { ascending: false })
            .limit(1),
        ]);
        const newest = (
          thumb.data as Array<{
            thumb_path: string | null;
            storage_path: string | null;
            image_url: string | null;
          }> | null
        )?.[0];
        agg[p.id] = {
          photoCount: latest.count ?? 0,
          lastActivity:
            (latest.data as Array<{ created_at: string }> | null)?.[0]?.created_at ?? null,
          // Prefer the stored thumbnail: the card paints it 258px wide, so the
          // camera original would be a megabyte spent on a preview.
          thumbPath: newest?.thumb_path ?? newest?.storage_path ?? null,
          thumbUrl: newest?.image_url ?? null,
        };
      }),
    );

    /*
     * Photos live in a private bucket, so `image_url` is null for everything
     * uploaded since signing came in - which is why the preview card used to
     * say "no photos yet" next to a project with photos. Sign the newest
     * photo per project, all of them in one request, the way the gallery does.
     */
    const toSign = Object.values(agg)
      .map((s) => s.thumbPath)
      .filter((path): path is string => Boolean(path));
    if (toSign.length > 0) {
      const { data: signed } = await supabase.storage
        .from("site-photos")
        .createSignedUrls(toSign, 3600);
      const byPath: Record<string, string> = {};
      signed?.forEach((s, i) => {
        if (s.signedUrl) byPath[toSign[i]] = s.signedUrl;
      });
      for (const s of Object.values(agg)) {
        if (s.thumbPath && byPath[s.thumbPath]) s.thumbUrl = byPath[s.thumbPath];
      }
    }

    const missing = all.filter((p) => p.latitude == null || p.longitude == null);
    let resolved = all;
    if (missing.length > 0) {
      setGeocoding(missing.length);
      // Geocode + persist each missing project independently and in parallel -
      // these are separate rows with no shared state, so there's no need to
      // pay one round-trip's latency at a time.
      const geocoded = await Promise.all(
        missing.map(async (p) => {
          try {
            const addr = formatAddress(p);
            if (!addr) return p;
            const { latitude, longitude } = await geocode({ data: { address: addr } });
            if (latitude != null && longitude != null) {
              await supabase.from("projects").update({ latitude, longitude }).eq("id", p.id);
              return { ...p, latitude, longitude };
            }
            return p;
          } catch (e) {
            console.warn("Geocode failed for project", p.id, e);
            return p;
          } finally {
            setGeocoding((n) => Math.max(0, n - 1));
          }
        }),
      );
      resolved = all.map((p) => geocoded.find((g) => g.id === p.id) ?? p);
    }

    return { projects: resolved, stats: agg };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geocode]);

  const query = useQuery({
    queryKey: qk.mapProjects(user?.id ?? ""),
    queryFn: load,
    enabled: !!user,
    staleTime: 60_000,
  });

  // Local useState mirrors query.data so a cache-hit remount (queryFn skipped,
  // data served straight from cache) still repopulates the map/list - a plain
  // useState reset on mount would otherwise leave these empty until the next
  // refetch.
  useEffect(() => {
    if (query.data) {
      setProjects(query.data.projects);
      setStats(query.data.stats);
    }
  }, [query.data]);

  const loading = query.isPending;

  const visible = useMemo(
    () => (filter === "all" ? projects : projects.filter((p) => p.status === filter)),
    [projects, filter],
  );

  const mappable = useMemo(
    () => visible.filter((p) => p.latitude != null && p.longitude != null),
    [visible],
  );

  // Init map once container is mounted. Depends on projects.length too, not
  // just loading: query.isPending flips false a render before the local
  // `projects` state (copied from query.data in a separate effect) updates,
  // so the map div may not exist in the DOM yet the first time this runs.
  useEffect(() => {
    if (loading) return;
    if (!mapRef.current || mapInstance.current) return;
    loadGoogleMaps()
      .then(() => {
        if (!mapRef.current || mapInstance.current) return;
        const restored = readMapView();
        mapInstance.current = new window.google.maps.Map(mapRef.current, {
          center: restored?.center ?? { lat: 39.5, lng: -98.35 },
          zoom: restored?.zoom ?? 4,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
          backgroundColor: "#0b1220",
          styles: [
            { elementType: "geometry", stylers: [{ color: "#0f172a" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
            {
              featureType: "administrative",
              elementType: "geometry.stroke",
              stylers: [{ color: "#334155" }],
            },
            { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
            {
              featureType: "road",
              elementType: "geometry.stroke",
              stylers: [{ color: "#0f172a" }],
            },
            {
              featureType: "road",
              elementType: "labels.text.fill",
              stylers: [{ color: "#cbd5e1" }],
            },
            {
              featureType: "road.highway",
              elementType: "geometry",
              stylers: [{ color: "#334155" }],
            },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#0c1a2e" }] },
            {
              featureType: "water",
              elementType: "labels.text.fill",
              stylers: [{ color: "#475569" }],
            },
            {
              featureType: "landscape.natural",
              elementType: "geometry",
              stylers: [{ color: "#0f1b2d" }],
            },
          ],
        });
        // A restored view is the user's own framing. Marking it as already
        // fitted is what keeps the marker layer from re-fitting to every pin
        // the moment the markers land, which is what used to undo the drill-in.
        if (restored) fittedFilter.current = restored.filter;

        infoWindow.current = new window.google.maps.InfoWindow({ maxWidth: 300 });
        infoWindow.current.addListener("closeclick", () => {
          selectedIdRef.current = null;
          previewOpenRef.current = false;
          setSelected(null);
        });
        mapInstance.current.addListener("idle", () => saveCurrentView());
        mapInstance.current.addListener("click", () => closePreview());
        setMapReady(true);
      })
      .catch((e) => setMapError(e.message ?? "Failed to load map"));
  }, [loading, projects.length, saveCurrentView, closePreview]);

  const fitToAll = useCallback(() => {
    if (!mapInstance.current || !window.google?.maps || mappable.length === 0) return;
    const bounds = new window.google.maps.LatLngBounds();
    mappable.forEach((p) => bounds.extend({ lat: Number(p.latitude), lng: Number(p.longitude) }));
    if (mappable.length === 1) {
      mapInstance.current.setCenter(bounds.getCenter());
      mapInstance.current.setZoom(14);
    } else {
      mapInstance.current.fitBounds(bounds, { top: 80, right: 80, bottom: 80, left: 80 });
    }
  }, [mappable]);

  // Update markers whenever mappable changes OR map becomes ready
  useEffect(() => {
    if (!mapReady || !mapInstance.current || !window.google?.maps) return;
    if (clusterer.current) {
      clusterer.current.clearMarkers();
      clusterer.current = null;
    }
    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];
    markersById.current = {};
    if (mappable.length === 0) return;

    const bounds = new window.google.maps.LatLngBounds();
    mappable.forEach((p) => {
      const pos = { lat: Number(p.latitude), lng: Number(p.longitude) };
      const marker = new window.google.maps.Marker({
        position: pos,
        title: p.name,
        // Lifts the preview card to the top of the pin instead of over its tip.
        anchorPoint: new window.google.maps.Point(0, -PIN_H),
        optimized: false,
        zIndex: 10,
      });
      paintMarker(marker, p, selectedIdRef.current === p.id ? "selected" : "idle");
      marker.addListener("mouseover", () => {
        if (selectedIdRef.current !== p.id) paintMarker(marker, p, "hover");
      });
      marker.addListener("mouseout", () => {
        if (selectedIdRef.current !== p.id) paintMarker(marker, p, "idle");
      });
      marker.addListener("click", () => openPreview(p));
      markers.current.push(marker);
      markersById.current[p.id] = marker;
      bounds.extend(pos);
    });

    clusterer.current = new MarkerClusterer({
      map: mapInstance.current,
      markers: markers.current,
      algorithm: new SuperClusterAlgorithm({ maxZoom: CLUSTER_MAX_ZOOM, radius: 70 }),
      /*
       * The stock handler is `fitBounds(cluster.bounds)`, which for a tight
       * knot of neighbouring jobs barely moves the zoom - hence clusters that
       * took two or three clicks to open. Going in at least one level, and
       * never stopping short of the zoom where clustering switches off, makes
       * one click enough.
       */
      onClusterClick: (_event, cluster, map) => {
        const b = cluster.bounds;
        const current = map.getZoom() ?? 0;
        if (cluster.position) map.setCenter(cluster.position);
        else if (b) map.setCenter(b.getCenter());
        const fitted = b ? zoomForBounds(map, b) : current + 2;
        map.setZoom(Math.max(current + 1, Math.min(fitted, CLUSTER_MAX_ZOOM + 1)));
      },
    });

    /*
     * Rebuilding the layer pulls the old markers off the map, and Google closes
     * an InfoWindow whose anchor disappears. This effect runs on every refetch
     * of the project list - a window focus is enough - so without this the card
     * someone was reading would just shut itself. Re-open it on the new marker.
     */
    const openId = previewOpenRef.current ? selectedIdRef.current : null;
    if (openId) {
      const still = mappable.find((p) => p.id === openId);
      if (still) openPreview(still);
      else previewOpenRef.current = false;
    }

    // Framing is deliberately NOT part of this effect's job any more: it runs
    // again on every stats refresh and geocode, and re-fitting each time is
    // what yanked the map back out of whatever cluster was open. See the
    // fit-on-filter-change effect below.
  }, [mappable, mapReady, openPreview]);

  // Frame the pins when the filter changes what "all of them" means, and on a
  // first visit with no saved view. Never otherwise.
  useEffect(() => {
    if (!mapReady || !mapInstance.current || !window.google?.maps) return;
    if (mappable.length === 0) return;
    if (fittedFilter.current === filter) return;
    fittedFilter.current = filter;
    const bounds = new window.google.maps.LatLngBounds();
    mappable.forEach((p) => bounds.extend({ lat: Number(p.latitude), lng: Number(p.longitude) }));
    if (mappable.length === 1) {
      mapInstance.current.setCenter(bounds.getCenter());
      mapInstance.current.setZoom(14);
    } else {
      mapInstance.current.fitBounds(bounds, { top: 100, right: 100, bottom: 100, left: 100 });
    }
  }, [mappable, mapReady, filter]);

  // Keep the labelled pin in step with the selection, wherever it came from:
  // the pin itself, the sidebar list, or the card being dismissed.
  useEffect(() => {
    if (!mapReady || !window.google?.maps) return;
    selectedIdRef.current = selected?.id ?? null;
    for (const p of mappable) {
      const marker = markersById.current[p.id];
      if (marker) paintMarker(marker, p, selected?.id === p.id ? "selected" : "idle");
    }
  }, [selected, mappable, mapReady]);

  if (loading) return <PageLoader />;

  const pendingGeocodes = visible.filter((p) => p.latitude == null || p.longitude == null);
  // One count per chip, off the same list the chips are built from. All means
  // all: a job that is filed away is still one of the projects on this map.
  const counts = STATUSES.reduce(
    (acc, s) => {
      acc[s] = projects.filter((p) => p.status === s).length;
      return acc;
    },
    { all: projects.length } as Record<StatusFilter, number>,
  );
  /*
   * A list row is a preview too: it flies to the pin and opens the same card,
   * rather than navigating away. Going past CLUSTER_MAX_ZOOM guarantees the pin
   * is out of its cluster, so the card lands on the job itself and not on the
   * cluster bubble that was covering it.
   */
  const focusProject = (p: ProjectPin) => {
    const map = mapInstance.current;
    if (!map || p.latitude == null || p.longitude == null) {
      setSelected(p);
      return;
    }
    map.panTo({ lat: Number(p.latitude), lng: Number(p.longitude) });
    if ((map.getZoom() ?? 0) <= CLUSTER_MAX_ZOOM) map.setZoom(CLUSTER_MAX_ZOOM + 1);
    openPreview(p);
    // The clusterer only releases the marker on the next idle, so re-anchor the
    // card to it once it is actually on the map.
    if (window.google?.maps) {
      window.google.maps.event.addListenerOnce(map, "idle", () => {
        const marker = markersById.current[p.id];
        if (selectedIdRef.current !== p.id || !marker?.getMap?.()) return;
        infoWindow.current?.setOptions({ pixelOffset: new window.google.maps.Size(0, 0) });
        infoWindow.current?.open({ anchor: marker, map });
      });
    }
  };

  return (
    <div className="min-h-full bg-background px-6 pb-24 pt-6 sm:px-10 sm:pt-10">
      <PageHeader
        eyebrow="Field overview"
        title="Project map"
        description={
          <>
            Every project with an address, plotted at a glance.
            {geocoding > 0 ? ` Locating ${geocoding}…` : ""}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-1 rounded-xl border-[0.8px] border-border bg-card/65 p-1 shadow-sm">
            {/*
              One chip per status the legend documents, then All. The dot is the
              pin colour, so the row that filters the map and the panel that
              explains it are saying the same thing in the same colours.
            */}
            {[...STATUSES, "all" as const].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`font-manrope flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
                  filter === key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {key !== "all" && (
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full ring-1 ring-card"
                    style={{ background: statusColor[key] }}
                  />
                )}
                {key === "all" ? "All" : statusLabel[key]}{" "}
                <span className="text-xs">{counts[key]}</span>
              </button>
            ))}
          </div>
        }
      />

      {projects.length === 0 ? (
        <div className="mt-8 rounded-3xl border-[0.8px] border-border bg-card/80 p-8">
          <EmptyState
            icon={MapPin}
            title="No projects with addresses"
            description="Add an address to a project to see it on the map."
            action={
              <Button asChild className="rounded-lg bg-primary hover:bg-primary/90">
                <Link to="/projects">Go to Projects</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="relative overflow-hidden rounded-[14px] border-[0.8px] border-border bg-card shadow-[0_25px_50px_-12px_rgba(0,89,156,0.05)]">
            {mapError ? (
              <div className="flex h-[420px] items-center justify-center p-6 text-sm text-muted-foreground">
                {mapError}
              </div>
            ) : (
              <>
                <div ref={mapRef} className="h-[70vh] min-h-[480px] w-full" />
                {/* Legend overlay */}
                <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-1 rounded-2xl border-[0.8px] border-border bg-card/85 px-3 py-2 text-xs shadow-lg backdrop-blur-md">
                  <div className="font-manrope mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Layers className="h-3 w-3" /> Legend
                  </div>
                  {/*
                    The same four, in the same order, as the chips above: every
                    colour the map can paint has a word here and a way to filter
                    by it up there. Archived kept its row conditionally for a
                    while, which put the legend back out of step with a filter
                    row that always shows its chip.
                  */}
                  {STATUSES.map((s) => (
                    <div key={s} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full ring-2 ring-card"
                        style={{ background: statusColor[s] }}
                      />
                      <span className="text-foreground/80">{statusLabel[s]}</span>
                    </div>
                  ))}
                  {/*
                    Said out loud, because a pin labelled "Invoiced" sitting on
                    a Completed colour is only confusing while you think they
                    are two competing statuses. They are one: the stage is the
                    detail, the bucket is what it counts as. Archived is outside
                    that sentence on purpose - a filed job keeps its own status
                    whatever stage it was filed from.
                  */}
                  {Object.keys(stageLookup).length > 0 && (
                    <p className="mt-1 max-w-[190px] border-t border-border pt-1.5 text-[10px] leading-snug text-muted-foreground">
                      Pipeline stages roll up into Active, On hold and Completed.
                    </p>
                  )}
                </div>
                {/* Count chip */}
                <div className="font-manrope pointer-events-none absolute right-4 top-4 rounded-full border-[0.8px] border-border bg-card/85 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur-md">
                  {mappable.length} on map
                  {pendingGeocodes.length > 0 && (
                    <span className="ml-1.5 text-muted-foreground">
                      · {pendingGeocodes.length} locating
                    </span>
                  )}
                </div>
                {/* Fit to all button */}
                {mappable.length > 1 && (
                  <Button
                    size="sm"
                    onClick={fitToAll}
                    className="font-manrope absolute bottom-4 right-4 h-8 gap-1.5 rounded-lg border-[0.8px] border-border bg-card/90 text-foreground shadow-lg hover:bg-card"
                  >
                    <Maximize2 className="h-3.5 w-3.5" /> Fit to all
                  </Button>
                )}
              </>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-manrope text-xs font-extrabold uppercase tracking-[1.8px] text-primary">
                {visible.length} project{visible.length === 1 ? "" : "s"}
              </p>
              {pendingGeocodes.length > 0 && (
                <p className="text-[11px] font-bold text-amber-600">
                  {pendingGeocodes.length} locating…
                </p>
              )}
            </div>
            <div className="max-h-[70vh] space-y-2.5 overflow-y-auto pr-1">
              {visible.map((p) => {
                const hasCoords = p.latitude != null && p.longitude != null;
                const isSelected = selected?.id === p.id;
                const badge = statusBadgeStyle[p.status] ?? statusBadgeStyle.completed;
                // The team's word for where the job is, where they have one.
                const stage = stageOf(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => focusProject(p)}
                    className={`w-full rounded-2xl border-[0.8px] bg-card/82 p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 ${
                      isSelected ? "border-primary/60 ring-2 ring-ring/20" : "border-border"
                    } ${!hasCoords ? "opacity-70" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-manrope truncate text-base font-extrabold text-foreground">
                        {p.name}
                      </p>
                      <span
                        className="font-manrope shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold"
                        style={
                          stage
                            ? { background: stage.color, color: "#ffffff" }
                            : { background: badge.bg, color: badge.text }
                        }
                        title={
                          stage
                            ? `${stage.name}, which counts as ${statusLabel[p.status] ?? p.status}`
                            : undefined
                        }
                      >
                        {stage ? stage.name : (statusLabel[p.status] ?? p.status.replace("_", " "))}
                      </span>
                    </div>
                    <div className="font-manrope mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate">{formatAddress(p) || "-"}</span>
                    </div>
                    {!hasCoords && (
                      <p className="mt-1.5 text-[11px] font-bold text-amber-600">Locating…</p>
                    )}
                    {isSelected && (
                      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                        <Button
                          asChild
                          size="sm"
                          className="font-manrope w-full rounded-lg bg-foreground text-background hover:bg-foreground/90"
                        >
                          <Link
                            to="/projects/$projectId"
                            params={{ projectId: p.id }}
                            search={{} as any}
                            onClick={saveCurrentView}
                          >
                            Open project
                          </Link>
                        </Button>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
