/**
 * Tasks, and what was done to each photo, as report sections.
 *
 * The client's complaint about the Tasks tab ended "no details what was done
 * and what needs to get done". `task_photo_items` answers that inside the app,
 * but a report is what actually reaches his customer, and reports carried no
 * tasks at all - so the record of the work stopped at the office.
 *
 * A report section is `{ title, body, photos: [{ photo_id, caption }] }`, and
 * that shape already says everything a task needs to say: the task is the
 * title, its standing is the body, and the per-photo note is the caption
 * printed under the picture it belongs to. No schema change, no new renderer,
 * and the PDF paginates it exactly as it paginates anything else.
 *
 * Pure and framework-free so it can be tested directly and reused by any
 * caller that ends up generating reports server side.
 */

import { normalizeDashesTrimmed } from "./machine-dashes";

export type TaskReportStatus = "open" | "in_progress" | "done";

export interface TaskForReport {
  id: string;
  title: string;
  description?: string | null;
  status: TaskReportStatus;
  /** The photos the task covers, in the order it carries them. */
  photo_ids: string[];
  due_date?: string | null;
}

export interface TaskPhotoStateForReport {
  photo_id: string;
  status: "open" | "done";
  note?: string | null;
}

export interface TaskReportSection {
  title: string;
  /** HTML, matching what the rich text editor stores for a hand-written one. */
  body: string;
  photos: Array<{ photo_id: string; caption: string }>;
}

export interface TaskReportOptions {
  /**
   * Leave out photos still outstanding. Off by default: "what needs to get
   * done" is half of what the client asked for, and a progress report that
   * shows only finished work is a sales brochure.
   */
  doneOnly?: boolean;
  /** Caption for a finished photo whose note was never written. */
  doneFallback?: string;
  /** Caption for a photo still outstanding. */
  openFallback?: string;
}

const DEFAULTS: Required<Omit<TaskReportOptions, "doneOnly">> = {
  doneFallback: "Completed",
  openFallback: "Outstanding",
};

/**
 * Text going into HTML, escaped.
 *
 * Titles, descriptions and notes are all typed by a crew member, and a note
 * reading `5 < 6 & rising` must not close the paragraph it sits in. The rich
 * text stored for a hand-written section is sanitised on the way out
 * (sanitize-page-html), but that is a reader-side guard against stored markup;
 * emitting broken markup here would be this module's own bug.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** User text, dash-folded and escaped, ready to drop into a tag. */
function clean(value: unknown): string {
  return escapeHtml(normalizeDashesTrimmed(value));
}

/**
 * How far along a task is, counted over the photos it still carries.
 *
 * Distinct ids, matching `taskPhotoProgress` and the SQL rollup: `photo_ids`
 * has no uniqueness behind it, and a photo listed twice is still one photo.
 */
export function taskReportProgress(
  task: TaskForReport,
  states: TaskPhotoStateForReport[] | undefined,
): { total: number; done: number; remaining: number } {
  const ids = Array.from(new Set(task.photo_ids ?? []));
  const byPhoto = new Map((states ?? []).map((s) => [s.photo_id, s]));
  const done = ids.reduce((n, id) => n + (byPhoto.get(id)?.status === "done" ? 1 : 0), 0);
  return { total: ids.length, done, remaining: ids.length - done };
}

/**
 * One task as one section, or null when it has nothing to show.
 *
 * Null for a task carrying no photos: this is the per-photo record, and a
 * section with a heading and no evidence under it is a line the reader has to
 * take on faith. Those tasks stay in the app.
 */
export function buildTaskReportSection(
  task: TaskForReport,
  states: TaskPhotoStateForReport[] | undefined,
  options: TaskReportOptions = {},
): TaskReportSection | null {
  const opts = { ...DEFAULTS, ...options };
  const ids = Array.from(new Set(task.photo_ids ?? []));
  if (ids.length === 0) return null;

  const byPhoto = new Map((states ?? []).map((s) => [s.photo_id, s]));
  const { total, done, remaining } = taskReportProgress(task, states);

  /*
   * Finished photos first, each group keeping the order the task carries them
   * in. A reader scanning the page sees the work before the remainder, and the
   * renderer batches positionally, so the grouping survives pagination.
   */
  const ordered = [
    ...ids.filter((id) => byPhoto.get(id)?.status === "done"),
    ...ids.filter((id) => byPhoto.get(id)?.status !== "done"),
  ];
  const visible = opts.doneOnly
    ? ordered.filter((id) => byPhoto.get(id)?.status === "done")
    : ordered;
  if (visible.length === 0) return null;

  const photos = visible.map((photo_id) => {
    const state = byPhoto.get(photo_id);
    const note = normalizeDashesTrimmed(state?.note ?? "");
    return {
      photo_id,
      // The caption IS the per-photo note. That is the whole point: the record
      // of what was done ends up printed under the picture it describes.
      caption: note || (state?.status === "done" ? opts.doneFallback : opts.openFallback),
    };
  });

  const parts: string[] = [];
  const description = clean(task.description);
  if (description) parts.push(`<p>${description}</p>`);

  const photoWord = total === 1 ? "photo" : "photos";
  if (done === total) {
    parts.push(`<p><strong>Completed.</strong> All ${total} ${photoWord} signed off.</p>`);
  } else if (done === 0) {
    parts.push(`<p><strong>Not started.</strong> ${total} ${photoWord} outstanding.</p>`);
  } else {
    parts.push(
      `<p><strong>In progress.</strong> ${done} of ${total} ${photoWord} done, ${remaining} still outstanding.</p>`,
    );
  }

  return { title: clean(task.title) || "Task", body: parts.join(""), photos };
}

/**
 * Every task worth printing, in the order given.
 *
 * `statesByTask` is keyed by task id; a task with no entry has had nothing
 * ticked yet, which is a legitimate section reading "not started" rather than
 * an absence.
 */
export function buildTaskReportSections(
  tasks: TaskForReport[],
  statesByTask: Map<string, TaskPhotoStateForReport[]>,
  options: TaskReportOptions = {},
): TaskReportSection[] {
  return tasks
    .map((task) => buildTaskReportSection(task, statesByTask.get(task.id), options))
    .filter((section): section is TaskReportSection => section !== null);
}
