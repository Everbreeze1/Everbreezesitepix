import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** Pending row patches, keyed by table then row id. */
type Queue = Record<string, Record<string, Record<string, unknown>>>;

/**
 * One persistence model for the whole template builder.
 *
 * Both designers used to mix write strategies — some edits fired instantly,
 * some waited for a Save button, some only landed on blur — which is why you
 * could never tell whether the thing you just typed had stuck. Everything now
 * goes through here: patches land in local state first, get coalesced per row,
 * and flush shortly after you stop typing, feeding one honest status line.
 *
 * `mark*` exists for the operations that can't be debounced (insert, delete,
 * reorder) so they drive the same indicator instead of a second, quieter one.
 */
export function useAutosave(
  write: (table: string, id: string, patch: Record<string, unknown>) => PromiseLike<unknown>,
  { delay = 600, onError }: { delay?: number; onError?: (error: unknown) => void } = {},
) {
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Queue>({});
  const writeRef = useRef(write);
  const errorRef = useRef(onError);
  writeRef.current = write;
  errorRef.current = onError;

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const pending = queue.current;
    queue.current = {};
    const ops: PromiseLike<unknown>[] = [];
    for (const [table, rows] of Object.entries(pending)) {
      for (const [id, patch] of Object.entries(rows)) ops.push(writeRef.current(table, id, patch));
    }
    if (ops.length === 0) return true;
    setState("saving");
    try {
      await Promise.all(ops);
      setState("saved");
      return true;
    } catch (e) {
      // Put the unsent patches back rather than dropping them. They used to be
      // gone the moment a write failed — the status line said "Not saved" and
      // that was the end of it, so a crew filling a checklist through a bad
      // signal could lose an answer with no way to get it back. Now the next
      // flush (the next edit, or the one on unmount) retries them.
      //
      // Anything queued while the write was in flight is newer, so it wins.
      for (const [table, rows] of Object.entries(pending)) {
        const bucket = (queue.current[table] ??= {});
        for (const [id, patch] of Object.entries(rows)) {
          bucket[id] = { ...patch, ...(bucket[id] ?? {}) };
        }
      }
      setState("error");
      errorRef.current?.(e);
      return false;
    }
  }, []);

  /** Queue a patch for `table.id` and (re)arm the debounce. */
  const queueSave = useCallback(
    (table: string, id: string, patch: Record<string, unknown>) => {
      const rows = (queue.current[table] ??= {});
      rows[id] = { ...(rows[id] ?? {}), ...patch };
      setState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  const markSaving = useCallback(() => setState("saving"), []);
  const markSaved = useCallback(() => setState("saved"), []);
  const markError = useCallback((e?: unknown) => {
    setState("error");
    if (e !== undefined) errorRef.current?.(e);
  }, []);

  /**
   * Run an immediate write (insert/delete/reorder) through the same indicator.
   * Returns whether it succeeded so callers can roll back optimistic state.
   */
  const runImmediate = useCallback(async (op: () => PromiseLike<{ error?: unknown } | void>) => {
    setState("saving");
    try {
      const res = (await op()) as { error?: unknown } | void;
      if (res && "error" in res && res.error) throw res.error;
      setState("saved");
      return true;
    } catch (e) {
      setState("error");
      errorRef.current?.(e);
      return false;
    }
  }, []);

  // Never strand an edit because the user switched templates, tabs, or pages
  // mid-debounce.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      void flush();
    };
  }, [flush]);

  return { state, queueSave, flush, markSaving, markSaved, markError, runImmediate };
}
