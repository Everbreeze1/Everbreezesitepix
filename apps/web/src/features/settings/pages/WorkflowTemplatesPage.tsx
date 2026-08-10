import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  Workflow as WorkflowIcon,
  Archive,
  ArchiveRestore,
  Copy,
  CheckSquare,
  Camera,
  StickyNote,
  ChevronDown,
  Signature,
  MoreHorizontal,
  Eye,
  Sparkles,
  ListTree,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDot,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { SURFACE_CARD } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import {
  AddTarget,
  BuilderBackToList,
  BuilderCanvas,
  BuilderLayout,
  BuilderRail,
  BuilderRailItem,
  BuilderTitleBar,
  DragHandle,
  QuietInput,
  QuietTextarea,
  RequiredToggle,
  StatChip,
} from "@/components/builder/builder-ui";
import { restrictToVerticalAxis } from "@/components/builder/builder-tokens";
import { useAutosave } from "@/components/builder/use-autosave";
import { KIND_META, KIND_ORDER, type ItemKind } from "@/lib/workflow-items";

interface Template {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  created_at: string;
}
interface Phase {
  id: string;
  template_id: string;
  position: number;
  name: string;
  description: string | null;
  requires_signoff: boolean;
}
interface Item {
  id: string;
  phase_id: string;
  position: number;
  kind: ItemKind;
  label: string;
  required: boolean;
}

/**
 * Blank-canvas templates are where this builder used to lose people: you got a
 * "Phase 1" with nothing in it and no sense of what a good workflow looks like.
 * Starters mirror the checklist designer and give the crew something to shape.
 */
const STARTER_WORKFLOWS: {
  name: string;
  description: string;
  phases: {
    name: string;
    description?: string;
    requires_signoff?: boolean;
    items: { kind: ItemKind; label: string; required?: boolean }[];
  }[];
}[] = [
  {
    name: "Install job",
    description: "Pre-job walkthrough through customer handover, with sign-off at each gate.",
    phases: [
      {
        name: "Pre-job",
        description: "Confirm scope and site conditions before anything comes off the truck.",
        items: [
          { kind: "check", label: "Scope confirmed with customer", required: true },
          { kind: "photo", label: "Site condition — wide shot", required: true },
          { kind: "check", label: "Access and parking arranged" },
          { kind: "note", label: "Existing damage noted" },
        ],
      },
      {
        name: "Install",
        items: [
          { kind: "check", label: "Equipment set and secured", required: true },
          { kind: "photo", label: "Rough-in progress", required: true },
          { kind: "check", label: "Connections torqued to spec", required: true },
          { kind: "photo", label: "Nameplate / serial number", required: true },
        ],
      },
      {
        name: "Inspection",
        requires_signoff: true,
        description: "Verify the work before the customer sees it.",
        items: [
          { kind: "check", label: "Leak / pressure test passed", required: true },
          { kind: "check", label: "System cycled and operating", required: true },
          { kind: "note", label: "Readings recorded" },
        ],
      },
      {
        name: "Handover",
        requires_signoff: true,
        items: [
          { kind: "photo", label: "Completed install", required: true },
          { kind: "check", label: "Customer walkthrough completed", required: true },
          { kind: "check", label: "Site cleaned up", required: true },
          { kind: "note", label: "Follow-up needed?" },
        ],
      },
    ],
  },
  {
    name: "Service call",
    description: "A single-visit troubleshoot-and-repair loop.",
    phases: [
      {
        name: "Arrival",
        items: [
          { kind: "check", label: "Arrived on site", required: true },
          { kind: "photo", label: "Equipment as found", required: true },
          { kind: "note", label: "Customer-reported symptoms", required: true },
        ],
      },
      {
        name: "Diagnose",
        items: [
          { kind: "note", label: "Fault found", required: true },
          { kind: "photo", label: "Failed component" },
          { kind: "check", label: "Estimate approved by customer", required: true },
        ],
      },
      {
        name: "Repair & close",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Repair completed", required: true },
          { kind: "photo", label: "After repair", required: true },
          { kind: "check", label: "Tested under load", required: true },
          { kind: "note", label: "Parts used" },
        ],
      },
    ],
  },
  {
    name: "Inspection & report",
    description: "Walk the site, document each area, hand over a signed report.",
    phases: [
      {
        name: "Exterior",
        items: [
          { kind: "photo", label: "Front elevation", required: true },
          { kind: "photo", label: "Roof / gutters", required: true },
          { kind: "check", label: "Drainage clear" },
          { kind: "note", label: "Exterior observations" },
        ],
      },
      {
        name: "Interior",
        items: [
          { kind: "photo", label: "Each affected room", required: true },
          { kind: "check", label: "Moisture readings taken", required: true },
          { kind: "note", label: "Interior observations" },
        ],
      },
      {
        name: "Report",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Findings summarised", required: true },
          { kind: "check", label: "Recommendations listed", required: true },
          { kind: "note", label: "Next steps agreed with customer" },
        ],
      },
    ],
  },
];

