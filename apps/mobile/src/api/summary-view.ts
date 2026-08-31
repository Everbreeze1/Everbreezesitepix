/**
 * Reading a walkthrough summary.
 *
 * Import-free so the two judgements can be tested: whether a summary is
 * finished, and how a shot is described.
 *
 * The second is not cosmetic. The service is explicit that the difference
 * between a note and a spoken line is load-bearing - "it is what lets the UI
 * render a narrated shot differently from a silent one instead of showing the
 * same card either way" - and a client that collapses them throws away the
 * distinction the recording was made to capture.
 */

/** One photograph in a summary, with what was done and what was said. */
export type SummaryPhotoNote = {
  photoId: string;
  /** Seconds into the recording. 0 for a summary built from photos alone. */
  offsetSeconds: number;
  /** What was done in this shot. Always present. */
  note: string;
  /** What was said on camera near this moment, or null when nobody spoke. */
  spoken: string | null;
};

/** Mirrors `WalkthroughSummaryRow` in the service. Field names are the server's. */
export type WalkthroughSummary = {
  id: string;
  projectId: string;
  /** The recording this summarises, or null when it came from photos alone. */
  walkthroughId: string | null;
  title: string;
  markdown: string | null;
  status: string;
  photoNotes: SummaryPhotoNote[];
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The server's ceilings, mirrored so the phone can refuse first. */
export const MAX_SUMMARY_TITLE = 160;
export const MAX_SUMMARY_MARKDOWN = 200_000;
export const MAX_SUMMARY_PHOTOS = 50;

/**
 * Whether the summary is finished, still being written, or failed.
 *
 * `status` is plain text upstream, so an unfamiliar value is possible and is
 * treated as ready rather than as broken: a summary with a body is worth
 * reading whatever the column says, and refusing to render one because of a
 * word nobody recognises is the worse failure.
 */
export type SummaryState = "pending" | "ready" | "failed";

export function summaryState(summary: { status: string; markdown: string | null }): SummaryState {
  const status = (summary.status ?? "").toLowerCase();
  if (status === "failed" || status === "error") return "failed";
  if (status === "pending" || status === "generating" || status === "processing") {
    /*
     * A body beats a stale status. The generate ops write the row first and
     * fill it in after, so a summary can carry text while its column still says
     * pending - and showing a spinner over readable text is the one outcome
     * nobody wants.
     */
    return summary.markdown?.trim() ? "ready" : "pending";
  }
  return "ready";
}

/** What to say while there is nothing to read yet. */
export function stateMessage(state: SummaryState): string | null {
  if (state === "pending") return "Still being written. This usually takes under a minute.";
  if (state === "failed") {
    // Named rather than generic: this fails locally every time, and a person
    // who does not know that reads it as their recording being broken.
    return "The write-up could not be generated. The AI service may be unavailable from this network.";
  }
  return null;
}

/** Where a summary came from. Two ways in, and the difference is worth saying. */
export function summaryOrigin(summary: { walkthroughId: string | null }): string {
  return summary.walkthroughId ? "From a recorded walkthrough" : "Written from photos";
}

/** `0:00` into a recording. Empty for a summary with no walk behind it. */
export function offsetLabel(note: SummaryPhotoNote, hasRecording: boolean): string {
  if (!hasRecording || note.offsetSeconds <= 0) return "";
  const minutes = Math.floor(note.offsetSeconds / 60);
  const seconds = Math.floor(note.offsetSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Whether this shot was narrated.
 *
 * The distinction the service asks the UI to preserve. A silent shot has a note
 * the model wrote; a narrated one also has what the person actually said, and
 * their words are the more valuable of the two.
 */
export function isNarrated(note: SummaryPhotoNote): boolean {
  return Boolean(note.spoken?.trim());
}

/** Photos in the order they were taken, which is the order they were spoken about. */
export function orderedNotes(notes: SummaryPhotoNote[]): SummaryPhotoNote[] {
  return [...notes].sort((a, b) => a.offsetSeconds - b.offsetSeconds);
}

/** The subtitle on a list row. */
export function summarySubtitle(item: {
  photoCount: number;
  walkthroughId: string | null;
}): string {
  const photos = `${item.photoCount} photo${item.photoCount === 1 ? "" : "s"}`;
  return `${photos} · ${item.walkthroughId ? "from a recording" : "from photos"}`;
}

/** Why this edit cannot be saved, or null. Mirrors the server's schema. */
export function titleError(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return "Give the write-up a title.";
  if (trimmed.length > MAX_SUMMARY_TITLE) {
    return `That title is ${trimmed.length - MAX_SUMMARY_TITLE} characters too long.`;
  }
  return null;
}

/**
 * Why these photos cannot be summarised, or null.
 *
 * The upper bound is the server's and it rejects rather than trimming, so
 * somebody who selected sixty photographs would otherwise get a refusal from a
 * server they cannot see, after the wait.
 */
export function photoSelectionError(count: number): string | null {
  if (count === 0) return "Pick at least one photo.";
  if (count > MAX_SUMMARY_PHOTOS) {
    return `That is ${count - MAX_SUMMARY_PHOTOS} too many. ${MAX_SUMMARY_PHOTOS} is the most that can go in one write-up.`;
  }
  return null;
}

/** What the confirmation says before a summary is regenerated. */
export const REGENERATE_WARNING =
  "This writes the summary again from the original recording and replaces what is here now, including any edits.";

/** What the confirmation says before a summary is deleted. */
export function deleteWarning(summary: { walkthroughId: string | null }): string {
  return summary.walkthroughId
    ? "The write-up goes. The recording it came from stays on the job."
    : "The write-up goes. The photos it was written from stay on the job.";
}

/**
 * A plain-text preview of the body, for a list row.
 *
 * The body is markdown and the phone has no renderer for it, so headings and
 * emphasis are stripped rather than shown as syntax. The first heading is
 * dropped too: it repeats the title, which is already on the row above it.
 */
export function markdownPreview(markdown: string | null, max = 120): string {
  if (!markdown) return "";
  const text = markdown
    .replace(/^#.*$/m, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The whole body, reduced to something readable without a renderer.
 *
 * Sibling of `markdownPreview`, and separate because they want different
 * things: the preview flattens to one line for a list row, this keeps the
 * paragraphs. Both live here rather than in the screen so the stripping is
 * tested once and cannot drift into two dialects of half-rendered markdown.
 *
 * Deliberately not a parser. Headings keep their text and lose their hashes,
 * emphasis markers go, and image syntax is dropped entirely because a summary's
 * photographs are rendered as cards below the body with their own notes - the
 * markdown's copies would be the same pictures a second time.
 */
export function plainBody(markdown: string | null): string {
  if (!markdown) return "";
  return (
    markdown
      .replace(/^#\s+.*$/m, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      // Three or more blank lines collapse to one. Markdown uses them for
      // spacing a renderer would absorb; as plain text they read as the document
      // having stopped.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
