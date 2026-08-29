/**
 * The site log document: which photos, and what was written against each.
 *
 * Import-free so the merge rules can be tested. The one that matters is what
 * happens when the model's descriptions arrive and somebody has already typed
 * something. Getting that wrong silently destroys work, and it destroys it at
 * the exact moment the person was being helpful to themselves.
 */

export type TodoItem = {
  id: string;
  text: string;
  done: boolean;
};

export type PhotoNote = {
  notes: string;
  todos: TodoItem[];
};

export type SiteLogRow = {
  id: string;
  project_id: string;
  title: string;
  photo_ids: string[] | null;
  notes: Record<string, PhotoNote> | null;
  created_at: string;
  updated_at: string;
};

export const EMPTY_NOTE: PhotoNote = { notes: "", todos: [] };

/**
 * The note for one photo, whatever the row actually holds.
 *
 * `notes` is jsonb written by two clients across a year of schema changes, so a
 * missing key, a null, and a row whose `todos` is not an array are all things
 * that occur. Every read goes through here.
 */
export function noteFor(
  notes: Record<string, PhotoNote> | null | undefined,
  photoId: string,
): PhotoNote {
  const raw = notes?.[photoId];
  if (!raw) return EMPTY_NOTE;
  return {
    notes: typeof raw.notes === "string" ? raw.notes : "",
    todos: Array.isArray(raw.todos) ? raw.todos.filter((t) => t && typeof t.text === "string") : [],
  };
}

/** The photo ids on a log, whatever the column holds. */
export function photoIdsOf(log: Pick<SiteLogRow, "photo_ids">): string[] {
  return Array.isArray(log.photo_ids) ? log.photo_ids.filter((id) => typeof id === "string") : [];
}

/**
 * Fold the model's descriptions into what is already there.
 *
 * **Written notes always win.** The model is asked to describe photos, not to
 * correct somebody, and a person who typed three careful lines and then tapped
 * Describe to fill in the rest must not lose them. This is the whole reason
 * this function exists rather than an object spread at the call site: a spread
 * in the wrong order is a one-character difference that destroys work.
 */
export function mergeDescriptions(
  current: Record<string, PhotoNote>,
  described: Record<string, string>,
  photoIds: string[],
): Record<string, PhotoNote> {
  const next: Record<string, PhotoNote> = {};
  for (const id of photoIds) {
    const existing = noteFor(current, id);
    const suggestion = (described[id] ?? "").trim();
    next[id] = {
      // Only fills a blank. Anything typed stays exactly as typed.
      notes: existing.notes.trim() ? existing.notes : suggestion,
      todos: existing.todos,
    };
  }
  return next;
}

/**
 * Drop notes for photos no longer in the log.
 *
 * Without this, removing a photo and adding it back resurrects a note somebody
 * deleted, and the jsonb grows forever on a log that gets edited often.
 */
export function pruneNotes(
  notes: Record<string, PhotoNote>,
  photoIds: string[],
): Record<string, PhotoNote> {
  const keep = new Set(photoIds);
  const next: Record<string, PhotoNote> = {};
  for (const [id, note] of Object.entries(notes)) {
    if (keep.has(id)) next[id] = note;
  }
  return next;
}

/** Set the written note for one photo, leaving its to-dos alone. */
export function withNoteText(
  notes: Record<string, PhotoNote>,
  photoId: string,
  text: string,
): Record<string, PhotoNote> {
  return { ...notes, [photoId]: { ...noteFor(notes, photoId), notes: text } };
}

export function withTodoAdded(
  notes: Record<string, PhotoNote>,
  photoId: string,
  text: string,
  id: string,
): Record<string, PhotoNote> {
  const value = text.trim();
  // An empty to-do is a row that cannot be read and cannot be ticked off. It is
  // the same rule the annotation editor applies to a zero-length stroke.
  if (!value) return notes;
  const note = noteFor(notes, photoId);
  return {
    ...notes,
    [photoId]: { ...note, todos: [...note.todos, { id, text: value, done: false }] },
  };
}

export function withTodoToggled(
  notes: Record<string, PhotoNote>,
  photoId: string,
  todoId: string,
): Record<string, PhotoNote> {
  const note = noteFor(notes, photoId);
  return {
    ...notes,
    [photoId]: {
      ...note,
      todos: note.todos.map((t) => (t.id === todoId ? { ...t, done: !t.done } : t)),
    },
  };
}

export function withTodoRemoved(
  notes: Record<string, PhotoNote>,
  photoId: string,
  todoId: string,
): Record<string, PhotoNote> {
  const note = noteFor(notes, photoId);
  return { ...notes, [photoId]: { ...note, todos: note.todos.filter((t) => t.id !== todoId) } };
}

/**
 * The default title for a new log.
 *
 * Dated, because a project accumulates them and "Site Log" four times over is
 * a list nobody can navigate. Local date parts rather than `toISOString`, which
 * would name a log made at 9pm after the following day.
 */
export function defaultSiteLogTitle(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `Site log ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The line under a log in the list.
 *
 * Counts what is actually there rather than what was selected: a log whose
 * photos were later deleted should not claim twelve.
 */
export function siteLogSummary(log: SiteLogRow): string {
  const photos = photoIdsOf(log).length;
  const notes = log.notes ?? {};
  const written = photoIdsOf(log).filter((id) => noteFor(notes, id).notes.trim()).length;
  const todos = photoIdsOf(log).reduce((sum, id) => sum + noteFor(notes, id).todos.length, 0);

  const parts = [`${photos} photo${photos === 1 ? "" : "s"}`];
  if (written > 0) parts.push(`${written} noted`);
  if (todos > 0) parts.push(`${todos} to do`);
  return parts.join(" · ");
}

/** Open to-dos across a whole log, which is the number worth acting on. */
export function openTodoCount(log: SiteLogRow): number {
  const notes = log.notes ?? {};
  return photoIdsOf(log).reduce(
    (sum, id) => sum + noteFor(notes, id).todos.filter((t) => !t.done).length,
    0,
  );
}
