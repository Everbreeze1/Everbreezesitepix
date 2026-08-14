import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutTemplate,
  Plus,
  Loader2,
  Trash2,
  ClipboardList,
  FileText,
  FolderOpen,
  Archive,
  ArchiveRestore,
  Lock,
  X,
  Search,
  Tag,
  Tags,
  Newspaper,
  MoreHorizontal,
  Copy,
  Pencil,
  Clock,
  Sparkles,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  History,
  Rocket,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { ChecklistTemplatesPage } from "@/features/settings/pages/ChecklistTemplatesPage";
import { WorkflowTemplatesPage } from "@/features/settings/pages/WorkflowTemplatesPage";
import { useConfirm } from "@/hooks/use-confirm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { useQuery } from "@tanstack/react-query";
import { getMyTeam } from "@/features/settings/api";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { PageTabStrip } from "@/components/PageTabStrip";
import { SURFACE_CARD } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { LabelChip, LabelPicker } from "@/features/photos/components/LabelPicker";
import { ApplyBlueprintDialog } from "@/features/settings/components/ApplyBlueprintDialog";
import { BlueprintOutcomePreview } from "@/features/settings/components/BlueprintOutcomePreview";
import { KIND_OUTCOME, KIND_ORDER } from "@/features/settings/components/blueprint-outcomes";
import { LabelsManager } from "@/features/settings/components/LabelsManager";
import { LabelSetsManager } from "@/features/settings/components/LabelSetsManager";
import { ReportTemplatesManager } from "@/features/settings/components/ReportTemplatesManager";
import { DocumentTemplatesManager } from "@/features/settings/components/DocumentTemplatesManager";

import { ensureLabel, useLabelCatalog } from "@/hooks/use-label-catalog";

/**
 * Tab keys, exported so the route's `validateSearch` and this page cannot
 * disagree about what a valid tab is.
 */
export const TEMPLATE_TAB_KEYS = [
  "blueprints",
  "checklists",
  "workflows",
  "documents",
  "reports",
  "label-sets",
  "labels",
] as const;

export type TemplateTabKey = (typeof TEMPLATE_TAB_KEYS)[number];

export type TemplatesSearch = {
  tab?: TemplateTabKey;
  /** Opens straight to one blueprint - used by links from projects. */
  blueprint?: string;
};

interface ProjectTemplate {
  id: string;
  team_id: string | null;
  created_by: string;
  name: string;
  description: string | null;
  labels: string[] | null;
  archived: boolean;
  created_at: string;
}
interface ChecklistTemplate {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
}
interface AttachedChecklist {
  id: string;
  project_template_id: string;
  checklist_template_id: string;
  position: number;
}

type TemplateItemKind = "checklist" | "document" | "report" | "label_set" | "workflow";
interface TemplateItem {
  id: string;
  project_template_id: string;
  kind: TemplateItemKind;
  ref_id: string;
  position: number;
}

/** One recorded apply, from the `project_blueprint_applications` ledger. */
interface BlueprintApplication {
  id: string;
  blueprint_id: string;
  project_id: string;
  created_at: string;
  counts: Record<string, number> | null;
  failed_count: number;
  project_name: string | null;
}

/**
 * A row in the blueprint's contents list.
 *
 * `legacy` rows live in `project_template_checklists`, which predates the
 * generic `project_template_items` table. Both still apply, so both have to be
 * editable here - see `persistOrder` for how reordering reconciles them.
 */
