import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Tag as TagIcon, Check, Search } from "lucide-react";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { rememberTagColor } from "@/hooks/use-tag-colors";
import { toast } from "sonner";

export interface TagRow {
  id: string;
  name: string;
  color: string;
}

const PRESET_COLORS = [
  "#64748b",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

interface Props {
  scope: "project" | "photo";
  targetId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  trigger?: React.ReactNode;
}

function highlightMatch(name: string, query: string) {
  if (!query) return <span>{name}</span>;
  const q = query.toLowerCase();
  const idx = name.toLowerCase().indexOf(q);
  if (idx === -1) return <span>{name}</span>;
  return (
    <span>
      {name.slice(0, idx)}
      <mark className="rounded bg-primary/20 px-0.5 font-semibold text-primary">
        {name.slice(idx, idx + q.length)}
      </mark>
      {name.slice(idx + q.length)}
    </span>
  );
}

export function TagPicker({ scope, targetId, selectedIds, onChange, trigger }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [query, setQuery] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const joinTable = scope === "project" ? "project_tags" : "photo_tags";
  const fkCol = scope === "project" ? "project_id" : "photo_id";

  const loadTags = async () => {
    const { data, error } = await (supabase as any)
      .from("tags")
      .select("id, name, color")
      .order("name", { ascending: true });
    if (error) return toast.error(error.message);
    setTags((data as TagRow[]) ?? []);
  };

  useEffect(() => {
    if (open) void loadTags();
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();

  const selectedTags = useMemo(
    () =>
      tags.filter((t) => selectedIds.includes(t.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [tags, selectedIds],
  );
  const unselectedTags = useMemo(
    () => tags.filter((t) => !selectedIds.includes(t.id)),
    [tags, selectedIds],
  );
  const filteredUnselected = useMemo(() => {
    if (!normalizedQuery) return unselectedTags;
    return unselectedTags.filter((t) => t.name.toLowerCase().includes(normalizedQuery));
  }, [unselectedTags, normalizedQuery]);

  const visibleRows: Array<{ type: "selected" | "unselected"; tag: TagRow }> = useMemo(() => {
    const rows: Array<{ type: "selected" | "unselected"; tag: TagRow }> = [];
    if (normalizedQuery) {
      // When searching, show matches from both groups in one list.
      const matchingSelected = selectedTags.filter((t) =>
        t.name.toLowerCase().includes(normalizedQuery),
      );
      rows.push(...matchingSelected.map((t) => ({ type: "selected" as const, tag: t })));
      rows.push(...filteredUnselected.map((t) => ({ type: "unselected" as const, tag: t })));
    } else {
      rows.push(...selectedTags.map((t) => ({ type: "selected" as const, tag: t })));
      rows.push(...filteredUnselected.map((t) => ({ type: "unselected" as const, tag: t })));
    }
    return rows;
  }, [selectedTags, filteredUnselected, normalizedQuery]);

  const exactMatch = useMemo(
    () => tags.some((t) => t.name.toLowerCase() === normalizedQuery),
    [tags, normalizedQuery],
  );
  const canCreate = normalizedQuery.length > 0 && !exactMatch;

  const resetSearch = () => {
    setQuery("");
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const toggle = async (tagId: string) => {
    const isSel = selectedIds.includes(tagId);
    const next = isSel ? selectedIds.filter((i) => i !== tagId) : [...selectedIds, tagId];
    onChange(next);
    if (isSel) {
      const { error } = await supabase
        .from(joinTable as any)
        .delete()
        .eq(fkCol, targetId)
        .eq("tag_id", tagId);
      if (error) toast.error(error.message);
    } else {
      const { error } = await supabase
        .from(joinTable as any)
        .insert({ [fkCol]: targetId, tag_id: tagId, created_by: user?.id } as any);
      if (error) toast.error(error.message);
    }
    resetSearch();
  };

  const create = async () => {
    const name = query.trim();
    if (!name || !user || creating) return;
    const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setQuery("");
      if (!selectedIds.includes(existing.id)) await toggle(existing.id);
      return;
    }
    setCreating(true);
    const { data, error } = await (supabase as any)
      .from("tags")
      .insert({ name, color, created_by: user.id })
      .select("id, name, color")
      .single();
    setCreating(false);
    if (error) {
      toast.error(error.message || "Could not create tag");
      return;
    }
    const created = data as TagRow;
    rememberTagColor(created.name, created.color);
    setTags((t) => [...t, created].sort((a, b) => a.name.localeCompare(b.name)));
    setQuery("");
    setActiveIndex(-1);
    await toggle(created.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const maxIndex = visibleRows.length > 0 ? visibleRows.length - 1 : -1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, maxIndex));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && visibleRows[activeIndex]) {
        void toggle(visibleRows[activeIndex].tag.id);
      } else if (canCreate) {
        void create();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.querySelector(`[data-index="${activeIndex}"]`);
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs">
            <TagIcon className="h-3 w-3" /> Tags
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="end">
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(-1);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search or create a tag…"
              className="h-9 pl-8 text-sm"
            />
          </div>

          <div ref={listRef} className="max-h-60 space-y-0.5 overflow-y-auto pr-1">
            {!normalizedQuery && selectedTags.length > 0 && (
              <div className="pb-1">
                <p className="sticky top-0 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-popover">
                  Selected
                </p>
              </div>
            )}

            {visibleRows.map((row, i) => {
              const sel = row.type === "selected";
              return (
                <button
                  key={row.tag.id}
                  type="button"
                  data-index={i}
                  onClick={() => void toggle(row.tag.id)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition ${
                    i === activeIndex ? "bg-accent" : "hover:bg-accent"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
                      style={{ background: row.tag.color }}
                    />
                    {highlightMatch(row.tag.name, query.trim())}
                  </span>
                  {sel ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                </button>
              );
            })}

            {visibleRows.length === 0 && (
              <div className="px-2 py-4 text-center">
                <p className="text-xs text-muted-foreground">
                  {normalizedQuery ? `No tags match "${query.trim()}"` : "No tags yet"}
                </p>
              </div>
            )}
          </div>

          {canCreate && (
            <div className="space-y-2 border-t border-border pt-2">
              <div className="flex items-center gap-2">
                <label
                  className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-full ring-2 ring-border"
                  style={{ background: color }}
                  title="Pick any color"
                >
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    aria-label="Tag color"
                  />
                </label>
                <div className="flex flex-wrap gap-1">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      aria-label={`Color ${c}`}
                      className={`h-5 w-5 rounded-full ring-2 transition ${
                        color.toLowerCase() === c.toLowerCase()
                          ? "ring-foreground"
                          : "ring-transparent"
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              <Button size="sm" className="h-8 w-full gap-1" disabled={creating} onClick={create}>
                <Plus className="h-3.5 w-3.5" /> Create "{query.trim()}"
              </Button>
              <p className="text-[10px] text-muted-foreground">
                Tag library is shared across the workspace.
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TagChips({
  tags,
  onRemove,
  max,
}: {
  tags: TagRow[];
  onRemove?: (id: string) => void;
  max?: number;
}) {
  if (!tags.length) return null;
  const shown = max ? tags.slice(0, max) : tags;
  const extra = max && tags.length > max ? tags.length - max : 0;
  const toTitle = (s: string) =>
    s
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold shadow-sm backdrop-blur"
          style={{
            color: t.color,
            borderColor: `${t.color}55`,
            background: `${t.color}18`,
          }}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
          {toTitle(t.name)}
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemove(t.id);
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${t.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {extra > 0 && (
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  );
}
