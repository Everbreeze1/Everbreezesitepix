import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/everlumen/client";
import { useAuth } from "@/hooks/use-auth";

/*
 * The Checklist Library page, laid out exactly as the Main-html reference
 * (public/Main-html/ChecklistLibraryContent.dc.html): a grid of checklist
 * template cards that opens an in-page editor with the template's items.
 *
 * Unlike the reference (a static mockup), the cards come from the account's
 * real checklist_templates - name, item counts, how many blueprints use each,
 * and when each was last edited - and the editor edits the template's real
 * items. Save writes the name and the item list back; Cancel discards.
 */

interface ChecklistTemplateRow {
  id: string;
  name: string;
  archived: boolean;
  updated_at: string;
  itemCount: number;
  usedInBlueprints: number;
  blueprintNames: string[];
}

interface ChecklistItem {
  /** Empty for an item that has not been saved yet. */
  id: string;
  label: string;
}

/** "Edited 2 weeks ago" style relative time, matching the mockup's meta line. */
function relativeEditTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "recently";
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 65) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/* ---- Icons (paths from the mockup's inline SVGs) ---- */

function ChecklistCardIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 6 1.6 1.6L8.5 4.8" />
      <path d="M11 6h9.5" />
      <path d="m4 12.5 1.6 1.6 2.9-2.8" />
      <path d="M11 12.5h9.5" />
      <path d="m4 19 1.6 1.6 2.9-2.8" />
      <path d="M11 19h9.5" />
    </svg>
  );
}

function RowsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function XIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function PlusIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/* ---- Editor view (the mockup's <sc-if isEditor> block), real items ---- */

