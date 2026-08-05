import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  Check,
  MoreHorizontal,
  Copy,
  Pencil,
  Clock,
  Sparkles,
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { PageHeader } from "@/components/PageHeader";
import { LabelChip, LabelPicker } from "@/features/photos/components/LabelPicker";
import { LabelsManager } from "@/features/settings/components/LabelsManager";
import { LabelSetsManager } from "@/features/settings/components/LabelSetsManager";
import { ReportTemplatesManager } from "@/features/settings/components/ReportTemplatesManager";
import { DocumentTemplatesManager } from "@/features/settings/components/DocumentTemplatesManager";

import { ensureLabel, hexToChipStyle, useLabelCatalog } from "@/hooks/use-label-catalog";

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

export function TemplatesPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const fetchTeam = getMyTeam;
  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await fetchTeam()) as any,
    enabled: !!user,
    staleTime: 60_000,
  });

  const { isPro } = useSubscription();
  const myRole: string | null = teamData?.myRole ?? null;
  const canManage = !myRole || myRole === "owner" || myRole === "admin";
  const gated = !isPro;

  const [tab, setTab] = useState("projects");
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newLabels, setNewLabels] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [attaching, setAttaching] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [activeLabels, setActiveLabels] = useState<string[]>([]);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const load = async () => {
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
    if (list.length && (!selectedId || !list.find((t) => t.id === selectedId))) {
      const firstActive = list.find((t) => !t.archived) ?? list[0];
      setSelectedId(firstActive?.id ?? null);
    } else if (!list.length) {
      setSelectedId(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!user || gated) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, gated]);

  const labelCatalog = useLabelCatalog();
  const labelColorByName = (name: string) => {
    const r = labelCatalog.byName.get((name ?? "").trim().toLowerCase());
    return r?.color || "#3b82f6";
  };

  // All labels = union of catalog + any used by templates (covers labels created elsewhere).
  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const l of labelCatalog.rows) set.add(l.name);
    for (const t of templates) for (const l of t.labels ?? []) set.add(l);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [templates, labelCatalog.rows]);

  const countsByTemplate = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of attached) m.set(a.project_template_id, (m.get(a.project_template_id) ?? 0) + 1);
    return m;
  }, [attached]);

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
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (!showArchived && t.archived) return false;
      if (activeLabels.length && !activeLabels.every((l) => (t.labels ?? []).includes(l)))
        return false;
      if (q) {
        const hay = `${t.name} ${t.description ?? ""} ${(t.labels ?? []).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [templates, showArchived, search, activeLabels]);
  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const selectedAttached = attached.filter((a) => a.project_template_id === selectedId);
  const attachedIds = new Set(selectedAttached.map((a) => a.checklist_template_id));
  const availableChecklists = checklistTemplates.filter(
    (c) => !c.archived && !attachedIds.has(c.id),
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

      toast.success("Template created");
      setNewName("");
      setNewDesc("");
      setNewLabels([]);
      setCreateOpen(false);
      setSelectedId((data as any).id);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create template");
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
    toast.success("Template updated");
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
      await supabase.from("project_template_checklists" as any).insert(
        links.map((l) => ({
          project_template_id: newId,
          checklist_template_id: l.checklist_template_id,
          position: l.position,
        })),
      );
    }
    toast.success("Template duplicated");
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
    if (!(await confirm({ description: `Delete template "${t.name}"? This cannot be undone.`, variant: "destructive" }))) return;
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

  const addItem = async () => {
    if (!selectedId || !addKind || !addRefId) return;
    const items = tplItems.filter((i) => i.project_template_id === selectedId);
    const { error } = await supabase.from("project_template_items" as any).insert({
      project_template_id: selectedId,
      kind: addKind,
      ref_id: addRefId,
      position: items.length,
    });
    if (error) toast.error(error.message ?? "Failed to add");
    else {
      setAddKind("");
      setAddRefId("");
      void load();
    }
  };

  const detachItem = async (id: string) => {
    const prev = tplItems;
    setTplItems((xs) => xs.filter((x) => x.id !== id));
    const { error } = await supabase
      .from("project_template_items" as any)
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Failed");
      setTplItems(prev);
    }
  };

  const attachChecklist = async (checklistTemplateId: string) => {
    if (!selectedId || !checklistTemplateId) return;
    const position = selectedAttached.length;
    const { error } = await supabase.from("project_template_checklists" as any).insert({
      project_template_id: selectedId,
      checklist_template_id: checklistTemplateId,
      position,
    });
    if (error) toast.error(error.message ?? "Failed");
    else {
      setAttaching("");
      void load();
    }
  };

  const detachChecklist = async (id: string) => {
    const prev = attached;
    setAttached((xs) => xs.filter((x) => x.id !== id));
    const { error } = await supabase
      .from("project_template_checklists" as any)
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Failed");
      setAttached(prev);
    }
  };

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
        <PageHeader
          eyebrow="Workspace tools"
          title="Templates"
          description="Build reusable project blueprints with checklists, reports, and documents."
        />
        <Card className="mt-6 p-8 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-semibold">Upgrade to use Templates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Project Templates are available on the Pro and Team plans.
          </p>
          <Button className="mt-4" onClick={() => navigate({ to: "/pricing" })}>
            View plans
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 pb-24 pt-4 md:pt-6">
      <PageHeader
        eyebrow="Workspace tools"
        title="Templates"
        description="Create and manage reusable templates across your company — project setups, documents, checklists, reports, and the labels that organize them."
      />

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        {/*
          Left-aligned and scrollable rather than centred-and-wrapping: seven
          tabs wrapped onto a second row and floated to the middle of a
          full-width bar, which read as a layout accident. The divider splits
          the two real groups — things you author, and the taxonomy that
          organizes them.
        */}
        <TabsList className="mb-6 flex h-auto w-full justify-start gap-1 overflow-x-auto bg-muted/60 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="projects" className="shrink-0 gap-1.5">
            <FolderOpen className="h-3.5 w-3.5" />
            Project blueprints
          </TabsTrigger>
          <TabsTrigger value="documents" className="shrink-0 gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="checklists" className="shrink-0 gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" />
            Checklists
          </TabsTrigger>
          <TabsTrigger value="reports" className="shrink-0 gap-1.5">
            <Newspaper className="h-3.5 w-3.5" />
            Reports
          </TabsTrigger>
          <TabsTrigger value="workflows" className="shrink-0 gap-1.5">
            <WorkflowIcon className="h-3.5 w-3.5" />
            Workflows
          </TabsTrigger>
          <span className="mx-1 h-5 w-px shrink-0 self-center bg-border" aria-hidden />
          <TabsTrigger value="label-sets" className="shrink-0 gap-1.5">
            <Tags className="h-3.5 w-3.5" />
            Label sets
          </TabsTrigger>
          <TabsTrigger value="labels" className="shrink-0 gap-1.5">
            <Tag className="h-3.5 w-3.5" />
            Labels
          </TabsTrigger>
        </TabsList>

        <TabsContent value="label-sets" className="mt-6">
          <LabelSetsManager teamId={teamData?.team?.id ?? null} canManage={canManage} />
        </TabsContent>

        <TabsContent value="projects" className="mt-6">
          {loading ? (
            <Card className="flex items-center justify-center p-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </Card>
          ) : templates.length === 0 ? (
            <EmptyState
              icon={LayoutTemplate}
              title="No project templates yet"
              description={
                canManage
                  ? "Create a template to standardize how new projects are set up."
                  : "Ask your account owner or an admin to create one."
              }
              action={
                canManage ? (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    New project template
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
              {/* Sidebar */}
              <div className="space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search templates…"
                    className="h-10 rounded-xl pl-9"
                  />
                </div>

                {canManage && (
                  <Button
                    className="w-full justify-center rounded-xl"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    New template
                  </Button>
                )}

                <Card className="overflow-hidden p-0">
                  <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {visibleTemplates.length} template
                      {visibleTemplates.length === 1 ? "" : "s"}
                    </span>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowArchived((s) => !s)}
                    >
                      {showArchived ? "Hide archived" : "Show archived"}
                    </button>
                  </div>
                  {visibleTemplates.length === 0 ? (
                    <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                      No templates match your filters.
                    </p>
                  ) : (
                    <ul className="max-h-[60vh] divide-y divide-border/60 overflow-y-auto">
                      {visibleTemplates.map((t) => {
                        const isSelected = selectedId === t.id;
                        const count = countsByTemplate.get(t.id) ?? 0;
                        return (
                          <li key={t.id} className="relative">
                            {isSelected && (
                              <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />
                            )}
                            <button
                              onClick={() => setSelectedId(t.id)}
                              className={`flex w-full flex-col items-start gap-1.5 px-3.5 py-3 text-left transition-colors ${
                                isSelected ? "bg-primary/[0.06]" : "hover:bg-muted/50"
                              }`}
                            >
                              <div className="flex w-full items-start justify-between gap-2">
                                <span className="line-clamp-1 text-sm font-medium">{t.name}</span>
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
                                  <ClipboardList className="h-3 w-3" />
                                  {count} checklist{count === 1 ? "" : "s"}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {timeAgo(t.created_at)}
                                </span>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              </div>

              {/* Main detail */}
              {selected ? (
                <Card className="overflow-hidden p-0">
                  {/* Hero header */}
                  <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.04] via-background to-background px-6 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <LayoutTemplate className="h-4.5 w-4.5" />
                          </div>
                          <h2 className="truncate text-xl font-semibold tracking-tight">
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
                        </div>
                      </div>
                      {canManage && (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(selected)}
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
                              <DropdownMenuItem onClick={() => void duplicateTemplate(selected)}>
                                <Copy className="mr-2 h-4 w-4" />
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void toggleArchived(selected)}>
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
                                onClick={() => void deleteTemplate(selected)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Body */}
                  <div className="space-y-7 px-6 py-6">
                    {/* Labels */}
                    <section>
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Tag className="h-3 w-3" />
                        Labels
                      </div>
                      {canManage ? (
                        <LabelPicker
                          value={selected.labels ?? []}
                          onChange={(next) => void updateLabels(selected, next)}
                          suggestions={allLabels}
                          triggerLabel="Add label"
                          teamId={teamData?.team?.id ?? null}
                          userId={user?.id}
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
                    </section>

                    <Separator />

                    {/* Unified sections builder */}
                    {(() => {
                      const items = tplItems.filter((i) => i.project_template_id === selectedId);
                      type Row = {
                        key: string;
                        kind: TemplateItemKind;
                        name: string;
                        onRemove: () => void;
                      };
                      const kindMeta: Record<
                        TemplateItemKind,
                        {
                          label: string;
                          icon: React.ReactNode;
                          tint: string;
                          lib: Array<{ id: string; name: string }>;
                        }
                      > = {
                        checklist: {
                          label: "Checklist",
                          icon: <ClipboardList className="h-4 w-4" />,
                          tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                          lib: checklistTemplates.map((c) => ({ id: c.id, name: c.name })),
                        },
                        document: {
                          label: "Document",
                          icon: <FileText className="h-4 w-4" />,
                          tint: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                          lib: docTpls,
                        },
                        report: {
                          label: "Report",
                          icon: <FileText className="h-4 w-4" />,
                          tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
                          lib: reportTpls,
                        },
                        label_set: {
                          label: "Label set",
                          icon: <Tag className="h-4 w-4" />,
                          tint: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
                          lib: labelSetTpls,
                        },
                        workflow: {
                          label: "Workflow",
                          icon: <WorkflowIcon className="h-4 w-4" />,
                          tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
                          lib: workflowTpls,
                        },
                      };
                      const legacyRows: Row[] = selectedAttached.map((a) => ({
                        key: `chk-${a.id}`,
                        kind: "checklist" as TemplateItemKind,
                        name:
                          checklistTemplates.find((x) => x.id === a.checklist_template_id)?.name ??
                          "(deleted checklist)",
                        onRemove: () => void detachChecklist(a.id),
                      }));
                      const newRows: Row[] = items.map((it) => ({
                        key: `it-${it.id}`,
                        kind: it.kind,
                        name:
                          (kindMeta[it.kind].lib.find((x) => x.id === it.ref_id) as any)?.name ??
                          "(deleted)",
                        onRemove: () => void detachItem(it.id),
                      }));
                      const rows = [...legacyRows, ...newRows];

                      const counts: Record<TemplateItemKind, number> = {
                        checklist: 0,
                        document: 0,
                        report: 0,
                        label_set: 0,
                        workflow: 0,
                      };
                      for (const r of rows) counts[r.kind]++;

                      const availableFor = (k: TemplateItemKind) => {
                        if (k === "checklist") {
                          const used = new Set(
                            selectedAttached.map((a) => a.checklist_template_id),
                          );
                          return checklistTemplates
                            .filter((c) => !c.archived && !used.has(c.id))
                            .map((c) => ({ id: c.id, name: c.name }));
                        }
                        const used = new Set(
                          items.filter((i) => i.kind === k).map((i) => i.ref_id),
                        );
                        return kindMeta[k].lib.filter((x) => !used.has(x.id));
                      };

                      const addOfKind = async (k: TemplateItemKind, refId: string) => {
                        if (!selectedId || !refId) return;
                        if (k === "checklist") {
                          setAttaching(refId);
                          await attachChecklist(refId);
                          return;
                        }
                        const { error } = await supabase
                          .from("project_template_items" as any)
                          .insert({
                            project_template_id: selectedId,
                            kind: k,
                            ref_id: refId,
                            position: items.length,
                          });
                        if (error) toast.error(error.message ?? "Failed to add");
                        else void load();
                      };

                      return (
                        <section>
                          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold">Blueprint sections</h3>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Everything here is auto-created in the matching project tab when
                                this blueprint is applied.
                              </p>
                            </div>
                            {canManage && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" className="rounded-lg">
                                    <Plus className="mr-1.5 h-4 w-4" />
                                    Add section
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                  {(Object.keys(kindMeta) as TemplateItemKind[]).map((k) => (
                                    <DropdownMenuItem
                                      key={k}
                                      onClick={() => {
                                        setAddKind(k);
                                        setAddRefId("");
                                      }}
                                    >
                                      <span
                                        className={`mr-2 inline-flex h-6 w-6 items-center justify-center rounded ${kindMeta[k].tint}`}
                                      >
                                        {kindMeta[k].icon}
                                      </span>
                                      {kindMeta[k].label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>

                          {/* Preview strip */}
                          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                            {(Object.keys(kindMeta) as TemplateItemKind[]).map((k) => (
                              <div
                                key={k}
                                className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
                              >
                                <span
                                  className={`inline-flex h-7 w-7 items-center justify-center rounded ${kindMeta[k].tint}`}
                                >
                                  {kindMeta[k].icon}
                                </span>
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold leading-none">
                                    {counts[k]}
                                  </div>
                                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                    {kindMeta[k].label}
                                    {counts[k] === 1 ? "" : "s"}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Rows */}
                          {rows.length === 0 ? (
                            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-10 text-center">
                              <LayoutTemplate className="h-6 w-6 text-muted-foreground/70" />
                              <p className="mt-2 text-sm font-medium">Nothing attached yet</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Click <span className="font-medium">Add section</span> to bundle
                                checklists, documents, reports, workflows, or label sets.
                              </p>
                            </div>
                          ) : (
                            <ul className="space-y-2">
                              {rows.map((r, idx) => (
                                <li
                                  key={r.key}
                                  className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3.5 py-2.5 transition-colors hover:border-border"
                                >
                                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
                                    {idx + 1}
                                  </div>
                                  <span
                                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded ${kindMeta[r.kind].tint}`}
                                  >
                                    {kindMeta[r.kind].icon}
                                  </span>
                                  <Badge variant="outline" className="text-[10px]">
                                    {kindMeta[r.kind].label}
                                  </Badge>
                                  <span className="flex-1 truncate text-sm">{r.name}</span>
                                  {canManage && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                                      onClick={r.onRemove}
                                      aria-label="Remove"
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}

                          {/* Picker dialog for chosen kind */}
                          {canManage && addKind && (
                            <Dialog
                              open={!!addKind}
                              onOpenChange={(o) => {
                                if (!o) {
                                  setAddKind("" as TemplateItemKind | "");
                                  setAddRefId("");
                                }
                              }}
                            >
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>
                                    Add {kindMeta[addKind as TemplateItemKind].label.toLowerCase()}
                                  </DialogTitle>
                                </DialogHeader>
                                <div className="space-y-3">
                                  <p className="text-xs text-muted-foreground">
                                    Pick a saved{" "}
                                    {kindMeta[addKind as TemplateItemKind].label.toLowerCase()}{" "}
                                    template to include in this blueprint.
                                  </p>
                                  {availableFor(addKind as TemplateItemKind).length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
                                      No more{" "}
                                      {kindMeta[addKind as TemplateItemKind].label.toLowerCase()}{" "}
                                      templates available. Create one in the matching tab first.
                                    </div>
                                  ) : (
                                    <Select value={addRefId} onValueChange={setAddRefId}>
                                      <SelectTrigger className="h-10 rounded-lg">
                                        <SelectValue
                                          placeholder={`Pick a ${kindMeta[addKind as TemplateItemKind].label.toLowerCase()}…`}
                                        />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {availableFor(addKind as TemplateItemKind).map((x) => (
                                          <SelectItem key={x.id} value={x.id}>
                                            {x.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                </div>
                                <DialogFooter>
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      setAddKind("" as TemplateItemKind | "");
                                      setAddRefId("");
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    disabled={!addRefId}
                                    onClick={async () => {
                                      const k = addKind as TemplateItemKind;
                                      const ref = addRefId;
                                      setAddKind("" as TemplateItemKind | "");
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

                          {canManage && (
                            <p className="mt-3 text-[11px] text-muted-foreground">
                              Need a new template first? Open the{" "}
                              <button
                                className="text-primary hover:underline"
                                onClick={() => setTab("checklists")}
                              >
                                Checklists
                              </button>
                              ,{" "}
                              <button
                                className="text-primary hover:underline"
                                onClick={() => setTab("documents")}
                              >
                                Documents
                              </button>
                              ,{" "}
                              <button
                                className="text-primary hover:underline"
                                onClick={() => setTab("reports")}
                              >
                                Reports
                              </button>
                              ,{" "}
                              <button
                                className="text-primary hover:underline"
                                onClick={() => setTab("workflows")}
                              >
                                Workflows
                              </button>
                              , or{" "}
                              <button
                                className="text-primary hover:underline"
                                onClick={() => setTab("label-sets")}
                              >
                                Label sets
                              </button>{" "}
                              tab, create one, then come back here.
                            </p>
                          )}
                        </section>
                      );
                    })()}
                  </div>
                </Card>
              ) : (
                <Card className="flex flex-col items-center justify-center gap-2 p-16 text-center">
                  <Sparkles className="h-6 w-6 text-muted-foreground/70" />
                  <p className="text-sm font-medium">Select a template</p>
                  <p className="text-xs text-muted-foreground">
                    Pick a template from the list to view and edit it.
                  </p>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="checklists" className="mt-6">
          <ChecklistTemplatesPage embedded />
        </TabsContent>

        <TabsContent value="workflows" className="mt-6">
          <WorkflowTemplatesPage embedded />
        </TabsContent>

        <TabsContent value="labels" className="mt-6">
          {user && (
            <LabelsManager
              teamId={teamData?.team?.id ?? null}
              userId={user.id}
              canManage={canManage}
              templateUsage={templateUsage}
              projectUsage={projectUsage}
            />
          )}
        </TabsContent>

        <TabsContent value="reports" className="mt-6">
          <ReportTemplatesManager teamId={teamData?.team?.id ?? null} canManage={canManage} />
        </TabsContent>
        <TabsContent value="documents" className="mt-6">
          <DocumentTemplatesManager teamId={teamData?.team?.id ?? null} canManage={canManage} />
        </TabsContent>
      </Tabs>

      {/* Create dialog */}
      {canManage && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New project template</DialogTitle>
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
                  Pick from existing labels or type to create a new one.
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
              <DialogTitle>Edit template</DialogTitle>
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
    </div>
  );
}
