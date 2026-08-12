import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  BookmarkPlus,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  ImagePlus,
  ListPlus,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  Printer,
  Share2,
  Trash2,
  UserCircle2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatChecklistAnswer, formatProjectAddress } from "@sitepix/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BulkAddItemsDialog } from "@/components/BulkAddItemsDialog";
import { ErrorState } from "@/components/ErrorState";
import { PendingMigrationState } from "@/components/PendingMigrationState";
import { RECORD_MIGRATION } from "@/lib/field-records.functions";
import { RichTextEditor } from "@/components/RichTextEditor";
import { PrintDocument } from "@/components/PrintDocument";
import { SaveStatus } from "@/components/builder/builder-ui";
import { useAutosave } from "@/components/builder/use-autosave";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { usePrompt } from "@/hooks/use-prompt";
import { useProfile } from "@/hooks/use-profile";
import { useTeamMembers } from "@/hooks/use-team-members";
import { TYPE_META, TYPE_ORDER, hasResponse, type ItemType } from "@/lib/checklist-items";
import { friendlyError, isPendingMigrationError } from "@/lib/supabase-errors";
import { cn } from "@/lib/utils";
import type { FieldRecordBody } from "@/lib/field-records.functions";
import { RecordDocument } from "../components/RecordDocument";
import { ShareRecordDialog } from "../components/ShareRecordDialog";
import {
  AttachItemPhotosDialog,
  ChecklistItemResponse,
  ITEM_COLUMNS,
  type ChecklistItem,
  type ItemPhoto,
  type ProjectPhoto,
} from "../components/checklist/checklist-shared";
import { RunnerProgress } from "../components/runner/runner-ui";
import { toneForProgress } from "../components/runner/runner-tokens";

/**
 * One checklist, as a page.
 *
 * This used to be a dialog inside the Checklists panel, and that was the whole
 * problem. A modal cannot be printed (the app shell prints with it), cannot be
 * linked to (there is no URL), cannot be shared, and gives a 30-line punch list
 * an 88vh scroll box to live in on the screen where it is actually filled out.
 * Anything a crew produces on site and a customer receives afterwards is a
 * document, so it gets a route, a letterhead, and a print sheet.
 *
 * Three surfaces, one record:
 *   - this page: filling it in, tuned for a phone on site
 *   - the print sheet: `PrintDocument` + `RecordDocument`, letterhead and all
 *   - the public link: /share/checklists/$token, the same `RecordDocument`
 *
 * The interactive view and the document are deliberately *not* the same markup.
 * A checkbox big enough to hit with a glove is wrong on paper, and a signature
 * rule is meaningless on screen. They share the view-model, not the layout.
 */

interface Checklist {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  created_by: string;
  assigned_to: string | null;
  completed_at: string | null;
  notes_html: string | null;
  share_token: string | null;
  revoked_at: string | null;
  template_id: string | null;
}