function ChecklistEditor({
  name,
  savedName,
  blueprintNames,
  items,
  saving,
  onName,
  onAdd,
  onRename,
  onRemove,
  onBack,
  onSave,
}: {
  name: string;
  /** The name as stored, empty for a checklist that has not been created yet. */
  savedName: string;
  blueprintNames: string[];
  items: ChecklistItem[];
  saving: boolean;
  onName: (name: string) => void;
  onAdd: (label: string) => void;
  onRename: (index: number, label: string) => void;
  onRemove: (index: number) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  const [draft, setDraft] = useState("");
  const commitDraft = () => {
    const label = draft.trim();
    if (!label) return;
    onAdd(label);
    setDraft("");
  };

  return (
    <div className="mx-auto w-full max-w-[900px]">
      {/* Breadcrumb */}
      <div className="mb-3.5 text-[12.5px] text-faint">
        <a className="cursor-pointer text-primary hover:underline" onClick={onBack}>
          Checklists
        </a>{" "}
        &nbsp;/&nbsp; {savedName || "New checklist"}
      </div>

      {/* Title + actions */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Checklist name"
          aria-label="Checklist name"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 text-[22px] font-bold tracking-[-0.01em] text-foreground outline-none transition-colors placeholder:text-faint hover:border-border focus:border-primary/50"
        />
        <div className="flex gap-2.5">
          <button
            onClick={onBack}
            className="cursor-pointer rounded-[9px] border border-border px-4 py-2.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !name.trim()}
            className="cursor-pointer rounded-[9px] bg-primary px-4 py-2.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving\u2026" : "Save checklist"}
          </button>
        </div>
      </div>
      <div className="mb-[22px] text-[12.5px] text-faint">
        {blueprintNames.length === 0
          ? "Not used in any blueprint yet"
          : `Used in ${blueprintNames.length} ${blueprintNames.length === 1 ? "blueprint" : "blueprints"} \u00b7 ${blueprintNames.join(", ")}`}
      </div>

      {/* Items */}
      <div className="mb-2.5 text-xs font-semibold uppercase tracking-[0.05em] text-faint">
        Items
      </div>
      <div className="rounded-xl border border-border bg-card px-[18px] py-0.5">
        {items.length === 0 ? (
          <div className="px-1 py-[11px] text-[13px] italic text-faint">No items yet.</div>
        ) : (
          items.map((item, index) => (
            <div
              key={item.id || `new-${index}`}
              className="flex items-center gap-3 border-b border-border px-1 py-[11px] last:border-b-0"
            >
              <span className="shrink-0 text-faint">
                <RowsIcon />
              </span>
              {/* Template items are definitions, not completed work, so the box
                  is drawn open rather than claiming a done state. */}
              <span className="h-[17px] w-[17px] shrink-0 rounded-[5px] border-[1.6px] border-border" />
              <input
                value={item.label}
                onChange={(e) => onRename(index, e.target.value)}
                aria-label={`Item ${index + 1}`}
                className="min-w-0 flex-grow bg-transparent text-[13px] text-foreground outline-none"
              />
              <button
                onClick={() => onRemove(index)}
                className="shrink-0 cursor-pointer text-faint transition-colors hover:text-foreground"
                aria-label={`Delete "${item.label}"`}
              >
                <XIcon />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add item field */}
      <label className="mt-4 flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px] text-faint transition-colors focus-within:border-primary/50 hover:border-primary/50">
        <PlusIcon />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            }
          }}
          onBlur={commitDraft}
          placeholder="Add item\u2026"
          className="min-w-0 flex-grow bg-transparent text-foreground outline-none placeholder:text-faint"
        />
      </label>
    </div>
  );
}

/* ---- Library page (the mockup's grid), real data ---- */

export function ChecklistLibraryContent({
  createTick,
  onCreate,
}: {
  /** Incremented by the hub's "New checklist" button. */
  createTick: number;
  onCreate: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<ChecklistTemplateRow[]>([]);
  const [itemsByTemplate, setItemsByTemplate] = useState<Record<string, ChecklistItem[]>>({});
  const { user } = useAuth();
  const [view, setView] = useState<"list" | "editor">("list");
  const [editing, setEditing] = useState<ChecklistTemplateRow | null>(null);
  const [name, setName] = useState("");
  const [localItems, setLocalItems] = useState<ChecklistItem[]>([]);
  const [saving, setSaving] = useState(false);

  const prevCreateTick = useRef(createTick);
  useEffect(() => {
    if (createTick > prevCreateTick.current) {
      void load();
      setEditing(null);
      setName("");
      setLocalItems([]);
      setView("editor");
    }
    prevCreateTick.current = createTick;
  }, [createTick]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    const [tplRes, itemsRes, usageRes, bpRes] = await Promise.all([
      supabase
        .from("checklist_templates" as any)
        .select("id, name, description, archived, created_at, updated_at, category")
        .order("updated_at", { ascending: false }),
      supabase
        .from("checklist_template_items" as any)
        .select("id, template_id, label, position")
        .order("position", { ascending: true }),
      supabase
        .from("project_template_checklists" as any)
        .select("id, project_template_id, checklist_template_id"),
      supabase.from("project_templates" as any).select("id, name, archived"),
    ]);

    const blueprintName: Record<string, string> = {};
    for (const b of (bpRes.data as any[]) ?? []) {
      if (!b.archived) blueprintName[b.id] = b.name ?? "";
    }

    const itemCount: Record<string, number> = {};
    const items: Record<string, ChecklistItem[]> = {};
    for (const it of (itemsRes.data as any[]) ?? []) {
      if (!it.template_id) continue;
      itemCount[it.template_id] = (itemCount[it.template_id] ?? 0) + 1;
      (items[it.template_id] ??= []).push({ id: it.id, label: it.label ?? "" });
    }
    const usage: Record<string, string[]> = {};
    for (const u of (usageRes.data as any[]) ?? []) {
      const bp = blueprintName[u.project_template_id];
      if (!u.checklist_template_id || !bp) continue;
      const names = (usage[u.checklist_template_id] ??= []);
      if (!names.includes(bp)) names.push(bp);
    }

    setTemplates(
      ((tplRes.data as any[]) ?? [])
        .filter((t: any) => !t.archived)
        .map((t: any) => ({
          id: t.id,
          name: t.name ?? "",
          archived: !!t.archived,
          updated_at: t.updated_at ?? t.created_at ?? "",
          itemCount: itemCount[t.id] ?? 0,
          usedInBlueprints: usage[t.id]?.length ?? 0,
          blueprintNames: usage[t.id] ?? [],
        })),
    );
    setItemsByTemplate(items);
    setLoading(false);
  }

  const openEditor = (t: ChecklistTemplateRow) => {
    setEditing(t);
    setName(t.name);
    setLocalItems(itemsByTemplate[t.id] ?? []);
    setView("editor");
  };

  const addItem = (label: string) => {
    setLocalItems((xs) => [...xs, { id: "", label }]);
  };

  const renameItem = (index: number, label: string) => {
    setLocalItems((xs) => xs.map((x, i) => (i === index ? { ...x, label } : x)));
  };

  const removeItem = (index: number) => {
    setLocalItems((xs) => xs.filter((_, i) => i !== index));
  };

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Blank rows are dropped rather than saved as nameless checklist items.
    const items = localItems.filter((i) => i.label.trim());
    setSaving(true);
    try {
      let templateId = editing?.id ?? "";
      if (editing) {
        if (trimmed !== editing.name) {
          const { error } = await supabase
            .from("checklist_templates" as any)
            .update({ name: trimmed })
            .eq("id", editing.id);
          if (error) throw error;
        }
      } else {
        if (!user) throw new Error("You need to be signed in to create a checklist");
        const { data, error } = await supabase
          .from("checklist_templates" as any)
          .insert({ created_by: user.id, name: trimmed })
          .select("id")
          .single();
        if (error || !data) throw error ?? new Error("Failed to create checklist");
        templateId = (data as any).id as string;
      }

      const original = editing ? (itemsByTemplate[editing.id] ?? []) : [];
      const keptIds = new Set(items.map((i) => i.id).filter(Boolean));
      const removedIds = original.map((i) => i.id).filter((id) => !keptIds.has(id));
      if (removedIds.length > 0) {
        const { error } = await supabase
          .from("checklist_template_items" as any)
          .delete()
          .in("id", removedIds);
        if (error) throw error;
      }

      const originalIndex = new Map(original.map((i, index) => [i.id, index]));
      for (const [position, item] of items.entries()) {
        const label = item.label.trim();
        if (!item.id) {
          const { error } = await supabase.from("checklist_template_items" as any).insert({
            template_id: templateId,
            position,
            label,
            required: false,
            item_type: "checkbox",
          });
          if (error) throw error;
        } else if (
          original[originalIndex.get(item.id) ?? -1]?.label !== label ||
          originalIndex.get(item.id) !== position
        ) {
          const { error } = await supabase
            .from("checklist_template_items" as any)
            .update({ label, position })
            .eq("id", item.id);
          if (error) throw error;
        }
      }

      if (editing) {
        // Item edits do not touch the template row, and the card's "Edited ..." reads it.
        await supabase
          .from("checklist_templates" as any)
          .update({ updated_at: new Date().toISOString() })
          .eq("id", templateId);
      }
      toast.success(editing ? "Checklist saved" : "Checklist created");
      setView("list");
      await load();
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't save the checklist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-10 sm:px-10">
      {loading && templates.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-faint">Loading checklists&hellip;</div>
      ) : view === "editor" ? (
        <ChecklistEditor
          name={name}
          savedName={editing?.name ?? ""}
          blueprintNames={editing?.blueprintNames ?? []}
          items={localItems}
          saving={saving}
          onName={setName}
          onAdd={addItem}
          onRename={renameItem}
          onRemove={removeItem}
          onBack={() => setView("list")}
          onSave={() => void save()}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((c) => (
            <div
              key={c.id}
              onClick={() => openEditor(c)}
              className="flex cursor-pointer flex-col gap-3 rounded-[13px] border border-border bg-card p-5 transition-colors hover:border-primary"
            >
              <div className="flex items-center gap-2.5">
                <span className="shrink-0 text-primary">
                  <ChecklistCardIcon />
                </span>
                <div className="text-[14.5px] font-semibold text-foreground">{c.name}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-2 py-[3px] text-[11px] text-muted-foreground">
                  {c.itemCount} {c.itemCount === 1 ? "item" : "items"}
                </span>
                <span className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-2 py-[3px] text-[11px] text-muted-foreground">
                  Used in {c.usedInBlueprints}{" "}
                  {c.usedInBlueprints === 1 ? "blueprint" : "blueprints"}
                </span>
              </div>
              <div className="border-t border-border pt-3 text-xs text-faint">
                {c.updated_at ? `Edited ${relativeEditTime(c.updated_at)}` : "Edited recently"}
              </div>
            </div>
          ))}

          {/* Dashed "Build a new checklist" card */}
          <div
            onClick={onCreate}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[13px] border border-dashed border-border p-5 text-faint transition-colors hover:border-primary"
          >
            <PlusIcon size={22} />
            <div className="text-[13px] font-medium">Build a new checklist</div>
          </div>
        </div>
      )}
    </div>
  );
}
