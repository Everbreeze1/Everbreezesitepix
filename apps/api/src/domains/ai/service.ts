import { cleanCaption } from "@sitepix/shared";
import { chatEndpoint } from "../../lib/ai-provider";
import type { AuthedContext } from "../../lib/user-context";

const VISION_MODEL = "google/gemini-2.5-pro";
const CHAT_MODEL = "google/gemini-2.5-pro";
const AUTO_REPORT_OWNER_EMAILS = new Set(["ajmalllo@icloud.com"]);

function aiKeyConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

const analysisTool = {
  type: "function" as const,
  function: {
    name: "report_site_analysis",
    description: "Return a structured site photo analysis for a construction/trades inspection.",
    parameters: {
      type: "object",
      properties: {
        brand: { type: "string", description: "Manufacturer / brand printed on the equipment, if visible. Empty string if none." },
        model_number: { type: "string", description: "Model number printed on the equipment, if visible. Empty string if none." },
        serial_number: { type: "string", description: "Serial number printed on the equipment, if visible. Empty string if none." },
        ocr_text: { type: "string", description: "All other readable text in the image (labels, warnings, signs). Empty string if none." },
        labels: { type: "array", items: { type: "string" }, description: "High-level scene labels (e.g. roof, HVAC unit, electrical panel)." },
        defects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "e.g. crack, leak, corrosion, wear, misalignment, missing_part, damage" },
              severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
              location: { type: "string", description: "Where in the image / on the equipment." },
              description: { type: "string" },
            },
            required: ["type", "severity", "description"],
            additionalProperties: false,
          },
        },
        report_text: { type: "string", description: "1-3 paragraph field inspection report in plain English." },
        recommendations: { type: "array", items: { type: "string" }, description: "Actionable next steps for the field worker." },
      },
      required: ["ocr_text", "labels", "defects", "report_text", "recommendations"],
      additionalProperties: false,
    },
  },
};