interface SectionRow {
  id: string;
  legacy: boolean;
  kind: TemplateItemKind;
  refId: string;
  name: string;
  missing: boolean;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

const KIND_META: Record<
  TemplateItemKind,
  { label: string; icon: typeof ClipboardList; tint: string }
> = {
  checklist: {
    label: KIND_OUTCOME.checklist.label,
    icon: ClipboardList,
    tint: KIND_OUTCOME.checklist.tint,
  },
  workflow: {
    label: KIND_OUTCOME.workflow.label,
    icon: WorkflowIcon,
    tint: KIND_OUTCOME.workflow.tint,
  },
  document: {
    label: KIND_OUTCOME.document.label,
    icon: FileText,
    tint: KIND_OUTCOME.document.tint,
  },
  report: { label: KIND_OUTCOME.report.label, icon: Newspaper, tint: KIND_OUTCOME.report.tint },
  label_set: { label: KIND_OUTCOME.label_set.label, icon: Tag, tint: KIND_OUTCOME.label_set.tint },
};

/** Which library tab authors a given blueprint section kind. */
const KIND_TAB: Record<TemplateItemKind, TemplateTabKey> = {
  checklist: "checklists",
  workflow: "workflows",
  document: "documents",
  report: "reports",
  label_set: "label-sets",
};

export function TemplatesPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const search = useSearch({ from: "/_app/templates" });
  const fetchTeam = getMyTeam;
  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await fetchTeam()) as any,
    enabled: !!user,
    staleTime: 60_000,
  });

  const { isPro, isTeam } = useSubscription();
  const myRole: string | null = teamData?.myRole ?? null;
  const canManage = !myRole || myRole === "owner" || myRole === "admin";
  const gated = !isPro;

  const tab: TemplateTabKey = search.tab ?? "blueprints";
  const setTab = useCallback(
    (next: TemplateTabKey) => {
      void navigate({
        to: "/templates",
        search: (prev: TemplatesSearch) => ({ ...prev, tab: next }),
        replace: true,
      });
    },
    [navigate],
  );

  const [tplItems, setTplItems] = useState<TemplateItem[]>([]);
  const [addKind, setAddKind] = useState<TemplateItemKind | "">("");
  const [addRefId, setAddRefId] = useState("");
  const [docTpls, setDocTpls] = useState<Array<{ id: string; name: string }>>([]);
  const [reportTpls, setReportTpls] = useState<Array<{ id: string; name: string }>>([]);
  const [labelSetTpls, setLabelSetTpls] = useState<Array<{ id: string; name: string }>>([]);
  const [workflowTpls, setWorkflowTpls] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([]);
  const [attached, setAttached] = useState<AttachedChecklist[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(search.blueprint ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newLabels, setNewLabels] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [reordering, setReordering] = useState(false);

  const [applyOpen, setApplyOpen] = useState(false);

  /**
   * `null` means the ledger is unreadable - most likely migration
   * 20260810000000 has not been run on this environment yet. The usage panel
   * hides itself rather than showing a permanently empty "never used".
   */
  const [applications, setApplications] = useState<BlueprintApplication[] | null>(null);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const loadApplications = useCallback(async () => {
    const { data, error } = await supabase
      .from("project_blueprint_applications" as any)
      .select("id, blueprint_id, project_id, created_at, counts, failed_count, projects(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      // Reported, not swallowed. Without this line the usage panel simply
      // vanishes and there is nothing anywhere - console, UI or network tab
      // summary - saying the ledger could not be read.
      console.warn("[blueprint-applications] ledger read failed", {
        code: (error as { code?: string }).code,
        message: error.message,
      });
      setApplications(null);
      return;
    }
    setApplications(
      ((data as any[]) ?? []).map((r) => ({
        id: r.id,
        blueprint_id: r.blueprint_id,
        project_id: r.project_id,
        created_at: r.created_at,
        counts: (r.counts as Record<string, number> | null) ?? {},
        failed_count: r.failed_count ?? 0,
        project_name: r.projects?.name ?? null,
      })),
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [tplRes, chkRes, attRes, itemsRes, docRes, repRes, lsRes, wfRes] = await Promise.all([
      supabase
        .from("project_templates" as any)
        .select("id, team_id, created_by, name, description, labels, archived, created_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("checklist_templates" as any)
        .select("id, name, description, archived")
        .order("created_at", { ascending: true }),
      supabase
        .from("project_template_checklists" as any)
        .select("id, project_template_id, checklist_template_id, position")
        .order("position", { ascending: true }),
      supabase
        .from("project_template_items" as any)
        .select("id, project_template_id, kind, ref_id, position")
        .order("position", { ascending: true }),
      supabase
        .from("document_templates" as any)
        .select("id, name, archived")
        .eq("archived", false)
        .order("name"),
      supabase
        .from("report_templates" as any)
        .select("id, name, archived")
        .eq("archived", false)
        .order("name"),
      supabase
        .from("label_sets" as any)
        .select("id, name, archived")
        .eq("archived", false)
        .order("name"),
      supabase
        .from("workflow_templates" as any)
        .select("id, name, archived")
        .eq("archived", false)
        .order("name"),
    ]);
    const list = ((tplRes.data as any[]) ?? []) as ProjectTemplate[];
    setTemplates(list);
    setChecklistTemplates(((chkRes.data as any[]) ?? []) as ChecklistTemplate[]);
    setAttached(((attRes.data as any[]) ?? []) as AttachedChecklist[]);
    setTplItems(((itemsRes.data as any[]) ?? []) as TemplateItem[]);
    setDocTpls(((docRes.data as any[]) ?? []).map((x: any) => ({ id: x.id, name: x.name })));
    setReportTpls(((repRes.data as any[]) ?? []).map((x: any) => ({ id: x.id, name: x.name })));
    setLabelSetTpls(((lsRes.data as any[]) ?? []).map((x: any) => ({ id: x.id, name: x.name })));
    setWorkflowTpls(((wfRes.data as any[]) ?? []).map((x: any) => ({ id: x.id, name: x.name })));
    setSelectedId((cur) => {
      if (cur && list.find((t) => t.id === cur)) return cur;
      if (!list.length) return null;
      return (list.find((t) => !t.archived) ?? list[0])?.id ?? null;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user || gated) return;
    void load();
    void loadApplications();
  }, [user, gated, load, loadApplications]);

  // A `?blueprint=` link should win over whatever was selected, and only once -
  // the param is cleared so a later click in the rail is not snapped back.
  useEffect(() => {
    if (!search.blueprint) return;
    setSelectedId(search.blueprint);
    void navigate({
      to: "/templates",
      search: (prev: TemplatesSearch): TemplatesSearch => ({
        ...prev,
        tab: "blueprints",
        blueprint: undefined,
      }),
      replace: true,
    });
  }, [search.blueprint, navigate]);

  const labelCatalog = useLabelCatalog();

  // All labels = union of catalog + any used by templates (covers labels created elsewhere).
  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const l of labelCatalog.rows) set.add(l.name);
    for (const t of templates) for (const l of t.labels ?? []) set.add(l);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [templates, labelCatalog.rows]);

  /** Section count per blueprint, across both storage tables. */
  const sectionCountByTemplate = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of attached) m.set(a.project_template_id, (m.get(a.project_template_id) ?? 0) + 1);
    for (const i of tplItems) m.set(i.project_template_id, (m.get(i.project_template_id) ?? 0) + 1);
    return m;
  }, [attached, tplItems]);

  const applyCountByTemplate = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of applications ?? []) m.set(a.blueprint_id, (m.get(a.blueprint_id) ?? 0) + 1);
    return m;
  }, [applications]);

  // Usage counts for the Labels tab.
  const templateUsage = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of templates) {
      if (t.archived) continue;
      for (const l of t.labels ?? []) {
        const k = l.toLowerCase();
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return m;
  }, [templates]);

  const [projectUsage, setProjectUsage] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!user || gated) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("projects").select("labels").limit(1000);
      if (cancelled) return;
      const m = new Map<string, number>();
      for (const row of (data as any[] | null) ?? []) {
        for (const l of (row.labels as string[] | null) ?? []) {
          const k = String(l).toLowerCase();
          m.set(k, (m.get(k) ?? 0) + 1);
        }
      }
      setProjectUsage(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, gated, tab]);

  const visibleTemplates = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return templates.filter((t) => {
      if (!showArchived && t.archived) return false;
      if (q) {
        const hay = `${t.name} ${t.description ?? ""} ${(t.labels ?? []).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [templates, showArchived, searchText]);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const libFor = useCallback(
    (k: TemplateItemKind): Array<{ id: string; name: string }> =>
      k === "checklist"
        ? checklistTemplates.map((c) => ({ id: c.id, name: c.name }))
        : k === "document"
          ? docTpls
          : k === "report"
            ? reportTpls
            : k === "label_set"
              ? labelSetTpls
              : workflowTpls,
    [checklistTemplates, docTpls, reportTpls, labelSetTpls, workflowTpls],
  );

  /**
   * The selected blueprint's contents in apply order.
   *
   * Legacy checklist links come first because `applyProjectBlueprintService`
   * processes them first - the list has to show the order that will actually
   * happen, not a prettier one.
   */
  const sections: SectionRow[] = useMemo(() => {
    if (!selectedId) return [];
    const nameOf = (kind: TemplateItemKind, refId: string) =>
      libFor(kind).find((x) => x.id === refId)?.name ?? null;
    const legacy: SectionRow[] = attached
      .filter((a) => a.project_template_id === selectedId)
      .map((a) => {
        const name = nameOf("checklist", a.checklist_template_id);
        return {
          id: a.id,
          legacy: true,
          kind: "checklist" as TemplateItemKind,
          refId: a.checklist_template_id,
          name: name ?? "Deleted checklist template",
          missing: name === null,
        };
      });
    const rest: SectionRow[] = tplItems
      .filter((i) => i.project_template_id === selectedId)
      .map((i) => {
        const name = nameOf(i.kind, i.ref_id);
        return {
          id: i.id,
          legacy: false,
          kind: i.kind,
          refId: i.ref_id,
          name: name ?? `Deleted ${KIND_META[i.kind].label.toLowerCase()} template`,
          missing: name === null,
        };
      });
    return [...legacy, ...rest];
  }, [selectedId, attached, tplItems, libFor]);

  /** Contents in the shape the outcome preview and the apply dialog expect. */
  const previewItems = useMemo(
    () => sections.filter((s) => !s.missing).map((s) => ({ kind: s.kind, name: s.name })),
    [sections],
  );

  const selectedApplications = useMemo(
    () => (applications ?? []).filter((a) => a.blueprint_id === selectedId),
    [applications, selectedId],
  );

  const updateLabels = async (t: ProjectTemplate, labels: string[]) => {
    const prev = templates;
    setTemplates((xs) => xs.map((x) => (x.id === t.id ? { ...x, labels } : x)));
    // Ensure new labels exist in the global catalog so their colors persist.
    if (user) {
      await Promise.all(labels.map((l) => ensureLabel(l, teamData?.team?.id ?? null, user.id)));
    }
    const { error } = await supabase
      .from("project_templates" as any)
      .update({ labels })
      .eq("id", t.id);
    if (error) {
      toast.error("Failed to update labels");
      setTemplates(prev);
    }
  };

  const createTemplate = async () => {
    if (!newName.trim() || !user) return;
    setCreating(true);
    try {
      // Persist new labels into the catalog first.
      await Promise.all(newLabels.map((l) => ensureLabel(l, teamData?.team?.id ?? null, user.id)));
      const { data, error } = await supabase
        .from("project_templates" as any)
        .insert({
          created_by: user.id,
          team_id: teamData?.team?.id ?? null,
          name: newName.trim(),
          description: newDesc.trim() || null,
          labels: newLabels,
        })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Failed");

      toast.success("Blueprint created");
      setNewName("");
      setNewDesc("");
      setNewLabels([]);
      setCreateOpen(false);
      setSelectedId((data as any).id);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create blueprint");
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (t: ProjectTemplate) => {
    setEditName(t.name);
    setEditDesc(t.description ?? "");
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!selected || !editName.trim()) return;
    setSavingEdit(true);
    const { error } = await supabase
      .from("project_templates" as any)
      .update({ name: editName.trim(), description: editDesc.trim() || null })
      .eq("id", selected.id);
    setSavingEdit(false);
    if (error) {
      toast.error("Failed to save");
      return;
    }
    toast.success("Blueprint updated");
    setEditOpen(false);
    void load();
  };

  const duplicateTemplate = async (t: ProjectTemplate) => {
    if (!user) return;
    const { data, error } = await supabase
      .from("project_templates" as any)
      .insert({
        created_by: user.id,
        team_id: teamData?.team?.id ?? null,
        name: `${t.name} (copy)`,
        description: t.description,
        labels: t.labels ?? [],
      })
      .select("id")
      .single();
    if (error || !data) {
      toast.error("Failed to duplicate");
      return;
    }
    const newId = (data as any).id as string;
    const links = attached.filter((a) => a.project_template_id === t.id);
    if (links.length) {
      const { error: linksErr } = await supabase.from("project_template_checklists" as any).insert(
        links.map((l) => ({
          project_template_id: newId,
          checklist_template_id: l.checklist_template_id,
          position: l.position,
        })),
      );
      if (linksErr) {
        toast.error(linksErr.message ?? "Couldn't copy this blueprint's checklists");
        void load();
        return;
      }
    }
    // Copying only the legacy checklist links silently dropped every document,
    // report, workflow and label set - a "duplicate" of a five-section
    // blueprint could come back with none of them.
    const items = tplItems.filter((i) => i.project_template_id === t.id);
    if (items.length) {
      const { error: itemsErr } = await supabase.from("project_template_items" as any).insert(
        items.map((i) => ({
          project_template_id: newId,
          kind: i.kind,
          ref_id: i.ref_id,
          position: i.position,
        })),
      );
      // Discarding this error reproduced the exact symptom the comment above
      // describes: the rows are selected correctly now, but a failed insert
      // still produced a "duplicated" blueprint with none of its sections.
      if (itemsErr) {
        toast.error(itemsErr.message ?? "Couldn't copy this blueprint's sections");
        void load();
        return;
      }
    }
    toast.success("Blueprint duplicated");
    setSelectedId(newId);
    void load();
  };

  const toggleArchived = async (t: ProjectTemplate) => {
    const { error } = await supabase
      .from("project_templates" as any)
      .update({ archived: !t.archived })
      .eq("id", t.id);
    if (error) toast.error("Failed");
    else void load();
  };

  const deleteTemplate = async (t: ProjectTemplate) => {
    if (
      // Without confirmText the action button reads "Continue", which is a
      // strange thing for a permanent delete to say.
      !(await confirm({
        title: `Delete "${t.name}"?`,
        description:
          "Projects it has already been applied to keep everything it created. This cannot be undone.",
        confirmText: "Delete blueprint",
        variant: "destructive",
      }))
    )
      return;
    const { error } = await supabase
      .from("project_templates" as any)
      .delete()
      .eq("id", t.id);
    if (error) toast.error("Failed");
    else {
      if (selectedId === t.id) setSelectedId(null);
      void load();
    }
  };

  const addOfKind = async (k: TemplateItemKind, refId: string) => {
    if (!selectedId || !refId) return;
    if (k === "checklist") {
      // New checklist links go into the generic table too. The legacy table is
      // read for what is already there, never written to again.
      const alreadyLegacy = attached.some(
        (a) => a.project_template_id === selectedId && a.checklist_template_id === refId,
      );
      if (alreadyLegacy) return;
    }
    const { error } = await supabase.from("project_template_items" as any).insert({
      project_template_id: selectedId,
      kind: k,
      ref_id: refId,
      // max+1 over this blueprint's rows, not `sections.length`. `removeSection`
      // never renumbers survivors, and `sections` also counts legacy
      // `project_template_checklists` rows - so length was both gap-blind and
      // inflated, and could hand the new section a number a sibling held.
      position:
        tplItems
          .filter((i) => i.project_template_id === selectedId)
          .reduce((max, i) => Math.max(max, i.position), -1) + 1,
    });
    if (error) toast.error(error.message ?? "Failed to add");
    else void load();
  };

  const removeSection = async (row: SectionRow) => {
    const table = row.legacy ? "project_template_checklists" : "project_template_items";
    if (row.legacy) setAttached((xs) => xs.filter((x) => x.id !== row.id));
    else setTplItems((xs) => xs.filter((x) => x.id !== row.id));
    const { error } = await supabase
      .from(table as any)
      .delete()
      .eq("id", row.id);
    if (error) {
      toast.error("Failed to remove");
      void load();
    }
  };

  /**
   * Writes a new section order.
   *
   * The apply service always runs legacy `project_template_checklists` rows
   * before `project_template_items`, so an order that interleaves the two
   * cannot be expressed while a blueprint still has legacy rows. Reordering
   * therefore migrates them first: copy each legacy link into the generic table
   * (dropping any that already exist there), then delete the legacy rows. The
   * copy is verified before the delete, so a failure leaves the blueprint
   * exactly as it was rather than half-moved.
   */
  const persistOrder = async (next: SectionRow[]) => {
    if (!selectedId) return;
    setReordering(true);
    try {
      const legacyRows = next.filter((r) => r.legacy);
      if (legacyRows.length) {
        const existingRefs = new Set(
          tplItems
            .filter((i) => i.project_template_id === selectedId && i.kind === "checklist")
            .map((i) => i.ref_id),
        );
        const toInsert = legacyRows.filter((r) => !existingRefs.has(r.refId));
        if (toInsert.length) {
          const { error } = await supabase.from("project_template_items" as any).insert(
            toInsert.map((r) => ({
              project_template_id: selectedId,
              kind: "checklist",
              ref_id: r.refId,
              position: next.indexOf(r),
            })),
          );
          if (error) throw error;
        }
        const { error: delErr } = await supabase
          .from("project_template_checklists" as any)
          .delete()
          .in(
            "id",
            legacyRows.map((r) => r.id),
          );
        if (delErr) throw delErr;
        // The insert above had no row ids to work with, so positions are only
        // correct relative to each other. Re-read to get the real ids, then
        // write the absolute order in one pass.
        const { data } = await supabase
          .from("project_template_items" as any)
          .select("id, kind, ref_id")
          .eq("project_template_id", selectedId);
        const idByRef = new Map(
          ((data as any[]) ?? []).map((r) => [`${r.kind}:${r.ref_id}`, r.id as string]),
        );
        const migrated = await Promise.all(
          next.map((r, idx) => {
            const id = idByRef.get(`${r.kind}:${r.refId}`);
            if (!id) return Promise.resolve();
            return supabase
              .from("project_template_items" as any)
              .update({ position: idx })
              .eq("id", id);
          }),
        );
        // Must throw so the catch below reports it. Silence here is the worst
        // case in this function: the legacy rows have already been migrated and
        // deleted above, so a failed position pass leaves the blueprint
        // permanently converted but still in the old order, saying nothing.
        const badMigrated = migrated.find((r: any) => r?.error);
        if (badMigrated) throw (badMigrated as any).error;
      } else {
        const results = await Promise.all(
          next.map((r, idx) =>
            supabase
              .from("project_template_items" as any)
              .update({ position: idx })
              .eq("id", r.id),
          ),
        );
        // Without this the reorder is a silent no-op: the spinner runs, the row
        // doesn't move, and the catch that would explain why never fires.
        const bad = results.find((r: any) => r?.error);
        if (bad) throw (bad as any).error;
      }
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't reorder sections");
      await load();
    } finally {
      setReordering(false);
    }
  };

  const moveSection = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    void persistOrder(next);
  };

  const tabCounts: Record<TemplateTabKey, number> = {
    blueprints: templates.filter((t) => !t.archived).length,
    checklists: checklistTemplates.filter((c) => !c.archived).length,
    workflows: workflowTpls.length,
    documents: docTpls.length,
    reports: reportTpls.length,
    "label-sets": labelSetTpls.length,
    labels: labelCatalog.rows.length,
  };
  const buildingBlocks =
    tabCounts.checklists +
    tabCounts.workflows +
    tabCounts.documents +
    tabCounts.reports +
    tabCounts["label-sets"];

  if (teamLoading) {
    return (
      <div className="container mx-auto max-w-5xl px-4 pt-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (gated) {
    return (
      <div className="container mx-auto max-w-3xl px-4 pb-24 pt-6">
        <Card className="mt-6 p-8 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-semibold">Upgrade to use Templates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Build a job setup once, then apply it to every project. Available on the Pro and Team
            plans.
          </p>
          <Button className="mt-4" onClick={() => navigate({ to: "/pricing" })}>
            View plans
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* pt-only responsive scaling. `md:py-10` used to sit here, and because a
          variant shorthand outranks the unvariated `pb-32`, desktop bottom
          padding collapsed to 40px - less than the 84px the floating camera
          button occupies, so the last row of every tab sat under it. */}
      <div className="container mx-auto px-3 pb-32 pt-4 sm:px-4 sm:pt-6 md:pt-10">
        {/* Hero - same shell, ornament, badge and stats rail as Projects and the
            project home page. Templates was the last product surface still
            wearing the plain settings header, which is most of why it read as a
            bolted-on admin screen rather than the thing the workflow runs on. */}
        <div className="relative overflow-hidden rounded-[32px] bg-sidebar">
          <div className="pointer-events-none absolute -right-24 -top-28 h-[288px] w-[288px] rounded-full border-[28px] border-sidebar-ring/20" />
          <div className="relative flex flex-col gap-7 p-6 sm:px-10 sm:py-9">
            <div className="flex flex-col gap-7 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <span className="inline-flex items-center rounded-full bg-sidebar-ring px-3 py-1 text-[10px] font-extrabold uppercase tracking-[1.4px] text-sidebar-foreground">
                  Workspace tools
                </span>
                <h1 className="font-display mt-3 truncate text-2xl font-bold leading-tight tracking-tight text-sidebar-foreground sm:text-3xl">
                  Templates
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-sidebar-foreground/60">
                  Build a job setup once as a blueprint, then apply it to any project - its
                  checklists, workflows, documents, reports and labels all land in place.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {canManage && (
                  <Button
                    onClick={() => {
                      setTab("blueprints");
                      setCreateOpen(true);
                    }}
                    className="h-10 rounded-lg bg-sidebar-foreground px-5 font-bold text-sidebar shadow-sm hover:bg-sidebar-foreground/90"
                  >
                    <Plus className="mr-2 h-4 w-4 text-sidebar-ring" /> New blueprint
                  </Button>
                )}
              </div>
            </div>

            {/* Stats rail - states what the library holds and cuts to it. */}
            <div className="flex flex-col gap-4 border-t border-sidebar-border pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-[10px] font-extrabold uppercase tracking-[1.5px] text-sidebar-foreground/45">
                  Library
                </span>
                <span className="text-xs font-bold text-sidebar-foreground">
                  {tabCounts.blueprints} {tabCounts.blueprints === 1 ? "blueprint" : "blueprints"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-5 text-xs font-bold text-sidebar-foreground/60">
                <button
                  type="button"
                  onClick={() => setTab("checklists")}
                  className="inline-flex items-center gap-2 rounded-md transition hover:text-sidebar-foreground"
                >
                  <LayoutTemplate className="h-4 w-4 text-sidebar-ring" />
                  {buildingBlocks} reusable pieces
                </button>
                {applications !== null && (
                  <span className="inline-flex items-center gap-2">
                    <Rocket className="h-4 w-4 text-sidebar-ring" />
                    {applications.length} applied to projects
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* The same strip Projects and the project home page use, so the three
            hub screens can no longer drift apart. */}
        <PageTabStrip
          className="mt-3.5"
          value={tab}
          onChange={(key) => setTab(key as TemplateTabKey)}
          items={[
            {
              key: "blueprints",
              label: "Project blueprints",
              count: tabCounts.blueprints,
              icon: FolderOpen,
            },
            {
              key: "checklists",
              label: "Checklists",
              count: tabCounts.checklists,
              icon: ClipboardList,
            },
            {
              key: "workflows",
              label: "Workflows",
              count: tabCounts.workflows,
              icon: WorkflowIcon,
            },
            { key: "documents", label: "Documents", count: tabCounts.documents, icon: FileText },
            { key: "reports", label: "Reports", count: tabCounts.reports, icon: Newspaper },
            {
              key: "label-sets",
              label: "Label sets",
              count: tabCounts["label-sets"],
              icon: Tags,
            },
            { key: "labels", label: "Labels", count: tabCounts.labels, icon: Tag },
          ]}
        />

        <div className="mt-6">
          {tab === "blueprints" && (
            <BlueprintsTab
              loading={loading}
              canManage={canManage}
              isTeam={isTeam}
              templates={templates}
              visibleTemplates={visibleTemplates}
              sectionCountByTemplate={sectionCountByTemplate}
              applyCountByTemplate={applyCountByTemplate}
              applicationsAvailable={applications !== null}
              selectedApplications={selectedApplications}
              selected={selected}
              selectedId={selectedId}
              onSelect={setSelectedId}
              search={searchText}
              onSearch={setSearchText}
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived((s) => !s)}
              onCreate={() => setCreateOpen(true)}
              sections={sections}
              previewItems={previewItems}
              reordering={reordering}
              onMove={moveSection}
              onRemove={removeSection}
              onPickKind={(k) => {
                setAddKind(k);
                setAddRefId("");
              }}
              onApply={() => setApplyOpen(true)}
              onEdit={openEdit}
              onDuplicate={duplicateTemplate}
              onArchiveToggle={toggleArchived}
              onDelete={deleteTemplate}
              onUpdateLabels={updateLabels}
              allLabels={allLabels}
              teamId={teamData?.team?.id ?? null}
              userId={user?.id}
              onGoToTab={setTab}
              onUpgrade={() => navigate({ to: "/pricing" })}
            />
          )}

          {tab === "checklists" && <ChecklistTemplatesPage embedded />}
          {tab === "workflows" && <WorkflowTemplatesPage embedded />}
          {tab === "documents" && (
            <DocumentTemplatesManager teamId={teamData?.team?.id ?? null} canManage={canManage} />
          )}
          {tab === "reports" && (
            <ReportTemplatesManager teamId={teamData?.team?.id ?? null} canManage={canManage} />
          )}
          {tab === "label-sets" && (
            <LabelSetsManager teamId={teamData?.team?.id ?? null} canManage={canManage} />
          )}
          {tab === "labels" && user && (
            <LabelsManager
              teamId={teamData?.team?.id ?? null}
              userId={user.id}
              canManage={canManage}
              templateUsage={templateUsage}
              projectUsage={projectUsage}
            />
          )}
        </div>
      </div>

      {/* Section picker for the chosen kind */}
      {canManage && addKind && (
        <Dialog
          open={!!addKind}
          onOpenChange={(o) => {
            if (!o) {
              setAddKind("");
              setAddRefId("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add {KIND_META[addKind].label.toLowerCase()}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{KIND_OUTCOME[addKind].becomes}.</p>
              {(() => {
                const used = new Set(
                  sections.filter((s) => s.kind === addKind).map((s) => s.refId),
                );
                const available = libFor(addKind).filter((x) => !used.has(x.id));
                if (available.length === 0) {
                  return (
                    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
                      No more {KIND_META[addKind].label.toLowerCase()} templates available.{" "}
                      <button
                        className="font-semibold text-primary hover:underline"
                        onClick={() => {
                          const target = KIND_TAB[addKind];
                          setAddKind("");
                          setTab(target);
                        }}
                      >
                        Create one first
                      </button>
                      .
                    </div>
                  );
                }
                return (
                  <Select value={addRefId} onValueChange={setAddRefId}>
                    <SelectTrigger className="h-10 rounded-lg">
                      <SelectValue
                        placeholder={`Pick a ${KIND_META[addKind].label.toLowerCase()}…`}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {available.map((x) => (
                        <SelectItem key={x.id} value={x.id}>
                          {x.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setAddKind("");
                  setAddRefId("");
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={!addRefId}
                onClick={async () => {
                  const k = addKind;
                  const ref = addRefId;
                  setAddKind("");
                  setAddRefId("");
                  await addOfKind(k, ref);
                }}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add to blueprint
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create dialog */}
      {canManage && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New project blueprint</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Name
                </label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Residential roof inspection"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Description (optional)
                </label>
                <Textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={2}
                  className="mt-1"
                  placeholder="When should the crew reach for this one?"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Labels (optional)
                </label>
                <div className="mt-1 min-h-[44px] rounded-md border border-input bg-background px-2 py-2">
                  <LabelPicker
                    value={newLabels}
                    onChange={setNewLabels}
                    suggestions={allLabels}
                    triggerLabel="Add label"
                    teamId={teamData?.team?.id ?? null}
                    userId={user?.id}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Every project this blueprint is applied to picks these labels up.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void createTemplate()} disabled={!newName.trim() || creating}>
                {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit dialog */}
      {canManage && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit blueprint</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Name
                </label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Description
                </label>
                <Textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void saveEdit()} disabled={!editName.trim() || savingEdit}>
                {savingEdit && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {selected && (
        <ApplyBlueprintDialog
          open={applyOpen}
          onOpenChange={setApplyOpen}
          blueprintId={selected.id}
          blueprintName={selected.name}
          items={previewItems}
          labels={selected.labels ?? []}
          companyName={teamData?.team?.name ?? null}
          onApplied={() => void loadApplications()}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Blueprints tab                                                            */
/* -------------------------------------------------------------------------- */

function BlueprintsTab(props: {
  loading: boolean;
  canManage: boolean;
  isTeam: boolean;
  templates: ProjectTemplate[];
  visibleTemplates: ProjectTemplate[];
  sectionCountByTemplate: Map<string, number>;
  applyCountByTemplate: Map<string, number>;
  applicationsAvailable: boolean;
  selectedApplications: BlueprintApplication[];
  selected: ProjectTemplate | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (v: string) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  onCreate: () => void;
  sections: SectionRow[];
  previewItems: Array<{ kind: TemplateItemKind; name: string }>;
  reordering: boolean;
  onMove: (index: number, dir: -1 | 1) => void;
  onRemove: (row: SectionRow) => void;
  onPickKind: (k: TemplateItemKind) => void;
  onApply: () => void;
  onEdit: (t: ProjectTemplate) => void;
  onDuplicate: (t: ProjectTemplate) => void;
  onArchiveToggle: (t: ProjectTemplate) => void;
  onDelete: (t: ProjectTemplate) => void;
  onUpdateLabels: (t: ProjectTemplate, labels: string[]) => void;
  allLabels: string[];
  teamId: string | null;
  userId?: string;
  onGoToTab: (t: TemplateTabKey) => void;
  onUpgrade: () => void;
}) {
  const {
    loading,
    canManage,
    isTeam,
    templates,
    visibleTemplates,
    sectionCountByTemplate,
    applyCountByTemplate,
    applicationsAvailable,
    selectedApplications,
    selected,
    selectedId,
    onSelect,
    search,
    onSearch,
    showArchived,
    onToggleArchived,
    onCreate,
    sections,
    previewItems,
    reordering,
    onMove,
    onRemove,
    onPickKind,
    onApply,
    onEdit,
    onDuplicate,
    onArchiveToggle,
    onDelete,
    onUpdateLabels,
    allLabels,
    teamId,
    userId,
    onGoToTab,
    onUpgrade,
  } = props;

  if (loading) {
    return (
      <Card className="flex items-center justify-center p-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (templates.length === 0) {
    return <BlueprintsIntro canManage={canManage} onCreate={onCreate} />;
  }

  const hasContent = previewItems.length > 0 || (selected?.labels?.length ?? 0) > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* Library rail */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search blueprints…"
            className="h-10 rounded-xl pl-9"
          />
        </div>

        {canManage && (
          <Button className="w-full justify-center rounded-xl" onClick={onCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            New blueprint
          </Button>
        )}

        <div className={cn(SURFACE_CARD, "overflow-hidden")}>
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <span className="text-xs font-bold text-muted-foreground">
              {visibleTemplates.length} blueprint{visibleTemplates.length === 1 ? "" : "s"}
            </span>
            <button
              className="text-xs font-bold text-muted-foreground hover:text-foreground"
              onClick={onToggleArchived}
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </button>
          </div>
          {visibleTemplates.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              No blueprints match your search.
            </p>
          ) : (
            <ul className="max-h-[62vh] divide-y divide-border/60 overflow-y-auto">
              {visibleTemplates.map((t) => {
                const isSelected = selectedId === t.id;
                const sectionCount = sectionCountByTemplate.get(t.id) ?? 0;
                const applyCount = applyCountByTemplate.get(t.id) ?? 0;
                return (
                  <li key={t.id} className="relative">
                    {isSelected && (
                      <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />
                    )}
                    <button
                      onClick={() => onSelect(t.id)}
                      className={cn(
                        "flex w-full flex-col items-start gap-1.5 px-3.5 py-3 text-left transition-colors",
                        isSelected ? "bg-primary/[0.06]" : "hover:bg-muted/50",
                      )}
                    >
                      <div className="flex w-full items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-bold">{t.name}</span>
                        {t.archived && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            Archived
                          </Badge>
                        )}
                      </div>
                      {t.description && (
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {t.description}
                        </p>
                      )}
                      {(t.labels?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {t.labels!.slice(0, 3).map((l) => (
                            <LabelChip key={l} label={l} size="xs" />
                          ))}
                          {(t.labels?.length ?? 0) > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{(t.labels?.length ?? 0) - 3}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="flex w-full items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <LayoutTemplate className="h-3 w-3" />
                          {sectionCount} section{sectionCount === 1 ? "" : "s"}
                        </span>
                        {applicationsAvailable && applyCount > 0 && (
                          <span className="inline-flex items-center gap-1 font-bold text-primary">
                            <Rocket className="h-3 w-3" />
                            used {applyCount}×
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Detail */}
      {!selected ? (
        <Card className="flex flex-col items-center justify-center gap-2 p-16 text-center">
          <Sparkles className="h-6 w-6 text-muted-foreground/70" />
          <p className="text-sm font-semibold">Select a blueprint</p>
          <p className="text-xs text-muted-foreground">
            Pick one from the list to see what it creates and apply it.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Header */}
          <div className={cn(SURFACE_CARD, "p-5")}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <LayoutTemplate className="h-4.5 w-4.5" />
                  </span>
                  <h2 className="font-display truncate text-xl font-bold tracking-tight">
                    {selected.name}
                  </h2>
                  {selected.archived && <Badge variant="outline">Archived</Badge>}
                </div>
                {selected.description && (
                  <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    {selected.description}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Created {timeAgo(selected.created_at)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <LayoutTemplate className="h-3.5 w-3.5" />
                    {sections.length} section{sections.length === 1 ? "" : "s"}
                  </span>
                  {applicationsAvailable && (
                    <span className="inline-flex items-center gap-1.5">
                      <Rocket className="h-3.5 w-3.5" />
                      {selectedApplications.length === 0
                        ? "Never applied yet"
                        : `Applied ${selectedApplications.length}×`}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* The action the whole page exists for. It sat behind no
                    explanation at all before: you could author a blueprint and
                    never find out what it did to anything. */}
                {isTeam ? (
                  <Button
                    size="sm"
                    className="rounded-lg"
                    onClick={onApply}
                    disabled={!hasContent}
                    title={hasContent ? undefined : "Add at least one section or label first"}
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    Apply to projects
                  </Button>
                ) : (
                  // Applying is enforced as a Team feature server-side. Saying
                  // so here beats letting someone build a blueprint and meet
                  // the restriction only at the moment they try to use it.
                  <Button size="sm" className="rounded-lg" onClick={onUpgrade}>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    Applying is on Team
                  </Button>
                )}
                {isTeam && (
                  <Button asChild variant="outline" size="sm" className="rounded-lg">
                    <Link to="/projects/new" search={{ blueprint: selected.id }}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      New project from this
                    </Link>
                  </Button>
                )}
                {canManage && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEdit(selected)}
                      className="rounded-lg"
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="rounded-lg"
                          aria-label="More actions"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => onDuplicate(selected)}>
                          <Copy className="mr-2 h-4 w-4" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onArchiveToggle(selected)}>
                          {selected.archived ? (
                            <>
                              <ArchiveRestore className="mr-2 h-4 w-4" />
                              Unarchive
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
                          onClick={() => onDelete(selected)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            </div>

            {/* Labels belong with the header: they are applied to the project
                alongside everything else, not a separate setting. */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
              <span className="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                <Tag className="h-3 w-3" />
                Labels
              </span>
              {canManage ? (
                <LabelPicker
                  value={selected.labels ?? []}
                  onChange={(next) => onUpdateLabels(selected, next)}
                  suggestions={allLabels}
                  triggerLabel="Add label"
                  teamId={teamId}
                  userId={userId}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {(selected.labels ?? []).map((l) => (
                    <LabelChip key={l} label={l} />
                  ))}
                  {(selected.labels?.length ?? 0) === 0 && (
                    <span className="text-xs text-muted-foreground">No labels yet.</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* What applying it does. This is the answer to "when I select a
              template, what happens to it?" and it comes before the builder on
              purpose - the outcome is the point, the parts list is detail. */}
          <div className={cn(SURFACE_CARD, "p-5")}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="font-manrope text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                  When you apply this
                </p>
                <h3 className="font-display mt-1.5 text-lg font-bold tracking-tight">
                  Here is the project you get
                </h3>
              </div>
              {hasContent && isTeam && (
                <Button size="sm" variant="ghost" className="rounded-lg" onClick={onApply}>
                  Apply now
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <BlueprintOutcomePreview
              className="mt-3"
              items={previewItems}
              labels={selected.labels ?? []}
            />
            {hasContent && (
              <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                Applying never overwrites anything: existing checklists, documents and labels on the
                project stay exactly as they are, and these are added alongside them.
              </p>
            )}
          </div>

          {/* Contents */}
          <div className={cn(SURFACE_CARD, "p-5")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-manrope text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                  Blueprint contents
                </p>
                <h3 className="font-display mt-1.5 text-lg font-bold tracking-tight">
                  {sections.length} section{sections.length === 1 ? "" : "s"}, applied in this order
                </h3>
              </div>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="rounded-lg">
                      <Plus className="mr-1.5 h-4 w-4" />
                      Add section
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    {KIND_ORDER.map((k) => {
                      const Icon = KIND_META[k].icon;
                      return (
                        <DropdownMenuItem
                          key={k}
                          className="items-start gap-2"
                          onClick={() => onPickKind(k)}
                        >
                          <span
                            className={cn(
                              "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded",
                              KIND_META[k].tint,
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">
                              {KIND_META[k].label}
                            </span>
                            <span className="block text-[11px] leading-snug text-muted-foreground">
                              {KIND_OUTCOME[k].becomes}
                            </span>
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {sections.length === 0 ? (
              <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-10 text-center">
                <LayoutTemplate className="h-6 w-6 text-muted-foreground/70" />
                <p className="mt-2 text-sm font-semibold">Nothing attached yet</p>
                <p className="mt-0.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
                  A blueprint is a bundle of things you have already built. Add checklists,
                  workflows, documents, reports or label sets and they all land on the project in
                  one click.
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {sections.map((r, idx) => {
                  const meta = KIND_META[r.kind];
                  const Icon = meta.icon;
                  return (
                    <li
                      key={`${r.legacy ? "chk" : "it"}-${r.id}`}
                      className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3.5 py-2.5 transition-colors hover:border-border"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground">
                        {idx + 1}
                      </div>
                      <span
                        className={cn(
                          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded",
                          meta.tint,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <Badge
                        variant="outline"
                        className="hidden shrink-0 text-[10px] sm:inline-flex"
                      >
                        {meta.label}
                      </Badge>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-sm font-semibold",
                            r.missing && "text-destructive",
                          )}
                        >
                          {r.name}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {r.missing
                            ? "The source template was deleted - remove this section"
                            : `→ ${KIND_OUTCOME[r.kind].becomes}`}
                        </span>
                      </span>
                      {canManage && (
                        <div className="flex shrink-0 items-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground disabled:opacity-30"
                            disabled={idx === 0 || reordering}
                            onClick={() => onMove(idx, -1)}
                            aria-label={`Move ${r.name} up`}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground disabled:opacity-30"
                            disabled={idx === sections.length - 1 || reordering}
                            onClick={() => onMove(idx, 1)}
                            aria-label={`Move ${r.name} down`}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => onRemove(r)}
                            aria-label={`Remove ${r.name}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {canManage && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                Need a new piece first? Build it under{" "}
                {(["checklists", "workflows", "documents", "reports", "label-sets"] as const).map(
                  (key, i, arr) => (
                    <span key={key}>
                      <button
                        className="font-semibold text-primary hover:underline"
                        onClick={() => onGoToTab(key)}
                      >
                        {key === "label-sets" ? "Label sets" : key[0].toUpperCase() + key.slice(1)}
                      </button>
                      {i < arr.length - 2 ? ", " : i === arr.length - 2 ? " or " : ""}
                    </span>
                  ),
                )}
                , then come back here and add it.
              </p>
            )}
          </div>

          {/*
           * Where it has been used.
           *
           * The card stays mounted when the ledger is unreadable and says so,
           * rather than deleting itself. Hiding it meant the one screen that
           * answers "where has this blueprint been used" silently ceased to
           * exist, and nothing distinguished that from a blueprint that had
           * genuinely never been applied.
           */}
          <div className={cn(SURFACE_CARD, "p-5")}>
            <p className="font-manrope text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
              Track record
            </p>
            <h3 className="font-display mt-1.5 text-lg font-bold tracking-tight">
              Where this blueprint has been used
            </h3>
            {!applicationsAvailable ? (
              <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                Usage history isn’t available on this environment yet, so we can’t show where this
                blueprint has been applied.
              </p>
            ) : selectedApplications.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                Not applied to any project yet. Every apply is recorded here, with what it created.
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {selectedApplications.slice(0, 12).map((a) => {
                  const total = Object.values(a.counts ?? {}).reduce((x, y) => x + y, 0);
                  return (
                    <li key={a.id}>
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: a.project_id }}
                        className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2 transition-colors hover:border-primary/30"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                          <FolderOpen className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {a.project_name ?? "Project"}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {total} item{total === 1 ? "" : "s"} created
                            {a.failed_count > 0 ? ` · ${a.failed_count} failed` : ""} ·{" "}
                            {timeAgo(a.created_at)}
                          </span>
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  );
                })}
                {selectedApplications.length > 12 && (
                  <li className="px-3 pt-1 text-[11px] text-muted-foreground">
                    <History className="mr-1 inline h-3 w-3" />
                    and {selectedApplications.length - 12} more
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  First-run explainer                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The zero-blueprint state does the teaching.
 *
 * "We have templates, but how do we apply them to projects, and how is that
 * going to look?" is not a question an empty list with a Create button
 * answers. Three steps, in the order the user will do them.
 */
function BlueprintsIntro({ canManage, onCreate }: { canManage: boolean; onCreate: () => void }) {
  const steps = [
    {
      icon: LayoutTemplate,
      title: "Build the pieces",
      body: "Checklists, workflows, documents, reports and label sets - each on its own tab above. Anything you save from a project lands there too.",
    },
    {
      icon: FolderOpen,
      title: "Bundle them into a blueprint",
      body: "A blueprint is the whole job setup: the checklists the crew runs, the paperwork it produces, the labels that file it.",
    },
    {
      icon: Rocket,
      title: "Apply it to projects",
      body: "One click on a new project or a dozen already running. Everything appears in the matching project tab, pre-filled with that project's details.",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className={cn(SURFACE_CARD, "p-5")}>
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <s.icon className="h-4 w-4" />
              </span>
              <span className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                Step {i + 1}
              </span>
            </div>
            <h3 className="mt-3 text-sm font-bold">{s.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>

      <EmptyState
        icon={LayoutTemplate}
        title="No project blueprints yet"
        description={
          canManage
            ? "Create one to standardise how a job gets set up - then apply it to any project in a click."
            : "Ask your account owner or an admin to create one."
        }
        action={
          canManage ? (
            <Button onClick={onCreate}>
              <Plus className="mr-1.5 h-4 w-4" />
              New blueprint
            </Button>
          ) : null
        }
      />
    </div>
  );
}
