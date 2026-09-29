import type { TranscriptLine } from "../ai/service";

/**
 * Captions for the photos snapped during a walkthrough, from what was said
 * around each snap.
 *
 * Jon, 2026-09-29: "those words transcribed just before that snap and just
 * after that snap should be recorded as a caption for that snap". So each
 * photo's caption is the narration from a few seconds before the shutter to a
 * few seconds after it, widened to whole sentences where that costs only a
 * little more, and never the whole transcript.
 *
 * Timing comes from the transcription itself (one timed line per sentence, see
 * `transcribeAudioTimed`). Within a line, words are spread evenly across it,
 * which is as precise as a sentence-level timestamp allows. A transcript with
 * no timing at all is treated as one line spanning the recording, which is the
 * old proportional estimate, and still a window rather than everything.
 */

export interface TimedSegment {
  /** Seconds from the start of the recording. */
  start: number;
  end: number;
  text: string;
  /**
   * Spread the words evenly over the whole span. Only for the untimed
   * fallback, where the span is the recording rather than one sentence.
   */
  even?: boolean;
}

/**
 * Roughly how long one spoken word takes. A sentence's line runs until the
 * next one starts, which includes the silence after it; spreading its words
 * across all of that would place the end of a short remark long after it was
 * said.
 */
const SECONDS_PER_WORD = 0.4;

/** Seconds of speech before the snap that belong to it. */
export const CAPTION_BEFORE_SECONDS = 8;
/** Seconds after the snap: people often name what they shot just after. */
export const CAPTION_AFTER_SECONDS = 4;
/** How far past the window a caption may reach to finish its sentence. */
const SENTENCE_REACH_SECONDS = 6;
/** `photos.caption` and the save op both cap at 255. */
export const CAPTION_MAX_CHARS = 255;

/**
 * Timed lines from one transcribed piece, placed on the recording's clock.
 *
 * Each line ends where the next begins; the last ends at the piece's end.
 */
export function segmentsFromLines(
  lines: TranscriptLine[],
  pieceStart: number,
  pieceEnd: number,
): TimedSegment[] {
  const out: TimedSegment[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const start = pieceStart + Math.max(0, lines[i].start);
    const nextStart = i + 1 < lines.length ? pieceStart + lines[i + 1].start : pieceEnd;
    const end = Math.max(start + 0.5, Math.min(Math.max(nextStart, start), pieceEnd));
    const text = lines[i].text.replace(/\s+/g, " ").trim();
    if (text) out.push({ start: Math.min(start, pieceEnd), end, text });
  }
  return out;
}

/** The transcript as prose: the segments' text, in order. */
export function transcriptFromSegments(segments: TimedSegment[]): string {
  return segments
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

type TimedWord = { word: string; t: number; lastInSegment: boolean };

function timedWords(segments: TimedSegment[]): TimedWord[] {
  const words: TimedWord[] = [];
  for (const s of segments) {
    const parts = s.text.split(" ").filter(Boolean);
    const full = Math.max(0, s.end - s.start);
    const span = s.even ? full : Math.min(full, parts.length * SECONDS_PER_WORD);
    parts.forEach((word, i) => {
      words.push({
        word,
        t: s.start + ((i + 0.5) / parts.length) * span,
        lastInSegment: i === parts.length - 1,
      });
    });
  }
  return words;
}

function endsSentence(w: TimedWord): boolean {
  return w.lastInSegment || /[.!?]["')\]]*$/.test(w.word);
}

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars - 3);
  const space = cut.lastIndexOf(" ");
  return `${(space > maxChars / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "")}...`;
}

/**
 * What was said around `atSeconds`, as a caption. Null when nothing was.
 */
export function captionAround(
  segments: TimedSegment[],
  atSeconds: number,
  options: { before?: number; after?: number; maxChars?: number } = {},
): string | null {
  const before = options.before ?? CAPTION_BEFORE_SECONDS;
  const after = options.after ?? CAPTION_AFTER_SECONDS;
  const maxChars = options.maxChars ?? CAPTION_MAX_CHARS;
  const words = timedWords(segments);
  if (!words.length || !Number.isFinite(atSeconds)) return null;

  const from = atSeconds - before;
  const to = atSeconds + after;
  let first = words.findIndex((w) => w.t >= from && w.t <= to);
  if (first === -1) return null;
  let last = first;
  while (last + 1 < words.length && words[last + 1].t <= to) last += 1;

  // Back to the start of the sentence, if it began only a little earlier.
  let leadingCut = false;
  while (first > 0 && !endsSentence(words[first - 1])) {
    if (words[first - 1].t < from - SENTENCE_REACH_SECONDS) {
      leadingCut = true;
      break;
    }
    first -= 1;
  }
  // On to the end of the sentence, if it finishes only a little later.
  let trailingCut = false;
  while (last + 1 < words.length && !endsSentence(words[last])) {
    if (words[last + 1].t > to + SENTENCE_REACH_SECONDS) {
      trailingCut = true;
      break;
    }
    last += 1;
  }

  const body = words
    .slice(first, last + 1)
    .map((w) => w.word)
    .join(" ")
    .trim();
  if (!body) return null;
  const text = `${leadingCut ? "..." : ""}${body}${trailingCut ? "..." : ""}`;
  return clip(text, maxChars);
}

/**
 * The placeholder captions the recorders write, which a transcript caption may
 * replace. Anything else was typed by a person and is left alone.
 *
 * - "Walkthrough +42s": the mobile recorder's offset label.
 * - "walkthrough-1755000000000.jpg": the web recorder's generated filename.
 */
export function isPlaceholderCaption(caption: string | null | undefined): boolean {
  const c = (caption ?? "").trim();
  if (!c) return true;
  return /^Walkthrough \+\d+s$/i.test(c) || /^walkthrough-\d{10,}\.[a-z0-9]+$/i.test(c);
}

/**
 * Timed segments kept on the walkthrough (inside `narration_json`, under
 * `transcriptSegments`), so a photo that reaches the server after the
 * transcript can still be captioned by time. Null when none are stored.
 */
export function storedSegments(narrationJson: unknown): TimedSegment[] | null {
  if (!narrationJson || typeof narrationJson !== "object") return null;
  const raw = (narrationJson as Record<string, unknown>).transcriptSegments;
  if (!Array.isArray(raw)) return null;
  const segments = raw
    .map((s) => s as Record<string, unknown>)
    .filter(
      (s) =>
        typeof s?.text === "string" &&
        Number.isFinite(Number(s.start)) &&
        Number.isFinite(Number(s.end)),
    )
    .map((s) => ({ start: Number(s.start), end: Number(s.end), text: String(s.text) }));
  return segments.length ? segments : null;
}

/** The whole transcript as one segment: the fallback when no timing exists. */
export function untimedSegments(transcript: string, durationSeconds: number): TimedSegment[] {
  const text = transcript.replace(/\s+/g, " ").trim();
  if (!text) return [];
  return [{ start: 0, end: Math.max(1, durationSeconds || 0), text, even: true }];
}
