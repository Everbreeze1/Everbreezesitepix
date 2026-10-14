import { useEffect, useRef, useState } from "react";
import { Check, ImageOff, Loader2, Pencil, Play, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SummaryPhoto } from "@/lib/summaries.functions";

/**
 * The summary's photos, each carrying its own note.
 *
 * "each note sitting directly next to its matching photo, not narration and
 * photos in two separate lists like the current build."
 *
 * One list, and it is the only place photos appear on the page. The prose above
 * it is prose: the old composer appended a `## Photos` gallery to the markdown
 * as well, so every reader had to strip it back out before rendering, and any
 * that forgot showed the whole set twice.
 *
 * Each card shows the AI's note only. The AI already heard what was said near
 * the shot and wrote it into the note, so printing the raw words again as a
 * "heard on camera" quote just said the same thing twice. `spoken` stays in the
 * data for the report writer; it is not shown.
 *
 * On the summary page each note can be corrected in place: "i should be able to
 * click on the comments on any picture on the summary and edit it just in case
 * something got recorded wrong." `onEditNote` turns that on; the public share
 * page leaves it off and stays read-only.
 */

const fmtOffset = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;

export function SummaryPhotoNotes({
  photos,
  /** True when this summary came from a recording, so offsets mean something. */
  timed = false,
  /** Given when there is a player above to drive; omitted on the share page. */
  onSeek,
  /** Given on the owner's summary page, so a note can be corrected in place. */
  onEditNote,
  className,
}: {
  photos: SummaryPhoto[];
  timed?: boolean;
  onSeek?: (seconds: number) => void;
  onEditNote?: (photoId: string, note: string) => Promise<void>;
  className?: string;
}) {
  if (!photos.length) return null;

  return (
    <section className={cn("mt-8", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">Photos</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {timed
              ? "Each photo from the walk, with the AI's note on what was being done."
              : "The photos this summary was written from."}
            {onEditNote && " Click a note to correct it."}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {photos.length} {photos.length === 1 ? "photo" : "photos"}
        </span>
      </div>

      <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {photos.map((photo, idx) => {
          // The caption only earns a line of its own when it says something the
          // note does not already say.
          const caption = photo.caption && photo.caption !== photo.note ? photo.caption : null;
          return (
            <li
              key={`${photo.photoId}-${idx}`}
              className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            >
              <div className="relative aspect-[4/3] bg-muted">
                {photo.imageUrl ? (
                  <img
                    src={photo.imageUrl}
                    alt={photo.note || caption || "Site photo"}
                    loading="lazy"
                    decoding="async"
                    sizes="(max-width: 640px) 100vw, 50vw"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="h-6 w-6" />
                  </div>
                )}
                {/* A summary written from photos has no timeline, so a badge
                    would stamp a meaningless 0:00 on every tile. */}
                {timed &&
                  (onSeek ? (
                    <button
                      type="button"
                      onClick={() => onSeek(photo.offsetSeconds)}
                      className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 font-mono text-[11px] font-medium text-white backdrop-blur-sm transition hover:bg-black/85"
                    >
                      <Play className="h-2.5 w-2.5" />
                      {fmtOffset(photo.offsetSeconds)}
                    </button>
                  ) : (
                    <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[11px] font-medium text-white backdrop-blur-sm">
                      {fmtOffset(photo.offsetSeconds)}
                    </span>
                  ))}
              </div>

              <div className="flex flex-1 flex-col gap-2.5 p-3.5">
                <div>
                  <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
                    <Sparkles className="h-3 w-3" strokeWidth={2.25} />
                    Note
                  </p>
                  {onEditNote ? (
                    <EditableNote
                      note={photo.note ?? ""}
                      onSave={(note) => onEditNote(photo.photoId, note)}
                    />
                  ) : (
                    <p className="mt-1 text-sm leading-relaxed text-foreground">
                      {photo.note?.trim() || (
                        <span className="text-muted-foreground">
                          Nothing was recorded against this photo.
                        </span>
                      )}
                    </p>
                  )}
                </div>

                {caption && (
                  <p className="mt-auto border-t border-border/60 pt-2 text-[11.5px] text-muted-foreground">
                    Caption: {caption}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * One photo's note, as text until it is clicked and a text box after.
 *
 * Enter saves (Shift+Enter for a new line), Escape puts the old words back, and
 * clicking away saves too, so a correction never needs a separate Save button.
 */
function EditableNote({ note, onSave }: { note: string; onSave: (note: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(note);
  }, [note, editing]);

  // Grow with the text, so a long note is never cut off behind a scrollbar.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !editing) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);

  const commit = async () => {
    const next = draft.trim();
    setEditing(false);
    if (next === note.trim()) return;
    setSaving(true);
    try {
      await onSave(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setDraft(note);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <textarea
        ref={boxRef}
        autoFocus
        value={draft}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          const end = e.currentTarget.value.length;
          e.currentTarget.setSelectionRange(end, end);
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(note);
            setEditing(false);
          }
        }}
        placeholder="What was being done in this shot"
        aria-label="Edit note"
        className="mt-1 block w-full resize-none overflow-hidden rounded-lg border border-primary/50 bg-background px-2 py-1.5 text-sm leading-relaxed text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to edit this note"
      className="group/note -mx-2 mt-0.5 flex w-[calc(100%+1rem)] items-start gap-2 rounded-lg px-2 py-1 text-left text-sm leading-relaxed text-foreground transition hover:bg-muted/60"
    >
      <span className="min-w-0 flex-1 whitespace-pre-wrap">
        {note.trim() || (
          <span className="text-muted-foreground">
            Nothing was recorded against this photo. Click to add a note.
          </span>
        )}
      </span>
      <span className="mt-1 shrink-0 text-muted-foreground">
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : saved ? (
          <Check className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Pencil className="h-3.5 w-3.5 opacity-0 transition group-hover/note:opacity-100" />
        )}
      </span>
    </button>
  );
}
