import { useEffect, useMemo, useState } from "react";
import { ListPlus, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Hard stop so a stray paste of a whole document can't create thousands of rows. */
const MAX_ITEMS = 200;

/**
 * Turn a pasted list into checklist items.
 *
 * Both the template designer and the on-project checklist only ever let you add
 * one item at a time — type a label, pick a type, click Add, repeat. Building a
 * 30-line QA walk that way is the single most tedious thing in the product, and
 * the list almost always already exists somewhere (a spec, an email, a Word
 * doc). This takes that list as-is.
 */
function parseItemLines(raw: string): string[] {
  return (
    raw
      .split(/\r?\n/)
      // Strip the bullet or numbering the source list came with, so pasting
      // "1. Check breaker" doesn't create an item literally called "1. Check…".
      .map((line) => line.replace(/^\s*(?:[-*•·–—]|\d+[.)])\s+/, "").trim())
      .filter(Boolean)
      .slice(0, MAX_ITEMS)
  );
}

export function BulkAddItemsDialog<T extends string>({
  open,
  onOpenChange,
  onAdd,
  types,
  defaultType,
  title = "Add several items",
  description = "One per line. Bullets and numbering are stripped automatically.",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Resolve once the rows are written; the dialog closes on success. */
  onAdd: (labels: string[], type: T) => Promise<void>;
  /** Answer types offered for the whole batch. */
  types: Array<{ value: T; label: string; icon?: React.ComponentType<{ className?: string }> }>;
  defaultType: T;
  title?: string;
  description?: string;
}) {
  const [raw, setRaw] = useState("");
  const [type, setType] = useState<T>(defaultType);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setRaw("");
      setType(defaultType);
    }
  }, [open, defaultType]);

  const labels = useMemo(() => parseItemLines(raw), [raw]);
  const truncated = raw.split(/\r?\n/).filter((l) => l.trim()).length > MAX_ITEMS;

  const submit = async () => {
    if (!labels.length) return;
    setSaving(true);
    try {
      await onAdd(labels, type);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter commits without reaching for the mouse.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={9}
          autoFocus
          placeholder={"Verify breaker labeled\nFilter replaced\nCondensate drain clear\n…"}
          className="resize-y font-mono text-sm leading-relaxed"
        />

        {types.length > 1 && (
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Answer type for all {labels.length || ""} item{labels.length === 1 ? "" : "s"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {types.map((t) => {
                const on = type === t.value;
                const Icon = t.icon;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setType(t.value)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors",
                      on
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter className="items-center">
          <p className="mr-auto text-xs font-semibold text-muted-foreground">
            {labels.length === 0
              ? "Nothing to add yet"
              : `${labels.length} item${labels.length === 1 ? "" : "s"} ready`}
            {truncated && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                · capped at {MAX_ITEMS}
              </span>
            )}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!labels.length || saving}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <ListPlus className="mr-1.5 h-4 w-4" />
            )}
            Add {labels.length || ""} item{labels.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
