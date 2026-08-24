import { cleanCaption, normalizeDashes } from "@sitepix/shared";
import { chatEndpoint } from "../../lib/ai-provider";
import { inlineImageAsDataUrl } from "../../lib/inline-image";
import { getCallerTeamPlan } from "../../lib/team-plan";
import type { AuthedContext } from "../../lib/user-context";

const VISION_MODEL = "google/gemini-2.5-pro";
const CHAT_MODEL = "google/gemini-2.5-pro";

function aiKeyConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * Turn a failed provider response into an error carrying the right status.
 *
 * WHY THIS EXISTS
 *
 * Every call site used to `throw new Error("Rate limited. Try again shortly.")`
 * with no status. `jsonFromUnknownError` maps a status-less throw to HTTP 500
 * `internal_error`, so the provider throttling us was reported to the customer,
 * and recorded in `api_audit_logs`, as OUR server crashing. Thirty of the
 * hundred 5xx on record are these - transcribeWalkthrough, analyzePhoto,
 * extractPhotoText, chatWithAssistant and the summarisers - which both
 * overstated the real error rate and buried the failures that are genuinely
 * ours.
 *
 * The distinction the statuses now draw:
 *
 *   429 / 402  the caller can act - wait, or add credits. 4xx, so the message
 *              reaches their toast unchanged.
 *   503        upstream is down or refused us. Not the caller's fault and not a
 *              bug in this codebase; `expose` lets the human-readable half
 *              through while the raw provider body stays server-side.
 */
async function aiProviderError(res: Response, label: string): Promise<Error> {
  const body = await res.text().catch(() => "");

  if (res.status === 429) {
    return Object.assign(new Error("The AI service is busy right now. Try again in a moment."), {
      status: 429,
    });
  }
  if (res.status === 402) {
    return Object.assign(
      new Error("AI credits are exhausted. Add credits in workspace settings."),
      {
        status: 402,
      },
    );
  }
  if (res.status === 401 || res.status === 403) {
    // Our credentials, not the caller's problem - but an operator needs the
    // detail, so it goes to the log rather than the toast.
    console.error(`[ai] ${label} rejected: ${res.status} ${body.slice(0, 300)}`);
    return Object.assign(new Error("The AI service is not accepting our credentials."), {
      status: 503,
      expose: true,
    });
  }

  console.error(`[ai] ${label} failed: ${res.status} ${body.slice(0, 300)}`);
  return Object.assign(
    new Error("The AI service is temporarily unavailable. Try again in a moment."),
    { status: 503, expose: true },
  );
}

/**
 * Every provider call gets a deadline.
 *
 * These are plain `fetch`es to a third party with no timeout, so a provider
 * that accepts a connection and then stalls holds one of ours open until the
 * platform gives up on it. Observed successful calls top out around ten
 * seconds, so this only ever catches a genuine hang.
 */
const AI_TIMEOUT_MS = 120_000;

async function aiFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(AI_TIMEOUT_MS) });
  } catch (e: any) {
    // A timeout or a dropped connection is upstream being unavailable, not a
    // fault in the request we made.
    console.error(`[ai] ${label} network failure: ${e?.name ?? ""} ${e?.message ?? e}`);
    throw Object.assign(new Error("The AI service did not respond. Try again in a moment."), {
      status: 503,
      expose: true,
    });
  }
}

const analysisTool = {
  type: "function" as const,
  function: {
    name: "report_site_analysis",
    description: "Return a structured site photo analysis for a construction/trades inspection.",
    parameters: {
      type: "object",
      properties: {
        brand: {
          type: "string",
          description:
            "Manufacturer / brand printed on the equipment, if visible. Empty string if none.",
        },
        model_number: {
          type: "string",
          description: "Model number printed on the equipment, if visible. Empty string if none.",
        },
        serial_number: {
          type: "string",
          description: "Serial number printed on the equipment, if visible. Empty string if none.",
        },
        ocr_text: {
          type: "string",
          description:
            "All other readable text in the image (labels, warnings, signs). Empty string if none.",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "High-level scene labels (e.g. roof, HVAC unit, electrical panel).",
        },
        defects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                description:
                  "e.g. crack, leak, corrosion, wear, misalignment, missing_part, damage",
              },
              severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
              location: { type: "string", description: "Where in the image / on the equipment." },
              description: { type: "string" },
            },
            required: ["type", "severity", "description"],
            additionalProperties: false,
          },
        },
        report_text: {
          type: "string",
          description: "1-3 paragraph field inspection report in plain English.",
        },
        recommendations: {
          type: "array",
          items: { type: "string" },
          description: "Actionable next steps for the field worker.",
        },
      },
      required: ["ocr_text", "labels", "defects", "report_text", "recommendations"],
      additionalProperties: false,
    },
  },
};

