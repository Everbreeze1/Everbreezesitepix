import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ClipboardList,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
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
  ChevronUp,
  ChevronDown,
  ListPlus,
  MoreHorizontal,
} from "lucide-react";
import { compressImageFile } from "@/features/photos/components/CameraCapture";
import { BulkAddItemsDialog } from "@/components/BulkAddItemsDialog";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { usePrompt } from "@/hooks/use-prompt";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SaveStatus } from "@/components/builder/builder-ui";
import { useAutosave } from "@/components/builder/use-autosave";
import { SURFACE_BUTTON } from "@/components/ui/surface";
import { TYPE_META, TYPE_ORDER, hasResponse, type ItemType } from "@/lib/checklist-items";
import { friendlyError } from "@/lib/supabase-errors";
import {
  RunnerCard,
  RunnerCardSkeleton,
  RunnerGrid,
  RunnerPanelHeader,
  RunnerProgress,
  RunnerStatusPill,
} from "./runner/runner-ui";
import { toneForProgress } from "./runner/runner-tokens";

interface Template {
  id: string;
  name: string;
  description: string | null;
}
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
/** Every column a `ChecklistItem` needs — shared so the refetch and the
 *  optimistic inserts can never select different shapes. */
const ITEM_COLUMNS =
  "id, checklist_id, position, label, required, completed_at, notes, item_type, description, response_value";

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