export async function analyzePhotoService(ctx: AuthedContext, data: { photoId: string }) {
  const { supabase, userId } = ctx;
  if (!aiKeyConfigured()) throw new Error("AI is not configured (set GEMINI_API_KEY)");

  const { data: photo, error: photoErr } = await supabase
    .from("photos")
    .select("id, storage_path, project_id")
    .eq("id", data.photoId)
    .single();
  if (photoErr || !photo) throw new Error("Photo not found");

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("status, current_period_end, price_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const isActive =
    sub &&
    (
      (["active", "trialing", "past_due"].includes(sub.status) &&
        (!sub.current_period_end || new Date(sub.current_period_end).getTime() > Date.now())) ||
      (sub.status === "canceled" && !!sub.current_period_end && new Date(sub.current_period_end).getTime() > Date.now())
    );
  if (!isActive) {
    throw new Error(
      "AI photo analysis requires a paid plan. Start your 14-day free trial or upgrade to Starter or Team — both include unlimited AI scans.",
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
    const res = await fetch(ep.url, {
      method: "POST",
      headers: ep.headers,
      body: JSON.stringify({
        model: ep.model,
        messages: [
          {
            role: "system",
            content:
              "You are an expert construction/trades field inspector (electrical, HVAC, plumbing, roofing, structural). For the attached job-site photo: (1) extract the equipment BRAND, MODEL NUMBER and SERIAL NUMBER exactly as printed (leave empty if not visible — never guess); (2) capture any other readable text/labels/warnings into ocr_text; (3) identify visible defects (cracks, leaks, corrosion, wear, misalignment, missing parts, physical damage) with severity; (4) write a clear, safety-first field report; and (5) recommend practical next actions. Always call the report_site_analysis tool — never reply with free-form text.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this job site photo. Extract brand/model/serial, list defects, and recommend next steps." },
              { type: "image_url", image_url: { url: signed.signedUrl } },
            ],
          },
        ],
        tools: [analysisTool],
        tool_choice: { type: "function", function: { name: "report_site_analysis" } },
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`AI gateway error ${res.status}: ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) throw new Error("AI did not return structured analysis");
    const parsed = JSON.parse(call.function.arguments);

    const idLines: string[] = [];
    if (parsed.brand) idLines.push(`Brand: ${parsed.brand}`);
    if (parsed.model_number) idLines.push(`Model: ${parsed.model_number}`);
    if (parsed.serial_number) idLines.push(`Serial: ${parsed.serial_number}`);
    const ocrCombined = [idLines.join("\n"), parsed.ocr_text ?? ""].filter(Boolean).join("\n\n").trim();

    await supabase
      .from("ai_analyses")
      .update({
        status: "completed",
        ocr_text: ocrCombined || null,
        labels: parsed.labels ?? [],
        defects: parsed.defects ?? [],
        report_text: parsed.report_text ?? null,
        recommendations: parsed.recommendations ?? [],
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
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const subActive =
      sub &&
      ["active", "trialing", "past_due"].includes(sub.status) &&
      (!sub.current_period_end || new Date(sub.current_period_end).getTime() > Date.now());
    if (!subActive) {
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
    "You are SitePix AI, an expert professional field supervisor with 15+ years of experience in construction, HVAC, electrical, and general contracting. Your tone is direct, confident, helpful, and concise. Speak in short, punchy sentences optimized for natural speech narration. Be practical, solution-focused, and encouraging without being overly wordy. Always prioritize clarity and actionable advice. When a photo is attached, briefly note what you see before advising. Avoid filler like \"As an AI…\" or \"Great question!\". CRITICAL LENGTH RULE: keep every reply to 350 characters or fewer (roughly 2–4 short sentences). Only exceed this when the user explicitly asks for a detailed report or full write-up.";

  const lastUserContent: unknown = imageUrl
    ? [
        { type: "text", text: data.message + ocrContext },
        { type: "image_url", image_url: { url: imageUrl } },
      ]
    : data.message + ocrContext;

  const messages = [
    { role: "system", content: systemPrompt },
    ...(history ?? []).slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: lastUserContent },
  ];

  const ep = chatEndpoint(CHAT_MODEL);
  const res = await fetch(ep.url, {
    method: "POST",
    headers: ep.headers,
    body: JSON.stringify({ model: ep.model, messages }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) throw new Error("Rate limited. Try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
    throw new Error(`AI error ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const reply = json.choices?.[0]?.message?.content ?? "";

  await supabase.from("messages").insert({
    conversation_id: convId,
    user_id: userId,
    role: "assistant",
    content: reply,
  });

  return { conversationId: convId, reply };
}

async function requireActiveSub(supabase: AuthedContext["supabase"], userId: string, email?: unknown) {
  const emailNorm = normalizeEmail(email);
  if (emailNorm && AUTO_REPORT_OWNER_EMAILS.has(emailNorm)) return;

  const { data: isAdmin } = await supabase
    .rpc("has_role" as never, { _user_id: userId, _role: "admin" } as never);
  if (isAdmin) return;

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const active =
    sub &&
    (
      (["active", "trialing", "past_due"].includes(sub.status) &&
        (!sub.current_period_end || new Date(sub.current_period_end).getTime() > Date.now())) ||
      (sub.status === "canceled" && !!sub.current_period_end && new Date(sub.current_period_end).getTime() > Date.now())
    );
  if (!active) throw new Error("Auto-reports require a paid plan. Upgrade to Pro or Team.");
}

export async function summarizePhotosReportService(
  ctx: AuthedContext,
  data: { photoIds: string[]; title?: string },
) {
  const { supabase, userId, claims } = ctx;
  if (!aiKeyConfigured()) throw new Error("AI is not configured");
  await requireActiveSub(supabase, userId, claims?.email);

  const { data: photos } = await supabase
    .from("photos")
    .select("id, caption, taken_at, storage_path, project_id")
    .in("id", data.photoIds);
  if (!photos?.length) throw new Error("No photos found");

  const projectIds = Array.from(new Set((photos as any[]).map((p: any) => p.project_id).filter(Boolean))) as string[];
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, address")
    .in("id", projectIds.length ? projectIds : ["00000000-0000-0000-0000-000000000000"]);
  const projectById = new Map(((projects as any[]) ?? []).map((p: any) => [p.id, p]));

  const { data: analyses } = await supabase
    .from("ai_analyses")
    .select("photo_id, ocr_text, labels, defects, report_text, recommendations")
    .in("photo_id", data.photoIds)
    .eq("status", "completed");
  const analysisByPhoto = new Map(((analyses as any[]) ?? []).map((a: any) => [a.photo_id, a]));

  const photoSummaries = (photos as any[]).map((p: any, i: number) => {
    const a = analysisByPhoto.get(p.id);
    const proj = p.project_id ? projectById.get(p.project_id) : undefined;
    const cap = cleanCaption(p.caption);
    return [
      `Photo ${i + 1}${cap ? ` — ${cap}` : ""}`,
      proj ? `Project: ${proj.name}${proj.address ? ` (${proj.address})` : ""}` : null,
      p.taken_at ? `Taken: ${new Date(p.taken_at).toLocaleString()}` : null,
      a?.report_text ? `Findings: ${a.report_text}` : null,
      a?.defects?.length ? `Defects: ${JSON.stringify(a.defects)}` : null,
      a?.recommendations?.length ? `Recommendations: ${(a.recommendations as string[]).join("; ")}` : null,
      a?.ocr_text ? `Text on equipment: ${a.ocr_text}` : null,
    ].filter(Boolean).join("\n");
  }).join("\n\n---\n\n");

  const ep = chatEndpoint(CHAT_MODEL);
  const res = await fetch(ep.url, {
    method: "POST",
    headers: ep.headers,
    body: JSON.stringify({
      model: ep.model,
      messages: [
        { role: "system", content: "You are SitePix AI, drafting a clean daily SITE LOG from a set of site photos. Your job is to SUMMARIZE what was captured — the photo captions, tags, project context, and any spoken notes — into a clear, professional recap. Structure the Markdown as: # Title, ## Overview (2-3 short sentences describing what the visit covered), ## Photo Notes (bulleted, one bullet per photo, referencing the caption/tag/context factually), ## Notes & Follow-ups (only if the source material explicitly mentions them). STYLE RULES: Keep the tone neutral, factual, and summary-focused — like a site log entry, not an engineering diagnosis. Do NOT call things 'critical', 'code violations', 'safety hazards', or 'severity: high'. Do NOT invent defects, recommendations, or risks. Do NOT add opinions the source material does not state. If prior AI defect/recommendation notes are included, mention them only as brief observations, not as diagnostic conclusions. Use short bullets and clean spacing." },
        { role: "user", content: `${data.title ? `Report title: ${data.title}\n\n` : ""}Photos and context:\n\n${photoSummaries}` },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) throw new Error("Rate limited. Try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted.");
    throw new Error(`AI error ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const markdown = json.choices?.[0]?.message?.content ?? "";
  return { markdown, photoCount: photos.length };
}

export async function describeSiteLogPhotosService(ctx: AuthedContext, data: { photoIds: string[] }) {
  const { supabase, userId, claims } = ctx;
  if (!aiKeyConfigured()) throw new Error("AI is not configured");
  await requireActiveSub(supabase, userId, claims?.email);

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

  const NEUTRAL = "No descriptive information was provided for this photo. No specific observations or notes available.";

  const signed = await Promise.all((photos as any[]).map(async (p: any) => {
    const caption = cleanCaption(p.caption);
    const tags = tagsByPhoto.get(p.id) ?? [];
    const hasContext = !!caption || tags.length > 0;
    if (!hasContext) return { id: p.id, caption: "", tags, url: null as string | null, skip: true };
    const { data: s } = await supabase.storage
      .from("site-photos")
      .createSignedUrl(p.storage_path, 900);
    return { id: p.id, caption, tags, url: s?.signedUrl ?? null, skip: false };
  }));

  const ep = chatEndpoint(CHAT_MODEL);
  const results = await Promise.all(signed.map(async (item, i) => {
    if (item.skip || !item.url) return [item.id, NEUTRAL] as const;
    try {
      const contextBits: string[] = [];
      if (item.caption) contextBits.push(`caption: ${item.caption}`);
      if (item.tags.length) contextBits.push(`tags: ${item.tags.join(", ")}`);
      const res = await fetch(ep.url, {
        method: "POST",
        headers: ep.headers,
        body: JSON.stringify({
          model: ep.model,
          messages: [
            { role: "system", content: "You write a concise site-log note for a construction/trades photo, grounded ONLY in the user-provided context (caption, tags, voice notes). Reply with 2-3 short factual sentences that restate/expand the provided context and describe what is plainly visible. Neutral tone. Do NOT invent defects, risks, code issues, or recommendations the user did not mention. No headings, no bullets, no markdown, no disclaimers." },
            { role: "user", content: [
              { type: "text", text: `Photo ${i + 1} — user context: ${contextBits.join(" | ")}. Write the site-log note.` },
              { type: "image_url", image_url: { url: item.url } },
            ] },
          ],
        }),
      });
      if (!res.ok) return [item.id, NEUTRAL] as const;
      const json = await res.json();
      const text = (json.choices?.[0]?.message?.content ?? "").trim();
      return [item.id, text || NEUTRAL] as const;
    } catch {
      return [item.id, NEUTRAL] as const;
    }
  }));

  const notes: Record<string, string> = {};
  for (const [id, text] of results) notes[id] = text;
  return { notes };
}

export async function summarizeWalkthroughsReportService(
  ctx: AuthedContext,
  data: { walkthroughIds: string[]; title?: string },
) {
  const { supabase, userId, claims } = ctx;
  if (!aiKeyConfigured()) throw new Error("AI is not configured");
  await requireActiveSub(supabase, userId, claims?.email);

  const { data: walks } = await supabase
    .from("walkthroughs" as never)
    .select("id, title, transcript, summary_markdown, duration_seconds, started_at, project_id, status, created_by")
    .in("id", data.walkthroughIds);
  const mine = (walks ?? []).filter((w: { created_by: string }) => w.created_by === userId);
  if (!mine.length) throw new Error("No walkthroughs found");

  const projectIds = Array.from(new Set(mine.map((w: any) => w.project_id).filter(Boolean)));
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .in("id", projectIds.length ? (projectIds as string[]) : ["00000000-0000-0000-0000-000000000000"]);
  const projectById = new Map(((projects as any[]) ?? []).map((p: any) => [p.id, p]));

  const blocks = mine.map((w: any, i: number) => {
    const proj = w.project_id ? projectById.get(w.project_id) : undefined;
    return [
      `Walkthrough ${i + 1}: ${w.title ?? "Untitled"}`,
      proj ? `Project: ${proj.name}` : null,
      w.started_at ? `Date: ${new Date(w.started_at).toLocaleString()}` : null,
      w.duration_seconds ? `Duration: ${Math.round(w.duration_seconds / 60)} min` : null,
      w.summary_markdown ? `Prior summary:\n${w.summary_markdown}` : null,
      w.transcript ? `Transcript:\n${String(w.transcript).slice(0, 6000)}` : null,
    ].filter(Boolean).join("\n");
  }).join("\n\n===\n\n");

  const ep = chatEndpoint(CHAT_MODEL);
  const res = await fetch(ep.url, {
    method: "POST",
    headers: ep.headers,
    body: JSON.stringify({
      model: ep.model,
      messages: [
        { role: "system", content: "You are SitePix AI, summarizing one or more site walkthroughs into a clean recap — like a site log, not an engineering diagnosis. Structure the Markdown as: # Title, ## Summary (2-3 sentences describing what was walked), ## Highlights (bulleted list summarizing what the technician described, grouped by area/topic when natural), ## Follow-ups (only if the source material explicitly mentions them). STYLE RULES: Neutral, factual, summary-focused. Do NOT use language like 'critical', 'code violation', 'safety hazard', 'severity: high', or strong diagnostic opinions unless the speaker explicitly used those words. Do NOT invent findings, risks, or recommendations. Base every bullet on what is actually in the transcripts and prior summaries. Prefer short bullets and clean spacing over long paragraphs." },
        { role: "user", content: `${data.title ? `Report title: ${data.title}\n\n` : ""}Walkthroughs:\n\n${blocks}` },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) throw new Error("Rate limited. Try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted.");
    throw new Error(`AI error ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const markdown = json.choices?.[0]?.message?.content ?? "";
  return { markdown, walkthroughCount: mine.length };
}

export async function extractPhotoTextService(ctx: AuthedContext, data: { photoId: string }) {
  const { supabase } = ctx;
  if (!aiKeyConfigured()) throw new Error("AI is not configured");

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
  const res = await fetch(ep.url, {
    method: "POST",
    headers: ep.headers,
    body: JSON.stringify({
      model: ep.model,
      messages: [
        {
          role: "system",
          content:
            "You are an OCR engine. Extract ALL readable text from the image exactly as printed — labels, warnings, model numbers, handwriting, signage. Preserve line breaks. Do NOT add commentary, headings, translations, or explanations. If there is no readable text, reply with exactly: (no text found).",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract every readable piece of text from this photo." },
            { type: "image_url", image_url: { url: signed.signedUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) throw new Error("Rate limited. Try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted.");
    throw new Error(`AI error ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const text = (json.choices?.[0]?.message?.content ?? "").trim();
  return { text };
}