export async function analyzePhotoService(ctx: AuthedContext, data: { photoId: string }) {
  const { supabase, userId } = ctx;
  if (!aiKeyConfigured())
    throw Object.assign(new Error("AI features are not configured on this deployment."), {
      status: 503,
      expose: true,
    });

  const { data: photo, error: photoErr } = await supabase
    .from("photos")
    .select("id, storage_path, project_id")
    .eq("id", data.photoId)
    .single();
  if (photoErr || !photo) throw Object.assign(new Error("Photo not found"), { status: 404 });

  const { isActive } = await getCallerTeamPlan(supabase, userId);
  if (!isActive) {
    // A plan gate is the caller's answer to act on, not a server fault. Thrown
    // without a status it reached them as HTTP 500 "internal_error".
    throw Object.assign(
      new Error("AI photo analysis requires an active plan. Subscribe to unlock it."),
      { status: 403 },
    );
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from("site-photos")
    .createSignedUrl(photo.storage_path, 600);
  if (signErr || !signed) throw new Error("Could not access photo");

  const { data: pending, error: insErr } = await supabase
    .from("ai_analyses")
    .insert({
      photo_id: photo.id,
      created_by: userId,
      provider: "gemini-2.5-pro",
      status: "processing",
    })
    .select("id")
    .single();
  if (insErr || !pending) throw new Error("Failed to create analysis record");

  try {
    const ep = chatEndpoint(VISION_MODEL);
    const res = await aiFetch(
      ep.url,
      {
        method: "POST",
        headers: ep.headers,
        body: JSON.stringify({
          model: ep.model,
          messages: [
            {
              role: "system",
              content:
                "You are an expert construction/trades field inspector (electrical, HVAC, plumbing, roofing, structural). For the attached job-site photo: (1) extract the equipment BRAND, MODEL NUMBER and SERIAL NUMBER exactly as printed (leave empty if not visible - never guess); (2) capture any other readable text/labels/warnings into ocr_text; (3) identify visible defects (cracks, leaks, corrosion, wear, misalignment, missing parts, physical damage) with severity; (4) write a clear, safety-first field report; and (5) recommend practical next actions. Always call the report_site_analysis tool - never reply with free-form text.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Analyze this job site photo. Extract brand/model/serial, list defects, and recommend next steps.",
                },
                {
                  type: "image_url",
                  image_url: { url: await inlineImageAsDataUrl(signed.signedUrl) },
                },
              ],
            },
          ],
          tools: [analysisTool],
          tool_choice: { type: "function", function: { name: "report_site_analysis" } },
        }),
      },
      "analyzePhoto",
    );

    if (!res.ok) throw await aiProviderError(res, "analyzePhoto");
    const json = await res.json();
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) throw new Error("AI did not return structured analysis");
    const parsed = JSON.parse(call.function.arguments);

    const idLines: string[] = [];
    if (parsed.brand) idLines.push(`Brand: ${parsed.brand}`);
    if (parsed.model_number) idLines.push(`Model: ${parsed.model_number}`);
    if (parsed.serial_number) idLines.push(`Serial: ${parsed.serial_number}`);
    const ocrCombined = [idLines.join("\n"), parsed.ocr_text ?? ""]
      .filter(Boolean)
      .join("\n\n")
      .trim();

    /*
     * The prose the model wrote gets the dash fold; the values it read off the
     * equipment do not. `ocr_text`, and the brand/model/serial lines folded
     * into it above, are transcriptions of what is printed on a plate - see
     * extractPhotoTextService for the same distinction.
     */
    const defects = (parsed.defects ?? []).map((d: any) => ({
      ...d,
      location: d?.location ? normalizeDashes(String(d.location)) : d?.location,
      description: normalizeDashes(String(d?.description ?? "")),
    }));

    await supabase
      .from("ai_analyses")
      .update({
        status: "completed",
        ocr_text: ocrCombined || null,
        labels: (parsed.labels ?? []).map((l: any) => normalizeDashes(String(l))),
        defects,
        report_text: parsed.report_text ? normalizeDashes(String(parsed.report_text)) : null,
        recommendations: (parsed.recommendations ?? []).map((r: any) => normalizeDashes(String(r))),
        raw_response: json,
      })
      .eq("id", pending.id);

    return { id: pending.id, ...parsed, ocr_text: ocrCombined };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase
      .from("ai_analyses")
      .update({ status: "failed", raw_response: { error: message } })
      .eq("id", pending.id);
    throw e;
  }
}

