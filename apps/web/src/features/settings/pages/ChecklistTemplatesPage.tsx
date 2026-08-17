import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Plus,
  Trash2,
  Loader2,
  ClipboardList,
  Archive,
  ArchiveRestore,
  Copy,
  Sparkles,
  CheckSquare,
  Star,
  MoreHorizontal,
  Eye,
  MessageSquareText,
  ListChecks,
  ListPlus,
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
import { BulkAddItemsDialog } from "@/components/BulkAddItemsDialog";
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
import { STARTER_TEMPLATES } from "@/features/settings/components/checklist-starters";
import { TYPE_META, TYPE_ORDER, type ItemType } from "@/lib/checklist-items";
import { GENERAL_CATEGORY, categoryIcon, makeCategoryRank } from "@/lib/template-categories";
import { TradeSelect } from "@/components/builder/TradeSelect";
import { useCompanySetup } from "@/hooks/use-company-setup";
import { tradeCategoryFor } from "@sitepix/shared";

interface Template {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  created_at: string;
  /**
   * The trade this checklist belongs to, or null for one filed under nothing.
   *
   * Optional rather than merely nullable: a database that predates
   * 20260828000000_checklist_template_trades.sql does not return the column at
   * all, and every reader here treats a missing one as "General".
   */
  category?: string | null;
}
interface TemplateItem {
  id: string;
  template_id: string;
  position: number;
  label: string;
  required: boolean;
  item_type: ItemType;
  description: string | null;
}

const TABLES = {
  templates: "checklist_templates",
  items: "checklist_template_items",
} as const;

