import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PhotoTagPopoverBody } from "@/features/photos/components/PhotoTagPopoverBody";
import type { BeforeAfterTag } from "@/lib/watermark";

interface Props {
  open: boolean;
  count: number;
  onClose: () => void;
  /** Called with the selected before/after marker and any photo tags to apply. */
  onSelect: (tag: BeforeAfterTag, tags: string[]) => void;
  /**
   * Told when a tag is created here, so the caller can refresh its own list.
   * The tag itself is written to the workspace library by the picker.
   */
  onCreateTag?: (name: string) => Promise<string | null> | string | null;
}

export function TagPhotoDialog({ open, count, onClose, onSelect, onCreateTag }: Props) {
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);

  const toggle = (t: string) =>
    setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

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

        {/*
         * The picker the thumbnails, the lightbox and the selection bar all
         * use. This flow used to draw its own: plain `#name` pills off whatever
         * tag names were already on this project's photos, with a separate
         * "Add new tag" box beside them. Same job, different look, and a tag
         * made here did not show up in the workspace library.
         */}
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <PhotoTagPopoverBody
            photoTags={selected}
            onToggle={toggle}
            onCreate={onCreateTag ? (name) => void onCreateTag(name) : undefined}
            heading="Photo tags"
            keepSearchOnToggle
          />
        </div>

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
