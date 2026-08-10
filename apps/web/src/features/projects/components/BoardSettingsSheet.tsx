import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Plus, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import {
  updateProjectBoard,
  deleteProjectBoard,
  type ProjectBoard,
} from "@/lib/project-boards.functions";

interface TagRow {
  id: string;
  name: string;
  color: string;
}

function chipTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#111827" : "#ffffff";
}

export function BoardSettingsSheet({
  open,
  onOpenChange,
  board,
  allTags,
  onUpdated,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: ProjectBoard;
  allTags: TagRow[];
  onUpdated: (board: ProjectBoard) => void;
  onDeleted: (id: string) => void;
}) {
  const confirm = useConfirm();
  const [name, setName] = useState(board.name);
  const [tagIds, setTagIds] = useState<string[]>(board.tag_ids);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Re-seed when a different board is opened (or the board changes underneath us).
  useEffect(() => {
    setName(board.name);
    setTagIds(board.tag_ids);
  }, [board.id, board.name, board.tag_ids]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const tagById = useMemo(() => new Map(allTags.map((t) => [t.id, t])), [allTags]);
  const columns = tagIds.map((id) => tagById.get(id)).filter((t): t is TagRow => !!t);
  const available = allTags.filter((t) => !tagIds.includes(t.id));

  function handleReorder(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setTagIds((prev) => {
      const from = prev.indexOf(String(active.id));
      const to = prev.indexOf(String(over.id));
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Pipeline name can't be empty");
      return;
    }
    if (tagIds.length === 0) {
      toast.error("Add at least one stage");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateProjectBoard({
        data: { id: board.id, name: name.trim(), tagIds },
      });
      onUpdated(updated);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save pipeline");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (
      !(await confirm({
        description: `Delete "${board.name}"? The projects and tags stay — only the pipeline is removed.`,
        variant: "destructive",
      }))
    )
      return;
    try {
      await deleteProjectBoard({ data: { id: board.id } });
      onDeleted(board.id);
      onOpenChange(false);
      toast.success("Pipeline deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete pipeline");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 pb-4 pt-6 text-left">
          <SheetTitle>Pipeline Settings</SheetTitle>
          <SheetDescription>
            Select which tags appear as stages and drag to reorder them.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <Label htmlFor="board-name">Pipeline Name</Label>
          <Input
            id="board-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5"
          />

          <p className="mb-2 mt-6 text-sm font-bold text-foreground">
            Active Stages <span className="text-muted-foreground">({columns.length})</span>
          </p>

          {columns.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No stages yet — add a tag below.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleReorder}
            >
              <SortableContext items={tagIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {columns.map((tag) => (
                    <SortableColumnRow
                      key={tag.id}
                      tag={tag}
                      onRemove={() => setTagIds((prev) => prev.filter((id) => id !== tag.id))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={available.length === 0}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {available.length === 0 ? "All tags added" : "Add stage"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-72 w-64 overflow-y-auto p-1">
              {available.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTagIds((prev) => [...prev, t.id]);
                    setAddOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: t.color }}
                  />
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-6 py-4">
          <Button
            variant="outline"
            onClick={handleDelete}
            className="text-destructive hover:text-destructive"
          >
            Delete Board
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SortableColumnRow({ tag, onRemove }: { tag: TagRow; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tag.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // `relative` is required for the z-index to apply at all: this row is a
      // flex *container*, not a flex item, and its parent is a plain block — so
      // a bare `z-10` was dropped and the dragged row was painted in DOM order,
      // letting later siblings' opaque backgrounds cut across it.
      className={`flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-2 ${
        isDragging ? "relative z-[5] opacity-80 shadow-md" : ""
      }`}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-label={`Reorder ${tag.name}`}
        className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span
        className="inline-flex min-w-0 flex-1 items-center truncate rounded-full px-2.5 py-1 text-xs font-bold"
        style={{ background: tag.color, color: chipTextColor(tag.color) }}
      >
        <span className="truncate">{tag.name}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${tag.name} column`}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
