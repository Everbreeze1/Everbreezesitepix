// Central router for AI calls. Locked to our own Google Gemini Flash key
// (GEMINI_API_KEY) so no AI traffic is ever billed against the workspace's
// Direct Gemini API. If GEMINI_API_KEY is missing we throw instead of
// silently falling back to any third-party gateway.

const GEMINI_CHAT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

// Latest Gemini Flash. Using the "-latest" alias keeps us on a currently
// available model as Google rotates versions.
export const GEMINI_FLASH_MODEL = "gemini-flash-latest";

function requireGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not configured. All AI features are routed through our own Gemini key; add it in project secrets.",
    );
  }
  return key;
}

/** Returns URL/headers/model to use for a chat.completions style request. */
export function chatEndpoint(_preferredModel?: string) {
  const key = requireGeminiKey();
  return {
    url: GEMINI_CHAT,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    model: GEMINI_FLASH_MODEL,
    provider: "gemini" as const,
  };
}

// Audio is transcribed through the ordinary chat endpoint as an `input_audio`
// part (see transcribeAudio in domains/ai/service.ts). Gemini has no separate
// transcription endpoint, so there is none to export here.

export function isUsingCustomGemini() {
  return !!process.env.GEMINI_API_KEY;
}
