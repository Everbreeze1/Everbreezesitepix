import { z } from "zod";
import type { ServiceContext } from "../../lib/user-context";

export const synthesizeSpeechInputSchema = z.object({
  text: z.string().min(1).max(2500),
  voiceName: z.string().min(1).max(60).optional(),
});

export type SynthesizeSpeechInput = z.infer<typeof synthesizeSpeechInputSchema>;

export type SynthesizeSpeechResult = {
  error: "not_configured" | "upgrade_required" | "limit_reached" | null;
  audioBase64: string | null;
  mimeType: string | null;
};

export async function synthesizeBreezeSpeechService(
  _ctx: ServiceContext,
  data: SynthesizeSpeechInput,
): Promise<SynthesizeSpeechResult> {
  const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
  if (!apiKey) {
    return {
      error: "not_configured",
      audioBase64: null,
      mimeType: null,
    };
  }

  const body = {
    input: { text: data.text },
    voice: {
      languageCode: "en-US",
      name: data.voiceName ?? "en-US-Neural2-C",
    },
    audioConfig: { audioEncoding: "MP3" },
  };

  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`TTS failed: ${res.status} ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { audioContent?: string };
  if (!json.audioContent) throw new Error("TTS returned no audio");
  return {
    error: null,
    audioBase64: json.audioContent,
    mimeType: "audio/mpeg",
  };
}
