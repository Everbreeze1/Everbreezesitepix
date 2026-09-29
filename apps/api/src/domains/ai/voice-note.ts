import { z } from "zod";
import { bufferSource, extractAdtsPieces, findAacTrack } from "../../lib/mp4-audio";
import { rateLimit } from "../../lib/rate-limit";
import { getCallerTeamPlan } from "../../lib/team-plan";
import type { AuthedContext } from "../../lib/user-context";
import { aiKeyConfigured, transcribeAudio } from "./service";

/**
 * A spoken note for one photo, turned into text.
 *
 * The phone records a short clip (expo-audio, AAC in an .m4a) when the user
 * taps the mic in the photo note editor, sends it here, and appends the words
 * to the note, where they stay editable and save as the photo's caption. That
 * is all this is: speech to text of the user's own words. It never looks at
 * the photo, so it is not photo analysis and writes nothing itself.
 *
 * Walkthroughs have their own transcription (`transcribeWalkthrough`), which
 * needs a walkthrough and captions every photo in it. A photo taken outside a
 * walkthrough had no way to reach the transcriber until this.
 *
 * The clip arrives inline as base64 rather than through storage: a two minute
 * note is about a megabyte, so a second upload and a signed URL would cost
 * more than they save.
 */

/** Longest note transcribed. The editor stops recording here. */
export const VOICE_NOTE_MAX_SECONDS = 120;
/**
 * Largest clip accepted, decoded. Two minutes of the phone's recording preset
 * (128 kbit/s AAC) is under 2 MB; this leaves room for a higher bitrate.
 */
export const VOICE_NOTE_MAX_BYTES = 4 * 1024 * 1024;
/** Base64 is four characters for every three bytes. */
const MAX_BASE64_CHARS = Math.ceil(VOICE_NOTE_MAX_BYTES / 3) * 4;
/** Below this there is a container and no speech. */
const MIN_BYTES = 1024;
/** Per user, on top of the RPC-wide limit: a note a photo, not a stream. */
const RATE = { limit: 30, windowMs: 10 * 60_000 };

export const transcribeVoiceNoteInputSchema = z.object({
  audioBase64: z.string().min(1).max(MAX_BASE64_CHARS),
  /** The recording's mime type, such as "audio/m4a" or "audio/mp4". */
  mimeType: z.string().min(1).max(100).optional(),
});

export type TranscribeVoiceNoteInput = z.infer<typeof transcribeVoiceNoteInputSchema>;

/**
 * The container name `input_audio` wants, for a clip that is not an MP4 (an
 * MP4's AAC track is sent as "aac"). Null for anything the model cannot read,
 * so it is refused here rather than coming back as an empty transcript.
 */
export function voiceNoteFormat(mimeType: string | undefined): string | null {
  const mime = ((mimeType ?? "").split(";")[0] ?? "").trim().toLowerCase();
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("flac")) return "flac";
  if (mime === "audio/aac" || mime === "audio/x-aac") return "aac";
  return null;
}

function fail(message: string, status: number): Error {
  return Object.assign(new Error(message), { status, expose: true });
}

export async function transcribeVoiceNoteService(
  ctx: AuthedContext,
  data: TranscribeVoiceNoteInput,
): Promise<{ text: string }> {
  const { supabase, userId } = ctx;
  if (!aiKeyConfigured()) {
    throw fail("Voice notes are not available right now.", 503);
  }

  const rl = rateLimit({ key: `voice-note:${userId}`, ...RATE });
  if (!rl.ok) {
    throw fail("Too many voice notes in a row. Try again in a few minutes.", 429);
  }

  const { isActive } = await getCallerTeamPlan(supabase, userId);
  if (!isActive) {
    throw fail("Voice notes need an active plan. Type the note instead.", 403);
  }

  const bytes = Buffer.from(data.audioBase64, "base64");
  if (bytes.byteLength < MIN_BYTES) throw fail("That recording had no audio in it.", 400);
  if (bytes.byteLength > VOICE_NOTE_MAX_BYTES) {
    throw fail("That voice note is too long. Keep it under two minutes.", 413);
  }

  /*
   * The phone's .m4a is an MP4 container, which is not one of the formats
   * `input_audio` reads; its AAC track, framed as ADTS, is. Same extraction
   * as a walkthrough's narration, in one piece since a note is short.
   */
  const source = bufferSource(bytes);
  const track = await findAacTrack(source).catch(() => null);
  if (track) {
    const seconds = (track.samples.length * 1024) / track.sampleRate;
    // A few seconds of grace for the recorder stopping a beat late.
    if (seconds > VOICE_NOTE_MAX_SECONDS + 5) {
      throw fail("That voice note is too long. Keep it under two minutes.", 413);
    }
    const pieces = await extractAdtsPieces(source, track, {
      pieceSeconds: VOICE_NOTE_MAX_SECONDS + 5,
    }).catch(() => {
      throw fail("That recording could not be read.", 400);
    });
    if (!pieces.length) throw fail("That recording had no audio in it.", 400);
    const texts: string[] = [];
    for (const piece of pieces) {
      texts.push(await transcribeAudio(Buffer.from(piece.bytes).toString("base64"), "aac"));
    }
    return { text: joinText(texts) };
  }

  const format = voiceNoteFormat(data.mimeType);
  if (!format) throw fail("That recording format is not supported.", 415);
  return { text: joinText([await transcribeAudio(data.audioBase64, format)]) };
}

function joinText(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
