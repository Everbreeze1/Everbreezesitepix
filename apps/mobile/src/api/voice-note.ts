import { AI_TIMEOUT_MS } from "@everlumen/api-client";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { api } from "@/lib/api";

/**
 * A recorded photo note, as text. See `lib/voice-note.ts`.
 *
 * The clip goes inline as base64: a note is at most two minutes, about a
 * megabyte, so uploading it to storage first would be a second round trip
 * for nothing. The recording is deleted once it has been read, whatever the
 * answer: the words are what is kept, as the caption, never the audio.
 *
 * Throws on failure, with the client's `status` and `code`, so the editor can
 * tell a server without this operation from a failed transcription.
 */
export async function transcribeVoiceNote(uri: string): Promise<string> {
  const file = new File(uri);
  let audioBase64: string;
  try {
    audioBase64 = await file.base64();
  } finally {
    try {
      file.delete();
    } catch {
      // Already gone, or the cache will clear it.
    }
  }
  const result = await api.rpc<{ text?: string }>(
    "transcribeVoiceNote",
    { audioBase64, mimeType: "audio/m4a" },
    /*
     * AI work: the key makes a retry after a dropped response replay the
     * answer rather than pay for it twice, and the longer timeout stops the
     * phone hanging up on a transcription the server is still doing.
     */
    { idempotencyKey: randomUUID(), timeoutMs: AI_TIMEOUT_MS },
  );
  return (result?.text ?? "").trim();
}
