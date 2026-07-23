import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { rememberTagColor } from "@/hooks/use-tag-colors";
import { toast } from "sonner";

interface GlobalTag {
  id: string;
  name: string;
  color: string;
}

interface Props {
  /** Tag names currently on this photo (photos.tags text[]). */
  photoTags: string[];
  /** Toggle a tag name on/off for this photo. */
  onToggle: (tagName: string) => void | Promise<void>;
  /**
   * Optional legacy props — kept for backwards compatibility with older callers.
   * They are ignored: the picker always sources from the global/company tag library.
   */
  projectTags?: string[];
  onCreate?: (tagName: string) => void | Promise<void>;
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

const normalize = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32);

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

/**
 * Searchable, multi-select tag dropdown used on photo thumbnails AND inside
 * the lightbox. Sources tags from the global/company `tags` table so the
 * experience is identical everywhere and tags are shared across projects.
 */
export function PhotoTagPopoverBody({ photoTags, onToggle, onCreate }: Props) {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [tags, setTags] = useState<GlobalTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [color, setColor] = useState(PRESET_COLORS[4]);
  const [creating, setCreating] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase as any)
        .from("tags")
        .select("id, name, color")
        .order("name", { ascending: true });
      if (cancelled) return;
      if (error) toast.error(error.message);
      setTags((data as GlobalTag[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const query = q.trim();
  const normQuery = normalize(query);

  const selectedTags = useMemo(
    () =>
      tags.filter((t) => photoTags.includes(t.name)).sort((a, b) => a.name.localeCompare(b.name)),
    [tags, photoTags],
  );
  const unselectedTags = useMemo(
    () => tags.filter((t) => !photoTags.includes(t.name)),
    [tags, photoTags],
  );

  const matches = useMemo(() => {
    const ql = query.toLowerCase();
    if (!ql) return { selected: selectedTags, unselected: unselectedTags };
    const selected = selectedTags.filter((t) => t.name.toLowerCase().includes(ql));
    const unselected = unselectedTags.filter((t) => t.name.toLowerCase().includes(ql));
    return { selected, unselected };
  }, [selectedTags, unselectedTags, query]);

  const visibleRows: Array<{ type: "selected" | "unselected"; tag: GlobalTag }> = useMemo(() => {
    const rows: Array<{ type: "selected" | "unselected"; tag: GlobalTag }> = [];
    rows.push(...matches.selected.map((t) => ({ type: "selected" as const, tag: t })));
    rows.push(...matches.unselected.map((t) => ({ type: "unselected" as const, tag: t })));
    return rows;
  }, [matches]);

  const exactExists = tags.some((t) => t.name.toLowerCase() === query.toLowerCase());

  const resetSearch = () => {
    setQ("");
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const handleToggle = async (tagName: string) => {
    await onToggle(tagName);
    resetSearch();
  };

  const create = async () => {
    if (!normQuery || !user || creating) return;
    const existing = tags.find((t) => t.name.toLowerCase() === query.toLowerCase());
    if (existing) {
      setQ("");
      if (!photoTags.includes(existing.name)) await handleToggle(existing.name);
      return;
    }
    setCreating(true);
    const { data, error } = await (supabase as any)
      .from("tags")
      .insert({ name: normQuery, color, created_by: user.id })
      .select("id, name, color")
      .single();
    setCreating(false);
    if (error) {
      toast.error(error.message || "Could not create tag");
      return;
    }
    const created = data as GlobalTag;
    rememberTagColor(created.name, created.color);
    setTags((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setQ("");
    setActiveIndex(-1);
    await handleToggle(created.name);
    if (onCreate) await onCreate(created.name);
  };

  const selectedCount = photoTags.length;

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
        void handleToggle(visibleRows[activeIndex].tag.name);
      } else if (query && !exactExists) {
        void create();
      }
    } else if (e.key === "Escape") {
      if (query) {
        e.preventDefault();
        resetSearch();
      }
    }
  };

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.querySelector(`[data-index="${activeIndex}"]`);
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Tag this photo
        </p>
        {selectedCount > 0 && (
          <span className="text-[10px] text-muted-foreground">{selectedCount} selected</span>
        )}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search or create new tag…"
          className="h-8 pl-8 text-xs"
          maxLength={32}
        />
      </div>
      <div ref={listRef} className="max-h-56 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {!loading && visibleRows.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            {query ? `No tags match "${query}"` : "No tags yet. Type a name to create one."}
          </p>
        )}
        {!loading && !query && selectedTags.length > 0 && (
          <p className="sticky top-0 z-10 px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-popover">
            Selected
          </p>
        )}
        {!loading &&
          visibleRows.map((row, i) => {
            const has = row.type === "selected";
            return (
              <button
                key={row.tag.id}
                type="button"
                data-index={i}
                onClick={() => void handleToggle(row.tag.name)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition ${
                  i === activeIndex ? "bg-accent" : "hover:bg-accent"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    has ? "border-primary bg-primary text-primary-foreground" : "border-input"
                  }`}
                >
                  {has && <Check className="h-3 w-3" />}
                </span>
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: row.tag.color }}
                />
                <span className="truncate">{highlightMatch(row.tag.name, query)}</span>
              </button>
            );
          })}
      </div>
      {query && !exactExists && (
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
                  className={`h-4 w-4 rounded-full ring-2 transition ${
                    color.toLowerCase() === c.toLowerCase() ? "ring-foreground" : "ring-transparent"
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8 w-full gap-1"
            disabled={creating}
            onClick={() => void create()}
          >
            <Plus className="h-3.5 w-3.5" /> Create "{normQuery}"
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Tags are shared across your whole workspace. Tap multiple to apply several.
          </p>
        </div>
      )}
    </div>
  );
}