export function ChecklistTemplatesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [pane, setPane] = useState<"list" | "editor">("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [startersOpen, setStartersOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  /*
   * The company's trade, from the account setup wizard. It orders the rail and
   * the Starters dialog, so this tab answers the same question the Documents
   * tab does rather than being the one place the answer stopped mattering.
   */
  const { profile: company } = useCompanySetup();
  const rank = useMemo(
    () => makeCategoryRank(company.industry, company.trades),
    [company.industry, company.trades],
  );
  const ownTrade = tradeCategoryFor(company.industry);

  /**
   * One save model for everything on this screen. Name and description used to
   * sit behind an Edit → Save → Cancel round trip while the items below them
   * autosaved on blur; two contradictory contracts in one panel is why saving
   * felt unreliable. Now every field debounces into the same queue and reports
   * through the same status line.
   */
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
      .select("id, name, description, archived, created_at, category")
      .order("created_at", { ascending: true });
    const list = ((tpls as any[]) ?? []) as Template[];
    setTemplates(list);
    if (list.length) {
      const ids = list.map((t) => t.id);
      const { data: its } = await supabase
        .from(TABLES.items as any)
        .select("id, template_id, position, label, required, item_type, description")
        .in("template_id", ids)
        .order("position", { ascending: true });
      setItems(((its as any[]) ?? []) as TemplateItem[]);
      setSelectedId((cur) =>
        cur && list.some((t) => t.id === cur)
          ? cur
          : (list.find((t) => !t.archived)?.id ?? list[0]?.id ?? null),
      );
    } else {
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

  /*
   * The rail, split by trade rather than one flat alphabetical run.
   *
   * Same reasoning and the same ordering function as the Documents tab: a
   * company that told us their trade sees it first, and General - which is
   * where every checklist made before trades existed sits - stays at the top
   * because it holds their own work.
   *
   * Rendered as headings inside the rail only when there is more than one
   * group, since a single "Electrical" heading over the whole list is a row of
   * chrome that says nothing.
   */
  const railSections = useMemo<Array<[string, Template[]]>>(() => {
    const byTrade = new Map<string, Template[]>();
    for (const t of visibleTemplates) {
      const key = t.category || GENERAL_CATEGORY;
      const list = byTrade.get(key);
      if (list) list.push(t);
      else byTrade.set(key, [t]);
    }
    return [...byTrade.entries()].sort(
      (a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]),
    );
  }, [visibleTemplates, rank]);

  /**
   * The starter library, their trade first. Stable order within a trade.
   *
   * An uncategorised starter sorts last rather than through `rank`, which puts
   * General at the very top - correct in the rail, where General holds the
   * team's own checklists, and exactly backwards here, where it would push a
   * trade-less starter above the one written for their trade.
   */
  const starterOrder = useMemo(
    () =>
      [...STARTER_TEMPLATES].sort(
        (a, b) =>
          (a.category ? rank(a.category) : Number.MAX_SAFE_INTEGER) -
            (b.category ? rank(b.category) : Number.MAX_SAFE_INTEGER) ||
          a.name.localeCompare(b.name),
      ),
    [rank],
  );

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const selectedItems = useMemo(
    () => items.filter((i) => i.template_id === selectedId).sort((a, b) => a.position - b.position),
    [items, selectedId],
  );
  const requiredCount = selectedItems.filter((i) => i.required).length;
  const typeCount = new Set(selectedItems.map((i) => i.item_type)).size;

  /* ---------------------------------------------------------- templates */

  const selectTemplate = async (id: string) => {
    await save.flush();
    setSelectedId(id);
    setPane("editor");
  };

  const createTemplate = async (
    name: string,
    description: string | null,
    category?: string | null,
  ) => {
    if (!user) return null;
    const { data, error } = await supabase
      .from(TABLES.templates as any)
      .insert({
        created_by: user.id,
        name: name.trim(),
        description: description?.trim() || null,
        category: category ?? null,
      })
      .select("id")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Failed to create template");
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
    /*
     * Deliberately lands on the empty state rather than inserting a blank row.
     *
     * It used to `addItem("checkbox", id, 0)` here - one database round trip
     * for a nameless row, focused before the author had decided anything, which
     * silently framed "build a template" as twenty more of the same. The empty
     * state now offers "Paste a list" as its primary action and "Add one item"
     * beside it, so the choice is the author's and the bulk path is the one
     * that reads first.
     *
     * Not auto-opening the paste dialog from here on purpose: it would mean
     * unmounting this dialog and mounting another in the same beat, and Radix
     * only releases the body scroll lock once the first has finished animating
     * out. A button the user presses is worth more than a modal that appears.
     */
  };

  const createFromStarter = async (s: (typeof STARTER_TEMPLATES)[number]) => {
    setCreating(true);
    try {
      // The starter's trade comes with it, so a copied checklist lands under
      // the right heading instead of in General for the author to refile.
      const id = await createTemplate(s.name, s.description, s.category ?? null);
      if (!id) return;
      const { error } = await supabase.from(TABLES.items as any).insert(
        s.items.map((it, idx) => ({
          template_id: id,
          position: idx,
          label: it.label,
          required: !!it.required,
          item_type: it.item_type,
          description: it.description ?? null,
        })),
      );
      if (error) toast.error(error.message);
      else toast.success(`Created “${s.name}”`);
      setSelectedId(id);
      setPane("editor");
      setStartersOpen(false);
      await load();
    } finally {
      setCreating(false);
    }
  };

  const duplicateTemplate = async (t: Template) => {
    const id = await createTemplate(`${t.name} (copy)`, t.description, t.category ?? null);
    if (!id) return;
    const its = items.filter((i) => i.template_id === t.id).sort((a, b) => a.position - b.position);
    if (its.length) {
      const { error } = await supabase.from(TABLES.items as any).insert(
        its.map((it, idx) => ({
          template_id: id,
          position: idx,
          label: it.label,
          required: it.required,
          item_type: it.item_type,
          description: it.description,
        })),
      );
      if (error) toast.error(error.message);
    }
    toast.success("Template duplicated");
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
    else toast.success(t.archived ? "Template restored" : "Template archived");
  };

  const deleteTemplate = async (t: Template) => {
    if (
      !(await confirm({
        title: "Delete template",
        description: `“${t.name}” and all of its items will be removed. Checklists already added to a project keep their copy.`,
        confirmText: "Delete template",
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

  /* -------------------------------------------------------------- items */

  /**
   * The next free position, from max+1 rather than the array's length.
   *
   * Length is only correct while positions are a gapless 0..n-1 run, and
   * `deleteItem` doesn't renumber the survivors - so deleting a middle item and
   * adding another handed the new row a number one of its siblings already
   * held, and two items then sorted arbitrarily against each other.
   */
  const nextPosition = (templateId: string) =>
    items
      .filter((i) => i.template_id === templateId)
      .reduce((max, i) => Math.max(max, i.position), -1) + 1;

  /**
   * Push a set of rows down one slot to open a gap, locally first and then on
   * the server. Both insert-below paths - `duplicateItem` and `addItem`'s
   * `after` option - go through here, so "make room at N+1" has exactly one
   * implementation rather than two that can drift.
   *
   * The gaps `deleteItem` leaves behind can't cause a collision: a displaced
   * row at p > source lands at p+1 >= source+2, and every row that isn't
   * displaced keeps a number at or below source. Slot source+1 is free by
   * construction, gapless run or not.
   *
   * Every result is checked and the writes report through the shared status
   * line, the way `handleDragEnd` already does it. `duplicateItem` used to fire
   * them bare - and since the query builder resolves to `{ error }` instead of
   * rejecting, a failed shift left the screen showing an order the database
   * didn't have, with no toast, until the next load put two rows on one number.
   */
  const shiftDown = async (displaced: TemplateItem[]) => {
    if (!displaced.length) return;
    const ids = new Set(displaced.map((d) => d.id));
    setItems((xs) => xs.map((x) => (ids.has(x.id) ? { ...x, position: x.position + 1 } : x)));
    const ok = await save.runImmediate(async () => {
      const results = await Promise.all(
        displaced.map((d) =>
          supabase
            .from(TABLES.items as any)
            .update({ position: d.position + 1 })
            .eq("id", d.id),
        ),
      );
      const bad = results.find((r: any) => r?.error);
      if (bad) throw (bad as any).error;
    });
    // Refetch rather than roll back: these are independent requests, so a
    // failure can be partial - some rows moved, some didn't - and no local undo
    // is right for both. `runImmediate` has already surfaced the error.
    if (!ok) {
      // Flush before refetching. `load()` replaces `items` from the database
      // but leaves the autosave queue holding its pending patch, which then
      // lands afterwards with no re-render - so a label the user was mid-way
      // through typing would disappear from the screen and still be saved.
      // `selectTemplate` flushes ahead of a swap for the same reason.
      await save.flush();
      await load();
    }
  };

  /**
   * One insert at a time. `addItem` computes the new position from the render
   * closure, so two invocations inside a single round trip - Enter key
   * auto-repeat, or an impatient double-press - both read the same `items` and
   * both land on `after.position + 1`, reintroducing exactly the duplicate
   * positions the rest of this file works to prevent.
   */
  const addingRef = useRef(false);

  const addItem = async (
    type: ItemType = "checkbox",
    { templateId, after }: { templateId?: string; after?: TemplateItem } = {},
  ) => {
    const tplId = templateId ?? after?.template_id ?? selectedId;
    if (!tplId || addingRef.current) return;
    addingRef.current = true;
    try {
      /*
       * Appends by default; `after` drops the new row directly below a specific
       * one, which is the only thing Enter on a mid-list row can honestly mean.
       * This used to append unconditionally, so Enter on item 3 of 20 built item
       * 21 and then dragged the caret down there with it.
       *
       * `displaced` is snapshotted before the await, while `items` still excludes
       * the row being inserted.
       */
      const displaced = after
        ? items.filter((i) => i.template_id === tplId && i.position > after.position)
        : [];
      const position = after ? after.position + 1 : nextPosition(tplId);
      const { data, error } = await supabase
        .from(TABLES.items as any)
        .insert({
          template_id: tplId,
          label: "",
          required: false,
          position,
          item_type: type,
        })
        .select("id, template_id, label, description, required, position, item_type")
        .single();
      if (error || !data) {
        toast.error("Couldn't add that item");
        return;
      }
      const item = data as unknown as TemplateItem;
      setItems((xs) => [...xs, item]);
      setFocusItemId(item.id);
      // Not awaited: the order is already right locally, and making the caret
      // wait on one round trip per displaced row would buy nothing.
      void shiftDown(displaced);
    } finally {
      addingRef.current = false;
    }
  };

  /** One insert for the whole pasted list rather than a round trip per line. */
  const addItemsBulk = async (labels: string[], type: ItemType) => {
    if (!selectedId || !labels.length) return;
    const start = nextPosition(selectedId);
    const { data, error } = await supabase
      .from(TABLES.items as any)
      .insert(
        labels.map((label, idx) => ({
          template_id: selectedId,
          position: start + idx,
          label,
          required: false,
          item_type: type,
        })),
      )
      .select("id, template_id, position, label, required, item_type, description");
    if (error) {
      toast.error(error.message ?? "Couldn't add those items");
      return;
    }
    setItems((xs) => [...xs, ...(((data as any[]) ?? []) as TemplateItem[])]);
    save.markSaved();
    toast.success(`${labels.length} item${labels.length === 1 ? "" : "s"} added`);
  };

  const updateItem = (id: string, patch: Partial<TemplateItem>) => {
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

  const duplicateItem = async (source: TemplateItem) => {
    const displaced = selectedItems.filter((i) => i.position > source.position);
    const { data, error } = await supabase
      .from(TABLES.items as any)
      .insert({
        template_id: source.template_id,
        position: source.position + 1,
        label: source.label,
        required: source.required,
        item_type: source.item_type,
        description: source.description,
      })
      .select("id, template_id, label, description, required, position, item_type")
      .single();
    if (error || !data) {
      toast.error("Couldn't duplicate that item");
      return;
    }
    setItems((xs) => [...xs, data as unknown as TemplateItem]);
    await shiftDown(displaced);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = selectedItems.findIndex((i) => i.id === active.id);
    const newIndex = selectedItems.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(selectedItems, oldIndex, newIndex);
    setItems((xs) => {
      const others = xs.filter((x) => x.template_id !== selectedId);
      return [...others, ...reordered.map((r, idx) => ({ ...r, position: idx }))];
    });
    const ok = await save.runImmediate(async () => {
      const results = await Promise.all(
        reordered.map((r, idx) =>
          supabase
            .from(TABLES.items as any)
            .update({ position: idx })
            .eq("id", r.id),
        ),
      );
      const bad = results.find((r: any) => r?.error);
      if (bad) throw (bad as any).error;
    });
    // `runImmediate` returns a boolean precisely so callers can reconcile.
    // Discarding it left the list showing the dropped order after a failed
    // write, and every later load snapped it back with no explanation.
    if (!ok) {
      await save.flush();
      await load();
    }
  };

  /* --------------------------------------------------------------- view */

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => setStartersOpen(true)}>
        <Sparkles className="mr-1.5 h-4 w-4" />
        Starters
      </Button>
      <Button size="sm" onClick={() => setCreateOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        New template
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
          title="Checklist templates"
          description="Reusable inspection and service checklists - checkboxes, ratings, measurements, and pass/fail results."
          actions={headerActions}
        />
      )}

      {loading ? (
        <Card className={cn(SURFACE_CARD, "mt-6 flex items-center justify-center p-12")}>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </Card>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No templates yet"
          description="Start from a pre-built inspection or build your own. Either way you can rename, reorder, and retype every item after."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setStartersOpen(true)}>
                <Sparkles className="mr-1.5 h-4 w-4" />
                Start from a template
              </Button>
              <Button variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Blank template
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
              label="Templates"
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search templates…"
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived((s) => !s)}
              footer={
                <AddTarget onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  New template
                </AddTarget>
              }
            >
              {visibleTemplates.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No templates match “{search}”.
                </li>
              ) : (
                railSections.map(([heading, list]) => (
                  <Fragment key={heading}>
                    {railSections.length > 1 && (
                      <li className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[10px] font-extrabold uppercase tracking-[1.2px] text-muted-foreground">
                        {heading}
                        {heading === ownTrade && (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                            Yours
                          </span>
                        )}
                      </li>
                    )}
                    {list.map((t) => {
                      const count = items.filter((i) => i.template_id === t.id).length;
                      return (
                        <BuilderRailItem
                          key={t.id}
                          active={selectedId === t.id}
                          name={t.name}
                          archived={t.archived}
                          meta={`${count} item${count === 1 ? "" : "s"}`}
                          onSelect={() => void selectTemplate(t.id)}
                        />
                      );
                    })}
                  </Fragment>
                ))
              )}
            </BuilderRail>
          }
          canvas={
            selected ? (
              <>
                <BuilderBackToList label="All templates" onClick={() => setPane("list")} />
                <BuilderCanvas>
                  <BuilderTitleBar
                    icon={<ClipboardList className="h-4.5 w-4.5" />}
                    title={selected.name}
                    description={selected.description ?? ""}
                    titlePlaceholder="Template name"
                    descriptionPlaceholder="When should the crew fill this out?"
                    onTitleChange={(v) => updateTemplate(selected.id, { name: v })}
                    onDescriptionChange={(v) =>
                      updateTemplate(selected.id, { description: v || null })
                    }
                    saveState={save.state}
                    stats={
                      <>
                        <StatChip icon={ListChecks}>
                          {selectedItems.length} item{selectedItems.length === 1 ? "" : "s"}
                        </StatChip>
                        {requiredCount > 0 && (
                          <StatChip>
                            <span className="text-amber-600 dark:text-amber-400">
                              {requiredCount} required
                            </span>
                          </StatChip>
                        )}
                        {typeCount > 1 && <StatChip>{typeCount} answer types</StatChip>}
                        {/* Refiled in place, next to the other facts about the
                            template. Opening a settings panel to change which
                            heading a checklist appears under would be more
                            ceremony than the change deserves. */}
                        <TradeSelect
                          value={selected.category ?? null}
                          onChange={(v) => {
                            // Written straight through rather than debounced:
                            // it is a menu pick, not typing, and the rail has
                            // to re-group the moment it changes or the
                            // template appears to have moved nowhere.
                            setTemplates((prev) =>
                              prev.map((t) => (t.id === selected.id ? { ...t, category: v } : t)),
                            );
                            void supabase
                              .from(TABLES.templates as any)
                              .update({ category: v })
                              .eq("id", selected.id)
                              .then((r: any) => {
                                if (r.error) {
                                  toast.error(r.error.message);
                                  void load();
                                }
                              });
                          }}
                        />
                      </>
                    }
                    banner={
                      selected.archived ? (
                        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-[11.5px] font-semibold text-muted-foreground">
                          <Archive className="h-3.5 w-3.5" />
                          Archived - it won't show up when adding a checklist to a project.
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
                            <Button variant="ghost" size="icon" aria-label="Template actions">
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
                              Delete template
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    }
                  />

                  <div className="px-4 pb-5 pt-4 sm:px-6">
                    {selectedItems.length === 0 ? (
                      // Dead prose replaced by the two ways in, paste first.
                      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                        <p className="text-sm font-semibold text-foreground">No items yet</p>
                        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                          Most checklists already exist somewhere - a spec, an email, a punch list.
                          Paste it in and every line becomes an item.
                        </p>
                        <div className="mt-4 flex flex-wrap justify-center gap-2">
                          <Button size="sm" onClick={() => setBulkOpen(true)}>
                            <ListPlus className="mr-1.5 h-4 w-4" />
                            Paste a list
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void addItem()}>
                            <Plus className="mr-1.5 h-4 w-4" />
                            Add one item
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        modifiers={[restrictToVerticalAxis]}
                        onDragEnd={handleDragEnd}
                      >
                        <SortableContext
                          items={selectedItems.map((i) => i.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <ul className="space-y-1.5">
                            {selectedItems.map((it, idx) => (
                              <ItemRow
                                key={it.id}
                                index={idx}
                                item={it}
                                autoFocus={focusItemId === it.id}
                                onFocused={() => setFocusItemId(null)}
                                onChange={(patch) => updateItem(it.id, patch)}
                                onDelete={() => void deleteItem(it.id)}
                                onDuplicate={() => void duplicateItem(it)}
                                onAddAfter={() => void addItem(it.item_type, { after: it })}
                              />
                            ))}
                          </ul>
                        </SortableContext>
                      </DndContext>
                    )}

                    {/* Two visible controls and an overflow, the same shape as
                        the in-project composer - the crew filling a checklist
                        in and the manager who authored it should not be
                        learning two different bars. "Add typed item" used to be
                        a third full-width button spelling out what the ⋯ menu
                        now holds. */}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <AddTarget className="h-10 w-auto flex-1" onClick={() => void addItem()}>
                        <Plus className="h-4 w-4" />
                        Add item
                      </AddTarget>
                      {/* The escape hatch from one-at-a-time entry: most
                          checklists already exist as a list somewhere. */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10"
                        onClick={() => setBulkOpen(true)}
                      >
                        <ListPlus className="mr-1.5 h-4 w-4" />
                        Paste a list
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 shrink-0 text-muted-foreground"
                            aria-label="Add an item with a specific answer type"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-60">
                          <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                            Add with answer type
                          </DropdownMenuLabel>
                          {TYPE_ORDER.map((t) => {
                            const m = TYPE_META[t];
                            const I = m.icon;
                            return (
                              <DropdownMenuItem key={t} onClick={() => void addItem(t)}>
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
                    </div>
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
                <ClipboardList className="h-6 w-6 text-muted-foreground/70" />
                <p className="text-sm font-semibold">Select a template to edit</p>
              </Card>
            )
          }
        />
      )}

      {/* ---------------------------------------------------------- dialogs */}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New checklist template</DialogTitle>
            <DialogDescription>
              Name it after the job it covers. You can paste your whole list in next.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="tpl-name">Name</Label>
              <Input
                id="tpl-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) {
                    e.preventDefault();
                    void submitCreate();
                  }
                }}
                placeholder="e.g. Pre-pour inspection"
                autoFocus
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="tpl-desc">Description (optional)</Label>
              <Textarea
                id="tpl-desc"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={2}
                placeholder="When should the crew fill this out?"
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
              Create template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={startersOpen} onOpenChange={setStartersOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Start from a proven checklist</DialogTitle>
            <DialogDescription>
              Each one comes fully populated. Rename, reorder, or delete anything after.
            </DialogDescription>
          </DialogHeader>
          {/*
            Sorted, not grouped. Ten cards is short enough to scan in one pass,
            so headings would cost more space than they save - but which card is
            FIRST still matters, and after the setup wizard that is the one for
            their trade. Same ordering function as the rail and the Documents
            tab, so all three agree.
          */}
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-2">
            {starterOrder.map((s) => {
              const TradeIcon = categoryIcon(s.category ?? GENERAL_CATEGORY);
              return (
                <Card key={s.name} className={cn(SURFACE_CARD, "flex flex-col p-4")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-display text-lg font-bold tracking-[-0.3px]">{s.name}</div>
                    {s.category === ownTrade && (
                      <span className="mt-1 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.6px] text-primary">
                        Your trade
                      </span>
                    )}
                  </div>
                  {s.category && (
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                      <TradeIcon className="h-3 w-3" />
                      {s.category}
                    </div>
                  )}
                  <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
                    {s.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {[...new Set(s.items.map((i) => i.item_type))].map((t) => {
                      const m = TYPE_META[t];
                      const I = m.icon;
                      return (
                        <span
                          key={t}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold",
                            m.tint,
                          )}
                        >
                          <I className="h-3 w-3" />
                          {m.short}
                        </span>
                      );
                    })}
                  </div>
                  <div className="mt-3 text-[11px] font-semibold text-muted-foreground">
                    {s.items.length} items · {s.items.filter((i) => i.required).length} required
                  </div>
                  <Button
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => void createFromStarter(s)}
                    disabled={creating}
                  >
                    Use this template
                  </Button>
                </Card>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <BulkAddItemsDialog<ItemType>
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onAdd={addItemsBulk}
        types={TYPE_ORDER.map((t) => ({
          value: t,
          label: TYPE_META[t].short,
          icon: TYPE_META[t].icon,
        }))}
        defaultType="checkbox"
        description={`One per line - they'll be appended to “${selected?.name ?? "this template"}”. Bullets and numbering are stripped automatically.`}
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Field preview</DialogTitle>
            <DialogDescription>
              How “{selected?.name}” looks to the crew on a project.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-1.5 overflow-y-auto rounded-2xl border border-border bg-muted/25 p-3">
            {selectedItems.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Add an item to see the preview.
              </p>
            ) : (
              selectedItems.map((it) => <PreviewRow key={it.id} item={it} />)
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ====================================================================== */

function ItemRow({
  index,
  item,
  autoFocus,
  onFocused,
  onChange,
  onDelete,
  onDuplicate,
  onAddAfter,
}: {
  index: number;
  item: TemplateItem;
  autoFocus: boolean;
  onFocused: () => void;
  onChange: (patch: Partial<TemplateItem>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddAfter: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const removed = useRef(false);
  // Helper text is opt-in per item - an always-present empty textarea under
  // every row was most of what made this list feel like a form to survive.
  const [showHelp, setShowHelp] = useState(!!item.description);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      onFocused();
    }
  }, [autoFocus, onFocused]);

  const meta = TYPE_META[item.item_type] ?? TYPE_META.checkbox;
  const Icon = meta.icon;

  const remove = () => {
    if (removed.current) return;
    removed.current = true;
    onDelete();
  };

  /**
   * Discard a never-named row, but only once focus actually leaves it -
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
        "group rounded-xl border border-border bg-card px-1.5 py-1.5 transition-colors hover:border-primary/30",
        // `relative`, because z-index is inert on a static box: this read
        // `z-30` and did nothing at all, so the row being dragged was painted
        // in plain DOM order and the rows below it clipped its lift shadow.
        // The value has to stay under the sticky BuilderTitleBar (z-10) and
        // AppHeader (z-20) - at z-30 it would have floated over both.
        isDragging && "relative z-[5] opacity-90 shadow-[0px_14px_28px_-18px_rgba(16,25,41,0.55)]",
      )}
    >
      <div className="flex items-center gap-1.5">
        <DragHandle {...attributes} {...listeners} />
        <span className="w-5 shrink-0 text-right text-[11px] font-bold tabular-nums text-muted-foreground/60">
          {index + 1}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={`${meta.label} - click to change`}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[10.5px] font-extrabold uppercase tracking-wide transition-opacity hover:opacity-80",
                meta.tint,
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{meta.short}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Answer type
            </DropdownMenuLabel>
            {TYPE_ORDER.map((t) => {
              const m = TYPE_META[t];
              const I = m.icon;
              return (
                <DropdownMenuItem key={t} onClick={() => onChange({ item_type: t })}>
                  <I className="mr-2 h-4 w-4" />
                  <span className="flex-1">
                    {m.label}
                    <span className="block text-[11px] text-muted-foreground">{m.hint}</span>
                  </span>
                  {item.item_type === t && (
                    <CheckSquare className="ml-2 h-3.5 w-3.5 text-primary" />
                  )}
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
          placeholder="What does the crew check?"
          aria-label="Item label"
        />

        {/* Badge the exception, not the rule: most items are optional, so an
            always-on OPTIONAL pill was a uniform badge on twenty rows carrying
            no information. Marking one required moved into the ⋯ menu below
            rather than behind a hover-reveal - `group-hover` compiles inside
            `@media (hover: hover)`, so on a tablet the control would have been
            permanently invisible, and it is the only way to set this flag. */}
        {item.required && <RequiredToggle required onToggle={(v) => onChange({ required: v })} />}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-60"
              onMouseDown={(e) => e.preventDefault()}
              aria-label="Item actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => onChange({ required: !item.required })}>
              <AlertCircle className="mr-2 h-4 w-4" />
              {item.required ? "Make optional" : "Mark required"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowHelp((s) => !s)}>
              <MessageSquareText className="mr-2 h-4 w-4" />
              {showHelp || item.description ? "Hide helper text" : "Add helper text"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="mr-2 h-4 w-4" />
              Duplicate item
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={remove}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete item
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Indent lines up with the type chip - the chip's width varies by label. */}
      {(showHelp || item.description) && (
        <div className="pl-[52px] pr-9">
          <QuietTextarea
            value={item.description ?? ""}
            onChange={(e) => onChange({ description: e.target.value || null })}
            placeholder="Helper text shown under this item in the field…"
            aria-label="Helper text"
            className="text-xs text-muted-foreground"
          />
        </div>
      )}
    </li>
  );
}

/** Read-only rendering of one item as the crew answers it. */
function PreviewRow({ item }: { item: TemplateItem }) {
  const label = item.label || "Untitled item";
  const header = (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-sm font-medium">{label}</span>
      {item.required && (
        <span className="text-[10px] font-extrabold uppercase tracking-wide text-amber-600 dark:text-amber-400">
          Required
        </span>
      )}
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      {item.item_type === "checkbox" ? (
        <div className="flex items-center gap-3">
          <Checkbox checked={false} disabled aria-hidden />
          {header}
        </div>
      ) : (
        header
      )}
      {item.description && (
        <p className="mt-1 text-[11px] text-muted-foreground">{item.description}</p>
      )}

      {item.item_type === "rating" && (
        <div className="mt-2 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} className="h-5 w-5 text-muted-foreground/40" />
          ))}
        </div>
      )}
      {(item.item_type === "pass_fail" || item.item_type === "yes_no") && (
        <div className="mt-2 flex gap-1.5">
          {(item.item_type === "pass_fail" ? ["Pass", "Fail"] : ["Yes", "No"]).map((v) => (
            <span
              key={v}
              className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-muted-foreground"
            >
              {v}
            </span>
          ))}
        </div>
      )}
      {item.item_type === "numeric" && (
        <div className="mt-2 w-32 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">
          0.00
        </div>
      )}
      {item.item_type === "text" && (
        <div className="mt-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Type an answer…
        </div>
      )}
    </div>
  );
}