export async function chatWithAssistantService(
  ctx: AuthedContext,
  data: {
    conversationId?: string;
    message: string;
    photoId?: string;
    title?: string;
  },
) {
  const { supabase, userId } = ctx;
  if (!aiKeyConfigured()) throw new Error("AI is not configured");

  if (data.photoId) {
    const { isPro } = await getCallerTeamPlan(supabase, userId);
    if (!isPro) {
      throw new Error(
        "Attaching photos to the AI is a Pro feature. Upgrade to Pro for vision-powered chat.",
      );
    }
  }

  let convId = data.conversationId;
  if (!convId) {
    const { data: conv, error } = await supabase
      .from("conversations")
      .insert({ user_id: userId, title: data.title ?? data.message.slice(0, 60) })
      .select("id")
      .single();
    if (error || !conv) throw new Error("Failed to create conversation");
    convId = conv.id;
  }

  await supabase.from("messages").insert({
    conversation_id: convId,
    user_id: userId,
    role: "user",
    content: data.message,
    photo_id: data.photoId ?? null,
  });

  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true })
    .limit(40);

  let imageUrl: string | null = null;
  let ocrContext = "";
  if (data.photoId) {
    const { data: photo } = await supabase
      .from("photos")
      .select("storage_path")
      .eq("id", data.photoId)
      .single();
    if (photo) {
      const { data: signed } = await supabase.storage
        .from("site-photos")
        .createSignedUrl(photo.storage_path, 600);
      if (signed) imageUrl = signed.signedUrl;
      const { data: lastAnalysis } = await supabase
        .from("ai_analyses")
        .select("ocr_text, labels, defects, report_text")
        .eq("photo_id", data.photoId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastAnalysis) {
        ocrContext = `\n\n[Prior analysis of attached photo]\nOCR: ${lastAnalysis.ocr_text ?? "(none)"}\nLabels: ${JSON.stringify(lastAnalysis.labels)}\nDefects: ${JSON.stringify(lastAnalysis.defects)}\nReport: ${lastAnalysis.report_text ?? ""}`;
      }
    }
  }

  const systemPrompt =
    'You are SitePix AI, an expert professional field supervisor with 15+ years of experience in construction, HVAC, electrical, and general contracting. Your tone is direct, confident, helpful, and concise. Speak in short, punchy sentences optimized for natural speech narration. Be practical, solution-focused, and encouraging without being overly wordy. Always prioritize clarity and actionable advice. When a photo is attached, briefly note what you see before advising. Avoid filler like "As an AI…" or "Great question!". CRITICAL LENGTH RULE: keep every reply to 350 characters or fewer (roughly 2–4 short sentences). Only exceed this when the user explicitly asks for a detailed report or full write-up.';

  const lastUserContent: unknown = imageUrl
    ? [
        { type: "text", text: data.message + ocrContext },
        { type: "image_url", image_url: { url: await inlineImageAsDataUrl(imageUrl) } },
      ]
    : data.message + ocrContext;

  const messages = [
    { role: "system", content: systemPrompt },
    ...(history ?? []).slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: lastUserContent },
  ];

  const ep = chatEndpoint(CHAT_MODEL);
  const res = await aiFetch(
    ep.url,
    {
      method: "POST",
      headers: ep.headers,
      body: JSON.stringify({ model: ep.model, messages }),
    },
    "chatWithAssistant",
  );
  if (!res.ok) throw await aiProviderError(res, "chatWithAssistant");
  const json = await res.json();
  const reply = normalizeDashes(json.choices?.[0]?.message?.content ?? "");

  await supabase.from("messages").insert({
    conversation_id: convId,
    user_id: userId,
    role: "assistant",
    content: reply,
  });

  return { conversationId: convId, reply };
}

/**
 * Every AI entry point must pass through here.
 *
 * These calls cost real money on our Gemini key, and the RPC endpoint is
 * reachable with nothing but a valid session - so a hidden button is not a
 * control. Three services (`summarizePhotosReport`, `draftReportNarrative`,
 * `extractPhotoText`) had no check at all, which let a cancelled account keep
 * generating reports and running OCR indefinitely.
 *
 * `isActive` rather than `isPro`: it is the same bar `analyzePhoto` uses, and it
 * now covers `trialing` and `past_due` (see lib/team-plan.ts), so trials and
 * cards in their retry window are not locked out. Only genuinely inactive
 * accounts are refused.
 *
 * @param feature Named in the error the user sees - "Auto-reports require…"
 *   was previously shown for OCR and site-log notes too.
 */
async function requireActiveSub(
  supabase: AuthedContext["supabase"],
  userId: string,
  feature = "This AI feature",
) {
  const { data: isAdmin } = await supabase.rpc(
    "has_role" as never,
    { _user_id: userId, _role: "admin" } as never,
  );
  if (isAdmin) return;

  const { isActive } = await getCallerTeamPlan(supabase, userId);
  if (!isActive) {
    throw Object.assign(new Error(`${feature} requires an active plan. Upgrade to Pro or Team.`), {
      status: 403,
    });
  }
}

/** Groups timestamps into a human timeline: how many visits, over what span. */
function describeTimeline(takenAt: Array<string | null>): string {
  const dates = takenAt
    .filter((t): t is string => !!t)
    .map((t) => new Date(t))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  if (!dates.length) return "";

  const dayKey = (d: Date) => d.toDateString();
  const days = Array.from(new Set(dates.map(dayKey)));
  const first = dates[0];
  const last = dates[dates.length - 1];
  const fmtDate = (d: Date) =>
    d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (days.length === 1) {
    return `All photos were captured on ${fmtDate(first)}, between ${fmtTime(first)} and ${fmtTime(last)} - a single visit.`;
  }
  return (
    `Photos span ${days.length} separate days, from ${fmtDate(first)} to ${fmtDate(last)}. ` +
    `Treat each day as a distinct visit when describing sequence.`
  );
}