export function ProjectChecklists({
  projectId,
  onChanged,
}: {
  projectId: string;
  /** Lets the host refresh its tab counts without remounting this panel. */
  onChanged?: () => void;
}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const promptFor = usePrompt();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [itemPhotos, setItemPhotos] = useState<ItemPhoto[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [newTemplateId, setNewTemplateId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newAssignee, setNewAssignee] = useState<string>("__unassigned");
  const [creating, setCreating] = useState(false);
  /** Template currently being applied, so only the pressed card spins. */
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [adding, setAdding] = useState<Record<string, { label: string; type: ItemType }>>({});
  const [attachForId, setAttachForId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [createOpen, setCreateOpen] = useState(false);
  /*
   * Open dialogs are tracked by id, never by a copy of the row.
   *
   * Holding the object froze a snapshot taken when the dialog opened, so after
   * a successful reassignment the Select visibly snapped back to the old value
   * — the list behind had updated, the dialog was still rendering the stale
   * copy it captured.
   */
  const [viewingCompletedId, setViewingCompletedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Checklist id whose "paste a list" dialog is open. */
  const [bulkForChecklist, setBulkForChecklist] = useState<string | null>(null);
  /** When this browser last wrote, so realtime can defer to in-progress typing. */
  const lastLocalEdit = useRef(0);

  const save = useAutosave(
    (table, id, patch) =>
      supabase
        .from(table as any)
        .update(patch)
        .eq("id", id)
        .then((r: any) => {
          if (r.error) throw r.error;
        }),
    { onError: () => toast.error("Couldn't save that change — check your connection") },
  );
  const touch = () => {
    lastLocalEdit.current = Date.now();
  };

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

  /**
   * `silent` keeps the panel on screen while it refreshes.
   *
   * Every refetch used to flip the whole panel back to a spinner, and three
   * unfiltered realtime handlers called it — so ticking a box made the list
   * you were reading disappear and come back.
   */
  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true);
      try {
        const [clRes, tplRes] = await Promise.all([
          supabase
            .from("project_checklists" as any)
            .select(
              "id, project_id, name, created_at, created_by, assigned_to, completed_at, snapshot",
            )
            .eq("project_id", projectId)
            .order("created_at", { ascending: true }),
          supabase
            .from("checklist_templates" as any)
            .select("id, name, description")
            .eq("archived", false)
            .order("name", { ascending: true }),
        ]);
        if (clRes.error) throw clRes.error;

        const clList = ((clRes.data as any[]) ?? []) as Checklist[];
        setChecklists(clList);
        setTemplates(((tplRes.data as any[]) ?? []) as Template[]);

        if (!clList.length) {
          setItems([]);
          setItemPhotos([]);
          setPhotoUrls({});
          setLoadError(false);
          return;
        }

        const itRes = await supabase
          .from("project_checklist_items" as any)
          .select(ITEM_COLUMNS)
          .in(
            "checklist_id",
            clList.map((c) => c.id),
          )
          .order("position", { ascending: true });
        if (itRes.error) throw itRes.error;
        const itList = ((itRes.data as any[]) ?? []) as ChecklistItem[];
        setItems(itList);

        if (!itList.length) {
          setItemPhotos([]);
          setPhotoUrls({});
          setLoadError(false);
          return;
        }

        const { data: ips } = await supabase
          .from("checklist_item_photos" as any)
          .select("id, item_id, photo_id")
          .in(
            "item_id",
            itList.map((i) => i.id),
          );
        const ipList = ((ips as any[]) ?? []) as ItemPhoto[];
        setItemPhotos(ipList);

        const photoIds = Array.from(new Set(ipList.map((p) => p.photo_id)));
        if (photoIds.length) {
          const { data: phs } = await supabase
            .from("photos")
            .select("id, storage_path, image_url, caption")
            .in("id", photoIds);
          setPhotoUrls(await signPhotos(((phs as any[]) ?? []) as ProjectPhoto[]));
        } else {
          setPhotoUrls({});
        }
        setLoadError(false);
      } catch {
        setLoadError(true);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Our own writes echo back here. Refetching mid-sentence would replace
        // what the user is typing with the older server copy.
        if (Date.now() - lastLocalEdit.current < 2000) {
          refresh();
          return;
        }
        void load({ silent: true });
      }, 400);
    };
    const ch = supabase
      .channel(`project-checklists:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_checklist_items" },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_checklists",
          filter: `project_id=eq.${projectId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "checklist_item_photos" },
        refresh,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, [projectId, load]);

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
    // Order by `position`, not by whatever order the rows arrived in.
    // `moveItem` swaps the two rows' position values in place, so without this
    // the optimistic update changed nothing on screen — the row only appeared
    // to move once a refetch happened to return it in a new order.
    for (const arr of map.values()) arr.sort((a, b) => a.position - b.position);
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

  /**
   * Materialise a template onto this project.
   *
   * Takes the id as an argument rather than reading it from state: the
   * Templates tab used to call `setApplyingTemplate(id)` and then invoke this
   * immediately, which read the *previous* render's value — so the first tap
   * did nothing and the second applied whichever template you pressed before.
   */
  const applyTemplate = async (templateId: string, assignedTo: string | null = null) => {
    if (!templateId || !user) return false;
    setApplyingId(templateId);
    let createdId: string | null = null;
    try {
      const tpl = templates.find((t) => t.id === templateId);
      if (!tpl) throw new Error("That template is no longer available");

      const { data: tplItems, error: tplErr } = await supabase
        .from("checklist_template_items" as any)
        .select("position, label, required, item_type, description")
        .eq("template_id", templateId)
        .order("position", { ascending: true });
      if (tplErr) throw tplErr;

      const { data: created, error } = await supabase
        .from("project_checklists" as any)
        .insert({
          project_id: projectId,
          template_id: templateId,
          name: tpl.name,
          created_by: user.id,
          assigned_to: assignedTo,
        })
        .select("id")
        .single();
      if (error || !created) throw error ?? new Error("Couldn't create that checklist");
      createdId = (created as any).id as string;

      // Renumber from zero rather than trusting the template's stored
      // positions, so a template with gaps or duplicates still lands in order.
      const rows = ((tplItems as any[]) ?? []).map((it: any, idx: number) => ({
        checklist_id: createdId,
        position: idx,
        label: it.label,
        required: it.required ?? false,
        item_type: it.item_type ?? "checkbox",
        description: it.description ?? null,
      }));
      if (rows.length) {
        const { error: itErr } = await supabase.from("project_checklist_items" as any).insert(rows);
        if (itErr) throw itErr;
      }
      toast.success(`“${tpl.name}” added to this project`);
      await load({ silent: true });
      onChanged?.();
      setEditingId(createdId);
      return true;
    } catch (e: any) {
      // Cascades to items, so a partial apply never survives.
      if (createdId) {
        await supabase
          .from("project_checklists" as any)
          .delete()
          .eq("id", createdId);
      }
      toast.error(friendlyError(e, "Couldn't add that checklist"));
      return false;
    } finally {
      setApplyingId(null);
    }
  };

  const createBlank = async () => {
    if (!newName.trim() || !user) return false;
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("project_checklists" as any)
        .insert({
          project_id: projectId,
          name: newName.trim(),
          created_by: user.id,
          assigned_to: newAssignee === "__unassigned" ? null : newAssignee,
        })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Couldn't create that checklist");
      setNewName("");
      setNewAssignee("__unassigned");
      await load({ silent: true });
      onChanged?.();
      setEditingId((data as any).id as string);
      return true;
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't create that checklist"));
      return false;
    } finally {
      setCreating(false);
    }
  };

  const updateAssignee = async (checklistId: string, value: string) => {
    touch();
    const next = value === "__unassigned" ? null : value;
    const prev = checklists;
    setChecklists((xs) => xs.map((x) => (x.id === checklistId ? { ...x, assigned_to: next } : x)));
    const ok = await save.runImmediate(() =>
      supabase
        .from("project_checklists" as any)
        .update({ assigned_to: next })
        .eq("id", checklistId),
    );
    if (!ok) setChecklists(prev);
  };

  const memberLabel = (id: string | null) => {
    if (!id) return "Unassigned";
    const m = members.find((x) => x.user_id === id);
    return m?.full_name || m?.email || "Unknown";
  };

  const toggleItem = async (item: ChecklistItem) => {
    touch();
    const next = item.completed_at ? null : new Date().toISOString();
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, completed_at: next } : x)));
    const ok = await save.runImmediate(() =>
      supabase
        .from("project_checklist_items" as any)
        .update({ completed_at: next, completed_by: next ? (user?.id ?? null) : null })
        .eq("id", item.id),
    );
    if (!ok) {
      setItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, completed_at: item.completed_at } : x)),
      );
    }
  };

  /**
   * Reorder an item within its checklist.
   *
   * Up/down rather than drag-and-drop: these lists are filled in on a phone on
   * site, where dragging inside a nested scrolling panel is easy to start by
   * accident and hard to finish accurately. Buttons also come with keyboard and
   * screen-reader support for free. Optimistic, with rollback.
   *
   * Reorders by array index and renumbers 0..n rather than swapping the two
   * rows' stored `position` values. Deleting a middle item never renumbered the
   * survivors while both insert paths derived the next position from the array
   * *length* rather than max+1, so duplicate positions were routine — and a
   * swap between two rows already holding the same number moved nothing at all.
   * Renumbering makes the move correct and heals a list that had drifted.
   */
  const moveItem = async (item: ChecklistItem, dir: -1 | 1) => {
    touch();
    const siblings = items
      .filter((x) => x.checklist_id === item.checklist_id)
      .sort((a, b) => a.position - b.position);
    const idx = siblings.findIndex((x) => x.id === item.id);
    const targetIdx = idx + dir;
    if (idx < 0 || targetIdx < 0 || targetIdx >= siblings.length) return;

    const reordered = siblings.slice();
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(targetIdx, 0, moved);
    const renumbered = reordered.map((x, i) => ({ ...x, position: i }));
    const changed = renumbered.filter(
      (x) => siblings.find((s) => s.id === x.id)?.position !== x.position,
    );
    if (!changed.length) return;

    // Rollback restores `position` on the rows this move touched, rather than
    // replaying a whole-array snapshot. The realtime subscription and the
    // debounced answer queue both write into `items` while this request is in
    // flight, so putting the entire array back would take a neighbour's new row
    // or a half-typed response down with the failed reorder.
    const before = new Map(
      changed.map((x) => [x.id, siblings.find((s) => s.id === x.id)!.position]),
    );
    setItems((xs) => xs.map((x) => renumbered.find((r) => r.id === x.id) ?? x));

    const ok = await save.runImmediate(async () => {
      const results = await Promise.all(
        changed.map((x) =>
          supabase
            .from("project_checklist_items" as any)
            .update({ position: x.position })
            .eq("id", x.id),
        ),
      );
      const bad = results.find((r) => r?.error);
      if (bad?.error) throw bad.error;
    });
    if (!ok) {
      setItems((xs) =>
        xs.map((x) => (before.has(x.id) ? { ...x, position: before.get(x.id)! } : x)),
      );
    }
  };

  /**
   * Record an answer.
   *
   * `immediate` separates a tap from a keystroke: stars and Pass/Fail buttons
   * write straight away, while typed text and numbers go through the debounced
   * queue. The number field used to fire a write per character, and the text
   * field only saved on blur — dismissing the dialog with Escape threw the
   * answer away.
   */
  const setResponse = async (
    item: ChecklistItem,
    value: any,
    { immediate = true }: { immediate?: boolean } = {},
  ) => {
    touch();
    const next = hasResponse(value) ? new Date().toISOString() : null;
    const patch = {
      response_value: value,
      completed_at: next,
      completed_by: next ? (user?.id ?? null) : null,
    };
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, ...patch } : x)));
    if (!immediate) {
      save.queueSave("project_checklist_items", item.id, patch);
      return;
    }
    const ok = await save.runImmediate(() =>
      supabase
        .from("project_checklist_items" as any)
        .update(patch)
        .eq("id", item.id),
    );
    if (!ok) {
      setItems((prev) =>
        prev.map((x) =>
          x.id === item.id
            ? { ...x, response_value: item.response_value, completed_at: item.completed_at }
            : x,
        ),
      );
    }
  };

  const toggleRequired = async (item: ChecklistItem) => {
    touch();
    const next = !item.required;
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, required: next } : x)));
    const ok = await save.runImmediate(() =>
      supabase
        .from("project_checklist_items" as any)
        .update({ required: next })
        .eq("id", item.id),
    );
    if (!ok) {
      setItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, required: item.required } : x)),
      );
    }
  };

  /**
   * The next free position, from max+1 rather than the array's length.
   *
   * Length is only correct while positions are a gapless 0..n-1 run, and
   * `deleteItem` doesn't renumber survivors — so deleting a middle item and
   * adding another handed the new row a number one of its siblings already
   * held. Duplicate positions are what made the reorder controls silently do
   * nothing (see `moveItem`).
   */
  const nextPosition = (checklistId: string) =>
    (itemsByChecklist.get(checklistId) ?? []).reduce((max, i) => Math.max(max, i.position), -1) + 1;

  const addItem = async (checklistId: string) => {
    const entry = adding[checklistId] ?? { label: "", type: "checkbox" as ItemType };
    const label = entry.label.trim();
    if (!label) return;
    touch();
    const position = nextPosition(checklistId);
    // The new row is merged into local state before the refetch lands. `load()`
    // is fired unawaited below and takes two sequential round trips, so on a
    // slow link a second Enter would otherwise read a list that still didn't
    // contain the first item and hand both of them the same position — the
    // exact drift `nextPosition` exists to stop.
    const out: { row: ChecklistItem | null } = { row: null };
    const ok = await save.runImmediate(async () => {
      const res = await supabase
        .from("project_checklist_items" as any)
        .insert({ checklist_id: checklistId, label, position, item_type: entry.type })
        .select(ITEM_COLUMNS)
        .single();
      if (res.error) throw res.error;
      out.row = res.data as unknown as ChecklistItem;
    });
    if (!ok) return;
    if (out.row) setItems((xs) => [...xs, out.row as ChecklistItem]);
    setAdding((s) => ({ ...s, [checklistId]: { label: "", type: entry.type } }));
    void load({ silent: true });
  };

  /**
   * Append a pasted list in one insert.
   *
   * Adding a 30-line punch list one label at a time was the slowest thing on
   * this panel, and that list nearly always already exists in a spec or an
   * email. Same flow as the template designer, so the two behave alike.
   */
  const addItemsBulk = async (checklistId: string, labels: string[], type: ItemType) => {
    if (!labels.length) return;
    touch();
    const start = nextPosition(checklistId);
    // Merged locally for the same reason as `addItem` — a paste followed
    // straight away by a typed item must not reuse the pasted rows' positions.
    const out: { rows: ChecklistItem[] } = { rows: [] };
    const ok = await save.runImmediate(async () => {
      const res = await supabase
        .from("project_checklist_items" as any)
        .insert(
          labels.map((label, idx) => ({
            checklist_id: checklistId,
            label,
            position: start + idx,
            item_type: type,
          })),
        )
        .select(ITEM_COLUMNS);
      if (res.error) throw res.error;
      out.rows = ((res.data as unknown as ChecklistItem[]) ?? []).slice();
    });
    if (!ok) return;
    if (out.rows.length) setItems((xs) => [...xs, ...out.rows]);
    toast.success(`${labels.length} item${labels.length === 1 ? "" : "s"} added`);
    void load({ silent: true });
  };

  const deleteItem = async (itemId: string) => {
    touch();
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== itemId));
    const ok = await save.runImmediate(() =>
      supabase
        .from("project_checklist_items" as any)
        .delete()
        .eq("id", itemId),
    );
    if (!ok) setItems(prev);
  };

  /**
   * Returns whether the delete actually happened, so callers can close their
   * dialog *after* the fact. The editor used to close itself and then start
   * the confirmation, which unmounted the dialog before the question appeared.
   */
  const deleteChecklist = async (cl: Checklist) => {
    const count = (itemsByChecklist.get(cl.id) ?? []).length;
    if (
      !(await confirm({
        title: "Delete this checklist?",
        description: `“${cl.name}” and its ${count} item${count === 1 ? "" : "s"} will be permanently removed from this project. Photos attached to it stay in the project gallery.`,
        confirmText: "Delete checklist",
        variant: "destructive",
      }))
    )
      return false;
    touch();
    const prev = checklists;
    setChecklists((xs) => xs.filter((x) => x.id !== cl.id));
    const ok = await save.runImmediate(() =>
      supabase
        .from("project_checklists" as any)
        .delete()
        .eq("id", cl.id),
    );
    if (!ok) {
      setChecklists(prev);
      return false;
    }
    onChanged?.();
    return true;
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
    if (!user) return false;
    // The snapshot is an immutable record of what was answered, so anything
    // still sitting in the debounce queue has to land in the database first —
    // otherwise "Mark as complete" freezes the value from before the last
    // thing the user typed.
    await save.flush();
    const its = itemsByChecklist.get(cl.id) ?? [];
    const requiredOpen = its.filter((x) => x.required && !x.completed_at).length;
    if (requiredOpen > 0) {
      toast.error(`${requiredOpen} required item${requiredOpen === 1 ? "" : "s"} still open`);
      return false;
    }
    const now = new Date().toISOString();
    const snapshot = {
      name: cl.name,
      completed_at: now,
      items: its.map((it) => ({
        label: it.label,
        required: it.required,
        item_type: it.item_type,
        description: it.description,
        completed_at: it.completed_at,
        response_value: it.response_value,
        notes: it.notes,
        photo_ids: (photosByItem.get(it.id) ?? []).map((p) => p.photo_id),
      })),
    };
    touch();
    const ok = await save.runImmediate(() =>
      supabase
        .from("project_checklists" as any)
        .update({ completed_at: now, completed_by: user.id, snapshot })
        .eq("id", cl.id),
    );
    if (!ok) return false;
    toast.success("Checklist marked complete");
    setTab("completed");
    void load({ silent: true });
    onChanged?.();
    return true;
  };

  const saveAsTemplate = async (cl: Checklist) => {
    if (!user) return;
    const its = itemsByChecklist.get(cl.id) ?? [];
    // App-styled prompt, not `window.prompt` — the native dialog is unstyled,
    // unthemed, and blocks the whole tab.
    const name = await promptFor({
      title: "Save as template",
      description: "Reuse this checklist's items on other projects.",
      label: "Template name",
      defaultValue: cl.name,
      confirmText: "Save template",
    });
    if (!name?.trim()) return;

    const { data: tpl, error } = await supabase
      .from("checklist_templates" as any)
      .insert({ created_by: user.id, name: name.trim() })
      .select("id")
      .single();
    if (error || !tpl) {
      toast.error(friendlyError(error, "Couldn't save that template"));
      return;
    }
    if (its.length) {
      const { error: itErr } = await supabase.from("checklist_template_items" as any).insert(
        its.map((it, idx) => ({
          template_id: (tpl as any).id,
          position: idx,
          label: it.label,
          required: it.required,
          item_type: it.item_type ?? "checkbox",
          description: it.description,
        })),
      );
      if (itErr) {
        // Compensating delete for the parent we just created. Logged rather
        // than toasted: the user already has an accurate error, and this only
        // matters in the compound case where the rollback fails too and leaves
        // an empty phantom template behind.
        const { error: cleanupErr } = await supabase
          .from("checklist_templates" as any)
          .delete()
          .eq("id", (tpl as any).id);
        if (cleanupErr)
          console.warn("Could not roll back empty checklist template", (tpl as any).id, cleanupErr);
        toast.error(friendlyError(itErr, "Couldn't save that template's items"));
        return;
      }
    }
    // Saving a template moves it somewhere the user is not, and nothing said
    // where. Templates is the hub everything saved ends up in, so the toast
    // hands over the route rather than leaving people to find it.
    toast.success(`Saved “${name.trim()}” as a template`, {
      description: "Find it under Templates → Checklists, or add it to a blueprint.",
      action: {
        label: "Open Templates",
        onClick: () => void navigate({ to: "/templates", search: { tab: "checklists" } }),
      },
    });
    // The Templates tab reads from the same list, so refresh it — otherwise the
    // count and the grid stay stale and people save the same template twice.
    void load({ silent: true });
  };

  const activeCount = checklists.filter((c) => !c.completed_at).length;

  // Derived from the live list, never from a copy captured when the dialog
  // opened — that is what kept the assignee Select snapping back.
  const editingChecklist = editingId ? (checklists.find((c) => c.id === editingId) ?? null) : null;
  const viewingCompleted = viewingCompletedId
    ? (checklists.find((c) => c.id === viewingCompletedId) ?? null)
    : null;
  const attachFor = attachForId ? (items.find((i) => i.id === attachForId) ?? null) : null;

  return (
    <div>
      {/* Eyebrow and title used to be one sentence written twice ("Checks that
          travel with the job" over "Checks that move with the work"), which is
          ~86px of restated heading before a single checklist is on screen. */}
      <RunnerPanelHeader
        eyebrow="Project"
        title="Checklists"
        description={
          checklists.length === 0
            ? "Task lists that travel with this job. For multi-phase processes with sign-off, use Workflows."
            : activeCount === 0
              ? `All ${checklists.length} checklist${checklists.length === 1 ? "" : "s"} on this job are complete.`
              : `${activeCount} still open on this job.`
        }
        actions={
          <Button onClick={() => setCreateOpen(true)} className={cn(SURFACE_BUTTON, "bg-primary")}>
            <Plus className="h-4 w-4" />
            New checklist
          </Button>
        }
      />

      {/* Filter strip. Deliberately plain toggle buttons rather than
          role="tablist"/role="tab": half-implemented tab semantics are worse
          than none — a screen reader would promise arrow-key navigation and an
          associated tabpanel that don't exist here.

          Two entries, not four. "All" was arithmetic rather than a filter, and
          "Templates" was not a filter of this project's checklists at all — its
          count came from the template library while its three neighbours
          counted checklists, and its only content was an Apply grid duplicating
          the "New checklist" button directly above it. */}
      <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {(
          [
            { key: "active", label: "Active" },
            { key: "completed", label: "Completed" },
          ] as const
        ).map((t) => {
          const count =
            t.key === "active"
              ? checklists.filter((c) => !c.completed_at).length
              : checklists.filter((c) => c.completed_at).length;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(t.key)}
              className={`font-manrope relative min-h-11 px-3 py-2 text-sm font-bold transition-colors ${
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
        <RunnerGrid>
          <RunnerCardSkeleton />
          <RunnerCardSkeleton />
          <RunnerCardSkeleton />
        </RunnerGrid>
      ) : loadError ? (
        <ErrorState
          className="mt-6"
          title="Couldn't load checklists"
          description="You may be offline. Nothing has been lost — try again once you have a connection."
          onRetry={() => void load()}
        />
      ) : tab === "completed" ? (
        <div className="mt-6">
          {checklists.filter((c) => c.completed_at).length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No completed checklists yet"
              description="Fill out a checklist and mark it complete to save it here."
              action={
                <Button variant="outline" onClick={() => setTab("active")}>
                  Go to active checklists
                </Button>
              }
            />
          ) : (
            <RunnerGrid>
              {checklists
                .filter((c) => c.completed_at)
                .map((c) => {
                  const snapItems = Array.isArray(c.snapshot?.items) ? c.snapshot.items : [];
                  const done = snapItems.filter((it: any) => it.completed_at).length;
                  return (
                    <RunnerCard
                      key={c.id}
                      icon={ClipboardList}
                      tone="complete"
                      title={c.name}
                      statusLabel="Complete"
                      meta={`${done}/${snapItems.length} answered`}
                      done={done}
                      total={snapItems.length}
                      progressLabel={`${c.name} progress`}
                      onOpen={() => setViewingCompletedId(c.id)}
                    />
                  );
                })}
            </RunnerGrid>
          )}
        </div>
      ) : (
        (() => {
          const visible = checklists.filter((c) => !c.completed_at);
          if (visible.length === 0) {
            return (
              // The action belongs here, not in prose telling the reader to go
              // hunt for a button somewhere else on the page.
              <EmptyState
                icon={ClipboardList}
                title={checklists.length ? "Nothing open right now" : "No checklists yet"}
                description={
                  checklists.length
                    ? "Every checklist on this job is complete."
                    : "QA walks, punch lists, safety checks — start from a template or paste a list you already have."
                }
                className="mt-6"
                action={
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    New checklist
                  </Button>
                }
              />
            );
          }
          return (
            <RunnerGrid>
              {visible.map((cl) => {
                const its = itemsByChecklist.get(cl.id) ?? [];
                const done = its.filter((x) => x.completed_at).length;
                const requiredOpen = its.filter((x) => x.required && !x.completed_at).length;
                const isComplete = !!cl.completed_at;
                const tone = toneForProgress(done, its.length, isComplete);
                return (
                  <RunnerCard
                    key={cl.id}
                    icon={ClipboardList}
                    tone={tone}
                    title={cl.name}
                    // Only the terminal state earns a pill; "In progress" and
                    // "Not started" are already legible from the bar below.
                    statusLabel={isComplete ? "Complete" : undefined}
                    meta={its.length === 0 ? "No items yet" : `${done}/${its.length} done`}
                    detail={
                      requiredOpen > 0 ? (
                        <RunnerStatusPill tone="blocked" icon={AlertCircle}>
                          {requiredOpen} required open
                        </RunnerStatusPill>
                      ) : undefined
                    }
                    done={done}
                    total={its.length}
                    progressLabel={`${cl.name} progress`}
                    onOpen={() =>
                      cl.completed_at ? setViewingCompletedId(cl.id) : setEditingId(cl.id)
                    }
                  />
                );
              })}
            </RunnerGrid>
          );
        })()
      )}

      {/* Active checklist editor. Keyed on the resolved row, not the id, so a
          checklist deleted on another device closes the dialog instead of
          leaving an empty shell open. */}
      <Dialog
        open={!!editingChecklist}
        onOpenChange={(o) => {
          if (!o) setEditingId(null);
        }}
      >
        {/* Flex column with its own scroll region: the header (identity, progress,
            save state) and the footer (add-item, complete) stay put while a long
            list scrolls between them. It used to be one long scroll with the
            actions stranded at the bottom. */}
        <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          {editingChecklist &&
            (() => {
              const cl = editingChecklist;
              const its = itemsByChecklist.get(cl.id) ?? [];
              const done = its.filter((x) => x.completed_at).length;
              const requiredItems = its.filter((x) => x.required);
              const requiredOpen = requiredItems.filter((x) => !x.completed_at).length;
              const editable = canEdit(cl);
              const tone = toneForProgress(done, its.length, !!cl.completed_at);
              return (
                <>
                  <DialogHeader className="space-y-0 border-b border-border/60 px-5 pb-3.5 pt-5 sm:px-6">
                    {/* pr-12 clears the dialog's own absolutely-positioned close
                        button; the delete action lives in the menu now rather
                        than crowding against it. */}
                    <div className="flex items-start justify-between gap-2 pr-12">
                      <DialogTitle className="font-display truncate text-xl tracking-[-0.4px]">
                        {cl.name}
                      </DialogTitle>
                      {editable && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground"
                              aria-label="Checklist actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onClick={() => void saveAsTemplate(cl)}>
                              <BookmarkPlus className="mr-2 h-4 w-4" />
                              Save as template
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={async () => {
                                // Close only once it actually happened —
                                // unmounting first tore down the dialog before
                                // the confirmation could even be answered.
                                if (await deleteChecklist(cl)) setEditingId(null);
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete checklist
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5 pt-2.5">
                      <RunnerProgress
                        done={done}
                        total={its.length}
                        tone={tone}
                        label={`${cl.name} progress`}
                        className="h-1.5 flex-1"
                      />
                      <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-muted-foreground">
                        {done}/{its.length}
                      </span>
                    </div>

                    {/* The required-open count is stated once, in the footer
                        beside the button it disables. It used to appear here as
                        well — two counts ~400px apart in different colours and
                        sentence forms, both on screen at the same time. */}
                    <div className="flex flex-wrap items-center gap-2 pt-2.5">
                      {!editable && (
                        <RunnerStatusPill tone="idle" icon={Lock}>
                          View / fill only
                        </RunnerStatusPill>
                      )}
                      <SaveStatus state={save.state} />
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
                  </DialogHeader>

                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-6">
                    {its.length === 0 && (
                      <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center">
                        <p className="text-xs text-muted-foreground">
                          Nothing on this checklist yet — add the first item below.
                        </p>
                        {editable && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => setBulkForChecklist(cl.id)}
                          >
                            <ListPlus className="mr-1.5 h-4 w-4" />
                            Paste a list you already have
                          </Button>
                        )}
                      </div>
                    )}
                    {its.length > 0 && (
                      <ul className="space-y-2.5">
                        {its.map((it, itIdx) => {
                          const photos = photosByItem.get(it.id) ?? [];
                          return (
                            <li
                              key={it.id}
                              className="group rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-border/60 hover:bg-muted/40"
                            >
                              {/*
                                Three affordances at rest: tick it, read it,
                                photograph it. Everything that *edits the list
                                rather than fills it in* — required, reorder,
                                delete — lives in the row's ⋯ menu.

                                It used to carry seven, because `editable` is an
                                ownership check rather than a mode: whoever
                                applied the template always saw the full
                                authoring toolkit stacked on top of the one
                                control they came to use. The reorder chevrons
                                were worse than crowded — they rendered with no
                                `editable` guard at all, so a user holding the
                                "View / fill only" pill could still reorder
                                somebody else's checklist.
                              */}
                              <div className="flex items-start gap-2.5">
                                {it.item_type === "checkbox" || !it.item_type ? (
                                  <Checkbox
                                    checked={!!it.completed_at}
                                    onCheckedChange={() => void toggleItem(it)}
                                    className="mt-1 h-5 w-5"
                                    aria-label={it.label}
                                  />
                                ) : (
                                  <div
                                    className={`mt-1.5 h-4 w-4 shrink-0 rounded-full border ${
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
                                    {/* Badge the exception, never the rule. The
                                        editable branch used to stamp an
                                        uppercase OPTIONAL pill on every
                                        non-required row — on a default punch
                                        list that is a badge on 100% of rows
                                        carrying zero information. Toggling it
                                        now lives in the row's ⋯ menu. */}
                                    {it.required && (
                                      <span
                                        className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/12 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-700 dark:text-amber-300"
                                        title="Required — the checklist can't be completed without it"
                                      >
                                        Required
                                      </span>
                                    )}
                                    {/* Read-only. Switching the answer type wipes
                                      the recorded response, and offering that as
                                      a bare dropdown next to every filled-in row
                                      is a trap — answer types are chosen in the
                                      template designer. */}
                                    {it.item_type && it.item_type !== "checkbox" && (
                                      <span
                                        className={cn(
                                          "inline-flex shrink-0 items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide",
                                          TYPE_META[it.item_type].tint,
                                        )}
                                      >
                                        {TYPE_META[it.item_type].short}
                                      </span>
                                    )}
                                    {/* No "2 photos" counter here — the
                                        thumbnails render immediately below, and
                                        counting them in text pushed long labels
                                        onto a second line on a phone. */}
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
                                        onChange={(v, opts) => void setResponse(it, v, opts)}
                                      />
                                    </div>
                                  )}
                                </div>
                                {/* Stays visible for everyone, including a
                                    non-owner filling the list in: attaching
                                    evidence is part of *doing* the check. */}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                                  onClick={() => setAttachForId(it.id)}
                                  aria-label={`Attach photos to “${it.label}”`}
                                  title="Attach photos"
                                >
                                  <ImagePlus className="h-4 w-4" />
                                </Button>
                                {editable && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 shrink-0 text-muted-foreground"
                                        aria-label={`Edit “${it.label}”`}
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-52">
                                      <DropdownMenuItem onClick={() => void toggleRequired(it)}>
                                        <AlertCircle className="mr-2 h-4 w-4" />
                                        {it.required ? "Make optional" : "Mark required"}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        disabled={itIdx === 0}
                                        onClick={() => void moveItem(it, -1)}
                                      >
                                        <ChevronUp className="mr-2 h-4 w-4" />
                                        Move up
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        disabled={itIdx === its.length - 1}
                                        onClick={() => void moveItem(it, 1)}
                                      >
                                        <ChevronDown className="mr-2 h-4 w-4" />
                                        Move down
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onClick={() => void deleteItem(it.id)}
                                      >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Delete item
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
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
                                        {/* Visible on touch and reachable by
                                          keyboard — it was hover-only, so on a
                                          phone there was no way to detach a
                                          photo at all. */}
                                        <button
                                          onClick={() => void detachPhoto(ip.id)}
                                          className="absolute right-0.5 top-0.5 rounded-full bg-background/85 p-1 opacity-100 transition-opacity focus-visible:opacity-100 sm:opacity-0 sm:group-hover/img:opacity-100"
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
                  </div>

                  <div className="shrink-0 border-t border-border/60 px-5 py-3 sm:px-6">
                    {editable &&
                      // One row: type the label and press Enter. The answer type
                      // is a compact chip menu rather than a 150px select
                      // competing with the field you actually type in, and
                      // "Paste a list" covers the case where the list already
                      // exists somewhere else.
                      (() => {
                        const draft = adding[cl.id] ?? { label: "", type: "checkbox" as ItemType };
                        const typeMeta = TYPE_META[draft.type];
                        return (
                          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-1.5">
                            {/* text-base on touch: anything under 16px makes iOS
                                Safari zoom the whole viewport on focus. */}
                            <Input
                              placeholder="Add an item and press Enter…"
                              aria-label="New checklist item"
                              value={draft.label}
                              onChange={(e) =>
                                setAdding((s) => ({
                                  ...s,
                                  [cl.id]: { label: e.target.value, type: draft.type },
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void addItem(cl.id);
                                }
                              }}
                              className="h-9 min-w-[7rem] flex-1 border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0 sm:text-sm"
                            />

                            {/* The answer-type chip is shown only once it is not
                                the default, so the common case — a plain
                                checkbox — costs nothing at rest. It used to sit
                                lit in front of the field announcing "CHECK"
                                before you had typed anything. */}
                            {draft.type !== "checkbox" && (
                              <button
                                type="button"
                                title={`${typeMeta.label} — click to clear`}
                                onClick={() =>
                                  setAdding((s) => ({
                                    ...s,
                                    [cl.id]: { label: draft.label, type: "checkbox" },
                                  }))
                                }
                                className={cn(
                                  "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[10.5px] font-extrabold uppercase tracking-wide transition-opacity hover:opacity-80",
                                  typeMeta.tint,
                                )}
                              >
                                <typeMeta.icon className="h-3.5 w-3.5" />
                                {typeMeta.short}
                              </button>
                            )}

                            {/*
                              Labelled at every width, and an outline rather than
                              a ghost. The label was `hidden sm:inline` with no
                              aria-label, so on the phone — where a 30-line punch
                              list is most painful to type one item at a time —
                              this was a bare icon that screen readers announced
                              as nothing at all.
                            */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-9 shrink-0"
                              onClick={() => setBulkForChecklist(cl.id)}
                              title="Paste a list of items, one per line"
                            >
                              <ListPlus className="mr-1.5 h-4 w-4" />
                              Paste a list
                            </Button>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 shrink-0 text-muted-foreground"
                                  aria-label="Answer type for the next item"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-60">
                                <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                                  Answer type
                                </DropdownMenuLabel>
                                {TYPE_ORDER.map((t) => {
                                  const m = TYPE_META[t];
                                  const I = m.icon;
                                  return (
                                    <DropdownMenuItem
                                      key={t}
                                      onClick={() =>
                                        setAdding((s) => ({
                                          ...s,
                                          [cl.id]: { label: s[cl.id]?.label ?? "", type: t },
                                        }))
                                      }
                                    >
                                      <I className="mr-2 h-4 w-4" />
                                      <span className="flex-1">
                                        {m.label}
                                        <span className="block text-[11px] text-muted-foreground">
                                          {m.hint}
                                        </span>
                                      </span>
                                    </DropdownMenuItem>
                                  );
                                })}
                              </DropdownMenuContent>
                            </DropdownMenu>

                            {/* Only once there is something to add — Enter does
                                the same job and the placeholder says so. */}
                            {!!draft.label.trim() && (
                              <Button
                                size="sm"
                                className="min-h-9 shrink-0"
                                onClick={() => void addItem(cl.id)}
                                aria-label="Add item"
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        );
                      })()}

                    {/*
                     * No Save button.
                     *
                     * There used to be one, and it wrote nothing — it fired a
                     * "Saved" toast and refetched. Every edit on this screen
                     * already persists on its own; the header's SaveStatus is
                     * the honest report of whether it landed. A button that
                     * claims credit for work it didn't do is worse than no
                     * button, especially on a compliance record.
                     */}
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      {requiredOpen > 0 && (
                        <span className="mr-auto text-[11.5px] font-semibold text-amber-700 dark:text-amber-400">
                          {requiredOpen} required item{requiredOpen === 1 ? "" : "s"} still open
                        </span>
                      )}
                      {/* The empty case is already stated in the body above,
                          with the action attached; repeating it here was the
                          same sentence twice on one screen. */}
                      <Button
                        size="sm"
                        className="min-h-9"
                        onClick={async () => {
                          setCompleting(true);
                          const ok = await completeChecklist(cl);
                          setCompleting(false);
                          if (ok) setEditingId(null);
                        }}
                        disabled={its.length === 0 || requiredOpen > 0 || completing}
                      >
                        {completing ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckSquare className="mr-1.5 h-4 w-4" />
                        )}
                        Mark as complete
                      </Button>
                    </div>
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
                <label htmlFor="cl-template" className="text-xs uppercase text-muted-foreground">
                  Start from template (optional)
                </label>
                <Select value={newTemplateId} onValueChange={setNewTemplateId}>
                  <SelectTrigger id="cl-template" className="mt-1 h-10 text-sm">
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
            {!newTemplateId && (
              <div>
                <label htmlFor="cl-name" className="text-xs uppercase text-muted-foreground">
                  Name
                </label>
                <Input
                  id="cl-name"
                  placeholder="Checklist name…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1 h-10 text-base sm:text-sm"
                />
              </div>
            )}
            <div>
              <label htmlFor="cl-assignee" className="text-xs uppercase text-muted-foreground">
                Assign to
              </label>
              <Select value={newAssignee} onValueChange={setNewAssignee}>
                <SelectTrigger id="cl-assignee" className="mt-1 h-10 text-sm">
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
                const ok = newTemplateId
                  ? await applyTemplate(
                      newTemplateId,
                      newAssignee === "__unassigned" ? null : newAssignee,
                    )
                  : await createBlank();
                // Only dismiss on success, so a failed create leaves the form
                // (and what was typed into it) intact.
                if (!ok) return;
                setNewTemplateId("");
                setCreateOpen(false);
                setTab("active");
              }}
              disabled={creating || applyingId !== null || (!newTemplateId && !newName.trim())}
            >
              {creating || applyingId ? (
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
          if (!o) setViewingCompletedId(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle>{viewingCompleted?.name}</DialogTitle>
            <DialogDescription>
              {viewingCompleted?.completed_at
                ? `Completed ${new Date(viewingCompleted.completed_at).toLocaleString()} — this is the sealed record.`
                : "A read-only record of what was answered."}
            </DialogDescription>
          </DialogHeader>
          {viewingCompleted && (
            <>
              <ul className="mt-1 space-y-2">
                {(viewingCompleted.snapshot?.items ?? []).map((it: any, idx: number) => (
                  <li key={idx} className="rounded-xl border border-border bg-card/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div
                        className={`h-4 w-4 shrink-0 rounded-sm border ${
                          it.completed_at ? "border-emerald-500 bg-emerald-500" : "border-border"
                        }`}
                      />
                      <span className="text-sm font-medium">{it.label}</span>
                      {it.required && (
                        <span className="rounded-full border border-amber-500/40 bg-amber-500/12 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                          Required
                        </span>
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
        onClose={() => setAttachForId(null)}
        onAttached={() => void load({ silent: true })}
      />

      <BulkAddItemsDialog<ItemType>
        open={!!bulkForChecklist}
        onOpenChange={(v) => !v && setBulkForChecklist(null)}
        onAdd={async (labels, type) => {
          if (bulkForChecklist) await addItemsBulk(bulkForChecklist, labels, type);
        }}
        types={TYPE_ORDER.map((t) => ({
          value: t,
          label: TYPE_META[t].short,
          icon: TYPE_META[t].icon,
        }))}
        defaultType="checkbox"
        description="One per line — they'll be appended to this checklist. Bullets and numbering are stripped automatically."
      />
    </div>
  );
}

/**
 * The answer widget for a non-checkbox item.
 *
 * `immediate: false` marks the inputs that are typed rather than tapped, so
 * they ride the debounced autosave queue instead of firing a write per
 * keystroke. Both are controlled: the text field used to be uncontrolled and
 * save only on blur, which silently discarded the answer if the dialog was
 * dismissed with Escape or by clicking the overlay.
 */
function ItemResponse({
  item,
  onChange,
}: {
  item: ChecklistItem;
  onChange: (value: any, opts?: { immediate?: boolean }) => void;
}) {
  const value = item.response_value;
  switch (item.item_type) {
    case "rating": {
      const n = typeof value === "number" ? value : 0;
      return (
        <div className="flex items-center gap-0.5" role="group" aria-label="Rating out of 5">
          {[1, 2, 3, 4, 5].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v === n ? null : v)}
              aria-pressed={v <= n}
              className="p-1.5"
              aria-label={`Rate ${v} out of 5`}
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
        <div className="flex gap-2" role="group" aria-label={item.label}>
          {opts.map((o, i) => (
            <button
              key={o}
              type="button"
              onClick={() => onChange(value === o ? null : o)}
              aria-pressed={value === o}
              className={`min-h-11 min-w-[76px] rounded-lg border px-4 py-2 text-sm font-bold transition-colors ${
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
          inputMode="decimal"
          value={value ?? ""}
          aria-label={item.label}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(null, { immediate: false });
              return;
            }
            // A partial entry like "1e" or "-" parses to NaN, which used to be
            // written straight to the record.
            const n = Number(raw);
            if (Number.isNaN(n)) return;
            onChange(n, { immediate: false });
          }}
          placeholder="Enter a value"
          className="h-10 max-w-[180px] text-base sm:text-sm"
        />
      );
    case "text":
      return (
        <Textarea
          value={typeof value === "string" ? value : ""}
          aria-label={item.label}
          onChange={(e) => onChange(e.target.value || null, { immediate: false })}
          placeholder="Type a response…"
          rows={2}
          className="text-base sm:text-sm"
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

  // Keyed on the item *id*, not the row. The row is now looked up from live
  // state each render, so depending on the object would re-fetch the gallery
  // and clear the user's selection every time anything about the item changed.
  const itemId = item?.id ?? null;
  useEffect(() => {
    if (!itemId) return;
    setPicked(new Set());
    void loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, projectId]);

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
