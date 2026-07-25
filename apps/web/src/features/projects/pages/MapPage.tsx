import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Layers, Maximize2 } from "lucide-react";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { geocodeAddress } from "@/lib/geocode.functions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/PageLoader";

type StatusFilter = "active" | "all" | "on_hold" | "completed";

interface ProjectPin {
  id: string;
  name: string;
  status: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
}

const statusColor: Record<string, string> = {
  active: "#16a34a",
  on_hold: "#eab308",
  completed: "#64748b",
};

const statusLabel: Record<string, string> = {
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
};

const statusBadgeStyle: Record<string, { bg: string; text: string }> = {
  active: { bg: "#ECFDF5", text: "#047857" },
  on_hold: { bg: "#FEFCE8", text: "#A16207" },
  completed: { bg: "#F1F5F9", text: "#475569" },
};

const formatAddress = (p: ProjectPin) =>
  [p.street, [p.city, p.state].filter(Boolean).join(", "), p.zip].filter(Boolean).join(" ");

const hasAddress = (p: ProjectPin) =>
  Boolean((p.street && p.street.trim()) || (p.city && p.city.trim()) || (p.zip && p.zip.trim()));

// Larger teardrop pin with an always-visible label pill that bakes in the project name.
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

const pinWithLabelSvg = (color: string, label: string) => {
  const raw = label.length > 24 ? label.slice(0, 23) + "…" : label;
  const text = escapeXml(raw);
  // rough character-width estimate at font-size 14, weight 600
  const textWidth = Math.max(48, Math.min(240, Math.round(raw.length * 8.4)));
  const pillW = textWidth + 24;
  const totalW = PIN_W + PILL_GAP + pillW;
  const totalH = PIN_H + 4;
  const pillX = PIN_W + PILL_GAP;
  const pillY = (PIN_H - PILL_H) / 2;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
      <defs>
        <filter id="s" x="-30%" y="-20%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity="0.4"/>
        </filter>
      </defs>
      <g filter="url(#s)">
        <rect x="${pillX}" y="${pillY}" rx="15" ry="15" width="${pillW}" height="${PILL_H}" fill="#ffffff" stroke="${color}" stroke-width="2"/>
        <text x="${pillX + pillW / 2}" y="${pillY + 20}" text-anchor="middle" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="14" font-weight="600" fill="#0f172a">${text}</text>
        <path d="M24 2 C13 2 4 11 4 22 c0 14 20 36 20 36 s20 -22 20 -36 C44 11 35 2 24 2 z" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>
        <circle cx="24" cy="22" r="7" fill="#ffffff"/>
      </g>
    </svg>`,
  )}`;
};

// Approximate width so we can return a properly-sized icon to Google Maps.
const pinTotalWidth = (label: string) => {
  const len = Math.min(24, label.length);
  const textWidth = Math.max(48, Math.min(240, Math.round(len * 8.4)));
  return PIN_W + PILL_GAP + textWidth + 24;
};

interface ProjectStats {
  photoCount: number;
  lastActivity: string | null;
  thumbUrl: string | null;
}