interface ProjectHeader {
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export function ChecklistDocumentPage() {
  const { projectId, checklistId } = useParams({
    from: "/_app/projects/$projectId_/checklists/$checklistId",
  });
  const { new: isNew } = useSearch({
    from: "/_app/projects/$projectId_/checklists/$checklistId",
  });
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirm = useConfirm();
  const promptFor = usePrompt();
  const { profile } = useProfile();
  const { members: teamMembers } = useTeamMembers();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  /** The record columns this page selects do not exist yet — see RECORD_MIGRATION. */
  const [pendingMigration, setPendingMigration] = useState(false);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [project, setProject] = useState<ProjectHeader | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [itemPhotos, setItemPhotos] = useState<ItemPhoto[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<{ label: string; type: ItemType }>({
    label: "",
    type: "checkbox",
  });
  const [attachForId, setAttachForId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  /** When this browser last wrote, so realtime can defer to in-progress typing. */
  const lastLocalEdit = useRef(0);
  const touch = () => {
    lastLocalEdit.current = Date.now();
  };
  const titleRef = useRef<HTMLInputElement>(null);
  /** Only ever grab focus once, even if the record refetches under us. */
  const grabbedTitle = useRef(false);

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

  /* ------------------------------------------------------------------- load */

  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true);
      try {
        const clRes = await supabase
          .from("project_checklists" as any)
          .select(
            "id, project_id, name, created_at, created_by, assigned_to, completed_at, notes_html, share_token, revoked_at, template_id",
          )
          .eq("id", checklistId)
          .maybeSingle();
        if (clRes.error) throw clRes.error;
        const cl = (clRes.data as any as Checklist) ?? null;
        setChecklist(cl);
        if (!cl) {
          setLoadError(true);
          return;
        }

        const [projRes, itRes] = await Promise.all([
          supabase
            .from("projects")
            .select("name, street, city, state, zip")
            .eq("id", cl.project_id)
            .maybeSingle(),
          supabase
            .from("project_checklist_items" as any)
            .select(ITEM_COLUMNS)
            .eq("checklist_id", cl.id)
            .order("position", { ascending: true }),
        ]);
        if (itRes.error) throw itRes.error;
        setProject((projRes.data as any as ProjectHeader) ?? null);
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
        if (!photoIds.length) {
          setPhotoUrls({});
        } else {
          const { data: phs } = await supabase
            .from("photos")
            .select("id, storage_path, image_url, caption")
            .in("id", photoIds);
          const rows = ((phs as any[]) ?? []) as ProjectPhoto[];
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
          setPhotoUrls(map);
        }
        setLoadError(false);
        setPendingMigration(false);
      } catch (e) {
        // A missing column is not a connection problem, and telling the reader
        // to check their signal sends them somewhere a retry can never help.
        if (isPendingMigrationError(e)) setPendingMigration(true);
        else setLoadError(true);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [checklistId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Realtime, deferring to whatever this browser is in the middle of.
   *
   * Scoped to this one checklist rather than the whole project: the panel's
   * subscription had to listen to every item row on every checklist, because it
   * renders all of them. Here there is exactly one, so a teammate ticking a box
   * on a different checklist no longer refetches this page.
   */
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
      .channel(`checklist-record:${checklistId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_checklist_items",
          filter: `checklist_id=eq.${checklistId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_checklists",
          filter: `id=eq.${checklistId}`,
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
  }, [checklistId, load]);

  /**
   * A checklist created from the panel's "Blank checklist" entry arrives with a
   * placeholder name and `?new=1`. Select the title so naming it is the first
   * thing typed — that is the one useful step the old create modal spent an
   * entire dialog on.
   *
   * Pointedly not on a phone: raising the keyboard over a record the user has
   * not looked at yet is worse than one extra tap, and on iOS it also scrolls
   * the sticky header off screen.
   */
  useEffect(() => {
    if (!isNew || loading || grabbedTitle.current) return;
    const el = titleRef.current;
    if (!el) return;
    grabbedTitle.current = true;
    if (window.matchMedia("(min-width: 768px)").matches) {
      el.focus();
      el.select();
    }
  }, [isNew, loading]);

  /* ---------------------------------------------------------------- derived */

  const members = useMemo(
    () =>
      teamMembers.length
        ? teamMembers.map((m) => ({ user_id: m.user_id, full_name: m.full_name, email: m.email }))
        : user
          ? [{ user_id: user.id, full_name: null, email: user.email ?? null }]
          : [],
    [teamMembers, user],
  );
  const memberLabel = (id: string | null) => {
    if (!id) return "Unassigned";
    const m = members.find((x) => x.user_id === id);
    return m?.full_name || m?.email || "Unknown";
  };

  const ordered = useMemo(() => items.slice().sort((a, b) => a.position - b.position), [items]);
  const photosByItem = useMemo(() => {
    const map = new Map<string, ItemPhoto[]>();
    for (const ip of itemPhotos) {
      const arr = map.get(ip.item_id) ?? [];
      arr.push(ip);
      map.set(ip.item_id, arr);
    }
    return map;
  }, [itemPhotos]);

  const done = ordered.filter((x) => x.completed_at).length;
  const requiredOpen = ordered.filter((x) => x.required && !x.completed_at).length;
  const sealed = !!checklist?.completed_at;
  /*
   * Two different locks, deliberately kept apart.
   *
   * `owned` is an authoring right — only the person who put the checklist on the
   * project restructures it (add, reorder, delete, mark required). Any teammate
   * with RLS access can still *fill it in*, which is the whole point of
   * assigning one. `sealed` overrides both: a completed checklist carries a
   * snapshot that is the compliance record, so nothing about it may move.
   */
  const owned = !!user && !!checklist && checklist.created_by === user.id;
  const canStructure = owned && !sealed;
  const canFill = !sealed;

  /* -------------------------------------------------------------- mutations */

  const patchChecklist = async (patch: Partial<Checklist>) => {
    if (!checklist) return false;
    touch();
    const before = checklist;
    setChecklist({ ...checklist, ...patch });
    const ok = await save.runImmediate(() =>
      supabase
        .from("project_checklists" as any)
        .update(patch)
        .eq("id", checklist.id),
    );
    if (!ok) setChecklist(before);
    return ok;
  };

  /** Notes ride the debounced queue — it is prose, typed a character at a time. */
  const setNotes = (html: string) => {
    if (!checklist) return;
    touch();
    setChecklist({ ...checklist, notes_html: html });
    save.queueSave("project_checklists", checklist.id, { notes_html: html });
  };

  const renameChecklist = async (name: string) => {
    const trimmed = name.trim();
    if (!checklist || !trimmed || trimmed === checklist.name) return;
    await patchChecklist({ name: trimmed });
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
   * Record an answer.
   *
   * `immediate` separates a tap from a keystroke: stars and Pass/Fail buttons
   * write straight away, while typed text and numbers go through the debounced
   * queue.
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

  /**
   * Reorder by array index and renumber 0..n rather than swapping two rows'
   * stored `position` values. `deleteItem` doesn't renumber survivors, so
   * duplicate positions are routine — and a swap between two rows already
   * holding the same number moves nothing at all.
   */
  const moveItem = async (item: ChecklistItem, dir: -1 | 1) => {
    touch();
    const siblings = ordered;
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

    // Rollback restores `position` on the rows this move touched rather than
    // replaying a whole-array snapshot: realtime and the debounced answer queue
    // both write into `items` while this request is in flight.
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

  /** The next free position, from max+1 rather than the array's length. */
  const nextPosition = () => ordered.reduce((max, i) => Math.max(max, i.position), -1) + 1;

  const addItem = async () => {
    const label = draft.label.trim();
    if (!label || !checklist) return;
    touch();
    const position = nextPosition();
    // Merged into local state before the refetch lands: `load()` is fired
    // unawaited below and takes two round trips, so on a slow link a second
    // Enter would read a list that still didn't contain the first item and hand
    // both the same position.
    const out: { row: ChecklistItem | null } = { row: null };
    const ok = await save.runImmediate(async () => {
      const res = await supabase
        .from("project_checklist_items" as any)
        .insert({ checklist_id: checklist.id, label, position, item_type: draft.type })
        .select(ITEM_COLUMNS)
        .single();
      if (res.error) throw res.error;
      out.row = res.data as unknown as ChecklistItem;
    });
    if (!ok) return;
    if (out.row) setItems((xs) => [...xs, out.row as ChecklistItem]);
    // The answer type is kept for the next line — a run of Pass/Fail checks is
    // typed as a run, not one at a time with a re-pick between each.
    setDraft({ label: "", type: draft.type });
    void load({ silent: true });
  };

  const addItemsBulk = async (labels: string[], type: ItemType) => {
    if (!labels.length || !checklist) return;
    touch();
    const start = nextPosition();
    const out: { rows: ChecklistItem[] } = { rows: [] };
    const ok = await save.runImmediate(async () => {
      const res = await supabase
        .from("project_checklist_items" as any)
        .insert(
          labels.map((label, idx) => ({
            checklist_id: checklist.id,
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

  const backToPanel = () =>
    void navigate({
      to: "/projects/$projectId",
      params: { projectId },
      search: { panel: "checklists" },
    });

  const deleteChecklist = async () => {
    if (!checklist) return;
    if (
      !(await confirm({
        title: "Delete this checklist?",
        description: `“${checklist.name}” and its ${ordered.length} item${ordered.length === 1 ? "" : "s"} will be permanently removed from this project. Photos attached to it stay in the project gallery.`,
        confirmText: "Delete checklist",
        variant: "destructive",
      }))
    )
      return;
    touch();
    const ok = await save.runImmediate(() =>
      supabase
        .from("project_checklists" as any)
        .delete()
        .eq("id", checklist.id),
    );
    if (ok) backToPanel();
  };

  const completeChecklist = async () => {
    if (!user || !checklist) return;
    setCompleting(true);
    try {
      // The snapshot is an immutable record of what was answered, so anything
      // still sitting in the debounce queue has to land first — otherwise
      // "Mark as complete" freezes the value from before the last keystroke.
      await save.flush();
      if (requiredOpen > 0) {
        toast.error(`${requiredOpen} required item${requiredOpen === 1 ? "" : "s"} still open`);
        return;
      }
      const now = new Date().toISOString();
      const snapshot = {
        name: checklist.name,
        completed_at: now,
        items: ordered.map((it) => ({
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
          .eq("id", checklist.id),
      );
      if (!ok) return;
      setChecklist((c) => (c ? { ...c, completed_at: now } : c));
      toast.success("Checklist marked complete — the record is sealed");
    } finally {
      setCompleting(false);
    }
  };

  const reopenChecklist = async () => {
    if (!checklist) return;
    if (
      !(await confirm({
        title: "Reopen this checklist?",
        description:
          "The sealed record will be cleared so the checklist can be edited again. Anyone holding its share link will see the reopened version.",
        confirmText: "Reopen",
      }))
    )
      return;
    await patchChecklist({ completed_at: null });
  };

  const saveAsTemplate = async () => {
    if (!user || !checklist) return;
    // App-styled prompt, not `window.prompt` — the native dialog is unstyled,
    // unthemed, and blocks the whole tab.
    const name = await promptFor({
      title: "Save as template",
      description: "Reuse this checklist's items on other projects.",
      label: "Template name",
      defaultValue: checklist.name,
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
    if (ordered.length) {
      const { error: itErr } = await supabase.from("checklist_template_items" as any).insert(
        ordered.map((it, idx) => ({
          template_id: (tpl as any).id,
          position: idx,
          label: it.label,
          required: it.required,
          item_type: it.item_type ?? "checkbox",
          description: it.description,
        })),
      );
      if (itErr) {
        // Compensating delete for the parent we just created. Logged rather than
        // toasted: the user already has an accurate error, and this only matters
        // in the compound case where the rollback fails too.
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
    toast.success(`Saved “${name.trim()}” as a template`, {
      description: "Find it under Templates → Checklists, or add it to a blueprint.",
      action: {
        label: "Open Templates",
        onClick: () => void navigate({ to: "/templates", search: { tab: "checklists" } }),
      },
    });
  };

  /* ------------------------------------------------------- print view-model */

  /**
   * The live record, in the same shape the public share route serves.
   *
   * Building it here rather than fetching it keeps the print sheet honest while
   * the crew is still working: it prints the tick they just made, not whatever
   * the last save round-tripped.
   */
  const printRecord: FieldRecordBody | null = useMemo(() => {
    if (!checklist) return null;
    return {
      kind: "checklist",
      title: checklist.name,
      description: null,
      createdAt: checklist.created_at,
      completedAt: checklist.completed_at,
      notesHtml: checklist.notes_html,
      done,
      total: ordered.length,
      sections: [
        {
          id: checklist.id,
          name: null,
          description: null,
          notes: null,
          requiresSignoff: false,
          signoff: null,
          items: ordered.map((it) => ({
            id: it.id,
            label: it.label,
            description: it.description,
            type: it.item_type ?? "checkbox",
            required: it.required,
            answered: !!it.completed_at,
            // Shared with the server so the sheet the owner prints and the sheet
            // a customer prints from the link format an answer identically —
            // "4 / 5", not "4" in one place and "4/5" in the other.
            answer: formatChecklistAnswer(it.item_type, it.response_value),
            notes: it.notes,
            completedAt: it.completed_at,
            photoUrls: (photosByItem.get(it.id) ?? [])
              .map((p) => photoUrls[p.photo_id])
              .filter(Boolean),
          })),
        },
      ],
    };
  }, [checklist, ordered, done, photosByItem, photoUrls]);

  /* ------------------------------------------------------------------- view */

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (pendingMigration) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <PendingMigrationState
          migration={RECORD_MIGRATION}
          feature="Printing and sharing a checklist"
          onRetry={() => void load()}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={backToPanel}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to checklists
          </Button>
        </div>
      </div>
    );
  }

  if (loadError || !checklist) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <ErrorState
          title="Couldn't open this checklist"
          description="It may have been deleted, or you may be offline. Nothing has been lost."
          onRetry={() => void load()}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={backToPanel}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to checklists
          </Button>
        </div>
      </div>
    );
  }

  const tone = toneForProgress(done, ordered.length, sealed);
  const attachFor = attachForId ? (ordered.find((i) => i.id === attachForId) ?? null) : null;
  const address = formatProjectAddress(project);

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Sticks below AppHeader (h-[82px], also sticky top-0) rather than at
          top-0 itself — otherwise both claim the same viewport position and the
          app header paints over this bar as soon as the page scrolls. */}
      <div className="sticky top-[82px] z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={backToPanel}
              aria-label="Back to checklists"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <ClipboardList className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
            {canStructure ? (
              <Input
                ref={titleRef}
                defaultValue={checklist.name}
                aria-label="Checklist name"
                onBlur={(e) => void renameChecklist(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="h-9 min-w-0 max-w-sm flex-1 border-none bg-transparent px-1 text-base font-extrabold shadow-none focus-visible:ring-1"
              />
            ) : (
              <span className="font-display min-w-0 flex-1 truncate text-base font-extrabold">
                {checklist.name}
              </span>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SaveStatus state={save.state} />
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              Print
            </Button>
            <Button
              size="sm"
              variant={checklist.revoked_at ? "outline" : "default"}
              onClick={() => setShareOpen(true)}
            >
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              {checklist.revoked_at ? "Share" : "Shared"}
            </Button>
            {owned && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="More actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => void saveAsTemplate()}>
                    <BookmarkPlus className="mr-2 h-4 w-4" />
                    Save as template
                  </DropdownMenuItem>
                  {sealed && (
                    <DropdownMenuItem onClick={() => void reopenChecklist()}>
                      <ClipboardList className="mr-2 h-4 w-4" />
                      Reopen checklist
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => void deleteChecklist()}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete checklist
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Progress + who owns it. One row, always visible while scrolling a
            long list — the two numbers people check most often. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/60 px-4 pb-2.5 pt-2 sm:px-6">
          <RunnerProgress
            done={done}
            total={ordered.length}
            tone={tone}
            label={`${checklist.name} progress`}
            className="h-1.5 min-w-[120px] flex-1"
          />
          <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-muted-foreground">
            {done}/{ordered.length}
          </span>
          {sealed ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
              <Lock className="h-3 w-3" />
              Complete — sealed record
            </span>
          ) : (
            !owned && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                <Lock className="h-3 w-3" />
                Fill only
              </span>
            )
          )}
          <Select
            value={checklist.assigned_to ?? "__unassigned"}
            onValueChange={(v) =>
              void patchChecklist({ assigned_to: v === "__unassigned" ? null : v })
            }
            disabled={!canStructure}
          >
            <SelectTrigger className="h-8 w-[170px] shrink-0 text-xs">
              <div className="flex items-center gap-1.5 truncate">
                <UserCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{memberLabel(checklist.assigned_to)}</span>
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

      {/* The document surface. Same 850px page and paper card as a project
          document, so a checklist and a daily log read as the same product. */}
      <div className="mx-auto max-w-[850px] px-4 py-6 sm:px-0 sm:py-8">
        <div className="rounded-sm border border-border bg-card p-5 shadow-sm sm:p-10">
          <header className="border-b border-border pb-4">
            <p className="font-manrope text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
              Checklist record
            </p>
            <h1 className="font-display mt-1 text-2xl font-extrabold tracking-[-0.5px]">
              {checklist.name}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {[project?.name, address].filter(Boolean).join(" · ") || "This project"}
              {checklist.completed_at
                ? ` · Completed ${new Date(checklist.completed_at).toLocaleDateString()}`
                : ` · Started ${new Date(checklist.created_at).toLocaleDateString()}`}
            </p>
          </header>

          {/* The write-up. Rich text, because what goes to the customer alongside
              a tick list is prose — findings, what was replaced, what to watch.
              It prints and shares with the record. */}
          <section className="mt-5">
            <div className="mb-1.5 flex items-center justify-between">
              <h2 className="font-manrope text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                Notes &amp; findings
              </h2>
              {!checklist.notes_html && !sealed && (
                <span className="text-[11px] text-muted-foreground">
                  Optional — appears on the printout and the shared link
                </span>
              )}
            </div>
            {sealed ? (
              checklist.notes_html ? (
                <div
                  className="tiptap text-sm"
                  // Sealed records are read-only, and this is the author's own
                  // saved editor output rendered back to them. Anonymous
                  // visitors get the server-sanitised copy instead — see
                  // apps/api/src/domains/projects/field-records.ts.
                  dangerouslySetInnerHTML={{ __html: checklist.notes_html }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No notes were recorded.</p>
              )
            ) : (
              <RichTextEditor
                value={checklist.notes_html ?? ""}
                onChange={setNotes}
                placeholder="What did you find? What was done? Anything the customer needs to know…"
                minHeight={72}
                toolbarOnFocus
              />
            )}
          </section>

          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-manrope text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                {ordered.length} item{ordered.length === 1 ? "" : "s"}
                {requiredOpen > 0 && (
                  <span className="ml-2 font-bold normal-case tracking-normal text-amber-700 dark:text-amber-400">
                    {requiredOpen} required still open
                  </span>
                )}
              </h2>
            </div>

            {ordered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-3 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Nothing on this checklist yet.
                  {canStructure && " Type the first item below, or paste a list you already have."}
                </p>
                {canStructure && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setBulkOpen(true)}
                  >
                    <ListPlus className="mr-1.5 h-4 w-4" />
                    Paste a list
                  </Button>
                )}
              </div>
            ) : (
              <ol className="divide-y divide-border/60">
                {ordered.map((it, idx) => {
                  const photos = photosByItem.get(it.id) ?? [];
                  const meta = it.item_type ? TYPE_META[it.item_type] : null;
                  return (
                    <li key={it.id} className="group flex items-start gap-2.5 py-3">
                      <span className="mt-0.5 w-5 shrink-0 text-right text-[11px] font-bold tabular-nums text-muted-foreground">
                        {idx + 1}
                      </span>
                      {it.item_type === "checkbox" || !it.item_type ? (
                        <Checkbox
                          checked={!!it.completed_at}
                          disabled={!canFill}
                          onCheckedChange={() => void toggleItem(it)}
                          className="mt-0.5 h-5 w-5"
                          aria-label={it.label}
                        />
                      ) : (
                        <div
                          className={cn(
                            "mt-1 h-4 w-4 shrink-0 rounded-full border",
                            it.completed_at
                              ? "border-emerald-500 bg-emerald-500/20"
                              : "border-border",
                          )}
                          aria-hidden
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "text-sm",
                              it.completed_at && it.item_type === "checkbox"
                                ? "text-muted-foreground line-through"
                                : "font-medium",
                            )}
                          >
                            {it.label}
                          </span>
                          {it.required && (
                            <span
                              className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/12 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-700 dark:text-amber-300"
                              title="Required — the checklist can't be completed without it"
                            >
                              Required
                            </span>
                          )}
                          {/* Read-only: switching the answer type wipes the
                              recorded response, so it is chosen in the template
                              designer, not next to a filled-in row. */}
                          {meta && it.item_type !== "checkbox" && (
                            <span
                              className={cn(
                                "inline-flex shrink-0 items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide",
                                meta.tint,
                              )}
                            >
                              {meta.short}
                            </span>
                          )}
                        </div>
                        {it.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{it.description}</p>
                        )}
                        {it.item_type && it.item_type !== "checkbox" && (
                          <div className="mt-2">
                            <ChecklistItemResponse
                              item={it}
                              readOnly={!canFill}
                              onChange={(v, opts) => void setResponse(it, v, opts)}
                            />
                          </div>
                        )}
                        {photos.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {photos.map((ip) => {
                              const url = photoUrls[ip.photo_id];
                              if (!url) return null;
                              return (
                                <div
                                  key={ip.id}
                                  className="group/img relative h-16 w-16 overflow-hidden rounded border border-border"
                                >
                                  <img src={url} alt="" className="h-full w-full object-cover" />
                                  {canFill && (
                                    // Visible on touch and reachable by keyboard
                                    // — hover-only left no way to detach a photo
                                    // on a phone at all.
                                    <button
                                      onClick={() => void detachPhoto(ip.id)}
                                      className="absolute right-0.5 top-0.5 rounded-full bg-background/85 p-1 opacity-100 transition-opacity focus-visible:opacity-100 sm:opacity-0 sm:group-hover/img:opacity-100"
                                      aria-label="Remove photo"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {canFill && (
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
                      )}
                      {canStructure && (
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
                              disabled={idx === 0}
                              onClick={() => void moveItem(it, -1)}
                            >
                              <ChevronUp className="mr-2 h-4 w-4" />
                              Move up
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={idx === ordered.length - 1}
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
                    </li>
                  );
                })}
              </ol>
            )}

            {/* One row: type the label, press Enter, keep typing. The answer type
                is a chip menu rather than a select competing with the field, and
                "Paste a list" covers the case where the list already exists in a
                spec or an email. */}
            {canStructure && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-background px-2 py-1.5">
                {/* text-base on touch: under 16px makes iOS Safari zoom the
                    whole viewport on focus. */}
                <Input
                  placeholder="Add an item and press Enter…"
                  aria-label="New checklist item"
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addItem();
                    }
                  }}
                  className="h-9 min-w-[7rem] flex-1 border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0 sm:text-sm"
                />

                {/* Shown only once it is not the default, so the common case — a
                    plain checkbox — costs nothing at rest. */}
                {draft.type !== "checkbox" && (
                  <button
                    type="button"
                    title={`${TYPE_META[draft.type].label} — click to clear`}
                    onClick={() => setDraft({ ...draft, type: "checkbox" })}
                    className={cn(
                      "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[10.5px] font-extrabold uppercase tracking-wide transition-opacity hover:opacity-80",
                      TYPE_META[draft.type].tint,
                    )}
                  >
                    {TYPE_META[draft.type].short}
                  </button>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-9 shrink-0"
                  onClick={() => setBulkOpen(true)}
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
                          onClick={() => setDraft((d) => ({ ...d, type: t }))}
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

                {!!draft.label.trim() && (
                  <Button
                    size="sm"
                    className="min-h-9 shrink-0"
                    onClick={() => void addItem()}
                    aria-label="Add item"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </section>

          {/* No Save button: every edit on this page persists on its own and the
              header's SaveStatus is the honest report of whether it landed. The
              only terminal action is sealing the record. */}
          {!sealed && (
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              {requiredOpen > 0 && (
                <span className="mr-auto text-[11.5px] font-semibold text-amber-700 dark:text-amber-400">
                  {requiredOpen} required item{requiredOpen === 1 ? "" : "s"} still open
                </span>
              )}
              <Button
                onClick={() => void completeChecklist()}
                disabled={ordered.length === 0 || requiredOpen > 0 || completing}
              >
                {completing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <CheckSquare className="mr-1.5 h-4 w-4" />
                )}
                Mark as complete
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Paper. Mounted alongside the page, not instead of it — see
          components/PrintDocument.tsx for why print inverts the visibility. */}
      {printRecord && (
        <PrintDocument>
          <RecordDocument
            record={printRecord}
            project={project}
            company={
              profile
                ? {
                    name: profile.company,
                    logo_url: profile.company_logo_url,
                    phone: profile.company_phone,
                    address: profile.company_address,
                  }
                : null
            }
            author={{ name: profile?.full_name ?? null }}
          />
        </PrintDocument>
      )}

      <ShareRecordDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        table="project_checklists"
        recordId={checklist.id}
        title={checklist.name}
        shareToken={checklist.share_token}
        revokedAt={checklist.revoked_at}
        sharePath="/share/checklists"
        onChanged={(patch) => setChecklist((c) => (c ? { ...c, ...patch } : c))}
      />

      <AttachItemPhotosDialog
        projectId={projectId}
        item={attachFor}
        alreadyAttached={
          attachFor ? (photosByItem.get(attachFor.id) ?? []).map((p) => p.photo_id) : []
        }
        onClose={() => setAttachForId(null)}
        onAttached={() => void load({ silent: true })}
      />

      <BulkAddItemsDialog<ItemType>
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onAdd={async (labels, type) => {
          await addItemsBulk(labels, type);
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
