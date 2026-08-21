import { chatEndpoint } from "../../lib/ai-provider";
import { getSupabaseAdmin } from "../../lib/supabase";
import { cleanCaption, normalizeDashesTrimmed } from "@sitepix/shared";

/**
 * The AI narration behind a walkthrough's Summary.
 *
 * A Summary is the flagship output of recording a walkthrough, and the client
 * was explicit about what that means: "a short AI-narrated video from the
 * walkthrough recording, plus a list of the captured photos each with
 * AI-generated narration describing what was done in that shot and/or
 * summarizing what was said on camera near that moment", and it must not "look
 * the same whether or not anyone spoke during the recording".
 *
 * Two things follow.
 *
 * **Narration is timed, not prose.** The video already exists - the recording
 * the technician made. What it lacks is a script. So this produces chapters
 * with real start/end offsets, which the player highlights as playback moves
 * and can read aloud over the footage. That is the "AI-narrated video": the
 * user's own recording with a generated narration track laid over its timeline,
 * rather than a re-rendered file this stack has no encoder to produce.
 *
 * **Every photo gets two distinct fields.** `narration` is what was done in
 * that shot. `spoken` is a tightening of what was actually said near that
 * moment, and it is null when nobody spoke. The UI renders them differently, so
 * a silent walk and a narrated one cannot come out looking alike.
 *
 * Everything here degrades. `buildFallbackNarration` produces the same shape
 * from the transcript and the photo timeline alone, so a missing API key or a
 * rate-limited model costs polish, not the feature.
 */

/** Bumped when the shape changes, so an old payload can be re-generated. */
export const WALKTHROUGH_NARRATION_VERSION = 1;

/** Chapters asked of the model. More than this and the rail stops scanning. */
const MAX_CHAPTERS = 8;
/** Below this many seconds a walk is one chapter, not a table of contents. */
const MIN_SECONDS_FOR_CHAPTERS = 45;

export interface NarrationChapter {
  /** Offset into the recording, in seconds. */
  start: number;
  end: number;
  title: string;
  /** One or two sentences, written to be read aloud over the footage. */
  narration: string;
}

export interface NarrationPhoto {
  photoId: string;
  offsetSeconds: number;
  /** What was done in this shot. Always present. */
  narration: string;
  /**
   * What the technician said near this moment, tightened. Null when the
   * recording was silent there - the UI must be able to tell the difference.
   */
  spoken: string | null;
}

export interface WalkthroughNarration {
  version: number;
  /** False when the recording carried no usable speech at all. */
  hasSpeech: boolean;
  /** One line under the title: what this walkthrough covered. */
  headline: string;
  chapters: NarrationChapter[];
  photos: NarrationPhoto[];
  /** True when the model wrote this, false when the deterministic path did. */
  aiGenerated: boolean;
}

export interface NarrationPhotoInput {
  photoId: string;
  offsetSeconds: number;
  spokenNote: string | null;
  caption: string | null;
  takenAt?: string | null;
}

export interface NarrationSource {
  title: string | null;
  projectName: string | null;
  transcript: string | null;
  durationSeconds: number;
  photos: NarrationPhotoInput[];
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function clampSeconds(value: unknown, duration: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.max(0, Math.round(n)), Math.max(0, Math.round(duration)));
}

function tidy(value: unknown, maxWords: number): string {
  const text = normalizeDashesTrimmed(String(value ?? "").replace(/\s+/g, " "));
  if (!text) return "";
  const words = text.split(" ");
  return words.length <= maxWords ? text : `${words.slice(0, maxWords).join(" ")}...`;
}

/**
 * The slice of transcript spoken around one photo.
 *
 * Proportional rather than timestamped, because the transcript comes back from
 * speech-to-text as one unsegmented string with no word timings. It is an
 * estimate and the UI says so by attributing it as "near this moment" rather
 * than quoting it as an exact utterance.
 */
