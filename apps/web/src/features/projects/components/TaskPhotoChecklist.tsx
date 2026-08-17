import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, StickyNote } from "lucide-react";
import { Input } from "@/components/ui/input";
import { photoIsDone, taskPhotoProgress, type TaskPhotoItem } from "@/lib/task-photo-items";

/**
 * The photos a task covers, each with its own state.
 *
 * This is the answer to the complaint that a multi-photo task had "all lumped
 * into one button for showing completion. no details what was done and what
 * needs to get done." One list, used in two places so the two cannot describe
 * the same task differently: expanded under a row on the project Tasks tab, and
 * inside the task dialog.
 */

export interface TaskChecklistPhoto {
  id: string;
  url: string;
  caption?: string | null;
  taken_at?: string | null;
}

interface Props {
  photoIds: string[];
  photos: TaskChecklistPhoto[];
  items: Map<string, TaskPhotoItem> | null | undefined;
  /** False when this viewer may not close the parent task. Notes stay editable. */
  canComplete: boolean;
  /** Why not, for the line under the list. */
  cannotCompleteReason?: string | null;
  onToggle: (photoId: string, next: "open" | "done") => void | Promise<void>;
  onNote: (photoId: string, note: string) => void | Promise<void>;
  /** Photo ids currently being written, so a row can show it is in flight. */
  pending?: Set<string>;
  /** Highlight the photo the viewer came from. */
  highlightPhotoId?: string | null;
  className?: string;
}

function photoLabel(photo: TaskChecklistPhoto | undefined, index: number): string {
  const caption = photo?.caption?.trim();
  if (caption) return caption;
  if (photo?.taken_at) {
    return new Date(photo.taken_at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  // Never the uuid. A crew member reading "Photo 3" knows where they are; a
  // crew member reading "8f2c1a90-..." has been handed a database row.
  return `Photo ${index + 1}`;
}

export function TaskPhotoChecklist({
  photoIds,
  photos,
  items,
  canComplete,
  cannotCompleteReason,
  onToggle,
  onNote,
  pending,
  highlightPhotoId,
  className,
}: Props) {
  const progress = taskPhotoProgress(photoIds, items);
  const photoById = new Map(photos.map((p) => [p.id, p]));

  if (photoIds.length === 0) return null;

  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-[#10B981] transition-all"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <span className="shrink-0 font-manrope text-[11px] font-bold tabular-nums text-muted-foreground">
          {progress.label}
        </span>
      </div>

      <ul className="space-y-1.5">
        {photoIds.map((photoId, index) => {
          const photo = photoById.get(photoId);
          const item = items?.get(photoId) ?? null;
          const done = photoIsDone(items, photoId);
          const busy = pending?.has(photoId) ?? false;
          return (
            <li key={photoId}>
              <PhotoRow
                label={photoLabel(photo, index)}
                url={photo?.url ?? ""}
                done={done}
                note={item?.note ?? ""}
                busy={busy}
                canComplete={canComplete}
                highlighted={highlightPhotoId === photoId}
                onToggle={() => void onToggle(photoId, done ? "open" : "done")}
                onNote={(note) => void onNote(photoId, note)}
              />
            </li>
          );
        })}
      </ul>

      {!canComplete && cannotCompleteReason && (
        <p className="mt-2 text-[10.5px] text-muted-foreground">{cannotCompleteReason}</p>
      )}
    </div>
  );
}

function PhotoRow({
  label,
  url,
  done,
  note,
  busy,
  canComplete,
  highlighted,
  onToggle,
  onNote,
}: {
  label: string;
  url: string;
  done: boolean;
  note: string;
  busy: boolean;
  canComplete: boolean;
  highlighted: boolean;
  onToggle: () => void;
  onNote: (note: string) => void;
}) {
  const [draft, setDraft] = useState(note);
  const [editing, setEditing] = useState(false);

  // A note written on another screen, or by another person, has to land here
  // without wiping what is being typed. Only sync when the field is at rest.
  useEffect(() => {
    if (!editing) setDraft(note);
  }, [note, editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() === note.trim()) return;
    onNote(draft);
  };

  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border-[0.8px] p-2 transition ${
        highlighted
          ? "border-primary/50 bg-primary/[0.06]"
          : done
            ? "border-[#34D399]/30 bg-[#34D399]/[0.05]"
            : "border-border bg-card/60"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={busy || !canComplete}
        aria-label={done ? `Reopen ${label}` : `Mark ${label} done`}
        title={
          canComplete
            ? done
              ? "Done. Click to reopen."
              : "Mark this photo done"
            : "Only the assignee or a manager can mark this done."
        }
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[0.8px] transition ${
          done ? "border-[#34D399] bg-[#34D399] text-white" : "border-border bg-card"
        } ${busy || !canComplete ? "cursor-not-allowed opacity-60" : "hover:border-primary"}`}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : done ? (
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
        ) : (
          <Circle className="h-3 w-3 text-muted-foreground/40" />
        )}
      </button>

      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : null}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={`truncate font-manrope text-xs font-bold ${done ? "text-muted-foreground line-through" : "text-foreground"}`}
        >
          {label}
        </p>
        {editing ? (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") {
                setDraft(note);
                setEditing(false);
              }
            }}
            placeholder="What was done to this photo?"
            className="mt-1 h-7 text-xs"
            autoFocus
          />
        ) : note.trim() ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-0.5 flex w-full items-start gap-1 text-left text-[11px] leading-4 text-muted-foreground hover:text-foreground"
          >
            <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1">{note}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-0.5 text-[11px] text-muted-foreground/70 hover:text-foreground"
          >
            {done ? "Add what was done" : "Add a note"}
          </button>
        )}
      </div>
    </div>
  );
}
