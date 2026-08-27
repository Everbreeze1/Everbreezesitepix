import { useNavigate, Link, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  FilePlus2,
  Loader2,
  LocateFixed,
  MapPin,
  LayoutTemplate,
  Pencil,
  Star,
  TriangleAlert,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/everlumen/client";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { useSubscriptionGate } from "@/hooks/use-subscription-gate";
import { useCompanySetup } from "@/hooks/use-company-setup";
import { useSiteLocation, type SiteCoords } from "@/hooks/use-site-location";
import { applyProjectBlueprint } from "@/lib/blueprint.functions";
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

/** Roughly the middle of the United States, for a map with nothing on it yet. */
const NOWHERE_IN_PARTICULAR = { lat: 39.8283, lng: -98.5795 };

interface BlueprintOption {
  id: string;
  name: string;
  labels: string[];
  category: string | null;
  /** The one blueprint a new project of this trade starts from. */
  isDefault: boolean;
}

/** Address fields that the detected location is allowed to fill in. */
const ADDRESS_KEYS = ["street", "city", "state", "zip", "formatted"] as const;
type AddressKey = (typeof ADDRESS_KEYS)[number];

export function NewProjectPage() {
  const { user } = useAuth();
  const { isTeam } = useSubscription();
  const { guard } = useSubscriptionGate();
  const navigate = useNavigate();
  const search = useSearch({ from: "/_app/projects/new" });
  const qc = useQueryClient();

  /*
   * The location starts being worked out here, at the top of the page, before
   * anything is rendered and before the user has chosen anything. That is the
   * whole point: by the time they reach the form the site address is already in
   * it, and the only thing left to type is who the job is for.
   *
   * It deliberately does NOT wait for the map. The map is confirmation; the
   * address is the answer, and it arrives as soon as the geocoding library
   * does.
   */
  const {
    phase: locPhase,
    coords,
    address: detected,
    source: locSource,
    mapsReady,
    mapsFailed,
    detect,
    pin,
    accept,
  } = useSiteLocation();

  const [saving, setSaving] = useState(false);
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

  /*
   * Address fields the user has typed into themselves. A detected address fills
   * everything else and leaves these alone: someone correcting a unit number
   * while the geocoder is still thinking must not have it overwritten a second
   * later.
   *
   * Cleared whenever the user asks for a different location outright (they move
   * the pin, they search, they press Use my location), because at that point
   * they are asking for the new answer, not defending the old one.
   */
  const editedRef = useRef(new Set<AddressKey>());
  const noteEdit = (key: AddressKey) => editedRef.current.add(key);

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

  // ---------------------------------------------------------------------------
  // Location
  // ---------------------------------------------------------------------------

  // A detected address fills the form. Everything the user typed survives it.
  useEffect(() => {
    if (!detected) return;
    setForm((f) => ({
      ...f,
      street: editedRef.current.has("street") ? f.street : detected.street,
      city: editedRef.current.has("city") ? f.city : detected.city,
      state: editedRef.current.has("state") ? f.state : detected.state,
      zip: editedRef.current.has("zip") ? f.zip : detected.zip,
      formatted: editedRef.current.has("formatted") ? f.formatted : detected.formatted,
    }));
  }, [detected]);

  /** The user asked for a different location, so their old corrections lapse. */
  const relocate = useCallback(
    (run: () => void) => {
      editedRef.current = new Set();
      run();
    },
    // `editedRef` is a ref; nothing here changes between renders.
    [],
  );

  const movePin = useCallback(
    (next: SiteCoords) => relocate(() => pin(next, "pin")),
    [relocate, pin],
  );
  const useMyLocation = useCallback(() => relocate(detect), [relocate, detect]);

  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  /*
   * Bumped each time a map instance is built. The marker effect below keys off
   * it, because a ref changing is invisible to React: stepping back to the
   * blueprint chooser and forward again builds a second map, and without this
   * the pin would be missing from it.
   */
  const [mapEpoch, setMapEpoch] = useState(0);
  // Read inside the ref callback, which must not re-run every time the pin
  // moves - re-running it would tear down and rebuild the map on every fix.
  const coordsRef = useRef<SiteCoords | null>(null);
  useEffect(() => {
    coordsRef.current = coords;
  }, [coords]);

  const attachMap = useCallback(
    (node: HTMLDivElement | null) => {
      mapNodeRef.current = node;
      if (!node) {
        // Step one unmounts the map. Keeping an instance bound to a detached
        // node is what left a grey box behind on the way back to step two.
        mapRef.current = null;
        markerRef.current = null;
        return;
      }
      if (!mapsReady || mapRef.current) return;
      const g = (window as any).google;
      const start = coordsRef.current;
      const map = new g.maps.Map(node, {
        center: start ?? NOWHERE_IN_PARTICULAR,
        zoom: start ? 17 : 4,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
        clickableIcons: false,
      });
      map.addListener("click", (e: any) => movePin({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
      mapRef.current = map;
      setMapEpoch((n) => n + 1);
    },
    [mapsReady, movePin],
  );

  // Keep the pin and the viewport on the current coordinates.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coords) return;
    const g = (window as any).google;
    if (!markerRef.current) {
      markerRef.current = new g.maps.Marker({
        position: coords,
        map,
        draggable: true,
        animation: g.maps.Animation.DROP,
        title: "Drag to move the job site",
      });
      markerRef.current.addListener("dragend", (e: any) =>
        movePin({ lat: e.latLng.lat(), lng: e.latLng.lng() }),
      );
    } else {
      markerRef.current.setPosition(coords);
    }
    map.panTo(coords);
    if ((map.getZoom() ?? 0) < 15) map.setZoom(17);
  }, [coords, mapEpoch, movePin]);

  // ---------------------------------------------------------------------------
  // The address, as one line
  // ---------------------------------------------------------------------------

  /**
   * What the user reads instead of four inputs.
   *
   * Built from the fields that actually get saved rather than from Google's
   * formatted string, so correcting the street number below changes the line
   * above it instead of leaving the two disagreeing.
   */
  const addressLine = useMemo(() => {
    const region = [form.state.trim(), form.zip.trim()].filter(Boolean).join(" ");
    const parts = [form.street.trim(), form.city.trim(), region].filter(Boolean);
    return parts.length ? parts.join(", ") : form.formatted.trim();
  }, [form.street, form.city, form.state, form.zip, form.formatted]);

  const [addressOpen, setAddressOpen] = useState(false);
  // Opened for the user when there is nothing to confirm, so a refused
  // permission lands on a usable form rather than on an empty card.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current) return;
    const stuck = locPhase === "denied" || locPhase === "unavailable" || mapsFailed;
    if (!stuck) return;
    autoOpened.current = true;
    setAddressOpen(true);
  }, [locPhase, mapsFailed]);

  const status = useMemo(() => {
    if (locPhase === "locating") {
      return {
        kind: "busy" as const,
        title: "Finding the job site",
        detail: "Reading your device location",
      };
    }
    if (locPhase === "resolving") {
      return {
        kind: "busy" as const,
        title: "Looking up the address",
        detail: "You are pinned, the street is on its way",
      };
    }
    if (locPhase === "denied") {
      return {
        kind: "warn" as const,
        title: "Location is blocked for this site",
        detail: "Allow it in your browser, or search for the address below",
      };
    }
    if (locPhase === "unavailable") {
      return {
        kind: "warn" as const,
        title: "Your device could not place you",
        detail: "Search for the address below instead",
      };
    }
    if (locPhase === "pinned") {
      return {
        kind: "warn" as const,
        title: "Pinned, but no address matched",
        detail: "Move the pin, or fill the address in below",
      };
    }
    /*
     * The address landed and the form is one render behind it, because the fill
     * runs in an effect. Reading that gap as "no address matched" is what made
     * the card flash a warning at the exact moment it succeeded.
     */
    if (!addressLine) {
      return {
        kind: "busy" as const,
        title: "Looking up the address",
        detail: "You are pinned, the street is on its way",
      };
    }
    return {
      kind: "ok" as const,
      title: addressLine,
      detail:
        locSource === "device"
          ? "Found from your device. Worth a glance before you create the job."
          : locSource === "pin"
            ? "From the pin you dropped"
            : "From the address you picked",
    };
  }, [locPhase, addressLine, locSource]);

  const locating = locPhase === "locating" || locPhase === "resolving";

  // ---------------------------------------------------------------------------
  // Naming
  // ---------------------------------------------------------------------------

  /**
   * What the project gets called when nobody names it.
   *
   * The customer plus the street, because that is how a crew refers to a job out
   * loud, and because the two of them together are the only pair that stays
   * unique across a street of identical addresses and a customer with four
   * properties. `newProjectName` still has the last word, so a job with neither
   * one filled in gets its stamped fallback rather than an empty string.
   */
  const suggestedName = useMemo(() => {
    const client = form.client_name.trim();
    const street = form.street.trim();
    if (client && street) return `${client} - ${street}`;
    return client || street;
  }, [form.client_name, form.street]);

  const finalName = () =>
    newProjectName(
      {
        name: form.name.trim() || suggestedName,
        street: form.street,
        client_name: form.client_name,
      },
      new Date(),
    );

  const applyTemplate = async (projectId: string, templateId: string, projectName: string) => {
    // Returned, not discarded: a per-item failure comes back 200 with a `failed`
    // list rather than throwing, so dropping the result meant a blueprint could
    // half-apply under an unqualified "Project created".
    return await applyProjectBlueprint({
      data: {
        blueprintId: templateId,
        projectId,
        projectName,
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
     * filled workspaces with rows of interchangeable placeholder entries -
     * identical in every picker, and the Move destination list was the place it
     * hurt, because picking the wrong one moves photos. Fixed here, at the only
     * place that mints the name, rather than in each picker.
     */
    const name = finalName();
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
        const res = await applyTemplate(projectId, selectedTemplateId, name);
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
   *
   * The location is being worked out underneath this the whole time, which is
   * why the footer says so: the user should arrive at step two knowing the
   * address was found for them rather than wondering why a form pre-filled
   * itself.
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

              <p className="flex items-center gap-1.5 text-center text-[11px] text-muted-foreground">
                {locating ? (
                  <>
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                    Finding the job site address while you choose…
                  </>
                ) : addressLine ? (
                  <>
                    <MapPin className="h-3 w-3 shrink-0 text-primary" />
                    <span className="truncate">Site address ready: {addressLine}</span>
                  </>
                ) : (
                  <>
                    <MapPin className="h-3 w-3 shrink-0" />
                    You will add the address on the next step.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-[calc(100dvh-4rem)]">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        {/* Back goes to step one when there was one, rather than out of the flow
            entirely. Losing a half-filled form to the Back arrow is the reason
            people stop trusting a two-step screen. */}
        {beginAtChooser ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            aria-label="Back to blueprints"
            onClick={() => setStep("blueprint")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        ) : (
          <Button asChild variant="ghost" size="icon" className="h-9 w-9">
            <Link to="/projects" aria-label="Back to projects">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
        )}
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-tight">New project</h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {beginAtChooser
              ? "Step 2 of 2 - where it is, and who it is for"
              : "Where it is, and who it is for"}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
          {/*
           * The job site, found rather than typed.
           *
           * The map used to own most of this screen and the form was squeezed
           * into a strip under it, which put the four address inputs - the ones
           * nobody should be filling in by hand - in the most prominent place on
           * the page. It is a card now: enough map to recognise the street, the
           * detected address as one line of text, and the inputs a click away
           * for the unit number or the correction the geocoder got wrong.
           */}
          <section className="overflow-hidden rounded-2xl border border-border/60 bg-card">
            {!mapsFailed && (
              <div className="relative h-40 sm:h-52">
                <div ref={attachMap} className="absolute inset-0 bg-muted" />
                {!mapsReady && (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {mapsReady && !coords && !locating && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60 px-6 text-center">
                    <p className="text-xs font-medium text-muted-foreground">
                      Tap the map to drop a pin, or search the address below.
                    </p>
                  </div>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={useMyLocation}
                  disabled={locating}
                  className="absolute bottom-2.5 right-2.5 h-8 gap-1.5 rounded-full border border-border/60 px-3 text-xs font-bold shadow-md"
                >
                  {locating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LocateFixed className="h-3.5 w-3.5" />
                  )}
                  {coords ? "Re-locate" : "Use my location"}
                </Button>
                {coords && (
                  <div className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-full border border-border/60 bg-background/95 px-2.5 py-1 text-[10px] font-medium tabular-nums shadow-sm backdrop-blur">
                    {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                  </div>
                )}
              </div>
            )}

            {/* What we think the address is */}
            <div
              className={cn(
                "flex items-start gap-3 px-3.5 py-3",
                !mapsFailed && "border-t border-border/60",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                  status.kind === "ok" && "bg-primary/10 text-primary",
                  status.kind === "busy" && "bg-muted text-muted-foreground",
                  status.kind === "warn" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                )}
              >
                {status.kind === "busy" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : status.kind === "warn" ? (
                  <TriangleAlert className="h-4 w-4" />
                ) : (
                  <MapPin className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold leading-snug">{status.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {status.detail}
                </p>
              </div>
            </div>

            {/* The four fields, out of the way until something needs correcting */}
            <Collapsible open={addressOpen} onOpenChange={setAddressOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between border-t border-border/60 px-3.5 py-2.5 text-left text-xs font-bold text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
                >
                  {addressOpen ? "Hide address details" : "Search or edit the address"}
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform", addressOpen && "rotate-180")}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-3 border-t border-border/60 bg-muted/20 px-3.5 py-3.5">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="np-search"
                      className="text-[11px] uppercase tracking-wide text-muted-foreground"
                    >
                      Search a different address
                    </Label>
                    <AddressAutocomplete
                      id="np-search"
                      value={form.formatted}
                      onChange={(v) => {
                        noteEdit("formatted");
                        setForm((f) => ({ ...f, formatted: v }));
                      }}
                      onSelect={(addr) => {
                        relocate(() => {
                          setForm((f) => ({
                            ...f,
                            street: addr.street,
                            city: addr.city,
                            state: addr.state,
                            zip: addr.zip,
                            formatted: addr.formatted,
                          }));
                          accept(
                            {
                              street: addr.street,
                              city: addr.city,
                              state: addr.state,
                              zip: addr.zip,
                              formatted: addr.formatted,
                            },
                            addr.latitude != null && addr.longitude != null
                              ? { lat: addr.latitude, lng: addr.longitude }
                              : null,
                          );
                        });
                      }}
                      placeholder="Start typing an address…"
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
                        onChange={(e) => {
                          noteEdit("street");
                          setForm({ ...form, street: e.target.value });
                        }}
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
                        onChange={(e) => {
                          noteEdit("city");
                          setForm({ ...form, city: e.target.value });
                        }}
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
                        onChange={(e) => {
                          noteEdit("state");
                          setForm({ ...form, state: e.target.value });
                        }}
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
                        onChange={(e) => {
                          noteEdit("zip");
                          setForm({ ...form, zip: e.target.value });
                        }}
                      />
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </section>

          {/*
           * The one field this screen actually asks for.
           *
           * Everything above it was filled in by the phone and everything below
           * it is optional, so this is the whole job of the form: say who the
           * work is for. It names the project too, which is why it sits on its
           * own rather than inside the optional block it used to live in.
           */}
          <div className="space-y-1.5">
            <Label htmlFor="np-client" className="flex items-center gap-1.5 text-sm font-bold">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              Who is this job for?
            </Label>
            <Input
              id="np-client"
              value={form.client_name}
              placeholder="Customer name"
              autoComplete="off"
              className="h-11 text-base"
              onChange={(e) => setForm({ ...form, client_name: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground">
              {suggestedName
                ? `This job will be called "${form.name.trim() || suggestedName}". Every document for it gets the name filled in.`
                : "Names the project, and fills itself into every document for this job."}
            </p>
          </div>

          {/* Optional. Collapsed, because a form that asks for six things when it
              needs one is why nobody fills any of them in. */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="group flex w-full items-center justify-between rounded-xl border border-border/60 bg-card px-3.5 py-3 text-left transition hover:border-border"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-bold">Job details</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Project name, contact, job number. All optional.
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3.5">
                <div className="space-y-1">
                  <Label
                    htmlFor="name"
                    className="text-[11px] uppercase tracking-wide text-muted-foreground"
                  >
                    Project name
                  </Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={suggestedName || "Named from the date if you leave this blank"}
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
            </CollapsibleContent>
          </Collapsible>

          {/* The blueprint was chosen in step one, so what belongs here is the
              decision as a fact and a way back to it - not the same picker
              again. `beginAtChooser` is false when there was no step one to go
              back to, in which case this row stays out of the way entirely. */}
          {beginAtChooser && (
            <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3">
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
        </div>
      </div>

      {/* Always reachable, so the answer to "am I done?" never depends on how far
          the page happens to be scrolled. */}
      <div className="border-t border-border bg-background px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)]">
        <div className="mx-auto flex max-w-2xl gap-2">
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
              "Create project"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
