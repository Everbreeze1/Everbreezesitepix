import { useNavigate, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FilePlus2,
  Loader2,
  LocateFixed,
  MapPin,
  LayoutTemplate,
  Pencil,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/everlumen/client";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { useSubscriptionGate } from "@/hooks/use-subscription-gate";
import { useCompanySetup } from "@/hooks/use-company-setup";
import { applyProjectBlueprint } from "@/lib/blueprint.functions";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { BlueprintOutcomePreview } from "@/features/settings/components/BlueprintOutcomePreview";
import { useBlueprintContents } from "@/hooks/use-blueprint-contents";
import { GENERAL_CATEGORY, makeCategoryRank } from "@/lib/template-categories";
import { cn } from "@/lib/utils";
import { newProjectName } from "@everlumen/shared";
import { toast } from "sonner";
import { qk } from "@/lib/query-keys";
import { writeWithNewColumns, PROJECT_CLIENT_KEYS } from "@/lib/merge-field-columns";

/** The "no blueprint" sentinel. Radix rejects an empty string as a value. */
const NO_BLUEPRINT = "__none";

interface BlueprintOption {
  id: string;
  name: string;
  labels: string[];
  category: string | null;
  /** The one blueprint a new project of this trade starts from. */
  isDefault: boolean;
}

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
    // Merge fields. Captured here so the job's first document does not have to
    // ask for them; equally editable later from the project's Edit dialog.
    client_name: "",
    client_contact: "",
    project_number: "",
  });
  const [projectTemplates, setProjectTemplates] = useState<BlueprintOption[]>([]);
  const [blueprintsLoaded, setBlueprintsLoaded] = useState(false);
  // "New project from this" on the Templates page arrives with the blueprint
  // already chosen - the point of that button is that you do not have to find
  // it again in a dropdown.
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    search.blueprint ?? NO_BLUEPRINT,
  );
  const blueprint = useBlueprintContents(
    selectedTemplateId === NO_BLUEPRINT ? null : selectedTemplateId,
  );

  /*
   * Step one is choosing a blueprint, per the spec: "User starts a new project.
   * First step is 'Choose a Blueprint' (or 'Start blank')."
   *
   * It used to be the last field on the form, a bare name in a dropdown below
   * the map and the client details, which is the opposite of what the spec asks
   * for: the decision that determines the whole shape of the project was made
   * after every smaller decision had been.
   *
   * `arrivedWithBlueprint` skips the step for a link that has already made the
   * choice. The step also skips itself when there is nothing to choose between,
   * which `beginAtChooser` decides once the library has actually loaded - a
   * chooser rendered before then would flash an empty list and then fill in.
   */
  const arrivedWithBlueprint = !!search.blueprint;
  const [step, setStep] = useState<"blueprint" | "details">(
    arrivedWithBlueprint ? "details" : "blueprint",
  );

  const company = useCompanySetup();

  // Load project templates the user can apply (Team plan only - Project
  // Blueprints are a Team-tier differentiator).
  useEffect(() => {
    if (!isTeam) {
      setBlueprintsLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      /*
       * `category` and `default_for_category` arrive with 20260908000000, and
       * PostgREST rejects the whole select over one unknown column. Without the
       * retry, a database still waiting for that migration would show NO
       * blueprints here at all - the chooser would be empty and the user would
       * conclude they had none.
       */
      const COLUMNS = "id, name, labels, archived";
      let { data, error } = await supabase
        .from("project_templates" as any)
        .select(`${COLUMNS}, category, default_for_category`)
        .eq("archived", false)
        .order("name", { ascending: true });
      if (error) {
        ({ data, error } = await supabase
          .from("project_templates" as any)
          .select(COLUMNS)
          .eq("archived", false)
          .order("name", { ascending: true }));
      }
      if (cancelled) return;
      setProjectTemplates(
        ((data as any[]) ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          labels: (t.labels as string[] | null) ?? [],
          category: (t.category as string | null) ?? null,
          isDefault: !!t.default_for_category,
        })),
      );
      setBlueprintsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [isTeam]);

  /** Blueprints in the order this company should see them: their trade first. */
  const rank = useMemo(
    () => makeCategoryRank(company.profile.industry, company.profile.trades),
    [company.profile.industry, company.profile.trades],
  );
  const orderedBlueprints = useMemo(
    () =>
      [...projectTemplates].sort(
        (a, b) =>
          // The default for a trade leads its group: it is the one-tap answer,
          // and burying it alphabetically among its siblings is what makes a
          // default worth nothing.
          rank(a.category || GENERAL_CATEGORY) - rank(b.category || GENERAL_CATEGORY) ||
          Number(b.isDefault) - Number(a.isDefault) ||
          a.name.localeCompare(b.name),
      ),
    [projectTemplates, rank],
  );

  /**
   * The blueprint a new project should start on.
   *
   * "Consider a default Blueprint per project category so most projects can be
   * created in one tap." The company's own trade wins; a default filed under
   * some other trade is still better than nothing, because someone deliberately
   * marked it as how their jobs start.
   */
  const suggestedId = useMemo(() => {
    const defaults = orderedBlueprints.filter((b) => b.isDefault);
    if (!defaults.length) return null;
    const forOurTrade = defaults.find(
      (b) => b.category && rank(b.category) < rank(GENERAL_CATEGORY),
    );
    return (forOurTrade ?? defaults[0]).id;
  }, [orderedBlueprints, rank]);

  // Preselect the suggestion, once, and only when the user has not already
  // chosen. A later re-run must not overwrite a deliberate pick.
  const suggestionApplied = useRef(false);
  useEffect(() => {
    if (suggestionApplied.current || arrivedWithBlueprint) return;
    if (!suggestedId) return;
    suggestionApplied.current = true;
    setSelectedTemplateId(suggestedId);
  }, [suggestedId, arrivedWithBlueprint]);

  /*
   * Nothing to choose between is not a step, it is a pause. A user with no
   * blueprints - which is every user below the Team plan - would otherwise meet
   * a full-screen chooser offering one option called "Start blank".
   */
  const beginAtChooser = blueprintsLoaded && projectTemplates.length > 0;
  useEffect(() => {
    if (blueprintsLoaded && !beginAtChooser && step === "blueprint") setStep("details");
  }, [blueprintsLoaded, beginAtChooser, step]);

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
        projectName: newProjectName(
          { name: form.name, street: form.street, client_name: form.client_name },
          new Date(),
        ),
        projectAddress:
          [form.street, form.city, form.state, form.zip].filter(Boolean).join(", ") || null,
      },
    });
  };

  const create = () => guard(() => void doCreate(), "Subscribe to create new projects.");

  const doCreate = async () => {
    if (!user) return;
    /*
     * Stamped when the crew gave us nothing to go on. The bare constant is what
     * filled workspaces with rows of interchangeable "Untitled project"
     * entries - identical in every picker, and the Move destination list was
     * the place it hurt, because picking the wrong one moves photos. Fixed
     * here, at the only place that mints the name, rather than in each picker.
     */
    const name = newProjectName(
      { name: form.name, street: form.street, client_name: form.client_name },
      new Date(),
    );
    setSaving(true);
    // Retried without the client columns if this database predates them, so
    // creating a project never fails over a field the user may not have filled.
    const { data, error } = await writeWithNewColumns(
      {
        created_by: user.id,
        name,
        street: form.street.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip: form.zip.trim() || null,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        status: "active",
        client_name: form.client_name.trim() || null,
        client_contact: form.client_contact.trim() || null,
        project_number: form.project_number.trim() || null,
      },
      PROJECT_CLIENT_KEYS,
      (row) =>
        supabase
          .from("projects")
          .insert(row as any)
          .select("id")
          .single(),
      "Project created without the client details",
    );
    if (error || !data) {
      setSaving(false);
      return toast.error(error?.message ?? "Could not create project");
    }
    const projectId = (data as any).id as string;
    if (selectedTemplateId && selectedTemplateId !== NO_BLUEPRINT) {
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
            description:
              "The items were created; the project just won’t show where they came from.",
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

  const selectedBlueprint =
    selectedTemplateId === NO_BLUEPRINT
      ? null
      : (projectTemplates.find((t) => t.id === selectedTemplateId) ?? null);

  /*
   * Step one: choose a blueprint, or start blank.
   *
   * Two panes rather than a dropdown, because the spec asks for a preview -
   * "show what a project would look like if this Blueprint were applied" - and
   * a name in a list cannot carry that. The same BlueprintOutcomePreview runs
   * on the blueprint's own page and inside the apply dialog, so the promise
   * made here is literally the same picture the other two screens make.
   */
  if (step === "blueprint") {
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] bg-background md:min-h-[calc(100dvh-4rem)]">
        <div className="flex items-center gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9">
            <Link to="/projects">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-base font-semibold leading-tight">Start a project</h1>
            <p className="text-[11px] text-muted-foreground">
              Step 1 of 2 - choose how this job gets set up
            </p>
          </div>
        </div>

        <div className="container mx-auto max-w-5xl px-4 py-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
            {/* The choices */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setSelectedTemplateId(NO_BLUEPRINT)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition",
                  selectedTemplateId === NO_BLUEPRINT
                    ? "border-primary bg-primary/[0.06]"
                    : "border-border/60 bg-card hover:border-border",
                )}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <FilePlus2 className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">Start blank</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Just the project. Add checklists and documents later.
                  </span>
                </span>
                {selectedTemplateId === NO_BLUEPRINT && (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                )}
              </button>

              <p className="px-1 pt-1.5 font-manrope text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                Blueprints
              </p>

              <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-0.5">
                {orderedBlueprints.map((t) => {
                  const on = selectedTemplateId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(t.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition",
                        on
                          ? "border-primary bg-primary/[0.06]"
                          : "border-border/60 bg-card hover:border-border",
                      )}
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <LayoutTemplate className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-bold">{t.name}</span>
                          {t.isDefault && (
                            <Star
                              className="h-3 w-3 shrink-0 text-primary"
                              aria-label="Default for this trade"
                            />
                          )}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {t.category ?? GENERAL_CATEGORY}
                          {t.labels.length ? ` · ${t.labels.join(", ")}` : ""}
                        </span>
                      </span>
                      {on && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* The preview */}
            <div className="space-y-3">
              <p className="font-manrope text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                What this creates
              </p>
              {selectedTemplateId === NO_BLUEPRINT ? (
                <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center">
                  <p className="text-sm font-semibold">An empty project</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                    You can apply a blueprint to it at any point afterwards, from the Templates
                    screen. Nothing here is a one-time decision.
                  </p>
                </div>
              ) : blueprint.loading ? (
                <div className="flex items-center gap-2 px-1 py-6 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading what this creates…
                </div>
              ) : (
                <BlueprintOutcomePreview
                  items={blueprint.items}
                  labels={blueprint.labels}
                  projectName={null}
                />
              )}

              <Button className="w-full" onClick={() => setStep("details")}>
                {selectedBlueprint ? `Continue with "${selectedBlueprint.name}"` : "Continue blank"}
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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

          {/* Merge fields. Every document template asks for these; filling them
              in once here means the job's documents arrive already complete. */}
          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Client &amp; job details{" "}
              <span className="normal-case text-muted-foreground/70">
                (optional, fills documents in for you)
              </span>
            </Label>
            <div className="space-y-1">
              <Label
                htmlFor="np-client"
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Client name
              </Label>
              <Input
                id="np-client"
                value={form.client_name}
                placeholder="e.g. Sarah Whitfield"
                onChange={(e) => setForm({ ...form, client_name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label
                  htmlFor="np-client-contact"
                  className="text-[11px] uppercase tracking-wide text-muted-foreground"
                >
                  Client contact
                </Label>
                <Input
                  id="np-client-contact"
                  value={form.client_contact}
                  placeholder="Email or phone"
                  onChange={(e) => setForm({ ...form, client_contact: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="np-number"
                  className="text-[11px] uppercase tracking-wide text-muted-foreground"
                >
                  Project number
                </Label>
                <Input
                  id="np-number"
                  value={form.project_number}
                  placeholder="e.g. PRJ-00421"
                  onChange={(e) => setForm({ ...form, project_number: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* The blueprint was chosen in step one, so what belongs here is the
              decision as a fact and a way back to it - not the same picker
              again. `beginAtChooser` is false when there was no step one to go
              back to, in which case this row stays out of the way entirely. */}
          {beginAtChooser && (
            <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                  selectedBlueprint
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {selectedBlueprint ? (
                  <LayoutTemplate className="h-4 w-4" />
                ) : (
                  <FilePlus2 className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {selectedBlueprint?.name ?? "Starting blank"}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {selectedBlueprint
                    ? blueprint.loading
                      ? "Loading what this creates…"
                      : `${blueprint.items.length} item${blueprint.items.length === 1 ? "" : "s"} will be created on this project`
                    : "No checklists, documents or workflows will be added"}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 rounded-lg text-xs font-bold"
                onClick={() => setStep("blueprint")}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Change
              </Button>
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