export function transcriptWindow(
  transcript: string,
  startSeconds: number,
  endSeconds: number | null,
  durationSeconds: number,
  index: number,
  total: number,
): string | null {
  const words = transcript.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return null;
  const count = Math.max(1, total);

  let startRatio: number;
  let endRatio: number;
  if (durationSeconds > 0 && Number.isFinite(startSeconds)) {
    const perPhoto = durationSeconds / count;
    const from = Math.max(0, startSeconds - Math.min(8, perPhoto / 2));
    const to = Math.min(
      durationSeconds,
      endSeconds && endSeconds > startSeconds ? endSeconds : startSeconds + Math.max(10, perPhoto),
    );
    startRatio = Math.min(0.95, Math.max(0, from / durationSeconds));
    endRatio = Math.min(1, Math.max(startRatio + 0.02, to / durationSeconds));
  } else {
    const share = 1 / count;
    startRatio = Math.min(0.95, index * share);
    endRatio = Math.min(1, (index + 1) * share);
  }

  const from = Math.min(words.length - 1, Math.floor(words.length * startRatio));
  const to = Math.min(words.length, Math.max(from + 6, Math.ceil(words.length * endRatio)));
  return words.slice(from, to).join(" ").trim() || null;
}

/**
 * Narration built without the model: chapters cut evenly across the recording,
 * photo narration from the caption or the spoken note.
 *
 * Deliberately says less rather than guessing more. A photo with nothing
 * recorded against it gets its timestamp and no invented activity, because a
 * field record that quietly makes things up is worse than one that is thin.
 */
export function buildFallbackNarration(source: NarrationSource): WalkthroughNarration {
  const transcript = (source.transcript ?? "").replace(/\s+/g, " ").trim();
  const hasSpeech = transcript.length > 0;
  const duration = Math.max(0, Math.round(source.durationSeconds || 0));
  const photos = [...source.photos].sort((a, b) => a.offsetSeconds - b.offsetSeconds);

  const photoNarration: NarrationPhoto[] = photos.map((p, i) => {
    const spoken =
      p.spokenNote?.trim() ||
      (hasSpeech
        ? transcriptWindow(
            transcript,
            p.offsetSeconds,
            photos[i + 1]?.offsetSeconds ?? null,
            duration,
            i,
            photos.length,
          )
        : null);
    const caption = cleanCaption(p.caption);
    return {
      photoId: p.photoId,
      offsetSeconds: p.offsetSeconds,
      narration:
        caption ||
        (spoken ? tidy(spoken, 26) : `Photo taken ${fmt(p.offsetSeconds)} into the walkthrough.`),
      spoken: spoken ? tidy(spoken, 40) : null,
    };
  });

  /*
   * Chapters follow the photos where there are any: the moments the technician
   * stopped to take a picture are the moments the walk changed subject, which
   * is a better cut than slicing the clock into equal parts. With no photos and
   * no speech there is one chapter, because there is one thing to say.
   */
  const chapters: NarrationChapter[] = [];
  if (duration >= MIN_SECONDS_FOR_CHAPTERS && photos.length > 1) {
    const step = Math.max(1, Math.ceil(photos.length / MAX_CHAPTERS));
    for (let i = 0; i < photos.length; i += step) {
      const start = i === 0 ? 0 : photos[i].offsetSeconds;
      const nextIndex = i + step;
      const end = nextIndex < photos.length ? photos[nextIndex].offsetSeconds : duration;
      const spoken = photoNarration[i]?.spoken;
      chapters.push({
        start,
        end: Math.max(start + 1, end),
        title: `From ${fmt(start)}`,
        narration: spoken
          ? tidy(spoken, 32)
          : `Walkthrough continues from ${fmt(start)} to ${fmt(end)}.`,
      });
    }
  } else if (duration > 0) {
    chapters.push({
      start: 0,
      end: duration,
      title: "Walkthrough",
      narration: hasSpeech
        ? tidy(transcript, 40)
        : `A ${fmt(duration)} walkthrough with no narration recorded.`,
    });
  }

  const headline = hasSpeech
    ? tidy(transcript, 24)
    : photos.length
      ? `${photos.length} ${photos.length === 1 ? "photo" : "photos"} captured across a ${fmt(duration)} walk.`
      : `A ${fmt(duration)} walkthrough.`;

  return {
    version: WALKTHROUGH_NARRATION_VERSION,
    hasSpeech,
    headline,
    chapters,
    photos: photoNarration,
    aiGenerated: false,
  };
}

const NARRATION_SYSTEM =
  "You are SitePix AI writing the narration track for a site walkthrough video. " +
  "You are a narrator and typesetter, not an inspector. " +
  "You cannot see the video or the photos - you only have what the technician said and what they typed. " +
  "Respond with a single JSON object and nothing else: no prose, no code fence, no commentary. " +
  "STYLE RULES: neutral, factual, spoken-aloud phrasing in the third person. " +
  "Never call anything 'critical', a 'code violation' or a 'safety hazard'. " +
  "Never invent defects, measurements, brands, model numbers, locations, recommendations or next steps. " +
  "If the source material is thin, write less rather than padding. " +
  "Never write an em dash; use a comma, a colon or a plain hyphen.";

