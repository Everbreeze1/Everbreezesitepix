import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  FileText,
  ImagePlus,
  X,
  AlertCircle,
  UserCircle2,
  Star,
  Lock,
  BookmarkPlus,
  CheckSquare,
  Upload,
  Camera,
  LayoutTemplate,
} from "lucide-react";
import { compressImageFile } from "@/features/photos/components/CameraCapture";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";

interface Template {
  id: string;
  name: string;
  description: string | null;
}
type ItemType = "checkbox" | "rating" | "text" | "pass_fail" | "numeric" | "yes_no";
interface ChecklistItem {
  id: string;
  checklist_id: string;
  position: number;
  label: string;
  required: boolean;
  completed_at: string | null;
  notes: string | null;
  item_type: ItemType;
  description: string | null;
  response_value: any;
}
interface Checklist {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  created_by: string;
  assigned_to: string | null;
  completed_at: string | null;
  snapshot?: any;
}
interface ItemPhoto {
  id: string;
  item_id: string;
  photo_id: string;
}
interface ProjectPhoto {
  id: string;
  storage_path: string;
  image_url: string | null;
  caption: string | null;
}
interface Member {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

function checklistStatus(cl: Checklist, done: number) {
  if (cl.completed_at) return { label: "Complete", tone: "complete" as const };
  if (done > 0) return { label: "In progress", tone: "progress" as const };
  return { label: "Not started", tone: "none" as const };
}

export function ProjectChecklists({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [itemPhotos, setItemPhotos] = useState<ItemPhoto[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [applyingTemplate, setApplyingTemplate] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newAssignee, setNewAssignee] = useState<string>("__unassigned");
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState<Record<string, { label: string; type: ItemType }>>({});
  const [attachFor, setAttachFor] = useState<ChecklistItem | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tab, setTab] = useState<"all" | "active" | "completed" | "templates">("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewingCompleted, setViewingCompleted] = useState<Checklist | null>(null);
  const [editingChecklist, setEditingChecklist] = useState<Checklist | null>(null);

  const signPhotos = async (rows: ProjectPhoto[]) => {
    const map: Record<string, string> = {};
    const toSign = rows.filter((p) => !p.image_url).map((p) => p.storage_path);
    const signedMap: Record<string, string> = {};
    if (toSign.length) {
      const { data: signed } = await supabase.storage
        .from("site-photos")
        .createSignedUrls(toSign, 3600);
      signed?.forEach((s, i) => {
        if (s.signedUrl) signedMap[toSign[i]] = s.signedUrl;
      });
    }
    rows.forEach((p) => {
      const url = p.image_url ?? signedMap[p.storage_path];
      if (url) map[p.id] = url;
    });
    return map;
  };

  const load = async () => {
    setLoading(true);
    const [{ data: cls }, { data: tpls }] = await Promise.all([
      supabase
        .from("project_checklists" as any)
        .select("id, project_id, name, created_at, created_by, assigned_to, completed_at, snapshot")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
      supabase
        .from("checklist_templates" as any)
        .select("id, name, description")
        .eq("archived", false)
        .order("name", { ascending: true }),
    ]);
    const clList = ((cls as any[]) ?? []) as Checklist[];
    setChecklists(clList);
    setTemplates(((tpls as any[]) ?? []) as Template[]);

    if (clList.length) {
      const ids = clList.map((c) => c.id);
      const { data: its } = await supabase
        .from("project_checklist_items" as any)
        .select(
          "id, checklist_id, position, label, required, completed_at, notes, item_type, description, response_value",
        )
        .in("checklist_id", ids)
        .order("position", { ascending: true });
      const itList = ((its as any[]) ?? []) as ChecklistItem[];
      setItems(itList);

      if (itList.length) {
        const itemIds = itList.map((i) => i.id);
        const { data: ips } = await supabase
          .from("checklist_item_photos" as any)
          .select("id, item_id, photo_id")
          .in("item_id", itemIds);
        const ipList = ((ips as any[]) ?? []) as ItemPhoto[];
        setItemPhotos(ipList);

        const photoIds = Array.from(new Set(ipList.map((p) => p.photo_id)));
        if (photoIds.length) {
          const { data: phs } = await supabase
            .from("photos")
            .select("id, storage_path, image_url, caption")
            .in("id", photoIds);
          const rows = ((phs as any[]) ?? []) as ProjectPhoto[];
          setPhotoUrls(await signPhotos(rows));
        } else {
          setPhotoUrls({});
        }
      } else {
        setItemPhotos([]);
        setPhotoUrls({});
      }
    } else {
      setItems([]);
      setItemPhotos([]);
      setPhotoUrls({});
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`project-checklists:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_checklist_items" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_checklists",
          filter: `project_id=eq.${projectId}`,
        },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "checklist_item_photos" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: myTeams } = await supabase
        .from("team_members" as any)
        .select("team_id")
        .eq("user_id", user.id);
      const teamIds = Array.from(new Set(((myTeams as any[]) ?? []).map((m) => m.team_id)));
      if (!teamIds.length) {
        setMembers([{ user_id: user.id, full_name: null, email: user.email ?? null }]);
        return;
      }
      const { data: tm } = await supabase
        .from("team_members" as any)
        .select("user_id")
        .in("team_id", teamIds);
      const userIds = Array.from(new Set(((tm as any[]) ?? []).map((m) => m.user_id)));
      if (!userIds.length) return;
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      const list: Member[] = ((profs as any[]) ?? []).map((p) => ({
        user_id: p.id,
        full_name: p.full_name,
        email: p.email,
      }));
      list.sort((a, b) =>
        (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""),
      );
      setMembers(list);
    })();
  }, [user]);

  const itemsByChecklist = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const it of items) {
      const arr = map.get(it.checklist_id) ?? [];
      arr.push(it);
      map.set(it.checklist_id, arr);
    }
    return map;
  }, [items]);

  const photosByItem = useMemo(() => {
    const map = new Map<string, ItemPhoto[]>();
    for (const ip of itemPhotos) {
      const arr = map.get(ip.item_id) ?? [];
      arr.push(ip);
      map.set(ip.item_id, arr);
    }
    return map;
  }, [itemPhotos]);

  const applyTemplate = async () => {
    if (!applyingTemplate || !user) return;
    setCreating(true);
    try {
      const tpl = templates.find((t) => t.id === applyingTemplate);
      if (!tpl) return;
      const { data: tplItems } = await supabase
        .from("checklist_template_items" as any)
        .select("position, label, required, item_type, description")
        .eq("template_id", applyingTemplate)
        .order("position", { ascending: true });

      const { data: created, error } = await supabase
        .from("project_checklists" as any)
        .insert({
          project_id: projectId,
          template_id: applyingTemplate,
          name: tpl.name,
          created_by: user.id,
          assigned_to: newAssignee === "__unassigned" ? null : newAssignee,
        })
        .select("id")
        .single();
      if (error || !created) throw error ?? new Error("Failed to create checklist");

      const rows = ((tplItems as any[]) ?? []).map((it: any, idx: number) => ({
        checklist_id: (created as any).id,
        position: it.position ?? idx,
        label: it.label,
        required: it.required ?? false,
        item_type: it.item_type ?? "checkbox",
        description: it.description ?? null,
      }));
      if (rows.length) {
        const { error: itErr } = await supabase.from("project_checklist_items" as any).insert(rows);
        if (itErr) throw itErr;
      }
      toast.success(`Added “${tpl.name}”`);
      setApplyingTemplate("");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to apply template");
    } finally {
      setCreating(false);
    }
  };

  const createBlank = async () => {
    if (!newName.trim() || !user) return;
    setCreating(true);
    try {
      const { error } = await supabase.from("project_checklists" as any).insert({
        project_id: projectId,
        name: newName.trim(),
        created_by: user.id,
        assigned_to: newAssignee === "__unassigned" ? null : newAssignee,
      });
      if (error) throw error;
      setNewName("");
      setNewAssignee("__unassigned");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create checklist");
    } finally {
      setCreating(false);
    }
  };

  const updateAssignee = async (checklistId: string, value: string) => {
    const next = value === "__unassigned" ? null : value;
    const prev = checklists;
    setChecklists((xs) => xs.map((x) => (x.id === checklistId ? { ...x, assigned_to: next } : x)));
    const { error } = await supabase
      .from("project_checklists" as any)
      .update({ assigned_to: next })
      .eq("id", checklistId);
    if (error) {
      toast.error("Failed to update assignee");
      setChecklists(prev);
    }
  };

  const memberLabel = (id: string | null) => {
    if (!id) return "Unassigned";
    const m = members.find((x) => x.user_id === id);
    return m?.full_name || m?.email || "Unknown";
  };

  const toggleItem = async (item: ChecklistItem) => {
    const next = item.completed_at ? null : new Date().toISOString();
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, completed_at: next } : x)));
    const { error } = await supabase
      .from("project_checklist_items" as any)
      .update({
        completed_at: next,
        completed_by: next ? (user?.id ?? null) : null,
      })
      .eq("id", item.id);
    if (error) {
      toast.error("Failed to update");
      setItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, completed_at: item.completed_at } : x)),
      );
    }
  };

  const setResponse = async (item: ChecklistItem, value: any) => {
    const hasValue = value !== null && value !== undefined && value !== "";
    const next = hasValue ? new Date().toISOString() : null;
    setItems((prev) =>
      prev.map((x) => (x.id === item.id ? { ...x, response_value: value, completed_at: next } : x)),
    );
    const { error } = await supabase
      .from("project_checklist_items" as any)
      .update({
        response_value: value,
        completed_at: next,
        completed_by: next ? (user?.id ?? null) : null,
      })
      .eq("id", item.id);
    if (error) {
      toast.error("Failed to update");
      void load();
    }
  };

  const toggleRequired = async (item: ChecklistItem) => {
    const next = !item.required;
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, required: next } : x)));
    const { error } = await supabase
      .from("project_checklist_items" as any)
      .update({ required: next })
      .eq("id", item.id);
    if (error) {
      toast.error("Failed to update");
      setItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, required: item.required } : x)),
      );
    }
  };

  const updateItemType = async (item: ChecklistItem, type: ItemType) => {
    setItems((prev) =>
      prev.map((x) =>
        x.id === item.id ? { ...x, item_type: type, response_value: null, completed_at: null } : x,
      ),
    );
    const { error } = await supabase
      .from("project_checklist_items" as any)
      .update({ item_type: type, response_value: null, completed_at: null, completed_by: null })
      .eq("id", item.id);
    if (error) {
      toast.error("Failed to change type");
      void load();
    }
  };

  const addItem = async (checklistId: string) => {
    const entry = adding[checklistId] ?? { label: "", type: "checkbox" as ItemType };
    const label = entry.label.trim();
    if (!label) return;
    const existing = itemsByChecklist.get(checklistId) ?? [];
    const position = existing.length;
    const { error } = await supabase
      .from("project_checklist_items" as any)
      .insert({ checklist_id: checklistId, label, position, item_type: entry.type });
    if (error) {
      toast.error("Failed to add item");
      return;
    }
    setAdding((s) => ({ ...s, [checklistId]: { label: "", type: entry.type } }));
    void load();
  };

  const deleteItem = async (itemId: string) => {
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== itemId));
    const { error } = await supabase
      .from("project_checklist_items" as any)
      .delete()
      .eq("id", itemId);
    if (error) {
      toast.error("Failed to delete");
      setItems(prev);
    }
  };

  const deleteChecklist = async (id: string) => {
    if (!(await confirm({ description: "Delete this checklist and all its items?", variant: "destructive" }))) return;
    const prev = checklists;
    setChecklists((xs) => xs.filter((x) => x.id !== id));
    const { error } = await supabase
      .from("project_checklists" as any)
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Failed to delete");
      setChecklists(prev);
    }
  };

  const detachPhoto = async (itemPhotoId: string) => {
    const prev = itemPhotos;
    setItemPhotos((xs) => xs.filter((x) => x.id !== itemPhotoId));
    const { error } = await supabase
      .from("checklist_item_photos" as any)
      .delete()
      .eq("id", itemPhotoId);
    if (error) {
      toast.error("Failed to remove photo");
      setItemPhotos(prev);
    }
  };

  const canEdit = (cl: Checklist) => !!user && cl.created_by === user.id;

  const completeChecklist = async (cl: Checklist) => {
    if (!user) return;
    const its = itemsByChecklist.get(cl.id) ?? [];
    const requiredOpen = its.filter((x) => x.required && !x.completed_at).length;
    if (requiredOpen > 0) {
      toast.error(`${requiredOpen} required item${requiredOpen === 1 ? "" : "s"} still open`);
      return;
    }
    const snapshot = {
      name: cl.name,
      completed_at: new Date().toISOString(),
      items: its.map((it) => ({
        label: it.label,
        required: it.required,
        item_type: it.item_type,
        description: it.description,
        completed_at: it.completed_at,
        response_value: it.response_value,
        notes: it.notes,
      })),
    };
    const { error } = await supabase
      .from("project_checklists" as any)
      .update({
        completed_at: new Date().toISOString(),
        completed_by: user.id,
        snapshot,
      })
      .eq("id", cl.id);
    if (error) {
      toast.error(error.message ?? "Failed to complete");
      return;
    }
    toast.success("Checklist marked complete");
    setTab("completed");
    void load();
  };

  const saveAsTemplate = async (cl: Checklist) => {
    if (!user) return;
    const its = itemsByChecklist.get(cl.id) ?? [];
    const name = prompt("Template name:", cl.name);
    if (!name?.trim()) return;
    const { data: tpl, error } = await supabase
      .from("checklist_templates" as any)
      .insert({ created_by: user.id, name: name.trim() })
      .select("id")
      .single();
    if (error || !tpl) {
      toast.error(error?.message ?? "Failed to save template");
      return;
    }
    if (its.length) {
      const rows = its.map((it, idx) => ({
        template_id: (tpl as any).id,
        position: idx,
        label: it.label,
        required: it.required,
        item_type: it.item_type ?? "checkbox",
        description: it.description,
      }));
      const { error: itErr } = await supabase.from("checklist_template_items" as any).insert(rows);
      if (itErr) {
        toast.error(itErr.message ?? "Failed to save template items");
        return;
      }
    }
    toast.success(`Saved "${name.trim()}" as a template`);
  };

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.52px] text-muted-foreground">
            Reusable field templates
          </p>
          <h2 className="font-display mt-3 text-[40px] font-bold leading-none tracking-[-1.4px] text-foreground">
            Checks that move with the work
          </h2>
          <p className="font-manrope mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            {checklists.length === 0
              ? "Simple task lists for this project. For multi-phase processes with sign-off, use Workflows."
              : `${checklists.length} checklist${checklists.length === 1 ? "" : "s"} attached to this project record.`}
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="h-8 rounded-lg bg-primary px-4 font-manrope text-xs font-bold text-primary-foreground hover:bg-primary/90"
        >
          <LayoutTemplate className="mr-1.5 h-4 w-4" />
          Use template
        </Button>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {(
          [
            { key: "all", label: "All" },
            { key: "active", label: "Active" },
            { key: "completed", label: "Completed" },
            { key: "templates", label: "Templates" },
          ] as const
        ).map((t) => {
          const count =
            t.key === "all"
              ? checklists.length
              : t.key === "active"
                ? checklists.filter((c) => !c.completed_at).length
                : t.key === "completed"
                  ? checklists.filter((c) => c.completed_at).length
                  : templates.length;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`font-manrope relative px-3 py-2 text-sm font-bold transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs font-medium text-muted-foreground">({count})</span>
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <Card className="mt-4 flex items-center justify-center p-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </Card>
      ) : tab === "templates" ? (
        <div className="mt-6">
          {templates.length === 0 ? (
            <EmptyState
              icon={BookmarkPlus}
              title="No templates yet"
              description="Save any checklist as a template to reuse it across projects."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {templates.map((t) => (
                <li key={t.id}>
                  <Card className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{t.name}</p>
                      {t.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {t.description}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => {
                        setApplyingTemplate(t.id);
                        void applyTemplate();
                      }}
                      disabled={creating}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Apply
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : tab === "completed" ? (
        <div className="mt-6">
          {checklists.filter((c) => c.completed_at).length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No completed checklists yet"
              description="Fill out a checklist and mark it complete to save it here."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {checklists
                .filter((c) => c.completed_at)
                .map((c) => {
                  const snapItems = Array.isArray(c.snapshot?.items) ? c.snapshot.items : [];
                  const done = snapItems.filter((it: any) => it.completed_at).length;
                  const pct = snapItems.length ? Math.round((done / snapItems.length) * 100) : 100;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setViewingCompleted(c)}
                        className="flex w-full flex-col rounded-[24px] border border-border bg-card/70 p-6 text-left shadow-sm transition hover:bg-card"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
                            <ClipboardList className="h-5 w-5 text-primary" strokeWidth={1.75} />
                          </span>
                          <span className="rounded-full bg-[#D1FAE5] px-2.5 py-1 font-manrope text-[10px] font-extrabold text-[#047857]">
                            Complete
                          </span>
                        </div>
                        <div className="mt-10">
                          <p className="font-manrope truncate text-base font-extrabold text-foreground">
                            {c.name}
                          </p>
                          <p className="mt-2 font-manrope text-xs text-muted-foreground">
                            {done} of {snapItems.length} items complete
                          </p>
                        </div>
                        <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-[#10B981]"
                            style={{ width: `${Math.max(2, pct)}%` }}
                          />
                        </div>
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      ) : (
        (() => {
          const visible = tab === "all" ? checklists : checklists.filter((c) => !c.completed_at);
          if (visible.length === 0) {
            return (
              <EmptyState
                icon={ClipboardList}
                title={tab === "active" ? "No active checklists" : "No checklists yet"}
                description='Click "Use template" to get started.'
                className="mt-6"
              />
            );
          }
          return (
            <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((cl) => {
                const its = itemsByChecklist.get(cl.id) ?? [];
                const done = its.filter((x) => x.completed_at).length;
                const pct = its.length ? Math.round((done / its.length) * 100) : 0;
                const status = checklistStatus(cl, done);
                const isComplete = status.tone === "complete";
                return (
                  <li key={cl.id}>
                    <button
                      type="button"
                      onClick={() =>
                        cl.completed_at ? setViewingCompleted(cl) : setEditingChecklist(cl)
                      }
                      className="flex w-full flex-col rounded-[24px] border-[0.8px] border-border bg-card/65 p-6 text-left transition hover:bg-card"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span
                          className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
                            isComplete ? "bg-[#D1FAE5]" : "bg-primary/10"
                          }`}
                        >
                          <ClipboardList
                            className={`h-5 w-5 ${isComplete ? "text-[#047857]" : "text-primary"}`}
                            strokeWidth={1.75}
                          />
                        </span>
                        <span
                          className={`font-manrope rounded-full px-2.5 py-1 text-[10px] font-extrabold ${
                            status.tone === "complete"
                              ? "bg-[#D1FAE5] text-[#047857]"
                              : status.tone === "progress"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {status.label}
                        </span>
                      </div>
                      <div className="mt-10">
                        <p className="font-manrope truncate text-base font-extrabold text-foreground">
                          {cl.name}
                        </p>
                        <p className="mt-2 font-manrope text-xs text-muted-foreground">
                          {done} of {its.length} items complete
                        </p>
                      </div>
                      <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${isComplete ? "bg-[#10B981]" : "bg-primary"}`}
                          style={{ width: `${Math.max(2, pct)}%` }}
                        />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          );
        })()
      )}

      {/* Active checklist editor */}
      <Dialog
        open={!!editingChecklist}
        onOpenChange={(o) => {
          if (!o) setEditingChecklist(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-6 sm:p-8">
          {editingChecklist &&
            (() => {
              const cl = editingChecklist;
              const its = itemsByChecklist.get(cl.id) ?? [];
              const done = its.filter((x) => x.completed_at).length;
              const requiredItems = its.filter((x) => x.required);
              const requiredOpen = requiredItems.filter((x) => !x.completed_at).length;
              const editable = canEdit(cl);
              return (
                <>
                  <DialogHeader>
                    <div className="flex items-start justify-between gap-3 pr-6">
                      <DialogTitle className="truncate">{cl.name}</DialogTitle>
                      {editable && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            void deleteChecklist(cl.id);
                            setEditingChecklist(null);
                          }}
                          aria-label="Delete checklist"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </DialogHeader>

                  <div className="flex items-center gap-3">
                    <Progress
                      value={its.length ? Math.round((done / its.length) * 100) : 0}
                      className="h-1.5 flex-1"
                    />
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {done}/{its.length} items
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {requiredOpen > 0 && (
                      <Badge
                        variant="outline"
                        className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      >
                        <AlertCircle className="mr-1 h-3 w-3" />
                        {requiredOpen} required open
                      </Badge>
                    )}
                    {!editable && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        <Lock className="mr-1 h-3 w-3" />
                        View / fill only
                      </Badge>
                    )}
                    <Select
                      value={cl.assigned_to ?? "__unassigned"}
                      onValueChange={(v) => void updateAssignee(cl.id, v)}
                      disabled={!editable}
                    >
                      <SelectTrigger className="ml-auto h-8 w-[160px] text-xs">
                        <div className="flex items-center gap-1.5 truncate">
                          <UserCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{memberLabel(cl.assigned_to)}</span>
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unassigned" className="text-sm">
                          Unassigned
                        </SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.user_id} value={m.user_id} className="text-sm">
                            {m.full_name || m.email || m.user_id.slice(0, 8)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {its.length > 0 && (
                    <ul className="mt-2 space-y-2.5">
                      {its.map((it) => {
                        const photos = photosByItem.get(it.id) ?? [];
                        return (
                          <li
                            key={it.id}
                            className="group rounded-xl border-[0.8px] border-transparent px-3 py-2.5 transition-colors hover:border-border/60 hover:bg-muted/40"
                          >
                            <div className="flex items-start gap-2.5">
                              {it.item_type === "checkbox" || !it.item_type ? (
                                <Checkbox
                                  checked={!!it.completed_at}
                                  onCheckedChange={() => void toggleItem(it)}
                                  className="mt-0.5"
                                  aria-label={it.label}
                                />
                              ) : (
                                <div
                                  className={`mt-1 h-4 w-4 shrink-0 rounded-full border ${
                                    it.completed_at
                                      ? "border-emerald-500 bg-emerald-500/20"
                                      : "border-border"
                                  }`}
                                  aria-hidden
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={
                                      it.completed_at && it.item_type === "checkbox"
                                        ? "text-sm text-muted-foreground line-through"
                                        : "text-sm font-medium"
                                    }
                                  >
                                    {it.label}
                                  </span>
                                  {editable ? (
                                    <button
                                      onClick={() => void toggleRequired(it)}
                                      className={`text-[11px] rounded-md border px-2 py-1 transition-colors ${
                                        it.required
                                          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                          : "border-border text-muted-foreground hover:text-foreground"
                                      }`}
                                      aria-label={it.required ? "Mark optional" : "Mark required"}
                                    >
                                      {it.required ? "Required" : "Optional"}
                                    </button>
                                  ) : it.required ? (
                                    <span className="text-[11px] rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-400">
                                      Required
                                    </span>
                                  ) : null}
                                  {editable && (
                                    <Select
                                      value={it.item_type ?? "checkbox"}
                                      onValueChange={(v) => void updateItemType(it, v as ItemType)}
                                    >
                                      <SelectTrigger className="h-6 w-[120px] text-[11px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="checkbox" className="text-sm">
                                          Checkbox
                                        </SelectItem>
                                        <SelectItem value="pass_fail" className="text-sm">
                                          Pass / Fail
                                        </SelectItem>
                                        <SelectItem value="yes_no" className="text-sm">
                                          Yes / No
                                        </SelectItem>
                                        <SelectItem value="rating" className="text-sm">
                                          Rating (1–5)
                                        </SelectItem>
                                        <SelectItem value="numeric" className="text-sm">
                                          Numeric
                                        </SelectItem>
                                        <SelectItem value="text" className="text-sm">
                                          Text / Notes
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  )}
                                  {photos.length > 0 && (
                                    <span className="text-[10px] text-muted-foreground">
                                      {photos.length} photo{photos.length === 1 ? "" : "s"}
                                    </span>
                                  )}
                                </div>
                                {it.description && (
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {it.description}
                                  </p>
                                )}
                                {it.item_type && it.item_type !== "checkbox" && (
                                  <div className="mt-2">
                                    <ItemResponse
                                      item={it}
                                      onChange={(v) => void setResponse(it, v)}
                                    />
                                  </div>
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => setAttachFor(it)}
                                aria-label="Attach photos"
                                title="Attach photos"
                              >
                                <ImagePlus className="h-3.5 w-3.5" />
                              </Button>
                              {editable && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground opacity-100 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                                  onClick={() => void deleteItem(it.id)}
                                  aria-label="Delete item"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                            {photos.length > 0 && (
                              <div className="mt-2 ml-7 flex flex-wrap gap-1.5">
                                {photos.map((ip) => {
                                  const url = photoUrls[ip.photo_id];
                                  if (!url) return null;
                                  return (
                                    <div
                                      key={ip.id}
                                      className="group/img relative h-14 w-14 overflow-hidden rounded border border-border"
                                    >
                                      <img
                                        src={url}
                                        alt=""
                                        className="h-full w-full object-cover"
                                      />
                                      <button
                                        onClick={() => void detachPhoto(ip.id)}
                                        className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5 opacity-0 transition-opacity group-hover/img:opacity-100"
                                        aria-label="Remove photo"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {editable && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Input
                        placeholder="Add item…"
                        value={adding[cl.id]?.label ?? ""}
                        onChange={(e) =>
                          setAdding((s) => ({
                            ...s,
                            [cl.id]: { label: e.target.value, type: s[cl.id]?.type ?? "checkbox" },
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void addItem(cl.id);
                          }
                        }}
                        className="h-9 min-w-[180px] flex-1 text-sm"
                      />
                      <Select
                        value={adding[cl.id]?.type ?? "checkbox"}
                        onValueChange={(v) =>
                          setAdding((s) => ({
                            ...s,
                            [cl.id]: { label: s[cl.id]?.label ?? "", type: v as ItemType },
                          }))
                        }
                      >
                        <SelectTrigger className="h-9 w-[150px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="checkbox" className="text-sm">
                            Checkbox
                          </SelectItem>
                          <SelectItem value="pass_fail" className="text-sm">
                            Pass / Fail
                          </SelectItem>
                          <SelectItem value="yes_no" className="text-sm">
                            Yes / No
                          </SelectItem>
                          <SelectItem value="rating" className="text-sm">
                            Rating (1–5)
                          </SelectItem>
                          <SelectItem value="numeric" className="text-sm">
                            Numeric
                          </SelectItem>
                          <SelectItem value="text" className="text-sm">
                            Text / Notes
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9"
                        onClick={() => void addItem(cl.id)}
                        disabled={!(adding[cl.id]?.label ?? "").trim()}
                      >
                        <Plus className="h-4 w-4" />
                        Add
                      </Button>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                    {editable && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => void saveAsTemplate(cl)}
                      >
                        <BookmarkPlus className="mr-1.5 h-4 w-4" />
                        Save as template
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => {
                        toast.success("Saved");
                        void load();
                      }}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={() => {
                        void completeChecklist(cl);
                        setEditingChecklist(null);
                      }}
                      disabled={its.length === 0 || requiredOpen > 0}
                      title={
                        requiredOpen > 0
                          ? `${requiredOpen} required item${requiredOpen === 1 ? "" : "s"} still open`
                          : undefined
                      }
                    >
                      <CheckSquare className="mr-1.5 h-4 w-4" />
                      Mark as complete
                    </Button>
                  </div>
                </>
              );
            })()}
        </DialogContent>
      </Dialog>

      {/* Create checklist modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle>New checklist</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {templates.length > 0 && (
              <div>
                <label className="text-xs uppercase text-muted-foreground">
                  Start from template (optional)
                </label>
                <Select value={applyingTemplate} onValueChange={setApplyingTemplate}>
                  <SelectTrigger className="mt-1 h-9 text-sm">
                    <SelectValue placeholder="Blank checklist" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id} className="text-sm">
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!applyingTemplate && (
              <div>
                <label className="text-xs uppercase text-muted-foreground">Name</label>
                <Input
                  placeholder="Checklist name…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>
            )}
            <div>
              <label className="text-xs uppercase text-muted-foreground">Assign to</label>
              <Select value={newAssignee} onValueChange={setNewAssignee}>
                <SelectTrigger className="mt-1 h-9 text-sm">
                  <div className="flex items-center gap-1.5 truncate">
                    <UserCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned" className="text-sm">
                    Unassigned
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id} className="text-sm">
                      {m.full_name || m.email || m.user_id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (applyingTemplate) {
                  await applyTemplate();
                } else {
                  await createBlank();
                }
                setCreateOpen(false);
                setTab("active");
              }}
              disabled={creating || (!applyingTemplate && !newName.trim())}
            >
              {creating ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-4 w-4" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Completed checklist read-only viewer */}
      <Dialog
        open={!!viewingCompleted}
        onOpenChange={(o) => {
          if (!o) setViewingCompleted(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle>{viewingCompleted?.name}</DialogTitle>
          </DialogHeader>
          {viewingCompleted && (
            <>
              <p className="text-xs text-muted-foreground">
                Completed {new Date(viewingCompleted.completed_at!).toLocaleString()}
              </p>
              <ul className="mt-3 space-y-2">
                {(viewingCompleted.snapshot?.items ?? []).map((it: any, idx: number) => (
                  <li key={idx} className="rounded-xl border-[0.8px] border-border bg-card/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div
                        className={`h-4 w-4 shrink-0 rounded-sm border ${
                          it.completed_at ? "border-emerald-500 bg-emerald-500" : "border-border"
                        }`}
                      />
                      <span className="text-sm font-medium">{it.label}</span>
                      {it.required && (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400"
                        >
                          Required
                        </Badge>
                      )}
                    </div>
                    {it.description && (
                      <p className="mt-1 ml-6 text-xs text-muted-foreground">{it.description}</p>
                    )}
                    {it.response_value !== null &&
                      it.response_value !== undefined &&
                      it.response_value !== "" && (
                        <p className="mt-1 ml-6 text-xs">
                          <span className="text-muted-foreground">Response:</span>{" "}
                          <span className="font-medium">{String(it.response_value)}</span>
                        </p>
                      )}
                    {it.notes && (
                      <p className="mt-1 ml-6 text-xs italic text-muted-foreground">{it.notes}</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AttachPhotosDialog
        projectId={projectId}
        item={attachFor}
        alreadyAttached={
          attachFor ? (photosByItem.get(attachFor.id) ?? []).map((p) => p.photo_id) : []
        }
        onClose={() => setAttachFor(null)}
        onAttached={() => void load()}
      />
    </div>
  );
}

function ItemResponse({ item, onChange }: { item: ChecklistItem; onChange: (value: any) => void }) {
  const value = item.response_value;
  switch (item.item_type) {
    case "rating": {
      const n = typeof value === "number" ? value : 0;
      return (
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v === n ? null : v)}
              className="p-0.5"
              aria-label={`Rate ${v}`}
            >
              <Star
                className={`h-5 w-5 ${
                  v <= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
                }`}
              />
            </button>
          ))}
          {n > 0 && <span className="ml-2 text-xs text-muted-foreground">{n}/5</span>}
        </div>
      );
    }
    case "pass_fail":
    case "yes_no": {
      const opts = item.item_type === "pass_fail" ? ["Pass", "Fail"] : ["Yes", "No"];
      const colors =
        item.item_type === "pass_fail"
          ? [
              "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
              "bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-400",
            ]
          : [
              "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
              "bg-muted border-border",
            ];
      return (
        <div className="flex gap-2">
          {opts.map((o, i) => (
            <button
              key={o}
              type="button"
              onClick={() => onChange(value === o ? null : o)}
              className={`min-w-[72px] rounded-lg border px-4 py-2 text-sm font-bold transition-colors ${
                value === o ? colors[i] : "border-border text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      );
    }
    case "numeric":
      return (
        <Input
          type="number"
          value={value ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? null : Number(v));
          }}
          placeholder="Enter a value"
          className="h-8 max-w-[180px] text-sm"
        />
      );
    case "text":
      return (
        <Textarea
          defaultValue={typeof value === "string" ? value : ""}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (typeof value === "string" ? value : "")) onChange(v || null);
          }}
          placeholder="Type a response…"
          rows={2}
          className="text-sm"
        />
      );
    default:
      return null;
  }
}

function AttachPhotosDialog({
  projectId,
  item,
  alreadyAttached,
  onClose,
  onAttached,
}: {
  projectId: string;
  item: ChecklistItem | null;
  alreadyAttached: string[];
  onClose: () => void;
  onAttached: () => void;
}) {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<ProjectPhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const loadPhotos = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("photos")
      .select("id, storage_path, image_url, caption")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(60);
    const rows = ((data as any[]) ?? []) as ProjectPhoto[];
    setPhotos(rows);

    const toSign = rows.filter((p) => !p.image_url).map((p) => p.storage_path);
    const signedMap: Record<string, string> = {};
    if (toSign.length) {
      const { data: signed } = await supabase.storage
        .from("site-photos")
        .createSignedUrls(toSign, 3600);
      signed?.forEach((s, i) => {
        if (s.signedUrl) signedMap[toSign[i]] = s.signedUrl;
      });
    }
    const map: Record<string, string> = {};
    rows.forEach((p) => {
      const url = p.image_url ?? signedMap[p.storage_path];
      if (url) map[p.id] = url;
    });
    setUrls(map);
    setLoading(false);
  };

  useEffect(() => {
    if (!item) return;
    setPicked(new Set());
    void loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, projectId]);

  const togglePick = (photoId: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length || !user || !item) return;
    setUploading(true);
    const newPhotoIds: string[] = [];
    try {
      for (const raw of Array.from(files)) {
        try {
          const file = await compressImageFile(raw);
          const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
          const path = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("site-photos")
            .upload(path, file, { contentType: file.type });
          if (upErr) throw upErr;
          const { data: row, error: insErr } = await supabase
            .from("photos")
            .insert({
              project_id: projectId,
              uploaded_by: user.id,
              storage_path: path,
              size_bytes: file.size,
              caption: file.name,
              phase: "untagged",
              taken_at: new Date().toISOString(),
            } as any)
            .select("id")
            .single();
          if (insErr || !row) throw insErr ?? new Error("Upload failed");
          newPhotoIds.push(row.id);
        } catch (e: any) {
          toast.error(e?.message ?? "Upload failed");
        }
      }
      if (newPhotoIds.length) {
        // Auto-attach to the checklist item and refresh gallery
        const rows = newPhotoIds.map((photo_id) => ({
          item_id: item.id,
          photo_id,
          created_by: user.id,
        }));
        const { error } = await supabase.from("checklist_item_photos" as any).insert(rows);
        if (error) {
          toast.error(error.message);
        } else {
          toast.success(`Attached ${rows.length} photo${rows.length === 1 ? "" : "s"}`);
          onAttached();
        }
        await loadPhotos();
      }
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  const save = async () => {
    if (!item || !user || picked.size === 0) return;
    setSaving(true);
    try {
      const rows = Array.from(picked).map((photo_id) => ({
        item_id: item.id,
        photo_id,
        created_by: user.id,
      }));
      const { error } = await supabase.from("checklist_item_photos" as any).insert(rows);
      if (error) throw error;
      toast.success(`Attached ${rows.length} photo${rows.length === 1 ? "" : "s"}`);
      onAttached();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to attach photos");
    } finally {
      setSaving(false);
    }
  };

  const busy = uploading;

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl p-6 sm:p-8">
        <DialogHeader>
          <DialogTitle className="truncate">
            Attach photos{item ? ` — ${item.label}` : ""}
          </DialogTitle>
        </DialogHeader>

        {/* Upload actions — always available */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border-[0.8px] border-dashed border-border bg-muted/30 p-3">
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={busy}
            onClick={() => uploadInputRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            Upload photo
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera className="mr-1.5 h-4 w-4" />
            Take photo
          </Button>
          <span className="text-xs text-muted-foreground">
            New photos are attached automatically and added to the project gallery.
          </span>
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : photos.length === 0 ? (
          <div className="rounded-xl border-[0.8px] border-dashed border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
            No photos in this project yet — upload or take one above to attach it to this item.
          </div>
        ) : (
          <>
            <p className="text-xs font-medium text-muted-foreground">
              Or pick from existing project photos
            </p>
            <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-5">
              {photos.map((p) => {
                const url = urls[p.id];
                const isAttached = alreadyAttached.includes(p.id);
                const isPicked = picked.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={isAttached}
                    onClick={() => togglePick(p.id)}
                    className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-all ${
                      isAttached
                        ? "border-emerald-500/60 opacity-50"
                        : isPicked
                          ? "border-primary"
                          : "border-transparent hover:border-border"
                    }`}
                  >
                    {url ? (
                      <img src={url} alt={p.caption ?? ""} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full bg-muted" />
                    )}
                    {isAttached && (
                      <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/20">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      </div>
                    )}
                    {isPicked && !isAttached && (
                      <div className="absolute right-1 top-1 rounded-full bg-primary text-primary-foreground">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void save()} disabled={picked.size === 0 || saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Attach selected {picked.size > 0 ? `(${picked.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
