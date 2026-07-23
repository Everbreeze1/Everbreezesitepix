import { useEffect, useState } from "react";
import { Plus, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BeforeAfterTag } from "@/lib/watermark";

interface Props {
  open: boolean;
  count: number;
  onClose: () => void;
  /** Called with the selected before/after marker and any photo tags to apply. */
  onSelect: (tag: BeforeAfterTag, tags: string[]) => void;
  /** Existing photo tags the user can pick from. */
  existingTags?: string[];
  /** Create a new photo tag inline. Should return the normalized tag name. */
  onCreateTag?: (name: string) => Promise<string | null> | string | null;
}

export function TagPhotoDialog({
  open,
  count,
  onClose,
  onSelect,
  existingTags = [],
  onCreateTag,
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected([]);
      setNewTag("");
    }
  }, [open]);

  const toggle = (t: string) =>
    setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  const create = async () => {
    const v = newTag.trim();
    if (!v || creating || !onCreateTag) return;
    setCreating(true);
    try {
      const norm = await onCreateTag(v);
      if (norm && !selected.includes(norm)) setSelected((s) => [...s, norm]);
      setNewTag("");
    } finally {
      setCreating(false);
    }
  };

  const submit = (tag: BeforeAfterTag) => onSelect(tag, selected);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tag {count > 1 ? `${count} photos` : "this photo"}</DialogTitle>
          <DialogDescription>
            Apply a clean Before / After watermark and any photo tags. Project name &amp; address
            are added automatically.
          </DialogDescription>
        </DialogHeader>

        {/* Photo tag picker */}
        {(existingTags.length > 0 || onCreateTag) && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Photo tags
            </p>
            {existingTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {existingTags.map((t) => {
                  const on = selected.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggle(t)}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:border-foreground/40"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" />}#{t}
                    </button>
                  );
                })}
              </div>
            )}
            {onCreateTag && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
                className="flex items-center gap-1.5"
              >
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Add new tag…"
                  className="h-8 flex-1 text-xs"
                  maxLength={32}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="h-8 px-2"
                  disabled={!newTag.trim() || creating}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </form>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 pt-2">
          <Button
            onClick={() => submit("before")}
            variant="outline"
            className="h-20 flex-col gap-1 border-foreground/30 bg-foreground/5 font-bold tracking-wide hover:bg-foreground/10"
          >
            <span className="text-base">BEFORE</span>
            <span className="text-[10px] font-normal text-muted-foreground">Initial state</span>
          </Button>
          <Button
            onClick={() => submit("after")}
            className="h-20 flex-col gap-1 font-bold tracking-wide"
          >
            <span className="text-base">AFTER</span>
            <span className="text-[10px] font-normal opacity-80">Completed work</span>
          </Button>
          <Button
            onClick={() => submit(null)}
            variant="ghost"
            className="h-20 flex-col gap-1 border border-dashed"
          >
            <span className="text-sm">No marker</span>
            <span className="text-[10px] font-normal text-muted-foreground">Just save</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