/** The JSON contract handed to the model, and re-validated on the way back. */
function narrationPrompt(source: NarrationSource): string {
  const duration = Math.max(0, Math.round(source.durationSeconds || 0));
  const transcript = (source.transcript ?? "").replace(/\s+/g, " ").trim();
  const photos = [...source.photos].sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  const photoLines = photos
    .map((p, i) => {
      const caption = cleanCaption(p.caption);
      const near = p.spokenNote?.trim();
      return [
        `- index ${i} | photo_id ${p.photoId} | taken at ${fmt(p.offsetSeconds)} (${p.offsetSeconds}s)`,
        caption ? `  caption typed by the technician: "${caption}"` : null,
        near ? `  spoken near this moment: "${near}"` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const chapterTarget = Math.max(
    1,
    Math.min(MAX_CHAPTERS, photos.length ? Math.ceil(photos.length / 2) : Math.ceil(duration / 90)),
  );

  return `${source.projectName ? `Project: ${source.projectName}\n` : ""}${
    source.title ? `Walkthrough: ${source.title}\n` : ""
  }Recording length: ${fmt(duration)} (${duration} seconds).
Photos captured during the walk: ${photos.length}.

Return JSON with exactly this shape:
{
  "headline": "one sentence, max 20 words, saying what this walkthrough covered",
  "chapters": [
    { "start": <integer seconds>, "end": <integer seconds>, "title": "<max 6 words>",
      "narration": "<1-2 sentences to be read aloud over this stretch of footage>" }
  ],
  "photos": [
    { "photo_id": "<exact id from the list below>",
      "narration": "<one sentence: what was being done or shown in this shot>",
      "spoken": "<a tight restatement of what was said near this moment, or null>" }
  ]
}

CHAPTER RULES:
- Aim for ${chapterTarget} chapter(s). Never more than ${MAX_CHAPTERS}.
- Chapters must be in order, must start at 0, must not overlap, and the last
  one must end at ${duration}.
- Base the cuts on where the speaker changed subject, area or system. If the
  transcript does not show a change, keep fewer, longer chapters.

PHOTO RULES:
- Emit one entry per photo listed below, in the same order, using the exact
  photo_id given. Never invent an id and never skip one.
- "narration" describes what was being done or shown, drawn ONLY from the
  caption and from what was said near that moment. With neither, state the
  moment plainly, e.g. "Captured 2:14 into the walk, with nothing recorded
  against it." Do not guess at contents you were not told about.
- "spoken" must be null unless the technician actually said something near that
  moment. Do not paraphrase the caption into "spoken".

Photos:
${photoLines || "(none)"}

Spoken transcript:
"""
${transcript || "(no speech was captured)"}
"""

${
  transcript
    ? "Write the JSON object only."
    : 'The technician did not speak. Set every "spoken" to null, keep the narration to what the captions and timestamps state, and keep the headline factual about there being no narration.'
}`;
}

/** Pull the JSON object out of a reply that may still be fenced or prefaced. */
function parseNarrationJson(raw: string): any | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Force the model's reply into the contract: real photo ids only, chapters in
 * order and inside the recording, no field left undefined.
 *
 * Anything the model got wrong falls back to the deterministic value for that
 * field rather than to a deterministic whole payload, so one malformed chapter
 * does not cost the user their photo narration.
 */
function coerceNarration(parsed: any, source: NarrationSource): WalkthroughNarration {
  const fallback = buildFallbackNarration(source);
  const duration = Math.max(0, Math.round(source.durationSeconds || 0));
  const photos: NarrationPhoto[] = fallback.photos.map((base) => {
    const raw = Array.isArray(parsed?.photos)
      ? parsed.photos.find((p: any) => String(p?.photo_id ?? p?.photoId) === base.photoId)
      : null;
    const narration = tidy(raw?.narration, 44);
    const spokenRaw = raw?.spoken;
    const spoken =
      spokenRaw === null || spokenRaw === undefined || spokenRaw === "null"
        ? null
        : tidy(spokenRaw, 60) || null;
    return {
      photoId: base.photoId,
      offsetSeconds: base.offsetSeconds,
      narration: narration || base.narration,
      // The model is not allowed to invent speech: without a real note or a
      // transcript behind this moment, "spoken" stays null whatever it wrote.
      spoken: base.spoken ? spoken || base.spoken : null,
    };
  });

  let chapters: NarrationChapter[] = Array.isArray(parsed?.chapters)
    ? parsed.chapters
        .slice(0, MAX_CHAPTERS)
        .map((c: any) => ({
          start: clampSeconds(c?.start, duration),
          end: clampSeconds(c?.end, duration),
          title: tidy(c?.title, 8) || "Walkthrough",
          narration: tidy(c?.narration, 60),
        }))
        .filter((c: NarrationChapter) => c.narration.length > 0)
        .sort((a: NarrationChapter, b: NarrationChapter) => a.start - b.start)
    : [];

  // Close the gaps the model left: a rail that does not cover the whole
  // recording leaves stretches of playback with nothing highlighted.
  chapters = chapters.filter((c, i) => i === 0 || c.start > chapters[i - 1].start);
  if (chapters.length) {
    chapters[0].start = 0;
    for (let i = 0; i < chapters.length; i++) {
      const next = chapters[i + 1];
      chapters[i].end = next ? next.start : duration;
      if (chapters[i].end <= chapters[i].start) chapters[i].end = chapters[i].start + 1;
    }
  }

  return {
    version: WALKTHROUGH_NARRATION_VERSION,
    hasSpeech: fallback.hasSpeech,
    headline: tidy(parsed?.headline, 30) || fallback.headline,
    chapters: chapters.length ? chapters : fallback.chapters,
    photos,
    aiGenerated: chapters.length > 0 || photos.some((p) => p.narration),
  };
}

/**
 * Write the narration for one walkthrough.
 *
 * Falls back rather than throwing: the Summary is generated automatically after
 * a recording finishes, and a user who has just walked a site for ten minutes
 * must not be handed an error where their summary should be.
 */
export async function buildWalkthroughNarration(
  source: NarrationSource,
): Promise<WalkthroughNarration> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("[walkthrough] narration: GEMINI_API_KEY missing, using deterministic narration");
    return buildFallbackNarration(source);
  }
  try {
    const ep = chatEndpoint();
    const res = await fetch(ep.url, {
      method: "POST",
      headers: ep.headers,
      body: JSON.stringify({
        model: ep.model,
        messages: [
          { role: "system", content: NARRATION_SYSTEM },
          { role: "user", content: narrationPrompt(source) },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AI error ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const parsed = parseNarrationJson(json.choices?.[0]?.message?.content ?? "");
    if (!parsed) throw new Error("Narration reply was not JSON");
    return coerceNarration(parsed, source);
  } catch (err) {
    console.warn("[walkthrough] narration generation failed, using deterministic narration", err);
    return buildFallbackNarration(source);
  }
}

/**
 * Persist narration onto the walkthrough row.
 *
 * `narration_json` arrives with 20261001000000_walkthrough_ai_narration.sql. A
 * deployment that has not run it yet still records, still transcribes and still
 * writes a summary; it just falls back to the older photo-note rendering until
 * the column exists. Losing polish on an un-migrated database is the right
 * trade against failing the whole generation on a missing column.
 */
export async function saveWalkthroughNarration(
  walkthroughId: string,
  narration: WalkthroughNarration,
): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from("walkthroughs" as any)
    .update({ narration_json: narration as any })
    .eq("id", walkthroughId);
  if (error) {
    console.warn("[walkthrough] could not save narration", {
      walkthroughId,
      message: error.message,
    });
    return false;
  }
  return true;
}

/** Read narration back, tolerating a database that has no column for it yet. */
export async function readWalkthroughNarration(
  supabase: any,
  walkthroughId: string,
): Promise<WalkthroughNarration | null> {
  const { data, error } = await supabase
    .from("walkthroughs")
    .select("narration_json")
    .eq("id", walkthroughId)
    .maybeSingle();
  if (error || !data) return null;
  return parseStoredNarration((data as any).narration_json);
}

/** Validate a stored payload before the UI is allowed to trust it. */
export function parseStoredNarration(value: unknown): WalkthroughNarration | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.photos) && !Array.isArray(raw.chapters)) return null;
  return {
    version: Number(raw.version) || WALKTHROUGH_NARRATION_VERSION,
    hasSpeech: !!raw.hasSpeech,
    headline: typeof raw.headline === "string" ? raw.headline : "",
    chapters: Array.isArray(raw.chapters) ? (raw.chapters as NarrationChapter[]) : [],
    photos: Array.isArray(raw.photos) ? (raw.photos as NarrationPhoto[]) : [],
    aiGenerated: raw.aiGenerated !== false,
  };
}