export function MapPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const geocode = geocodeAddress;
  const [projects, setProjects] = useState<ProjectPin[]>([]);
  const [stats, setStats] = useState<Record<string, ProjectStats>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [selected, setSelected] = useState<ProjectPin | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [geocoding, setGeocoding] = useState(0);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const clusterer = useRef<MarkerClusterer | null>(null);
  const infoWindow = useRef<any>(null);
  const hoverWindow = useRef<any>(null);
  const statsRef = useRef<Record<string, ProjectStats>>({});
  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("projects")
        .select("id, name, status, street, city, state, zip, latitude, longitude");
      if (cancelled) return;
      const all = ((data as ProjectPin[]) ?? []).filter(hasAddress);
      setProjects(all);
      setLoading(false);

      // Load per-project stats (photo count, latest activity, first thumbnail)
      void (async () => {
        const { data: photoRows } = await supabase
          .from("photos")
          .select("project_id, image_url, created_at, archived")
          .eq("archived", false)
          .order("created_at", { ascending: false });
        if (cancelled || !photoRows) return;
        const agg: Record<string, ProjectStats> = {};
        for (const row of photoRows as Array<{
          project_id: string;
          image_url: string | null;
          created_at: string;
        }>) {
          const cur = agg[row.project_id] ?? { photoCount: 0, lastActivity: null, thumbUrl: null };
          cur.photoCount += 1;
          if (!cur.lastActivity || row.created_at > cur.lastActivity)
            cur.lastActivity = row.created_at;
          if (!cur.thumbUrl && row.image_url) cur.thumbUrl = row.image_url;
          agg[row.project_id] = cur;
        }
        if (!cancelled) setStats(agg);
      })();

      const missing = all.filter((p) => p.latitude == null || p.longitude == null);
      if (missing.length === 0) return;
      setGeocoding(missing.length);
      // Geocode + persist each missing project independently and in parallel —
      // these are separate rows with no shared state, so there's no need to
      // pay one round-trip's latency at a time.
      await Promise.all(
        missing.map(async (p) => {
          try {
            const addr = formatAddress(p);
            if (!addr) return;
            const { latitude, longitude } = await geocode({ data: { address: addr } });
            if (latitude != null && longitude != null) {
              await supabase.from("projects").update({ latitude, longitude }).eq("id", p.id);
              if (!cancelled) {
                setProjects((prev) =>
                  prev.map((x) => (x.id === p.id ? { ...x, latitude, longitude } : x)),
                );
              }
            }
          } catch (e) {
            console.warn("Geocode failed for project", p.id, e);
          } finally {
            if (!cancelled) setGeocoding((n) => Math.max(0, n - 1));
          }
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user, geocode]);

  const visible = useMemo(
    () => (filter === "all" ? projects : projects.filter((p) => p.status === filter)),
    [projects, filter],
  );

  const mappable = useMemo(
    () => visible.filter((p) => p.latitude != null && p.longitude != null),
    [visible],
  );

  // Init map once container is mounted
  useEffect(() => {
    if (loading) return;
    if (!mapRef.current || mapInstance.current) return;
    loadGoogleMaps()
      .then(() => {
        if (!mapRef.current || mapInstance.current) return;
        mapInstance.current = new window.google.maps.Map(mapRef.current, {
          center: { lat: 39.5, lng: -98.35 },
          zoom: 4,
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
        infoWindow.current = new window.google.maps.InfoWindow();
        hoverWindow.current = new window.google.maps.InfoWindow({ disableAutoPan: true });
        setMapReady(true);
      })
      .catch((e) => setMapError(e.message ?? "Failed to load map"));
  }, [loading]);

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

  const buildHoverHtml = (p: ProjectPin, color: string) => {
    const st = statsRef.current[p.id];
    const addr = escapeXml(formatAddress(p) || "");
    const name = escapeXml(p.name);
    const thumb = st?.thumbUrl
      ? `<div style="width:100%;height:96px;background:#e2e8f0 center/cover no-repeat url('${st.thumbUrl.replace(/'/g, "%27")}');border-radius:8px;margin-bottom:8px;"></div>`
      : "";
    const activity = st?.lastActivity
      ? `Last activity ${new Date(st.lastActivity).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
      : "No activity yet";
    const photoCount = st?.photoCount ?? 0;
    return `<div style="font-family:ui-sans-serif,system-ui;min-width:220px;max-width:260px;color:#0f172a;">
      ${thumb}
      <div style="font-weight:600;font-size:13px;line-height:1.2;margin-bottom:2px;">${name}</div>
      <div style="font-size:11px;color:#475569;margin-bottom:6px;">${addr}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        <span style="padding:2px 8px;border-radius:999px;background:${color};color:#fff;font-size:10px;font-weight:600;text-transform:capitalize;">${statusLabel[p.status] ?? p.status}</span>
        <span style="font-size:11px;color:#475569;">${photoCount} photo${photoCount === 1 ? "" : "s"}</span>
      </div>
      <div style="font-size:10px;color:#64748b;margin-top:4px;">${activity}</div>
      <div style="font-size:10px;color:#0ea5e9;margin-top:6px;font-weight:600;">Click to open project →</div>
    </div>`;
  };

  // Update markers + fit bounds whenever mappable changes OR map becomes ready
  useEffect(() => {
    if (!mapReady || !mapInstance.current || !window.google?.maps) return;
    if (clusterer.current) {
      clusterer.current.clearMarkers();
      clusterer.current = null;
    }
    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];
    if (mappable.length === 0) return;

    const bounds = new window.google.maps.LatLngBounds();
    mappable.forEach((p) => {
      const pos = { lat: Number(p.latitude), lng: Number(p.longitude) };
      const color = statusColor[p.status] ?? "#64748b";
      const totalW = pinTotalWidth(p.name);
      const totalH = PIN_H + 4;
      const marker = new window.google.maps.Marker({
        position: pos,
        title: p.name,
        icon: {
          url: pinWithLabelSvg(color, p.name),
          scaledSize: new window.google.maps.Size(totalW, totalH),
          anchor: new window.google.maps.Point(PIN_W / 2, PIN_H),
        },
        optimized: false,
        zIndex: 10,
      });
      marker.addListener("mouseover", () => {
        if (!hoverWindow.current) return;
        hoverWindow.current.setContent(buildHoverHtml(p, color));
        hoverWindow.current.open({ anchor: marker, map: mapInstance.current });
      });
      marker.addListener("mouseout", () => {
        hoverWindow.current?.close();
      });
      marker.addListener("click", () => {
        setSelected(p);
        hoverWindow.current?.close();
        navigate({ to: "/projects/$projectId", params: { projectId: p.id }, search: {} as any });
      });
      markers.current.push(marker);
      bounds.extend(pos);
    });

    clusterer.current = new MarkerClusterer({
      map: mapInstance.current,
      markers: markers.current,
    });

    if (mappable.length === 1) {
      mapInstance.current.setCenter(bounds.getCenter());
      mapInstance.current.setZoom(14);
    } else {
      mapInstance.current.fitBounds(bounds, { top: 100, right: 100, bottom: 100, left: 100 });
    }
  }, [mappable, mapReady, navigate]);

  if (loading) return <PageLoader />;

  const pendingGeocodes = visible.filter((p) => p.latitude == null || p.longitude == null);
  const counts = {
    active: projects.filter((p) => p.status === "active").length,
    on_hold: projects.filter((p) => p.status === "on_hold").length,
    completed: projects.filter((p) => p.status === "completed").length,
    all: projects.length,
  };

  const focusProject = (p: ProjectPin) => {
    setSelected(p);
    if (p.latitude != null && p.longitude != null && mapInstance.current) {
      mapInstance.current.panTo({ lat: Number(p.latitude), lng: Number(p.longitude) });
      mapInstance.current.setZoom(15);
      const idx = mappable.findIndex((x) => x.id === p.id);
      const marker = markers.current[idx];
      if (marker && infoWindow.current) {
        window.google.maps.event.trigger(marker, "click");
      }
    }
  };

  return (
    <div className="min-h-full bg-background p-6 sm:p-10">
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
          <div className="flex items-center gap-1 rounded-xl border-[0.8px] border-border bg-card/65 p-1 shadow-sm">
            {(
              [
                ["active", "Active", counts.active],
                ["on_hold", "On hold", counts.on_hold],
                ["completed", "Completed", counts.completed],
                ["all", "All", counts.all],
              ] as const
            ).map(([key, label, count]) => (
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
                {label} <span className="text-xs">{count}</span>
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
                  {(["active", "on_hold", "completed"] as const).map((s) => (
                    <div key={s} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full ring-2 ring-card"
                        style={{ background: statusColor[s] }}
                      />
                      <span className="text-foreground/80">{statusLabel[s]}</span>
                    </div>
                  ))}
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
                        style={{ background: badge.bg, color: badge.text }}
                      >
                        {statusLabel[p.status] ?? p.status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="font-manrope mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate">{formatAddress(p) || "—"}</span>
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
