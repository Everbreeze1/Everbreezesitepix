import { useNavigate, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LocateFixed, Loader2, MapPin, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { useSubscriptionGate } from "@/hooks/use-subscription-gate";
import { applyProjectBlueprint } from "@/lib/blueprint.functions";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { BlueprintOutcomePreview } from "@/features/settings/components/BlueprintOutcomePreview";
import { useBlueprintContents } from "@/hooks/use-blueprint-contents";
import { toast } from "sonner";
import { qk } from "@/lib/query-keys";

interface AddrParts {
  street: string;
  city: string;
  state: string;
  zip: string;
  formatted: string;
}

function parseComponents(comps: any[]): AddrParts {
  const get = (type: string, short = false) => {
    const c = comps.find((x) => x.types?.includes(type));
    return (short ? (c?.short_name ?? c?.shortText) : (c?.long_name ?? c?.longText)) ?? "";
  };
  const street = `${get("street_number")} ${get("route")}`.trim();
  const city =
    get("locality") || get("postal_town") || get("sublocality") || get("sublocality_level_1");
  const state = get("administrative_area_level_1", true);
  const zip = get("postal_code");
  return { street, city, state, zip, formatted: "" };
}

export function NewProjectPage() {
  const { user } = useAuth();
  const { isTeam } = useSubscription();
  const { guard } = useSubscriptionGate();
  const navigate = useNavigate();
  const search = useSearch({ from: "/_app/projects/new" });
  const qc = useQueryClient();
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);

  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [reverseLoading, setReverseLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [form, setForm] = useState({
    name: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    formatted: "",
  });
  const [projectTemplates, setProjectTemplates] = useState<
    Array<{ id: string; name: string; labels: string[] }>
  >([]);
  // "New project from this" on the Templates page arrives with the blueprint
  // already chosen - the point of that button is that you do not have to find
  // it again in a dropdown.
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    search.blueprint ?? "__none",
  );
  const blueprint = useBlueprintContents(
    selectedTemplateId === "__none" ? null : selectedTemplateId,
  );

  // Load project templates the user can apply (Team plan only - Project
  // Blueprints are a Team-tier differentiator).
  useEffect(() => {
    if (!isTeam) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("project_templates" as any)
        .select("id, name, labels, archived")
        .eq("archived", false)
        .order("name", { ascending: true });
      if (cancelled) return;
      setProjectTemplates(
        ((data as any[]) ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          labels: (t.labels as string[] | null) ?? [],
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [isTeam]);

  // Load Maps JS
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(async () => {
        await (window as any).google.maps.importLibrary("maps");
        await (window as any).google.maps.importLibrary("marker");
        await (window as any).google.maps.importLibrary("geocoding");
        if (cancelled) return;
        setReady(true);
      })
      .catch(() => toast.error("Could not load map"));
    return () => {
      cancelled = true;
    };
  }, []);

  // Init map once ready
  useEffect(() => {
    if (!ready || !mapDivRef.current || mapRef.current) return;
    const g = (window as any).google;
    const initial = { lat: 39.8283, lng: -98.5795 }; // US center fallback
    mapRef.current = new g.maps.Map(mapDivRef.current, {
      center: initial,
      zoom: 4,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: "greedy",
      clickableIcons: false,
    });
    geocoderRef.current = new g.maps.Geocoder();

    mapRef.current.addListener("click", (e: any) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      void setLocation(lat, lng, { pan: false });
    });

    // Try geolocation immediately
    void locateMe(true);
  }, [ready]);

  const placeMarker = (lat: number, lng: number) => {
    const g = (window as any).google;
    if (!mapRef.current) return;
    if (!markerRef.current) {
      markerRef.current = new g.maps.Marker({
        position: { lat, lng },
        map: mapRef.current,
        draggable: true,
        animation: g.maps.Animation.DROP,
      });
      markerRef.current.addListener("dragend", (e: any) => {
        const la = e.latLng.lat();
        const ln = e.latLng.lng();
        void setLocation(la, ln, { pan: false });
      });
    } else {
      markerRef.current.setPosition({ lat, lng });
    }
  };

  const reverseGeocode = async (lat: number, lng: number) => {
    if (!geocoderRef.current) return;
    setReverseLoading(true);
    try {
      const { results } = await geocoderRef.current.geocode({ location: { lat, lng } });
      const first = results?.[0];
      if (!first) return;
      const parts = parseComponents(first.address_components ?? []);
      setForm((f) => ({
        ...f,
        street: parts.street || f.street,
        city: parts.city || f.city,
        state: parts.state || f.state,
        zip: parts.zip || f.zip,
        formatted: first.formatted_address ?? "",
        name: f.name || (parts.street ? `${parts.street} - Site visit` : f.name),
      }));
    } catch {
      // ignore
    } finally {
      setReverseLoading(false);
    }
  };

  const setLocation = async (lat: number, lng: number, opts: { pan?: boolean } = { pan: true }) => {
    setCoords({ lat, lng });
    placeMarker(lat, lng);
    if (mapRef.current) {
      if (opts.pan !== false) {
        mapRef.current.panTo({ lat, lng });
        if ((mapRef.current.getZoom() ?? 0) < 15) mapRef.current.setZoom(17);
      }
    }
    await reverseGeocode(lat, lng);
  };

  const locateMe = async (silent = false) => {
    if (!navigator.geolocation) {
      if (!silent) toast.error("Geolocation not available");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        void setLocation(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        setLocating(false);
        if (!silent) toast.error(err.message || "Could not get location");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const applyTemplate = async (projectId: string, templateId: string) => {
    // Returned, not discarded: a per-item failure comes back 200 with a `failed`
    // list rather than throwing, so dropping the result meant a blueprint could
    // half-apply under an unqualified "Project created".
    return await applyProjectBlueprint({
      data: {
        blueprintId: templateId,
        projectId,
        projectName: form.name.trim() || form.street.trim() || "Untitled project",
        projectAddress:
          [form.street, form.city, form.state, form.zip].filter(Boolean).join(", ") || null,
      },
    });
  };

  const create = () => guard(() => void doCreate(), "Subscribe to create new projects.");

  const doCreate = async () => {
    if (!user) return;
    const name = form.name.trim() || form.street.trim() || "Untitled project";
    setSaving(true);
    const { data, error } = await supabase
      .from("projects")
      .insert({
        created_by: user.id,
        name,
        street: form.street.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip: form.zip.trim() || null,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        status: "active",
      } as any)
      .select("id")
      .single();
    if (error || !data) {
      setSaving(false);
      return toast.error(error?.message ?? "Could not create project");
    }
    const projectId = (data as any).id as string;
    if (selectedTemplateId && selectedTemplateId !== "__none") {
      try {
        const res = await applyTemplate(projectId, selectedTemplateId);
        // The catch below only fires for transport/HTTP throws (plan gate,
        // ownership). Per-item failures resolve successfully with a `failed`
        // list, so they have to be inspected here or they are invisible - the
        // page has just shown the user a preview promising these very items.
        if (res?.failed?.length) {
          const n = res.failed.length;
          toast.warning(`Project created, but ${n} item${n === 1 ? "" : "s"} couldn’t be applied`, {
            description: res.failed.map((f) => `${f.kind}: ${f.reason}`).join("; "),
          });
        }
        // The items landed but nothing recorded which blueprint made them, so
        // the project will not be able to show its origin. Silent before this.
        if (res && res.ledgerRecorded === false) {
          toast.warning("Project created, but its blueprint origin wasn’t recorded", {
            description: "The items were created; the project just won’t show where they came from.",
          });
        }
      } catch (e) {
        // Non-fatal: project is created either way
        console.error("Failed to apply template", e);
        toast.error("Project created, but template could not be fully applied");
      }
    }
    setSaving(false);
    toast.success("Project created");
    void qc.invalidateQueries({ queryKey: qk.projectsList(user.id) });
    void qc.invalidateQueries({ queryKey: qk.dashboard(user.id) });
    void qc.invalidateQueries({ queryKey: qk.mapProjects(user.id) });
    navigate({ to: "/projects/$projectId", params: { projectId } });
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-[calc(100dvh-4rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9">
            <Link to="/projects">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-base font-semibold leading-tight">New project</h1>
            <p className="text-[11px] text-muted-foreground">
              Drop a pin or use your current location
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => locateMe(false)}
          disabled={locating}
          className="gap-1.5"
        >
          {locating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LocateFixed className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">Use my location</span>
        </Button>
      </div>

      {/* Map */}
      <div className="relative flex-1 min-h-[40vh]">
        <div ref={mapDivRef} className="absolute inset-0 bg-muted" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {coords && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background/95 px-3 py-1 text-[11px] font-medium shadow-md backdrop-blur">
            <MapPin className="mr-1 inline h-3 w-3" />
            {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
            {reverseLoading && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
          </div>
        )}
      </div>

      {/* Form */}
      <div className="border-t border-border bg-background px-4 py-4 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)]">
        <div className="mx-auto max-w-2xl space-y-3">
          <div className="space-y-1.5">
            <Label
              htmlFor="search"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Search address
            </Label>
            <AddressAutocomplete
              id="search"
              value={form.formatted}
              onChange={(v) => setForm((f) => ({ ...f, formatted: v }))}
              onSelect={(addr) => {
                setForm((f) => ({
                  ...f,
                  street: addr.street,
                  city: addr.city,
                  state: addr.state,
                  zip: addr.zip,
                  formatted: addr.formatted,
                  name: f.name || (addr.street ? `${addr.street} - Site visit` : f.name),
                }));
                if (addr.latitude != null && addr.longitude != null) {
                  void setLocation(addr.latitude, addr.longitude);
                }
              }}
              placeholder="Search or type address…"
            />
          </div>

          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-12 space-y-1">
              <Label
                htmlFor="street"
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Street
              </Label>
              <Input
                id="street"
                value={form.street}
                onChange={(e) => setForm({ ...form, street: e.target.value })}
                placeholder="123 Main St"
              />
            </div>
            <div className="col-span-6 space-y-1">
              <Label
                htmlFor="city"
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                City
              </Label>
              <Input
                id="city"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div className="col-span-3 space-y-1">
              <Label
                htmlFor="state"
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                State
              </Label>
              <Input
                id="state"
                value={form.state}
                maxLength={3}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              />
            </div>
            <div className="col-span-3 space-y-1">
              <Label
                htmlFor="zip"
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Zip
              </Label>
              <Input
                id="zip"
                value={form.zip}
                inputMode="numeric"
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label
              htmlFor="name"
              className="text-[11px] uppercase tracking-wide text-muted-foreground"
            >
              Project name <span className="normal-case text-muted-foreground/70">(optional)</span>
            </Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={form.street ? `${form.street} - Site visit` : "Auto-named from address"}
            />
          </div>

          {(projectTemplates.length > 0 || selectedTemplateId !== "__none") && (
            <div className="space-y-1">
              <Label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <LayoutTemplate className="h-3 w-3" />
                Apply project blueprint{" "}
                <span className="normal-case text-muted-foreground/70">(optional)</span>
              </Label>
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="No blueprint" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No blueprint</SelectItem>
                  {projectTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Picking a blueprint used to be a name in a dropdown and nothing
                  else - you found out what it did after the project existed.
                  Same panel the blueprint's own page shows. */}
              {selectedTemplateId !== "__none" && (
                <div className="pt-2">
                  {blueprint.loading ? (
                    <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading what this creates…
                    </div>
                  ) : (
                    <BlueprintOutcomePreview
                      items={blueprint.items}
                      labels={blueprint.labels}
                      projectName={form.name.trim() || form.street.trim() || null}
                      dense
                    />
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button asChild variant="ghost" className="flex-1">
              <Link to="/projects">Cancel</Link>
            </Button>
            <Button onClick={create} disabled={saving} className="flex-[2]">
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create & start taking photos"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
