import { useMemo, useState } from "react";
import { Plus, X, Check, Sparkles, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ColorPicker";
import { toast } from "sonner";
import {
  hexToChipStyle,
  hexToChipStyleDark,
  useLabelColor,
  fallbackLabelColor,
  upsertLabel,
} from "@/hooks/use-label-catalog";

type ChipSize = "xs" | "sm" | "md" | "lg";

// Bumped one step to match TagPill - labels sit over photos and on dense cards,
// where the old 11-13px sizes were reported as hard to read.
const CHIP_SIZE_CLASSES: Record<ChipSize, string> = {
  xs: "px-2.5 py-1 text-xs tracking-tight",
  sm: "px-3 py-1 text-[13px]",
  md: "px-3 py-1.5 text-sm",
  lg: "px-4 py-1.5 text-base",
};

export function LabelChip({
  label,
  onRemove,
  size = "md",
  variant = "light",
}: {
  label: string;
  onRemove?: () => void;
  size?: ChipSize;
  variant?: "light" | "dark";
}) {
  const color = useLabelColor(label);
  return (
    <span
      className={`inline-flex items-center gap-1.5 border font-bold leading-none ${variant === "light" ? "shadow-sm" : ""} ${CHIP_SIZE_CLASSES[size]}`}
      style={{
        ...(variant === "dark" ? hexToChipStyleDark(color) : hexToChipStyle(color)),
        transform: "skewX(-12deg)",
        borderRadius: "4px",
      }}
    >
      <span className="whitespace-nowrap" style={{ transform: "skewX(12deg)" }}>
        {label}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-0.5 rounded-full p-0.5 opacity-80 transition hover:bg-black/15 hover:opacity-100"
          aria-label={`Remove ${label}`}
          style={{ transform: "skewX(12deg)" }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export function LabelPicker({
  value,
  onChange,
  suggestions = [],
  placeholder = "Search labels",
  triggerLabel = "Add label",
  teamId = null,
  userId,
  variant = "light",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  triggerLabel?: string;
  teamId?: string | null;
  userId?: string;
  variant?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Create-label dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(fallbackLabelColor("new"));
  const [saving, setSaving] = useState(false);

  const normalized = value.map((v) => v.toLowerCase());
  const available = useMemo(
    () =>
      Array.from(new Set(suggestions))
        .filter((s) => !normalized.includes(s.toLowerCase()))
        .filter((s) => s.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => a.localeCompare(b)),
    [suggestions, normalized, query],
  );

  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (value.some((v) => v.toLowerCase() === t.toLowerCase())) return;
    onChange([...value, t]);
    setQuery("");
  };

  const remove = (l: string) => onChange(value.filter((v) => v !== l));

  const openCreate = () => {
    setNewName(query.trim());
    setNewColor(fallbackLabelColor(query.trim() || String(Math.random())));
    setCreateOpen(true);
    setOpen(false);
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      if (userId) {
        const row = await upsertLabel({
          name,
          color: newColor,
          team_id: teamId,
          created_by: userId,
        });
        if (!row) {
          toast.error("Could not create label");
          return;
        }
      }
      add(name);
      setCreateOpen(false);
      toast.success("Label created");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((l) => (
        <LabelChip key={l} label={l} onRemove={() => remove(l)} variant={variant} />
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={
              variant === "dark"
                ? "inline-flex items-center gap-1.5 rounded-full border border-dashed border-white/25 bg-transparent px-3 py-1 text-xs font-medium text-white/65 transition hover:border-white/40 hover:bg-white/10 hover:text-white"
                : "inline-flex items-center gap-1.5 rounded-full border border-dashed border-border/80 bg-background px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-foreground/40 hover:bg-muted hover:text-foreground"
            }
          >
            <Plus className="h-3.5 w-3.5" />
            {value.length === 0 ? triggerLabel : "Add"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="h-9 text-sm"
          />
          <div className="mt-2 max-h-56 overflow-y-auto pr-0.5">
            {available.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {suggestions.length === 0
                  ? "No labels yet - create your first one."
                  : "No matching labels."}
              </p>
            )}
            {available.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <LabelChip label={s} size="sm" />
                <Check className="h-3.5 w-3.5 opacity-0" />
              </button>
            ))}
          </div>
          <div className="mt-2 border-t pt-2">
            <button
              type="button"
              onClick={openCreate}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-foreground hover:bg-muted"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              {query.trim() ? (
                <span>
                  Create new label <span className="font-semibold">"{query.trim()}"</span>
                </span>
              ) : (
                <span>Create new label…</span>
              )}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">Create a new label</DialogTitle>
            <DialogDescription>
              Give it a clear name and pick a color. Labels are reusable across every project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 pt-1">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Label name</label>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) {
                    e.preventDefault();
                    void submitCreate();
                  }
                }}
                placeholder="e.g. HVAC, In Progress, Priority"
                className="h-11 text-base"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Color</label>
              <ColorPicker value={newColor} onChange={setNewColor} size="md" />
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/40 px-4 py-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Preview
              </p>
              <span
                className="inline-flex items-center gap-1.5 border px-3.5 py-1.5 text-sm font-bold shadow-sm"
                style={{
                  ...hexToChipStyle(newColor),
                  transform: "skewX(-12deg)",
                  borderRadius: "4px",
                }}
              >
                <span style={{ transform: "skewX(12deg)" }}>{newName.trim() || "Label name"}</span>
              </span>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitCreate()}
              disabled={!newName.trim() || saving}
              className="min-w-24"
            >
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
