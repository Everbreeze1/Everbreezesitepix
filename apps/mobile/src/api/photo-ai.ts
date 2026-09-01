import { AI_TIMEOUT_MS } from "@everlumen/api-client";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { PhotoAnalysis } from "./photo-ai-view";

/**
 * AI photo analysis and OCR.
 *
 * The whole thing already exists server-side: `analyzePhoto` sends the image to
 * Gemini with a field-inspector prompt and writes the result to `ai_analyses`,
 * and `extractPhotoText` does the OCR half on its own. The phone had neither
 * the trigger nor the result view, which is the wrong way round for a feature
 * whose input is a photograph somebody is standing in front of.
 *
 * Reads come straight off `ai_analyses` under RLS, writes go through `/v1/rpc`:
 * the analysis costs real money on our Gemini key and is gated on an active
 * subscription server-side, so it cannot be a client insert.
 *
 * Both ops are marked idempotent upstream. Tapping Analyse twice in a bad
 * signal does not pay for two runs.
 */

const COLUMNS =
  "id, photo_id, status, ocr_text, labels, defects, report_text, recommendations, created_at";

/*
 * Both of these wait on Gemini, so both carry the long timeout.
 *
 * Without it the client gives up on its default while the model is still
 * working. The screen says the analysis failed, the person taps again, and the
 * second run pays for a second analysis of a photograph the first one had
 * already finished - which is exactly what the upstream idempotency marking
 * exists to prevent, defeated by a client that hung up too early.
 */

/** Kick off a full analysis. Resolves when the model has answered. */
export async function analyzePhoto(photoId: string): Promise<void> {
  await api.rpc("analyzePhoto", { photoId }, { timeoutMs: AI_TIMEOUT_MS });
}

/** OCR only: read what is printed on the plate, and nothing else. */
export async function extractPhotoText(photoId: string): Promise<void> {
  await api.rpc("extractPhotoText", { photoId }, { timeoutMs: AI_TIMEOUT_MS });
}

/**
 * The newest analysis for a photo, or null.
 *
 * Newest rather than newest-completed, deliberately: a row still `processing`
 * is exactly what the screen needs to know about, and filtering it out would
 * make a running analysis look like no analysis at all.
 */
export async function getPhotoAnalysis(photoId: string): Promise<PhotoAnalysis | null> {
  const { data, error } = await (supabase as any)
    .from("ai_analyses")
    .select(COLUMNS)
    .eq("photo_id", photoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PhotoAnalysis) ?? null;
}