/**
 * Assembles the factual context block the drafting prompts work from.
 *
 * Covers what the field actually records about a job: photo metadata (caption,
 * tags, capture time), project info, the timeline the photos describe, spoken
 * notes narrated during a walkthrough, and any completed per-photo AI analysis.
 * Shared by the site-log and report prompts so both reason over identical
 * material.
 *
 * Photos keep the user's chosen order (that's the document's order), but the
 * timeline is derived from real capture times and stated separately - so the
 * model can narrate sequence without the document being reshuffled.
 */
async function buildPhotoContext(
  ctx: AuthedContext,
  photoIds: string[],
  opts: { includeComments?: boolean } = {},
) {
  const { supabase, userId } = ctx;
  if (!aiKeyConfigured()) throw new Error("AI is not configured");
  await requireActiveSub(supabase, userId, "The AI assistant");

  const { data: photos } = await supabase
    .from("photos")
    .select("id, caption, taken_at, created_at, storage_path, project_id")
    .in("id", photoIds);
  if (!photos?.length) throw new Error("No photos found");

  const projectIds = Array.from(
    new Set((photos as any[]).map((p: any) => p.project_id).filter(Boolean)),
  ) as string[];
  const safeIds = projectIds.length ? projectIds : ["00000000-0000-0000-0000-000000000000"];

  const [
    { data: projects },
    { data: analyses },
    { data: tagRows },
    { data: walkRows },
    commentRes,
  ] = await Promise.all([
    supabase.from("projects").select("id, name, street, city, state").in("id", safeIds),
    supabase
      .from("ai_analyses")
      .select("photo_id, ocr_text, labels, defects, report_text, recommendations")
      .in("photo_id", photoIds)
      .eq("status", "completed"),
    (supabase as any).from("photo_tags").select("photo_id, tags(name)").in("photo_id", photoIds),
    // Narration captured while walking the site - this is how a Report or
    // Site Log "pulls from a walkthrough": the spoken note rides on the photo.
    (supabase as any)
      .from("walkthrough_photos")
      .select("photo_id, spoken_note")
      .in("photo_id", photoIds),
    opts.includeComments
      ? (supabase as any)
          .from("photo_comments")
          .select("photo_id, body, created_at")
          .in("photo_id", photoIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const projectById = new Map(((projects as any[]) ?? []).map((p: any) => [p.id, p]));
  const analysisByPhoto = new Map(((analyses as any[]) ?? []).map((a: any) => [a.photo_id, a]));

  const tagsByPhoto = new Map<string, string[]>();
  for (const row of (tagRows as any[]) ?? []) {
    const name = row?.tags?.name;
    if (!name) continue;
    tagsByPhoto.set(row.photo_id, [...(tagsByPhoto.get(row.photo_id) ?? []), name]);
  }

  const notesByPhoto = new Map<string, string>();
  for (const row of (walkRows as any[]) ?? []) {
    const note = String(row?.spoken_note ?? "").trim();
    if (note) notesByPhoto.set(row.photo_id, note);
  }

  const commentsByPhoto = new Map<string, string[]>();
  for (const row of ((commentRes as any)?.data as any[]) ?? []) {
    const body = String(row?.body ?? "").trim();
    if (!body) continue;
    commentsByPhoto.set(row.photo_id, [...(commentsByPhoto.get(row.photo_id) ?? []), body]);
  }

  const photoSummaries = (photos as any[])
    .map((p: any, i: number) => {
      const a = analysisByPhoto.get(p.id);
      const proj = p.project_id ? projectById.get(p.project_id) : undefined;
      const cap = cleanCaption(p.caption);
      const tags = tagsByPhoto.get(p.id) ?? [];
      const note = notesByPhoto.get(p.id);
      const comments = commentsByPhoto.get(p.id) ?? [];
      return [
        `Photo ${i + 1}${cap ? ` - ${cap}` : ""}`,
        cap ? null : `(no caption recorded)`,
        proj
          ? `Project: ${proj.name}${
              [proj.street, proj.city, proj.state].filter(Boolean).length
                ? ` (${[proj.street, proj.city, proj.state].filter(Boolean).join(", ")})`
                : ""
            }`
          : null,
        tags.length ? `Tags: ${tags.join(", ")}` : null,
        p.taken_at ? `Taken: ${new Date(p.taken_at).toLocaleString()}` : null,
        note ? `Spoken note during walkthrough: "${note}"` : null,
        comments.length ? `Team notes: ${comments.join(" | ")}` : null,
        a?.report_text ? `Findings: ${a.report_text}` : null,
        a?.defects?.length ? `Defects: ${JSON.stringify(a.defects)}` : null,
        a?.recommendations?.length
          ? `Recommendations: ${(a.recommendations as string[]).join("; ")}`
          : null,
        a?.ocr_text ? `Text on equipment: ${a.ocr_text}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");

  const proj = projectById.get(projectIds[0]);
  const timeline = describeTimeline((photos as any[]).map((p: any) => p.taken_at ?? p.created_at));
  const allTags = Array.from(new Set(Array.from(tagsByPhoto.values()).flat()));
  const overview = [
    proj ? `Project: ${proj.name}` : null,
    proj && [proj.street, proj.city, proj.state].filter(Boolean).length
      ? `Address: ${[proj.street, proj.city, proj.state].filter(Boolean).join(", ")}`
      : null,
    `Photos in this document: ${photos.length}`,
    timeline || null,
    allTags.length ? `Tags across these photos: ${allTags.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    photoSummaries: `PROJECT & TIMELINE\n${overview}\n\n=== PHOTOS ===\n\n${photoSummaries}`,
    photoCount: photos.length,
  };
}

/**
 * Shared chat call - returns the assistant's message text.
 *
 * Every drafter in this file funnels through here, so the dash fold happens
 * once rather than at each caller: site-log bodies, report summaries and
 * conclusions, and the walkthrough summaries composed on top of them. See
 * `normalizeDashes` for why model prose needs it when tracked source does not.
 */
/**
 * Transcribe recorded audio to text.
 *
 * Gemini has no Whisper-style `/audio/transcriptions` endpoint - the URL the
 * walkthrough recorder used to POST to returns nothing at all (HTTP 000), which
 * is why every walkthrough ever recorded came back with an empty transcript and
 * a summary that called a narrated walk "silent". The supported path is audio
 * as an `input_audio` part on the ordinary chat endpoint, which is the same
 * endpoint every other AI feature here already uses and which works in
 * production (it is only geo-blocked from this dev machine).
 *
 * `format` is the bare container name Gemini expects ("wav", "mp3", "webm"),
 * not a mime type. The transcript is returned verbatim and unlabelled; an empty
 * string means the model heard no speech, which the caller must be able to tell
 * apart from a failure (a failure throws).
 */
export async function transcribeAudio(base64: string, format: string): Promise<string> {
  const ep = chatEndpoint(CHAT_MODEL);
  const res = await aiFetch(
    ep.url,
    {
      method: "POST",
      headers: ep.headers,
      body: JSON.stringify({
        model: ep.model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Transcribe the spoken words in this audio verbatim. Output only the " +
                  "transcript as plain text - no preamble, no speaker labels, no timestamps, " +
                  "no commentary, no quotation marks. If nobody speaks, output nothing at all.",
              },
              { type: "input_audio", input_audio: { data: base64, format } },
            ],
          },
        ],
      }),
    },
    "transcribeAudio",
  );
  if (!res.ok) {
    throw await aiProviderError(res, "transcribeAudio");
  }
  const json = await res.json();
  return normalizeDashes(json.choices?.[0]?.message?.content ?? "").trim();
}

export async function chatComplete(system: string, user: string): Promise<string> {
  const ep = chatEndpoint(CHAT_MODEL);
  const res = await aiFetch(
    ep.url,
    {
      method: "POST",
      headers: ep.headers,
      body: JSON.stringify({
        model: ep.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    },
    "chatComplete",
  );
  if (!res.ok) {
    throw await aiProviderError(res, "chatComplete");
  }
  const json = await res.json();
  return normalizeDashes(json.choices?.[0]?.message?.content ?? "");
}

/**
 * SITE LOG voice: the technician's own quick record of a visit. Terse bullets,
 * minimal ceremony - explicitly not a customer-facing document.
 */
const SITE_LOG_SYSTEM =
  "You are SitePix AI writing a technician's own SITE LOG - a fast internal record of a site visit, NOT a customer-facing report. " +
  "Output Markdown with ONLY these sections: '## What was done' (3-6 terse bullets, fragments not full sentences, e.g. '- Replaced condensate pump, unit 4B'), " +
  "and '## Follow-ups' (bullets, ONLY if the source material explicitly mentions outstanding work; omit the whole section otherwise). " +
  "Do NOT write an intro, a title, a conclusion, or any prose paragraphs. Do NOT pad. Keep each bullet under 12 words where possible. " +
  "STYLE RULES: neutral and factual. Do NOT call things 'critical', 'code violations', or 'safety hazards'. Do NOT invent defects, " +
  "recommendations, or risks not present in the source material.";

/**
 * Write about the work. Not about the photographs of it.
 *
 * "The Report that is being generated keeps saying This was photo documentation
 * for a Contactor Replacement. Instead it should say, a Contactor was replaced.
 * The report keeps emphasizing this was documented that was documented. It
 * should say more huminized output like Contactor replaced, Control Board
 * replaced on this date."
 *
 * The cause was in the prompts rather than the model: three of them asked for
 * "what was documented" and one named its own section "Work Documented", so the
 * subject of every sentence came back as the documentation and the work itself
 * became its object. A job where a contactor was replaced read as a job where
 * photographs were taken.
 *
 * The voice being asked for already existed in this file - SITE_LOG_SYSTEM has
 * always wanted "Replaced condensate pump, unit 4B" - it just was not what the
 * client-facing documents were asking for. This is that rule, extracted so the
 * four prompts cannot drift apart again.
 *
 * The last two sentences are what keeps this honest. Rephrasing a technician's
 * note is required; going beyond it is still forbidden, and a job whose notes
 * say nothing about the work has to say so rather than retreating to
 * "photo documentation of a site visit".
 */
export const WORK_VOICE_RULES =
  "VOICE - this rule outranks the others. Write about the work, not about the photographs of it. " +
  "Name the component and what was done to it, and lead with that: 'Contactor replaced', " +
  "'Control board replaced on 12 August', 'Condenser coil cleaned'. " +
  "NEVER write 'photo documentation', 'photographic documentation', 'this documents', 'documentation of', " +
  "'the record shows', 'the photo record', 'was documented', 'photos were taken', 'images were captured', " +
  "or any other phrasing whose subject is the documentation instead of the work. " +
  "A note naming a task IS that task, completed: a note reading 'Contactor Replacement' becomes " +
  "'the contactor was replaced'. Rephrasing a note that way is required of you, and is not an inference. " +
  "Going further than the notes is still forbidden: invent no parts, no measurements, no model numbers, " +
  "no causes, no outcomes, and no work that no note mentions. Where a task has a date, say when it was done. " +
  "Where the material names no work at all, say plainly that the notes on file do not describe the work " +
  "performed, and stop there rather than falling back on describing the photographs.";

/**
 * REPORT voice: a formal, client-facing document. Produces the two narrative
 * bookends - an opening summary and a closing conclusion - which the page
 * generator places around the photo sections.
 */
const REPORT_SYSTEM =
  "You are SitePix AI drafting a formal, client-facing site REPORT. Produce EXACTLY two Markdown sections and nothing else:\n" +
  "## Executive Summary\n<2-4 full sentences: what work was carried out on this visit, on what, and when>\n\n" +
  "## Conclusion\n<4-6 full sentences closing out the report: restate the work that was completed, name the components involved, " +
  "and give any next steps the material states. This is the section a customer reads to see what they paid for, " +
  "so it must say what was done. If the material genuinely supports less, write less rather than padding - " +
  "but never close on a sentence about documentation>\n\n" +
  "Write in complete, professional prose - no bullets. Do NOT include a title, photo-by-photo notes, or any other section. " +
  WORK_VOICE_RULES +
  " STYLE RULES: neutral and factual. Do NOT call things 'critical', 'code violations', or 'safety hazards'. Do NOT invent defects, " +
  "recommendations, findings, or risks that the source material does not state.";

/**
 * SUMMARY voice: a short shareable brief. Prose, not bullets - the "what
 * happened here, in a paragraph" read. Distinct from Daily Log (terse internal
 * bullets) and from Report (a full formal document with a cover page).
 */
const SUMMARY_SYSTEM =
  "You are SitePix AI writing a brief SUMMARY of work on a site - a short, shareable recap someone can read in under a minute. " +
  "Output Markdown with ONLY these sections: '## Overview' (2-4 sentences of flowing prose saying what work was carried out and when), " +
  "and '## Key Points' (3-5 short bullets, each leading with the component and what was done to it, " +
  "e.g. '- Contactor replaced' or '- Control board replaced, 12 August'). " +
  "Do NOT include a title, a conclusion, or photo-by-photo commentary. " +
  WORK_VOICE_RULES +
  " STYLE RULES: neutral and factual. Do NOT call things 'critical', 'code violations', or 'safety hazards'. Do NOT invent defects, " +
  "recommendations, or risks not present in the source material. If the source material is thin, say so plainly rather than padding.";

export async function summarizePhotosReportService(
  ctx: AuthedContext,
  data: { photoIds: string[]; title?: string; mode?: "daily_log" | "summary" },
) {
  await requireActiveSub(ctx.supabase, ctx.userId, "Photo report summaries");
  // Site Log is the technician's own internal record, so team photo comments
  // are fair game here. They are deliberately NOT fed to the client-facing
  // Report - internal @mention discussion must not leak into a deliverable.
  const isSummary = data.mode === "summary";
  // Daily Log is the technician's own internal record, so team photo comments
  // are fair game there. A Summary is shareable, so it gets the same treatment
  // as the client-facing Report: no internal @mention discussion.
  const { photoSummaries, photoCount } = await buildPhotoContext(ctx, data.photoIds, {
    includeComments: !isSummary,
  });
  const markdown = await chatComplete(
    isSummary ? SUMMARY_SYSTEM : SITE_LOG_SYSTEM,
    `${data.title ? `${isSummary ? "Summary" : "Daily log"} title: ${data.title}\n\n` : ""}Photos and context:\n\n${photoSummaries}`,
  );
  return { markdown, photoCount };
}

/**
 * Drafts the narrative bookends for a formal report. Returns raw Markdown for
 * each; a missing section simply comes back empty so the caller can omit it
 * rather than printing an empty heading.
 */
export async function draftReportNarrativeService(
  ctx: AuthedContext,
  data: { photoIds: string[]; title?: string },
): Promise<{ summary: string; conclusion: string }> {
  await requireActiveSub(ctx.supabase, ctx.userId, "Report drafting");
  const { photoSummaries } = await buildPhotoContext(ctx, data.photoIds);
  const markdown = await chatComplete(
    REPORT_SYSTEM,
    `${data.title ? `Report title: ${data.title}\n\n` : ""}Photos and context:\n\n${photoSummaries}`,
  );
  return {
    summary: extractSection(markdown, "Executive Summary"),
    conclusion: extractSection(markdown, "Conclusion"),
  };
}

/**
 * Pulls the body of a `## Heading` block out of the model's Markdown.
 *
 * The lookahead terminates at the next heading or at the absolute end of the
 * string - `$(?![\s\S])` rather than `\z`, which JavaScript does not support
 * (and which silently matched nothing, returning every section empty).
 */
function extractSection(markdown: string, heading: string): string {
  const re = new RegExp(`^#{1,3}\\s*${heading}\\s*$([\\s\\S]*?)(?=^#{1,3}\\s|$(?![\\s\\S]))`, "im");
  return re.exec(markdown ?? "")?.[1]?.trim() ?? "";
}

export async function describeSiteLogPhotosService(
  ctx: AuthedContext,
  data: { photoIds: string[] },
) {
  const { supabase, userId } = ctx;
  if (!aiKeyConfigured()) throw new Error("AI is not configured");
  await requireActiveSub(supabase, userId, "Site log descriptions");

  const { data: photos } = await supabase
    .from("photos")
    .select("id, caption, storage_path, taken_at")
    .in("id", data.photoIds);
  if (!photos?.length) return { notes: {} as Record<string, string> };

  const { data: tagRows } = await (supabase as any)
    .from("photo_tags")
    .select("photo_id, tags(name)")
    .in("photo_id", data.photoIds);
  const tagsByPhoto = new Map<string, string[]>();
  for (const row of (tagRows ?? []) as any[]) {
    const name = row?.tags?.name;
    if (!name) continue;
    const arr = tagsByPhoto.get(row.photo_id) ?? [];
    arr.push(name);
    tagsByPhoto.set(row.photo_id, arr);
  }

  const NEUTRAL =
    "No descriptive information was provided for this photo. No specific observations or notes available.";

  const signed = await Promise.all(
    (photos as any[]).map(async (p: any) => {
      const caption = cleanCaption(p.caption);
      const tags = tagsByPhoto.get(p.id) ?? [];
      const hasContext = !!caption || tags.length > 0;
      if (!hasContext)
        return { id: p.id, caption: "", tags, url: null as string | null, skip: true };
      const { data: s } = await supabase.storage
        .from("site-photos")
        .createSignedUrl(p.storage_path, 900);
      return { id: p.id, caption, tags, url: s?.signedUrl ?? null, skip: false };
    }),
  );

  const ep = chatEndpoint(CHAT_MODEL);
  const results = await Promise.all(
    signed.map(async (item, i) => {
      if (item.skip || !item.url) return [item.id, NEUTRAL] as const;
      try {
        const contextBits: string[] = [];
        if (item.caption) contextBits.push(`caption: ${item.caption}`);
        if (item.tags.length) contextBits.push(`tags: ${item.tags.join(", ")}`);
        const res = await aiFetch(
          ep.url,
          {
            method: "POST",
            headers: ep.headers,
            body: JSON.stringify({
              model: ep.model,
              messages: [
                {
                  role: "system",
                  content:
                    "You write a concise site-log note for a construction/trades photo, grounded ONLY in the user-provided context (caption, tags, voice notes). Reply with 2-3 short factual sentences that restate/expand the provided context and describe what is plainly visible. Neutral tone. Do NOT invent defects, risks, code issues, or recommendations the user did not mention. No headings, no bullets, no markdown, no disclaimers.",
                },
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `Photo ${i + 1} - user context: ${contextBits.join(" | ")}. Write the site-log note.`,
                    },
                    { type: "image_url", image_url: { url: await inlineImageAsDataUrl(item.url) } },
                  ],
                },
              ],
            }),
          },
          "visionChat",
        );
        if (!res.ok) return [item.id, NEUTRAL] as const;
        const json = await res.json();
        const text = normalizeDashes(json.choices?.[0]?.message?.content ?? "").trim();
        return [item.id, text || NEUTRAL] as const;
      } catch {
        return [item.id, NEUTRAL] as const;
      }
    }),
  );

  const notes: Record<string, string> = {};
  for (const [id, text] of results) notes[id] = text;
  return { notes };
}

export async function summarizeWalkthroughsReportService(
  ctx: AuthedContext,
  data: { walkthroughIds: string[]; title?: string },
) {
  const { supabase, userId } = ctx;
  if (!aiKeyConfigured()) throw new Error("AI is not configured");
  await requireActiveSub(supabase, userId, "Walkthrough reports");

  const { data: walks } = await supabase
    .from("walkthroughs" as never)
    .select(
      "id, title, transcript, summary_markdown, duration_seconds, started_at, project_id, status, created_by",
    )
    .in("id", data.walkthroughIds);
  const mine = (walks ?? []).filter((w: { created_by: string }) => w.created_by === userId);
  if (!mine.length) throw new Error("No walkthroughs found");

  const projectIds = Array.from(new Set(mine.map((w: any) => w.project_id).filter(Boolean)));
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .in(
      "id",
      projectIds.length ? (projectIds as string[]) : ["00000000-0000-0000-0000-000000000000"],
    );
  const projectById = new Map(((projects as any[]) ?? []).map((p: any) => [p.id, p]));

  const blocks = mine
    .map((w: any, i: number) => {
      const proj = w.project_id ? projectById.get(w.project_id) : undefined;
      return [
        `Walkthrough ${i + 1}: ${w.title ?? "Untitled"}`,
        proj ? `Project: ${proj.name}` : null,
        w.started_at ? `Date: ${new Date(w.started_at).toLocaleString()}` : null,
        w.duration_seconds ? `Duration: ${Math.round(w.duration_seconds / 60)} min` : null,
        w.summary_markdown ? `Prior summary:\n${w.summary_markdown}` : null,
        w.transcript ? `Transcript:\n${String(w.transcript).slice(0, 6000)}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n===\n\n");

  const ep = chatEndpoint(CHAT_MODEL);
  const res = await aiFetch(
    ep.url,
    {
      method: "POST",
      headers: ep.headers,
      body: JSON.stringify({
        model: ep.model,
        messages: [
          {
            role: "system",
            content:
              "You are SitePix AI, summarizing one or more site walkthroughs into a clean recap - like a site log, not an engineering diagnosis. Structure the Markdown as: # Title, ## Summary (2-3 sentences describing what was walked), ## Highlights (bulleted list summarizing what the technician described, grouped by area/topic when natural), ## Follow-ups (only if the source material explicitly mentions them). STYLE RULES: Neutral, factual, summary-focused. Do NOT use language like 'critical', 'code violation', 'safety hazard', 'severity: high', or strong diagnostic opinions unless the speaker explicitly used those words. Do NOT invent findings, risks, or recommendations. Base every bullet on what is actually in the transcripts and prior summaries. Prefer short bullets and clean spacing over long paragraphs.",
          },
          {
            role: "user",
            content: `${data.title ? `Report title: ${data.title}\n\n` : ""}Walkthroughs:\n\n${blocks}`,
          },
        ],
      }),
    },
    "visionChat",
  );
  if (!res.ok) {
    throw await aiProviderError(res, "visionChat");
  }
  const json = await res.json();
  const markdown = normalizeDashes(json.choices?.[0]?.message?.content ?? "");
  return { markdown, walkthroughCount: mine.length };
}

export async function extractPhotoTextService(ctx: AuthedContext, data: { photoId: string }) {
  const { supabase, userId } = ctx;
  if (!aiKeyConfigured()) throw new Error("AI is not configured");
  await requireActiveSub(supabase, userId, "Text extraction");

  const { data: photo, error: photoErr } = await supabase
    .from("photos")
    .select("id, storage_path")
    .eq("id", data.photoId)
    .single();
  if (photoErr || !photo) throw new Error("Photo not found");

  const { data: signed, error: signErr } = await supabase.storage
    .from("site-photos")
    .createSignedUrl(photo.storage_path, 600);
  if (signErr || !signed) throw new Error("Could not access photo");

  const ep = chatEndpoint(VISION_MODEL);
  const res = await aiFetch(
    ep.url,
    {
      method: "POST",
      headers: ep.headers,
      body: JSON.stringify({
        model: ep.model,
        messages: [
          {
            role: "system",
            content:
              "You are an OCR engine. Extract ALL readable text from the image exactly as printed - labels, warnings, model numbers, handwriting, signage. Preserve line breaks. Do NOT add commentary, headings, translations, or explanations. If there is no readable text, reply with exactly: (no text found).",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract every readable piece of text from this photo." },
              {
                type: "image_url",
                image_url: { url: await inlineImageAsDataUrl(signed.signedUrl) },
              },
            ],
          },
        ],
      }),
    },
    "visionChat",
  );
  if (!res.ok) {
    throw await aiProviderError(res, "visionChat");
  }
  const json = await res.json();
  /*
   * Deliberately NOT run through `normalizeDashes`, unlike every other model
   * output in this file. This is OCR: the value is a transcription of what is
   * physically printed on a label, a warning plate or a sign. If the sign says
   * it with a long dash, the extracted text has to say it the same way, or the
   * feature is quietly rewriting evidence. The house style governs prose we
   * author, not text we copy off an object in a photograph.
   */
  const text = (json.choices?.[0]?.message?.content ?? "").trim();
  return { text };
}