const TABLES = {
  templates: "workflow_templates",
  phases: "workflow_template_phases",
  items: "workflow_template_items",
} as const;

export function WorkflowTemplatesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [pane, setPane] = useState<"list" | "editor">("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [startersOpen, setStartersOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** Row to focus after an insert, so adding a step drops you straight into it. */
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [focusPhaseId, setFocusPhaseId] = useState<string | null>(null);

  const save = useAutosave(
    (table, id, patch) =>
      supabase
        .from(table as any)
        .update(patch)
        .eq("id", id)
        .then((r: any) => {
          if (r.error) throw r.error;
        }),
    { onError: (e: any) => toast.error(e?.message ?? "Couldn't save that change") },
  );

  const load = async () => {
    setLoading(true);
    const { data: tpls } = await supabase
      .from(TABLES.templates as any)
      .select("id, name, description, archived, created_at")
      .order("created_at", { ascending: true });
    const list = ((tpls as any[]) ?? []) as Template[];
    setTemplates(list);
    if (list.length) {
      const ids = list.map((t) => t.id);
      const { data: phs } = await supabase
        .from(TABLES.phases as any)
        .select("id, template_id, position, name, description, requires_signoff")
        .in("template_id", ids)
        .order("position", { ascending: true });
      const phList = ((phs as any[]) ?? []) as Phase[];
      setPhases(phList);
      if (phList.length) {
        const phIds = phList.map((p) => p.id);
        const { data: its } = await supabase
          .from(TABLES.items as any)
          .select("id, phase_id, position, kind, label, required")
          .in("phase_id", phIds)
          .order("position", { ascending: true });
        setItems(((its as any[]) ?? []) as Item[]);
      } else {
        setItems([]);
      }
      setSelectedId((cur) =>
        cur && list.some((t) => t.id === cur)
          ? cur
          : (list.find((t) => !t.archived)?.id ?? list[0]?.id ?? null),
      );
    } else {
      setPhases([]);
      setItems([]);
      setSelectedId(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const visibleTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates
      .filter((t) => showArchived || !t.archived)
      .filter(
        (t) =>
          !q || t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q),
      );
  }, [templates, showArchived, search]);

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const selectedPhases = useMemo(
    () =>
      phases.filter((p) => p.template_id === selectedId).sort((a, b) => a.position - b.position),
    [phases, selectedId],
  );
  const itemsByPhase = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const bucket = map.get(it.phase_id);
      if (bucket) bucket.push(it);
      else map.set(it.phase_id, [it]);
    }
    for (const bucket of map.values()) bucket.sort((a, b) => a.position - b.position);
    return map;
  }, [items]);

  const countsFor = (templateId: string) => {
    const ph = phases.filter((p) => p.template_id === templateId);
    const ids = new Set(ph.map((p) => p.id));
    const its = items.filter((i) => ids.has(i.phase_id));
    return {
      phases: ph.length,
      items: its.length,
      required: its.filter((i) => i.required).length,
      signoffs: ph.filter((p) => p.requires_signoff).length,
    };
  };
  const stats = selected
    ? countsFor(selected.id)
    : { phases: 0, items: 0, required: 0, signoffs: 0 };

  /* ---------------------------------------------------------- templates */

  const selectTemplate = async (id: string) => {
    await save.flush();
    setSelectedId(id);
    setPane("editor");
  };

  const createTemplate = async (
    name: string,
    description: string | null,
  ): Promise<string | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from(TABLES.templates as any)
      .insert({ created_by: user.id, name: name.trim(), description: description?.trim() || null })
      .select("id")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Failed to create workflow");
      return null;
    }
    return (data as any).id as string;
  };

  const submitCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const id = await createTemplate(newName, newDesc);
    setCreating(false);
    if (!id) return;
    setNewName("");
    setNewDesc("");
    setCreateOpen(false);
    setSelectedId(id);
    setPane("editor");
    await load();
    // A brand-new workflow is an empty canvas — give it a first phase so there
    // is somewhere to type instead of one lonely "Add phase" button.
    await addPhaseTo(id, 0, "Phase 1");
  };

  const createFromStarter = async (starter: (typeof STARTER_WORKFLOWS)[number]) => {
    setCreating(true);
    try {
      const id = await createTemplate(starter.name, starter.description);
      if (!id) return;
      for (const [pIdx, ph] of starter.phases.entries()) {
        const { data: phRow } = await supabase
          .from(TABLES.phases as any)
          .insert({
            template_id: id,
            position: pIdx,
            name: ph.name,
            description: ph.description ?? null,
            requires_signoff: !!ph.requires_signoff,
          })
          .select("id")
          .single();
        const phId = (phRow as any)?.id as string | undefined;
        if (!phId || !ph.items.length) continue;
        await supabase.from(TABLES.items as any).insert(
          ph.items.map((it, idx) => ({
            phase_id: phId,
            position: idx,
            kind: it.kind,
            label: it.label,
            required: !!it.required,
          })),
        );
      }
      toast.success(`Created “${starter.name}”`);
      setStartersOpen(false);
      setSelectedId(id);
      setPane("editor");
      await load();
    } finally {
      setCreating(false);
    }
  };

  const duplicateTemplate = async (t: Template) => {
    const id = await createTemplate(`${t.name} (copy)`, t.description);
    if (!id) return;
    const tPhases = phases
      .filter((p) => p.template_id === t.id)
      .sort((a, b) => a.position - b.position);
    for (const [idx, ph] of tPhases.entries()) {
      const { data: newPh } = await supabase
        .from(TABLES.phases as any)
        .insert({
          template_id: id,
          position: idx,
          name: ph.name,
          description: ph.description,
          requires_signoff: ph.requires_signoff,
        })
        .select("id")
        .single();
      const newPhId = (newPh as any)?.id as string | undefined;
      if (!newPhId) continue;
      const phItems = itemsByPhase.get(ph.id) ?? [];
      if (phItems.length) {
        await supabase.from(TABLES.items as any).insert(
          phItems.map((it, i) => ({
            phase_id: newPhId,
            position: i,
            kind: it.kind,
            label: it.label,
            required: it.required,
          })),
        );
      }
    }
    toast.success("Workflow duplicated");
    setSelectedId(id);
    await load();
  };

  const toggleArchived = async (t: Template) => {
    setTemplates((xs) => xs.map((x) => (x.id === t.id ? { ...x, archived: !x.archived } : x)));
    const ok = await save.runImmediate(() =>
      supabase
        .from(TABLES.templates as any)
        .update({ archived: !t.archived })
        .eq("id", t.id),
    );
    if (!ok)
      setTemplates((xs) => xs.map((x) => (x.id === t.id ? { ...x, archived: t.archived } : x)));
    else toast.success(t.archived ? "Workflow restored" : "Workflow archived");
  };

  const deleteTemplate = async (t: Template) => {
    if (
      !(await confirm({
        title: "Delete workflow",
        description: `“${t.name}” and all of its phases and steps will be removed. Projects already running this workflow keep their copy.`,
        confirmText: "Delete workflow",
        variant: "destructive",
      }))
    )
      return;
    const { error } = await supabase
      .from(TABLES.templates as any)
      .delete()
      .eq("id", t.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (selectedId === t.id) {
      setSelectedId(null);
      setPane("list");
    }
    void load();
  };

  const updateTemplate = (id: string, patch: Partial<Template>) => {
    setTemplates((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    save.queueSave(TABLES.templates, id, patch as Record<string, unknown>);
  };

  /* ------------------------------------------------------------- phases */

  const addPhaseTo = async (templateId: string, position: number, name: string) => {
    const { data, error } = await supabase
      .from(TABLES.phases as any)
      .insert({ template_id: templateId, position, name })
      .select("id, template_id, position, name, description, requires_signoff")
      .single();
    if (error || !data) {
      toast.error("Couldn't add that phase");
      return null;
    }
    const phase = data as unknown as Phase;
    setPhases((xs) => [...xs, phase]);
    setCollapsed((m) => ({ ...m, [phase.id]: false }));
    setFocusPhaseId(phase.id);
    return phase;
  };

  const addPhase = async () => {
    if (!selectedId) return;
    await addPhaseTo(selectedId, selectedPhases.length, `Phase ${selectedPhases.length + 1}`);
  };

  const updatePhase = (id: string, patch: Partial<Phase>) => {
    setPhases((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    save.queueSave(TABLES.phases, id, patch as Record<string, unknown>);
  };

  const deletePhase = async (ph: Phase) => {
    const count = (itemsByPhase.get(ph.id) ?? []).length;
    if (
      count > 0 &&
      !(await confirm({
        title: "Delete phase",
        description: `“${ph.name || "Untitled phase"}” and its ${count} step${count === 1 ? "" : "s"} will be removed.`,
        confirmText: "Delete phase",
        variant: "destructive",
      }))
    )
      return;
    const prevPhases = phases;
    const prevItems = items;
    setPhases((xs) => xs.filter((x) => x.id !== ph.id));
    setItems((xs) => xs.filter((x) => x.phase_id !== ph.id));
    const ok = await save.runImmediate(() =>
      supabase
        .from(TABLES.phases as any)
        .delete()
        .eq("id", ph.id),
    );
    if (!ok) {
      setPhases(prevPhases);
      setItems(prevItems);
    }
  };

  const duplicatePhase = async (ph: Phase) => {
    if (!selectedId) return;
    const position = ph.position + 1;
    const after = selectedPhases.filter((p) => p.position > ph.position);
    const { data, error } = await supabase
      .from(TABLES.phases as any)
      .insert({
        template_id: selectedId,
        position,
        name: `${ph.name} (copy)`,
        description: ph.description,
        requires_signoff: ph.requires_signoff,
      })
      .select("id, template_id, position, name, description, requires_signoff")
      .single();
    if (error || !data) {
      toast.error("Couldn't duplicate that phase");
      return;
    }
    const newPhase = data as unknown as Phase;
    const source = itemsByPhase.get(ph.id) ?? [];
    let newItems: Item[] = [];
    if (source.length) {
      const { data: its } = await supabase
        .from(TABLES.items as any)
        .insert(
          source.map((it, i) => ({
            phase_id: newPhase.id,
            position: i,
            kind: it.kind,
            label: it.label,
            required: it.required,
          })),
        )
        .select("id, phase_id, position, kind, label, required");
      newItems = ((its as any[]) ?? []) as Item[];
    }
    // Push everything after the source phase down one slot.
    setPhases((xs) => [
      ...xs.map((x) => (after.some((a) => a.id === x.id) ? { ...x, position: x.position + 1 } : x)),
      newPhase,
    ]);
    setItems((xs) => [...xs, ...newItems]);
    await Promise.all(
      after.map((p) =>
        supabase
          .from(TABLES.phases as any)
          .update({ position: p.position + 1 })
          .eq("id", p.id),
      ),
    );
  };

  const reorderPhases = async (from: number, to: number) => {
    const reordered = arrayMove(selectedPhases, from, to);
    setPhases((xs) => {
      const others = xs.filter((x) => x.template_id !== selectedId);
      return [...others, ...reordered.map((p, idx) => ({ ...p, position: idx }))];
    });
    await save.runImmediate(async () => {
      const results = await Promise.all(
        reordered.map((p, idx) =>
          supabase
            .from(TABLES.phases as any)
            .update({ position: idx })
            .eq("id", p.id),
        ),
      );
      const bad = results.find((r: any) => r?.error);
      if (bad) throw (bad as any).error;
    });
  };

  /* -------------------------------------------------------------- items */

  const addItem = async (phaseId: string, kind: ItemKind) => {
    const position = (itemsByPhase.get(phaseId) ?? []).length;
    const { data, error } = await supabase
      .from(TABLES.items as any)
      .insert({ phase_id: phaseId, position, kind, label: "", required: false })
      .select("id, phase_id, position, kind, label, required")
      .single();
    if (error || !data) {
      toast.error("Couldn't add that step");
      return;
    }
    const item = data as unknown as Item;
    setItems((xs) => [...xs, item]);
    setFocusItemId(item.id);
  };

  const updateItem = (id: string, patch: Partial<Item>) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    save.queueSave(TABLES.items, id, patch as Record<string, unknown>);
  };

  const deleteItem = async (id: string) => {
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== id));
    const ok = await save.runImmediate(() =>
      supabase
        .from(TABLES.items as any)
        .delete()
        .eq("id", id),
    );
    if (!ok) setItems(prev);
  };

  const reorderItems = async (phaseId: string, from: number, to: number) => {
    const list = itemsByPhase.get(phaseId) ?? [];
    const reordered = arrayMove(list, from, to);
    setItems((xs) => {
      const others = xs.filter((x) => x.phase_id !== phaseId);
      return [...others, ...reordered.map((it, idx) => ({ ...it, position: idx }))];
    });
    await save.runImmediate(async () => {
      const results = await Promise.all(
        reordered.map((it, idx) =>
          supabase
            .from(TABLES.items as any)
            .update({ position: idx })
            .eq("id", it.id),
        ),
      );
      const bad = results.find((r: any) => r?.error);
      if (bad) throw (bad as any).error;
    });
  };

  /* ---------------------------------------------------------------- dnd */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const a = active.data.current as { type?: string; phaseId?: string } | undefined;
    const o = over.data.current as { type?: string; phaseId?: string } | undefined;
    if (a?.type === "phase") {
      // An expanded phase is mostly steps, so the nearest droppable under the
      // cursor is usually one of its rows. Resolve that back to its phase
      // instead of dropping the gesture on the floor.
      const overPhaseId = o?.type === "phase" ? String(over.id) : o?.phaseId;
      if (!overPhaseId || overPhaseId === active.id) return;
      const from = selectedPhases.findIndex((p) => p.id === active.id);
      const to = selectedPhases.findIndex((p) => p.id === overPhaseId);
      if (from >= 0 && to >= 0) void reorderPhases(from, to);
      return;
    }
    if (a?.type === "item" && o?.type === "item" && a.phaseId && a.phaseId === o.phaseId) {
      const list = itemsByPhase.get(a.phaseId) ?? [];
      const from = list.findIndex((i) => i.id === active.id);
      const to = list.findIndex((i) => i.id === over.id);
      if (from >= 0 && to >= 0) void reorderItems(a.phaseId, from, to);
    }
  };

  /* --------------------------------------------------------------- view */

  const allCollapsed = selectedPhases.length > 0 && selectedPhases.every((p) => collapsed[p.id]);

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => setStartersOpen(true)}>
        <Sparkles className="mr-1.5 h-4 w-4" />
        Starters
      </Button>
      <Button size="sm" onClick={() => setCreateOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        New workflow
      </Button>
    </div>
  );

  return (
    <div className={embedded ? "" : "container mx-auto max-w-6xl px-4 pb-24 pt-4 md:pt-6"}>
      {embedded ? (
        <div className="flex justify-end">{headerActions}</div>
      ) : (
        <PageHeader
          backTo="/settings"
          backLabel="Settings"
          eyebrow="Workspace tools"
          title="Workflow templates"
          description="Phases the crew works through in order — checklist items, photo prompts, notes, and sign-off gates."
          actions={headerActions}
        />
      )}

      {loading ? (
        <Card className={cn(SURFACE_CARD, "mt-6 flex items-center justify-center p-12")}>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </Card>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows yet"
          description="Build a workflow once — Pre-Job, Install, Inspection, Handover — then apply it to any project. Start from a proven one or design your own."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setStartersOpen(true)}>
                <Sparkles className="mr-1.5 h-4 w-4" />
                Start from a template
              </Button>
              <Button variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Blank workflow
              </Button>
            </div>
          }
          className="mt-6"
        />
      ) : (
        <BuilderLayout
          pane={pane}
          rail={
            <BuilderRail
              label="Workflows"
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search workflows…"
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived((s) => !s)}
              footer={
                <AddTarget onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  New workflow
                </AddTarget>
              }
            >
              {visibleTemplates.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No workflows match “{search}”.
                </li>
              ) : (
                visibleTemplates.map((t) => {
                  const c = countsFor(t.id);
                  return (
                    <BuilderRailItem
                      key={t.id}
                      active={selectedId === t.id}
                      name={t.name}
                      archived={t.archived}
                      meta={`${c.phases} phase${c.phases === 1 ? "" : "s"} · ${c.items} step${c.items === 1 ? "" : "s"}`}
                      onSelect={() => void selectTemplate(t.id)}
                    />
                  );
                })
              )}
            </BuilderRail>
          }
          canvas={
            selected ? (
              <>
                <BuilderBackToList label="All workflows" onClick={() => setPane("list")} />
                <BuilderCanvas>
                  <BuilderTitleBar
                    icon={<WorkflowIcon className="h-4.5 w-4.5" />}
                    title={selected.name}
                    description={selected.description ?? ""}
                    titlePlaceholder="Workflow name"
                    descriptionPlaceholder="When should the crew use this workflow?"
                    onTitleChange={(v) => updateTemplate(selected.id, { name: v })}
                    onDescriptionChange={(v) =>
                      updateTemplate(selected.id, { description: v || null })
                    }
                    saveState={save.state}
                    stats={
                      <>
                        <StatChip icon={ListTree}>
                          {stats.phases} phase{stats.phases === 1 ? "" : "s"}
                        </StatChip>
                        <StatChip icon={CircleDot}>
                          {stats.items} step{stats.items === 1 ? "" : "s"}
                        </StatChip>
                        {stats.required > 0 && (
                          <StatChip>
                            <span className="text-amber-600 dark:text-amber-400">
                              {stats.required} required
                            </span>
                          </StatChip>
                        )}
                        {stats.signoffs > 0 && (
                          <StatChip icon={Signature}>
                            {stats.signoffs} sign-off{stats.signoffs === 1 ? "" : "s"}
                          </StatChip>
                        )}
                      </>
                    }
                    banner={
                      selected.archived ? (
                        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-[11.5px] font-semibold text-muted-foreground">
                          <Archive className="h-3.5 w-3.5" />
                          Archived — it won't show up when applying a workflow to a project.
                        </div>
                      ) : null
                    }
                    actions={
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="hidden sm:inline-flex"
                          onClick={() => setPreviewOpen(true)}
                        >
                          <Eye className="mr-1.5 h-4 w-4" />
                          Preview
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Workflow actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem
                              className="sm:hidden"
                              onClick={() => setPreviewOpen(true)}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              Preview
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void duplicateTemplate(selected)}>
                              <Copy className="mr-2 h-4 w-4" />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void toggleArchived(selected)}>
                              {selected.archived ? (
                                <>
                                  <ArchiveRestore className="mr-2 h-4 w-4" />
                                  Restore
                                </>
                              ) : (
                                <>
                                  <Archive className="mr-2 h-4 w-4" />
                                  Archive
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => void deleteTemplate(selected)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete workflow
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    }
                  />

                  <div className="px-4 pb-5 pt-4 sm:px-6">
                    {selectedPhases.length > 1 && (
                      <div className="mb-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsed(
                              allCollapsed
                                ? {}
                                : Object.fromEntries(selectedPhases.map((p) => [p.id, true])),
                            )
                          }
                          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {allCollapsed ? (
                            <ChevronsUpDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronsDownUp className="h-3.5 w-3.5" />
                          )}
                          {allCollapsed ? "Expand all" : "Collapse all"}
                        </button>
                      </div>
                    )}

                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      modifiers={[restrictToVerticalAxis]}
                      onDragEnd={onDragEnd}
                    >
                      <SortableContext
                        items={selectedPhases.map((p) => p.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="relative space-y-2.5">
                          {/* Connector between the numbered phase badges. Cards
                              come later in the DOM and carry bg-card, so it only
                              shows through in the gaps — left-[47px] centres it
                              under the badge (10px card pad + 20px handle + 4px
                              gap + half of the 28px badge). */}
                          {selectedPhases.length > 1 && (
                            <span
                              aria-hidden
                              className="absolute bottom-6 left-[47px] top-6 w-px bg-border"
                            />
                          )}
                          {selectedPhases.map((ph, idx) => (
                            <PhaseCard
                              key={ph.id}
                              index={idx}
                              phase={ph}
                              items={itemsByPhase.get(ph.id) ?? []}
                              collapsed={!!collapsed[ph.id]}
                              autoFocus={focusPhaseId === ph.id}
                              onFocused={() => setFocusPhaseId(null)}
                              focusItemId={focusItemId}
                              onItemFocused={() => setFocusItemId(null)}
                              onToggle={() => setCollapsed((m) => ({ ...m, [ph.id]: !m[ph.id] }))}
                              onUpdate={(patch) => updatePhase(ph.id, patch)}
                              onDelete={() => void deletePhase(ph)}
                              onDuplicate={() => void duplicatePhase(ph)}
                              onAddItem={(kind) => void addItem(ph.id, kind)}
                              onUpdateItem={updateItem}
                              onDeleteItem={(id) => void deleteItem(id)}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>

                    <AddTarget className="mt-3 py-3" onClick={() => void addPhase()}>
                      <Plus className="h-4 w-4" />
                      Add phase
                    </AddTarget>
                  </div>
                </BuilderCanvas>
              </>
            ) : (
              <Card
                className={cn(
                  SURFACE_CARD,
                  "flex flex-col items-center justify-center gap-2 p-16 text-center",
                )}
              >
                <WorkflowIcon className="h-6 w-6 text-muted-foreground/70" />
                <p className="text-sm font-semibold">Select a workflow to edit</p>
              </Card>
            )
          }
        />
      )}

      {/* ---------------------------------------------------------- dialogs */}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>
              Name it after the job type. You'll add phases and steps next.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="wf-name">Name</Label>
              <Input
                id="wf-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) {
                    e.preventDefault();
                    void submitCreate();
                  }
                }}
                placeholder="e.g. HVAC install"
                autoFocus
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="wf-desc">Description (optional)</Label>
              <Textarea
                id="wf-desc"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={2}
                placeholder="When should the crew use this?"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitCreate()} disabled={!newName.trim() || creating}>
              {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={startersOpen} onOpenChange={setStartersOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Start from a proven workflow</DialogTitle>
            <DialogDescription>
              Each one is a full set of phases and steps. Rename, reorder, or delete anything after.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-3">
            {STARTER_WORKFLOWS.map((s) => {
              const steps = s.phases.reduce((n, p) => n + p.items.length, 0);
              return (
                <Card key={s.name} className={cn(SURFACE_CARD, "flex flex-col p-4")}>
                  <div className="font-display text-lg font-bold tracking-[-0.3px]">{s.name}</div>
                  <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
                    {s.description}
                  </p>
                  <ol className="mt-3 space-y-1">
                    {s.phases.map((p, i) => (
                      <li
                        key={p.name}
                        className="flex items-center gap-2 text-[11.5px] text-muted-foreground"
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-bold">
                          {i + 1}
                        </span>
                        <span className="truncate font-semibold text-foreground/80">{p.name}</span>
                        {p.requires_signoff && (
                          <Signature className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                      </li>
                    ))}
                  </ol>
                  <div className="mt-3 text-[11px] font-semibold text-muted-foreground">
                    {s.phases.length} phases · {steps} steps
                  </div>
                  <Button
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => void createFromStarter(s)}
                    disabled={creating}
                  >
                    Use this workflow
                  </Button>
                </Card>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Field preview</DialogTitle>
            <DialogDescription>
              How “{selected?.name}” looks to the crew on a project.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto rounded-2xl border border-border bg-muted/25 p-3">
            <WorkflowPreview phases={selectedPhases} itemsByPhase={itemsByPhase} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ====================================================================== */

function PhaseCard({
  index,
  phase,
  items,
  collapsed,
  autoFocus,
  onFocused,
  focusItemId,
  onItemFocused,
  onToggle,
  onUpdate,
  onDelete,
  onDuplicate,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
}: {
  index: number;
  phase: Phase;
  items: Item[];
  collapsed: boolean;
  autoFocus: boolean;
  onFocused: () => void;
  focusItemId: string | null;
  onItemFocused: () => void;
  onToggle: () => void;
  onUpdate: (patch: Partial<Phase>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddItem: (kind: ItemKind) => void;
  onUpdateItem: (id: string, patch: Partial<Item>) => void;
  onDeleteItem: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: phase.id,
    data: { type: "phase" },
  });
  const nameRef = useRef<HTMLInputElement>(null);
  const [showDescription, setShowDescription] = useState(!!phase.description);

  useEffect(() => {
    if (autoFocus) {
      nameRef.current?.focus();
      nameRef.current?.select();
      onFocused();
    }
  }, [autoFocus, onFocused]);

  const required = items.filter((i) => i.required).length;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group/phase relative rounded-2xl border border-border bg-card transition-shadow",
        isDragging && "z-30 opacity-90 shadow-[0px_18px_36px_-20px_rgba(16,25,41,0.55)]",
      )}
    >
      <div className="flex items-start gap-1 px-2.5 py-2.5">
        <DragHandle className="mt-1" {...attributes} {...listeners} />
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand phase" : "Collapse phase"}
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-extrabold transition-colors",
            collapsed
              ? "border-border bg-muted text-muted-foreground hover:border-primary/40 hover:text-foreground"
              : "border-primary/25 bg-primary/10 text-primary",
          )}
        >
          {index + 1}
        </button>

        <div className="min-w-0 flex-1 pl-1">
          <QuietInput
            ref={nameRef}
            value={phase.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="Phase name"
            aria-label="Phase name"
            className="text-[15px] font-bold"
          />
          {(showDescription || phase.description) && (
            <QuietTextarea
              value={phase.description ?? ""}
              onChange={(e) => onUpdate({ description: e.target.value || null })}
              placeholder="What has to be true before this phase is done?"
              aria-label="Phase description"
              className="text-xs text-muted-foreground"
            />
          )}
          {collapsed && (
            <p className="px-2 pt-0.5 text-[11.5px] font-semibold text-muted-foreground">
              {items.length} step{items.length === 1 ? "" : "s"}
              {required > 0 && ` · ${required} required`}
              {phase.requires_signoff && " · sign-off"}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onUpdate({ requires_signoff: !phase.requires_signoff })}
            aria-pressed={phase.requires_signoff}
            title={
              phase.requires_signoff
                ? "Sign-off required to close this phase"
                : "No sign-off required"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wide transition-colors",
              phase.requires_signoff
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border text-muted-foreground/70 hover:border-primary/30 hover:text-foreground",
            )}
          >
            <Signature className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign-off</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                aria-label="Phase actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setShowDescription((s) => !s)}>
                {showDescription || phase.description ? "Hide description" : "Add description"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="mr-2 h-4 w-4" />
                Duplicate phase
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete phase
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand phase" : "Collapse phase"}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", collapsed && "-rotate-90")}
            />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="border-t border-border/70 px-2.5 py-2.5">
          {items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              No steps yet — add the first thing the crew does in this phase.
            </p>
          ) : (
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {items.map((it) => (
                  <StepRow
                    key={it.id}
                    item={it}
                    autoFocus={focusItemId === it.id}
                    onFocused={onItemFocused}
                    onChange={(patch) => onUpdateItem(it.id, patch)}
                    onDelete={() => onDeleteItem(it.id)}
                    onAddAfter={() => onAddItem(it.kind)}
                  />
                ))}
              </ul>
            </SortableContext>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {KIND_ORDER.map((kind) => {
              const meta = KIND_META[kind];
              const Icon = meta.icon;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onAddItem(kind)}
                  title={meta.hint}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[11.5px] font-bold text-muted-foreground transition-colors hover:border-primary/45 hover:bg-primary/[0.04] hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <Icon className="h-3.5 w-3.5" />
                  {meta.short}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StepRow({
  item,
  autoFocus,
  onFocused,
  onChange,
  onDelete,
  onAddAfter,
}: {
  item: Item;
  autoFocus: boolean;
  onFocused: () => void;
  onChange: (patch: Partial<Item>) => void;
  onDelete: () => void;
  onAddAfter: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "item", phaseId: item.phase_id },
  });
  const inputRef = useRef<HTMLInputElement>(null);
  // A row created by "add step" starts empty and is discarded if you walk away
  // without naming it — so the builder never accumulates blank rows.
  const removed = useRef(false);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      onFocused();
    }
  }, [autoFocus, onFocused]);

  const meta = KIND_META[item.kind];
  const Icon = meta.icon;

  const remove = () => {
    if (removed.current) return;
    removed.current = true;
    onDelete();
  };

  /**
   * Discard a never-named row, but only once focus actually leaves it —
   * otherwise reaching for the type chip on a row you just added would delete
   * it out from under you.
   */
  const discardIfUnnamed = (e: React.FocusEvent<HTMLInputElement>) => {
    if (item.label.trim()) return;
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.closest("li")?.contains(next)) return;
    remove();
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-1.5 rounded-xl border border-border bg-background/60 px-1.5 py-1.5 transition-colors hover:border-primary/30",
        isDragging && "z-30 opacity-90 shadow-[0px_14px_28px_-18px_rgba(16,25,41,0.55)]",
      )}
    >
      <DragHandle {...attributes} {...listeners} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={`${meta.label} — click to change`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[10.5px] font-extrabold uppercase tracking-wide transition-opacity hover:opacity-80",
              meta.tint,
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{meta.short}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Step type
          </DropdownMenuLabel>
          {KIND_ORDER.map((kind) => {
            const m = KIND_META[kind];
            const I = m.icon;
            return (
              <DropdownMenuItem key={kind} onClick={() => onChange({ kind })}>
                <I className="mr-2 h-4 w-4" />
                <span className="flex-1">
                  {m.label}
                  <span className="block text-[11px] text-muted-foreground">{m.hint}</span>
                </span>
                {item.kind === kind && <CheckSquare className="ml-2 h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <QuietInput
        ref={inputRef}
        value={item.label}
        onChange={(e) => onChange({ label: e.target.value })}
        onBlur={discardIfUnnamed}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (item.label.trim()) onAddAfter();
            else e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.currentTarget.blur();
          } else if (e.key === "Backspace" && !item.label) {
            e.preventDefault();
            remove();
          }
        }}
        placeholder={meta.placeholder}
        aria-label="Step label"
      />

      <RequiredToggle required={item.required} onToggle={(v) => onChange({ required: v })} />

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-60"
        onMouseDown={(e) => e.preventDefault()}
        onClick={remove}
        aria-label="Delete step"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

/**
 * Read-only rendering of the workflow as the crew meets it — the answer to
 * "what am I actually building here?" without leaving the designer.
 */
function WorkflowPreview({
  phases,
  itemsByPhase,
}: {
  phases: Phase[];
  itemsByPhase: Map<string, Item[]>;
}) {
  if (phases.length === 0)
    return (
      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
        Add a phase to see the preview.
      </p>
    );
  return (
    <div className="space-y-2">
      {phases.map((ph, idx) => {
        const its = itemsByPhase.get(ph.id) ?? [];
        return (
          <div
            key={ph.id}
            className={cn(
              "rounded-2xl border bg-card",
              idx === 0 ? "border-primary/40 ring-1 ring-primary/10" : "border-border",
            )}
          >
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className="text-sm font-bold">{ph.name || "Untitled phase"}</span>
              {idx === 0 && (
                <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary">
                  Now
                </span>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">0 / {its.length}</span>
            </div>
            <div className="space-y-1.5 border-t border-border px-3 py-2.5">
              {ph.description && (
                <p className="pb-1 text-xs text-muted-foreground">{ph.description}</p>
              )}
              {its.length === 0 && <p className="text-xs text-muted-foreground">No steps yet.</p>}
              {its.map((it) => {
                if (it.kind === "check")
                  return (
                    <div
                      key={it.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3 py-2"
                    >
                      <Checkbox checked={false} disabled aria-hidden />
                      <span className="flex-1 text-sm">{it.label || "Untitled step"}</span>
                      {it.required && (
                        <span className="text-[10px] font-extrabold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          Required
                        </span>
                      )}
                    </div>
                  );
                const M = KIND_META[it.kind];
                const I = M.icon;
                return (
                  <div
                    key={it.id}
                    className="rounded-xl border border-border bg-background/60 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <I className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 text-sm font-medium">
                        {it.label || "Untitled step"}
                      </span>
                      {it.required && (
                        <span className="text-[10px] font-extrabold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          Required
                        </span>
                      )}
                    </div>
                    <div className="mt-2 rounded-lg border border-dashed border-border px-3 py-2 text-center text-[11px] text-muted-foreground">
                      {it.kind === "photo" ? "Take / upload photo" : "Type a note…"}
                    </div>
                  </div>
                );
              })}
              {ph.requires_signoff && (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                  <Signature className="h-4 w-4" />
                  Sign off when this phase is verified.
                  <span className="ml-auto rounded-md bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground">
                    Sign off
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
