import { z } from "zod";
import { chatEndpoint, transcriptionEndpoint } from "../../lib/ai-provider";
import { getSupabaseAdmin } from "../../lib/supabase";
import type { AuthedContext } from "../../lib/user-context";
import { summarizePhotosReportService } from "../ai/service";
import {
  assertAutoReportAllowed,
  releaseAutoReport,
  reserveAutoReport,
} from "./auto-report-quota";
import {
  MAX_AUTO_REPORT_PHOTO_SECTIONS,
  consolidateReportSections,
  normalizeDashesTrimmed,
} from "@sitepix/shared";


const MODEL = "google/gemini-2.5-flash";
const TRANSCRIPTION_MODEL = "openai/gpt-4o-mini-transcribe";

const generateSchema = z.object({
  walkthroughId: z.string().uuid(),
});

const createSessionSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(160),
});

const listProjectSchema = z.object({
  projectId: z.string().uuid(),
});

const saveWalkthroughPhotoSchema = z.object({
  projectId: z.string().uuid(),
  walkthroughId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  /** Pre-generated thumbnail beside the original; null when generation failed. */
  thumbPath: z.string().min(1).max(600).nullable().optional(),
  sizeBytes: z.number().int().nonnegative(),
  caption: z.string().min(1).max(255),
  offsetSeconds: z.number().int().nonnegative().default(0),
  position: z.number().int().nonnegative().default(0),
  takenAt: z.string().min(1),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});

const ensurePhotoLinksSchema = z.object({
  walkthroughId: z.string().uuid(),
  photos: z.array(z.object({
    photoId: z.string().uuid(),
    offsetSeconds: z.number().int().nonnegative().default(0),
    position: z.number().int().nonnegative().default(0),
  })).max(200),
});

const finishSessionSchema = z.object({
  walkthroughId: z.string().uuid(),
  durationSeconds: z.number().int().positive(),
  liveTranscript: z.string().max(100_000).optional(),
});

const videoPathSchema = z.object({
  walkthroughId: z.string().uuid(),
  videoPath: z.string().min(1).max(500),
  videoMimeType: z.string().min(1).max(100),
});

const statusSchema = z.object({
  walkthroughId: z.string().uuid(),
  status: z.enum(["recording", "generating", "ready", "failed"]),
});

/**
 * A Summary is a walkthrough with no walk: the AI writes a short recap from
 * photos the user picks out of the gallery. Bounds mirror the picker
 * (SelectPhotosForPageDialog's MAX_PHOTOS = 50) and the recorded-session title
 * bound (160).
 *
 * Unlike the schemas above - which are vestigial, since validation for the
 * recorded-walkthrough ops lives inline in registry.ts - these two are
 * exported and parsed by the registry, matching the projects/pages and
 * blueprints convention rather than perpetuating the duplicated one.
 */
export const generateWalkthroughSummaryInputSchema = z.object({
  projectId: z.string().uuid(),
  photoIds: z.array(z.string().uuid()).min(1).max(50),
  title: z.string().trim().min(1).max(160).optional(),
});

export const regenerateWalkthroughSummaryInputSchema = z.object({
  walkthroughId: z.string().uuid(),
});

function fmtDuration(s: number) {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.max(0, s) % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/**
 * Break a raw transcript (a single wall-of-text string) into readable
 * paragraphs of ~3 sentences. Keeps the speaker's wording verbatim but stops
 * the fallback report from rendering as one giant blob of text.
 */
function paragraphizeTranscript(transcript: string, sentencesPerParagraph = 3) {
  const cleaned = (transcript ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const sentences = cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“‘(])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return cleaned;
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += sentencesPerParagraph) {
    paragraphs.push(sentences.slice(i, i + sentencesPerParagraph).join(" "));
  }
  return paragraphs.join("\n\n");
}

function buildFallbackWalkthroughMarkdown(args: {
  title: string | null;
  transcript: string | null;
  durationSeconds: number;
  links: Array<{ photo_id: string; offset_seconds: number | null; spoken_note: string | null; position: number | null }>;
}) {
  const title = (args.title ?? "Walkthrough Note").trim() || "Walkthrough Note";
  const transcript = paragraphizeTranscript(args.transcript ?? "");
  const lines: string[] = [`# ${title}`];

  if (transcript) {
    lines.push("", "## Summary", "", transcript);
  }

  if (args.links.length) {
    lines.push("", "## Photos");
    for (const [idx, link] of args.links.entries()) {
      const n = idx + 1;
      const ts = fmtDuration(link.offset_seconds ?? 0);
      lines.push("", `### Photo ${n} · ${ts}`, "", `![Photo ${n}](photo:${link.photo_id})`);
      if (link.spoken_note?.trim()) lines.push("", `*"${link.spoken_note.trim().replace(/"/g, '\\"')}"*`);
    }
  }

  if (!transcript && !args.links.length) {
    lines.push("", "## Notes", "", "Recording saved. No transcript or walkthrough photos were captured.");
  }

  lines.push("", `_Duration: ${fmtDuration(args.durationSeconds)}._`);
  return lines.join("\n").trim();
}

/**
 * A caption that is really just the uploaded filename, so it should never be
 * shown as prose. Mirrors looksLikeFilename() in public-pdf.ts, which guards
 * the same content on the PDF's photo pages.
 */
function looksLikeFilenameCaption(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(t)
    || /^(?:walkthrough|photo|img|image|dsc|screenshot)[-_ ]?\d/i.test(t)
    || /^https?:\/\//i.test(t);
}

/**
 * Draft the markdown body for a Summary walkthrough.
 *
 * The AI call is best-effort in exactly one direction: a transport or model
 * failure degrades to a deterministic photo gallery, but a plan refusal is
 * rethrown. generateProjectPageService swallows both and hands an unentitled
 * user an empty page; here that would mean writing a row into a table the user
 * could not otherwise write to, so it is refused instead.
 */
async function composeSummaryMarkdown(
  ctx: AuthedContext,
  args: { title: string; photos: Array<{ id: string; caption: string | null }> },
): Promise<{ markdown: string; aiFailed: string | null }> {
  let body = "";
  let aiFailed: string | null = null;
  try {
    const res = await summarizePhotosReportService(ctx, {
      photoIds: args.photos.map((p) => p.id),
      title: args.title,
      mode: "summary",
    });
    // SUMMARY_SYSTEM is told not to emit a title; strip one defensively, since
    // the H1 below is the one the rest of the app reads.
    body = (res.markdown ?? "").replace(/^#\s+.*$/m, "").trim();
  } catch (e: any) {
    // 403 is requireActiveSub refusing an inactive plan - that must not
    // silently produce a walkthrough row.
    if (e?.status === 403) throw e;
    aiFailed = e?.message ?? "AI unavailable";
    // The row still saves with a deterministic fallback body, so without this
    // the server logs a clean "summary saved" and the only trace of the AI
    // having failed is a toast the user has already dismissed.
    console.error("[walkthrough] server summary AI draft failed", {
      status: e?.status,
      message: aiFailed,
      photos: args.photos.length,
    });
  }

  const lines: string[] = [`# ${args.title}`];
  lines.push("", body || "## Overview\n\nSummary of the selected site photos.");

  // `photo:<id>` refs are how WalkthroughMarkdown resolves images and how the
  // public PDF finds them. cleanWalkthroughMarkdown strips this trailing
  // section on the detail and share pages so WalkthroughPhotoSteps owns the
  // gallery there - it exists for the PDF and for raw-markdown consumers.
  lines.push("", "## Photos");
  args.photos.forEach((p, i) => {
    lines.push("", `### Photo ${i + 1}`, "", `![Photo ${i + 1}](photo:${p.id})`);
    // Only real captions. An unedited upload's caption is its filename, and the
    // PDF's cover-summary extractor pulls running prose out of this markdown -
    // so "1 (9).jpg" would be printed as a sentence on a client-facing cover.
    // Same rule the PDF's own photo pages apply via looksLikeFilename().
    const caption = p.caption?.trim();
    if (caption && !looksLikeFilenameCaption(caption)) lines.push("", `*${caption}*`);
  });

  return { markdown: lines.join("\n").trim(), aiFailed };
}

async function readWalkthroughLinks(supabaseAdmin: any, walkthroughId: string) {
  const { data: links, error } = await supabaseAdmin
    .from("walkthrough_photos" as any)
    .select("photo_id, offset_seconds, spoken_note, position")
    .eq("walkthrough_id", walkthroughId)
    .order("position", { ascending: true });
  if (error) {
    console.error("[walkthrough] server link read failed", error, { walkthroughId });
    return [] as Array<{ photo_id: string; offset_seconds: number | null; spoken_note: string | null; position: number | null }>;
  }
  return ((links as any[]) ?? []) as Array<{ photo_id: string; offset_seconds: number | null; spoken_note: string | null; position: number | null }>;
}

function extractWalkthroughIdFromPath(path: string | null | undefined) {
  const match = (path ?? "").match(/\/walkthroughs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|\.|$)/i);
  return match?.[1] ?? null;
}

/*
 * Which photos the two recovery scans are allowed to adopt into a walkthrough.
 *
 * The SQL half is a coarse prefilter - PostgREST's `or` takes bare operators,
 * so it cannot express the caption rule below and would need a third round trip
 * to try. The JS half is the actual rule; run it on everything the scan returns.
 *
 * The `caption.like.walkthrough-%` arm is the dangerous one: caption is a
 * user-editable field, an unedited upload's caption is its filename, and a
 * prefix match therefore swept up a photo the user shot with the camera and
 * named "walkthrough-front-door.jpg". That photo was adopted into a fabricated
 * walkthrough and relabelled a capture frame, neither of which is reversible.
 *
 * The arm still earns its place - a capture uploaded before the
 * `/walkthroughs/{id}/` path convention has no other signal - so it is narrowed
 * to the exact name the recorder generates rather than dropped:
 * `walkthrough-${Date.now()}.jpg`, from WalkthroughRecorder's capturePhoto.
 */
const WALKTHROUGH_CANDIDATE_SCAN =
  "phase.eq.walkthrough,caption.like.walkthrough-%,storage_path.like.%/walkthroughs/%";

const RECORDER_FILENAME_CAPTION = /^walkthrough-\d{10,}\.[a-z0-9]+$/i;

function isWalkthroughCapture(photo: {
  phase?: string | null;
  storage_path?: string | null;
  caption?: string | null;
}) {
  return (
    photo.phase === "walkthrough" ||
    (photo.storage_path ?? "").includes("/walkthroughs/") ||
    RECORDER_FILENAME_CAPTION.test(photo.caption ?? "")
  );
}

async function recoverOrphanWalkthroughPhotosForProject(supabaseAdmin: any, args: { projectId: string; userId: string }) {
  console.log("[walkthrough] server orphan recovery requested", args);
  const { data: candidates, error: candidateErr } = await supabaseAdmin
    .from("photos")
    .select("id, created_at, taken_at, caption, storage_path, phase")
    .eq("project_id", args.projectId)
    .eq("uploaded_by", args.userId)
    .or(WALKTHROUGH_CANDIDATE_SCAN)
    .order("created_at", { ascending: true })
    .limit(250);

  if (candidateErr) {
    console.error("[walkthrough] server orphan recovery scan failed", candidateErr, args);
    return { recoveredWalkthroughs: 0, recoveredPhotos: 0 };
  }

  const allCandidateRows = ((candidates as any[]) ?? []) as Array<{
    id: string;
    created_at: string;
    taken_at: string | null;
    caption: string | null;
    storage_path: string | null;
    phase: string | null;
  }>;

  // See WALKTHROUGH_CANDIDATE_SCAN - the query is a prefilter, this is the rule.
  const candidateRows = allCandidateRows.filter(isWalkthroughCapture);
  if (candidateRows.length !== allCandidateRows.length) {
    console.log("[walkthrough] server orphan recovery ignored non-capture matches", {
      ...args,
      ignored: allCandidateRows.length - candidateRows.length,
    });
  }
  if (!candidateRows.length) return { recoveredWalkthroughs: 0, recoveredPhotos: 0 };

  const candidateIds = candidateRows.map((p) => p.id);
  const { data: existingLinks, error: existingErr } = await supabaseAdmin
    .from("walkthrough_photos" as any)
    .select("photo_id")
    .in("photo_id", candidateIds);
  if (existingErr) {
    console.error("[walkthrough] server orphan recovery existing-link scan failed", existingErr, args);
    return { recoveredWalkthroughs: 0, recoveredPhotos: 0 };
  }

  const linkedIds = new Set(((existingLinks as any[]) ?? []).map((l) => l.photo_id));
  const orphans = candidateRows.filter((p) => !linkedIds.has(p.id));
  if (!orphans.length) return { recoveredWalkthroughs: 0, recoveredPhotos: 0 };

  const groups: Array<{ forcedId: string | null; photos: typeof orphans }> = [];
  for (const photo of orphans) {
    const forcedId = extractWalkthroughIdFromPath(photo.storage_path);
    const createdMs = new Date(photo.created_at).getTime();
    const last = groups[groups.length - 1];
    const lastPhoto = last?.photos[last.photos.length - 1];
    const lastMs = lastPhoto ? new Date(lastPhoto.created_at).getTime() : 0;
    const sameForcedId = !!forcedId && last?.forcedId === forcedId;
    const sameTimedSession = !forcedId && !last?.forcedId && lastPhoto && Number.isFinite(createdMs) && Number.isFinite(lastMs) && createdMs - lastMs <= 10 * 60 * 1000;
    if (last && (sameForcedId || sameTimedSession)) {
      last.photos.push(photo);
    } else {
      groups.push({ forcedId, photos: [photo] });
    }
  }

  let recoveredWalkthroughs = 0;
  let recoveredPhotos = 0;
  for (const group of groups) {
    const first = group.photos[0];
    const last = group.photos[group.photos.length - 1];
    const startedAt = first.taken_at ?? first.created_at;
    const endedAt = last.taken_at ?? last.created_at;
    const startMs = new Date(startedAt).getTime();
    const endMs = new Date(endedAt).getTime();
    const durationSeconds = Math.max(1, Math.round(((Number.isFinite(endMs) ? endMs : Date.now()) - (Number.isFinite(startMs) ? startMs : Date.now())) / 1000));
    let walkthroughId = group.forcedId;
    const title = `Recovered Walkthrough - ${new Date(startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

    if (walkthroughId) {
      const { data: existing } = await supabaseAdmin
        .from("walkthroughs" as any)
        .select("id")
        .eq("id", walkthroughId)
        .maybeSingle();
      if (!existing) {
        const { error: insertForcedErr } = await supabaseAdmin
          .from("walkthroughs" as any)
          .insert({
            id: walkthroughId,
            project_id: args.projectId,
            created_by: args.userId,
            title,
            status: "ready",
            started_at: startedAt,
            ended_at: endedAt,
            duration_seconds: durationSeconds,
          } as any);
        if (insertForcedErr) {
          console.error("[walkthrough] server orphan recovery forced-row insert failed", insertForcedErr, { ...args, walkthroughId });
          walkthroughId = null;
        }
      }
    }

    if (!walkthroughId) {
      const { data: created, error: createErr } = await supabaseAdmin
        .from("walkthroughs" as any)
        .insert({
          project_id: args.projectId,
          created_by: args.userId,
          title,
          status: "ready",
          started_at: startedAt,
          ended_at: endedAt,
          duration_seconds: durationSeconds,
        } as any)
        .select("id")
        .single();
      if (createErr || !created) {
        console.error("[walkthrough] server orphan recovery row insert failed", createErr, args);
        continue;
      }
      walkthroughId = (created as any).id as string;
    }

    const linkRows = group.photos.map((photo, position) => ({
      walkthrough_id: walkthroughId,
      photo_id: photo.id,
      created_by: args.userId,
      offset_seconds: Math.max(0, Math.round((new Date(photo.taken_at ?? photo.created_at).getTime() - (Number.isFinite(startMs) ? startMs : new Date(photo.created_at).getTime())) / 1000)),
      spoken_note: null,
      position,
    }));
    const { error: linkErr } = await supabaseAdmin
      .from("walkthrough_photos" as any)
      .upsert(linkRows as any, { onConflict: "walkthrough_id,photo_id", ignoreDuplicates: true });
    if (linkErr) {
      console.error("[walkthrough] server orphan recovery link failed", linkErr, { ...args, walkthroughId, count: linkRows.length });
      continue;
    }

    await supabaseAdmin
      .from("photos")
      .update({ phase: "walkthrough" } as any)
      .in("id", group.photos.map((p) => p.id));

    const fallbackMarkdown = buildFallbackWalkthroughMarkdown({
      title,
      transcript: null,
      durationSeconds,
      links: linkRows.map((row) => ({
        photo_id: row.photo_id,
        offset_seconds: row.offset_seconds,
        spoken_note: null,
        position: row.position,
      })),
    });
    await supabaseAdmin
      .from("walkthroughs" as any)
      .update({ status: "ready", summary_markdown: fallbackMarkdown, duration_seconds: durationSeconds, ended_at: endedAt } as any)
      .eq("id", walkthroughId);

    recoveredWalkthroughs += 1;
    recoveredPhotos += group.photos.length;
    console.log("[walkthrough] server orphan recovery linked photos", { ...args, walkthroughId, count: group.photos.length });
  }

  if (recoveredPhotos > 0) {
    console.log("[walkthrough] server orphan recovery complete", { ...args, recoveredWalkthroughs, recoveredPhotos });
  }
  return { recoveredWalkthroughs, recoveredPhotos };
}












// ---------------------------------------------------------------------------
// Automatic Walkthrough → Project Report
//
// After transcription + summary_markdown are ready, turn the raw transcript
// and captured photos into a full structured entry in `project_reports` +
// `project_report_sections` so the user immediately has a polished, PDF-ready
// report inside the Documents / Reports section for that project.
// ---------------------------------------------------------------------------

export const createReportFromWalkInputSchema = z.object({
  walkthroughId: z.string().uuid(),
  /**
   * Page density for the generated report. Optional because the auto-report
   * runs unattended at the end of a walkthrough, with no dialog to ask in - the
   * caller passes the author's saved default and the server falls back to
   * `profiles.report_photos_per_page` when it does not.
   */
  photosPerPage: z.number().int().min(1).max(4).optional(),
});

function escapeHtml(str: string) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToHtmlParagraphs(text: string) {
  const t = (text ?? "").trim();
  if (!t) return "";
  return t
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

interface AiReportSection { title: string; body: string; photo_indices: number[] }
interface AiReportShape {
  title: string;
  subtitle: string;
  introduction: string;
  sections: AiReportSection[];
  conclusion: string;
}

function buildFallbackAiReport(args: {
  walkTitle: string;
  projectName: string | null;
  transcript: string;
  photoCount: number;
}): AiReportShape {
  const dateStr = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const title = args.walkTitle?.trim() || `${args.projectName ?? "Site"} Walkthrough Report - ${dateStr}`;
  const subtitle = args.projectName ? `${args.projectName} - Field walkthrough summary` : "Field walkthrough summary";
  const intro = args.transcript.trim()
    ? `<p>This report summarizes a recorded site walkthrough${args.projectName ? ` at ${escapeHtml(args.projectName)}` : ""}. It includes the technician's spoken narration organized into readable notes, along with ${args.photoCount} photo(s) captured during the walk.</p>`
    : `<p>This report summarizes a recorded site walkthrough${args.projectName ? ` at ${escapeHtml(args.projectName)}` : ""}. ${args.photoCount} photo(s) were captured during the walk.</p>`;
  const notesHtml = textToHtmlParagraphs(paragraphizeTranscript(args.transcript || ""));
  const sections: AiReportSection[] = [];
  if (notesHtml) sections.push({ title: "Field Notes", body: notesHtml, photo_indices: [] });
  const conclusion = `<p>End of walkthrough. Refer to the attached photos for visual context.</p>`;
  return { title, subtitle, introduction: intro, sections, conclusion };
}

/** One captured photo, as the prompt describes it to the model. */
export interface AutoReportPromptPhoto {
  index: number;
  offset: number;
  spoken_note: string;
  caption: string | null;
}

/**
 * The Auto Report prompt.
 *
 * Pulled out of the service so it can be exercised without a database, a
 * walkthrough row or a signed-in user - `scripts/check-auto-report-prompt.mjs`
 * runs this exact text against the real model. A prompt that can only be tested
 * by recording a walkthrough in production is a prompt nobody tests.
 *
 * `maxPhotoSections` and the per-section minimum are given to the model as
 * arithmetic rather than as a vague "group things", because one heading per
 * photo is its default instinct and that is precisely what paginates into one
 * photo per page. consolidateReportSections enforces the same numbers
 * afterwards for the runs where it does not comply.
 */
export function buildAutoReportPrompt(args: {
  projectName: string | null;
  walkTitle: string | null;
  durationSeconds: number;
  transcript: string;
  photos: AutoReportPromptPhoto[];
  photosPerPage: 1 | 2 | 3 | 4;
  maxPhotoSections: number;
}): string {
  const photoLines = args.photos
    .map(
      (p) =>
        `- Photo index ${p.index} - captured at ${fmtDuration(p.offset)}${p.spoken_note ? ` - spoken: "${p.spoken_note.replace(/"/g, '\\"')}"` : ""}${p.caption ? ` - existing caption: ${p.caption}` : ""}`,
    )
    .join("\n");
  const minPhotosPerSection = Math.min(args.photos.length, args.photosPerPage);

  return `You are drafting a formal, client-facing site REPORT from a recorded walkthrough. It is a deliverable the client receives, so it reads as a document, not as a running commentary on each photo.

Project: ${args.projectName ?? "(unspecified)"}
Walkthrough title: ${args.walkTitle ?? "Untitled walkthrough"}
Duration: ${fmtDuration(args.durationSeconds)}
Photos captured: ${args.photos.length}

VOICE:
- Complete, professional prose in the introduction and conclusion. No bullets there.
- Section bodies: short prose, or tight bullets (<ul><li>) where the speaker genuinely listed things. Never a caption-by-caption walk through the photos - the photos carry their own captions.
- Neutral and factual. Do NOT call anything "critical", a "code violation", a "safety hazard" or "severity: high" unless the speaker used those words. Do NOT invent defects, measurements, brands, risks, recommendations or next steps. If the source material is thin, keep it short rather than padding it.
- Base every sentence on the spoken transcript and the spoken notes tied to each photo.

STRUCTURE (this is what decides how the PDF paginates - follow it exactly):
- Produce AT MOST ${args.maxPhotoSections} section(s) that carry photos. Group them the way the walk actually divided up: by area, elevation, trade or stage. Do NOT create a section per photo.
- Every section carrying photos must carry at least ${minPhotosPerSection} of them, unless there are not that many photos left to give it.
- You may add at most one further section with no photos at all if the speaker covered something that has no picture.
- Section headings are short noun phrases: "Roof and flashings", "Interior - second floor", "Work completed". Not sentences.

OUTPUT:
- Valid JSON matching the schema below. No markdown fences, no commentary.
- Body fields are safe HTML using only these tags: <p>, <br/>, <strong>, <em>, <ul>, <ol>, <li>, <h3>. No inline styles, no other tags.
- Assign photos by integer index (0..${Math.max(0, args.photos.length - 1)}) in "photo_indices". Each index may appear in at most one section. Anything left unassigned is appended as a final gallery.

Return JSON:
{
  "title": "short, descriptive report title based on project and date",
  "subtitle": "one-sentence subtitle",
  "introduction": "<p>2-4 sentences of prose: what was walked, why, and what this report documents</p>",
  "sections": [
    { "title": "Section heading", "body": "<p>...</p>", "photo_indices": [0,1,2,3] }
  ],
  "conclusion": "<p>2-3 sentences closing out what the documentation shows overall, plus any next steps the speaker actually stated.</p>"
}

Available photos:
${photoLines || "(none)"}

Raw spoken transcript:
"""
${args.transcript || "(no speech captured)"}
"""

If the transcript is empty, still produce valid JSON: an introduction stating plainly that the walk was recorded without narration, a single section titled "Captured photos" with an empty body and photo_indices listing every photo in order, and a one-sentence conclusion. Invent nothing.`;
}

/** The system message that pairs with `buildAutoReportPrompt`. */
export const AUTO_REPORT_SYSTEM_PROMPT =
  "You are SitePix AI drafting a formal, client-facing site report. You output only valid JSON that matches the requested schema, never commentary outside the JSON. You write in neutral, factual, professional prose, you base every sentence on the provided transcript and spoken notes, and you never invent facts, findings, risks or recommendations. You group photos into a small number of themed sections rather than giving each photo its own heading.";

/**
 * Page density for a generated report: what the caller asked for, else the
 * author's saved default, else two per page.
 *
 * Read with the service role because the auto-report runs on a request that has
 * already been authenticated - and because a missing or unreadable preference
 * must degrade to the default rather than fail a report the user is waiting on.
 */
async function resolveReportPhotosPerPage(
  userId: string,
  requested: number | undefined,
): Promise<1 | 2 | 3 | 4> {
  const clamp = (n: number) => Math.min(4, Math.max(1, Math.round(n))) as 1 | 2 | 3 | 4;
  if (typeof requested === "number" && Number.isFinite(requested)) return clamp(requested);
  try {
    const { data: prof } = await getSupabaseAdmin()
      .from("profiles")
      .select("report_photos_per_page")
      .eq("id", userId)
      .maybeSingle();
    const saved = (prof as any)?.report_photos_per_page;
    if (typeof saved === "number" && Number.isFinite(saved)) return clamp(saved);
  } catch (e) {
    console.warn("[walkthrough→report] could not read report density preference", e, { userId });
  }
  return 2;
}

export async function createWalkthroughSessionService(ctx: AuthedContext, data: any) {
    const { supabase, userId } = ctx;
    console.log("[walkthrough] server create session requested", { projectId: data.projectId, userId });

    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (projectErr || !project) {
      console.error("[walkthrough] server project access check failed", projectErr, { projectId: data.projectId, userId });
      throw new Error("Project not found or access denied");
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: row, error } = await supabaseAdmin
      .from("walkthroughs" as any)
      .insert({
        project_id: data.projectId,
        created_by: userId,
        title: data.title,
        status: "recording",
      } as any)
      .select("id, created_at")
      .single();
    if (error || !row) {
      console.error("[walkthrough] server create session failed", error, { projectId: data.projectId, userId });
      throw new Error(error?.message ?? "Could not create walkthrough");
    }

    console.log("[walkthrough] server session created", { walkthroughId: (row as any).id, projectId: data.projectId, userId });
    return { id: (row as any).id as string, createdAt: (row as any).created_at as string };
  }

/**
 * Create a SUMMARY walkthrough: no video, no narration, no transcript,
 * duration 0, an AI recap in summary_markdown, and the user's chosen photos
 * linked as walkthrough photos.
 *
 * !! DO NOT set photos.phase = "walkthrough" here. !!
 * Every other linker in this file does, because a frame captured *during* a
 * recording is provenance worth recording. A Summary links photos the user
 * shot normally and picked out of the gallery; labelling those as walkthrough
 * captures states something false about where they came from, and nothing in
 * this codebase ever writes phase back, so it is not correctable.
 *
 * `phase` is a label only. It no longer hides a photo from any surface - see
 * the note in ProjectDetailPage's `load`.
 */
export async function generateWalkthroughSummaryService(
  ctx: AuthedContext,
  data: z.infer<typeof generateWalkthroughSummaryInputSchema>,
) {
    const { supabase, userId } = ctx;
    console.log("[walkthrough] server summary requested", {
      projectId: data.projectId,
      userId,
      photos: data.photoIds.length,
    });

    // Access check on the caller's RLS client, same shape as
    // createWalkthroughSessionService.
    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (projectErr || !project) {
      console.error("[walkthrough] server summary project access failed", projectErr, { projectId: data.projectId, userId });
      throw new Error("Project not found or access denied");
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Only photos that really belong to this project and are not trashed.
    // Deliberately NOT filtered by uploaded_by, unlike
    // ensureWalkthroughPhotoLinksService - the picker shows every project
    // photo, so filtering to the caller would silently drop teammates' photos
    // from a summary the user watched themselves select. The project access
    // check above is the authorization.
    const { data: photoRows, error: photoErr } = await supabaseAdmin
      .from("photos")
      .select("id, caption")
      .eq("project_id", data.projectId)
      .is("deleted_at", null)
      .in("id", data.photoIds);
    if (photoErr) {
      console.error("[walkthrough] server summary photo read failed", photoErr, { projectId: data.projectId, userId });
      throw new Error(photoErr.message);
    }
    const byId = new Map(((photoRows as any[]) ?? []).map((p) => [p.id, p]));
    // Preserve the order the user picked them in.
    const photos = data.photoIds
      .map((id) => byId.get(id))
      .filter(Boolean) as Array<{ id: string; caption: string | null }>;
    if (!photos.length) throw new Error("No photos found for this summary");

    const title =
      data.title?.trim() ||
      `Summary - ${new Date().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`;

    const { markdown, aiFailed } = await composeSummaryMarkdown(ctx, { title, photos });

    const nowIso = new Date().toISOString();
    const { data: row, error } = await supabaseAdmin
      .from("walkthroughs" as any)
      .insert({
        project_id: data.projectId,
        created_by: userId,
        title,
        status: "ready",
        source: "summary",
        duration_seconds: 0,
        started_at: nowIso,
        ended_at: nowIso,
        transcript: null,
        summary_markdown: markdown,
        video_path: null,
        video_mime_type: null,
      } as any)
      .select("id, created_at")
      .single();
    if (error || !row) {
      console.error("[walkthrough] server summary insert failed", error, { projectId: data.projectId, userId });
      throw new Error(error?.message ?? "Could not create summary");
    }
    const walkthroughId = (row as any).id as string;

    const linkRows = photos.map((p, i) => ({
      walkthrough_id: walkthroughId,
      photo_id: p.id,
      created_by: userId,
      offset_seconds: 0, // no recording, so no timeline position
      spoken_note: null, // nothing was spoken
      position: i,
    }));
    const { error: linkErr } = await supabaseAdmin
      .from("walkthrough_photos" as any)
      .upsert(linkRows as any, { onConflict: "walkthrough_id,photo_id", ignoreDuplicates: true });
    if (linkErr) {
      // A summary without its photos is a broken object and nothing recovers
      // it - orphan recovery only sweeps phase/path-marked capture frames,
      // which these deliberately are not. Roll the row back rather than leave
      // a husk sitting in the tab.
      console.error("[walkthrough] server summary link failed", linkErr, { walkthroughId, userId });
      await supabaseAdmin.from("walkthroughs" as any).delete().eq("id", walkthroughId);
      throw new Error(linkErr.message);
    }

    console.log("[walkthrough] server summary saved", { walkthroughId, userId, photos: photos.length });
    return { walkthroughId, markdown, aiFailed, photoCount: photos.length };
  }

/**
 * Re-draft an existing summary from the photos already linked to it. Shares
 * composeSummaryMarkdown with creation, and like creation it spends no Auto
 * Report quota - a summary never reserved one.
 */
export async function regenerateWalkthroughSummaryService(
  ctx: AuthedContext,
  data: z.infer<typeof regenerateWalkthroughSummaryInputSchema>,
) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();

    const { data: walk, error: walkErr } = await supabaseAdmin
      .from("walkthroughs" as any)
      .select("id, title, created_by, source")
      .eq("id", data.walkthroughId)
      .maybeSingle();
    if (walkErr || !walk) throw new Error("Walkthrough not found");
    if ((walk as any).created_by !== userId) throw new Error("Not authorized");
    if ((walk as any).source !== "summary") {
      throw new Error("This walkthrough was recorded - use Regenerate report instead.");
    }

    const { data: links } = await supabaseAdmin
      .from("walkthrough_photos" as any)
      .select("photo_id, position")
      .eq("walkthrough_id", data.walkthroughId)
      .order("position", { ascending: true });
    const ids = ((links as any[]) ?? []).map((l) => l.photo_id as string).filter(Boolean);
    if (!ids.length) throw new Error("This summary has no photos");

    const { data: photoRows } = await supabaseAdmin
      .from("photos")
      .select("id, caption")
      .is("deleted_at", null)
      .in("id", ids);
    const byId = new Map(((photoRows as any[]) ?? []).map((p) => [p.id, p]));
    const photos = ids
      .map((id) => byId.get(id))
      .filter(Boolean) as Array<{ id: string; caption: string | null }>;
    if (!photos.length) throw new Error("This summary's photos are no longer available");

    const title = ((walk as any).title as string) || "Summary";
    const { markdown, aiFailed } = await composeSummaryMarkdown(ctx, { title, photos });

    const { error } = await supabaseAdmin
      .from("walkthroughs" as any)
      .update({ summary_markdown: markdown, status: "ready" } as any)
      .eq("id", data.walkthroughId);
    if (error) throw new Error(error.message);

    console.log("[walkthrough] server summary regenerated", { walkthroughId: data.walkthroughId, userId });
    return { markdown, aiFailed };
  }

export async function saveWalkthroughPhotoService(ctx: AuthedContext, data: any) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();
    console.log("[walkthrough] server save photo requested", {
      walkthroughId: data.walkthroughId,
      projectId: data.projectId,
      userId,
      position: data.position,
      offsetSeconds: data.offsetSeconds,
      bytes: data.sizeBytes,
    });

    const { data: walk, error: walkErr } = await supabaseAdmin
      .from("walkthroughs" as any)
      .select("id, project_id, created_by, source")
      .eq("id", data.walkthroughId)
      .maybeSingle();
    if (walkErr || !walk || (walk as any).project_id !== data.projectId || (walk as any).created_by !== userId) {
      console.error("[walkthrough] server save photo unauthorized", walkErr, {
        walkthroughId: data.walkthroughId,
        projectId: data.projectId,
        userId,
      });
      throw new Error("Walkthrough not found or access denied");
    }
    // Capture frames belong to a recording. Accepting one here would attach a
    // phase="walkthrough" photo to a summary, which by definition links photos
    // that were shot outside any recording.
    if ((walk as any).source !== "recorded") {
      throw new Error("This walkthrough is a summary and cannot accept captures");
    }

    /*
     * SECURITY - the storage path is client-supplied and was written verbatim.
     * Every reader signs `photos.storage_path` with the service role, so a row
     * pointing at someone else's object becomes a permanent, renewable read
     * handle for their file. Uploads always land under `{userId}/{projectId}/`
     * (see the client's upload paths), so anything outside that prefix is not
     * this caller's to reference.
     */
    const expectedPrefix = `${userId}/${data.projectId}/`;
    const outOfPrefix = (p: string) => !p.startsWith(expectedPrefix) || p.includes("..");
    if (outOfPrefix(data.storagePath)) {
      console.error("[walkthrough] rejected out-of-prefix storage path", {
        walkthroughId: data.walkthroughId,
        storagePath: data.storagePath,
      });
      throw new Error("Invalid storage path");
    }
    /*
     * `thumb_path` is signed by exactly the same readers as `storage_path`, so
     * it is the same read handle and needs the same check. Dropping a bad one
     * rather than rejecting the capture: a thumbnail is optional, and losing a
     * site photo over it would be the worse failure.
     */
    let thumbPath = data.thumbPath ?? null;
    if (thumbPath && outOfPrefix(thumbPath)) {
      console.error("[walkthrough] rejected out-of-prefix thumbnail path", {
        walkthroughId: data.walkthroughId,
        thumbPath,
      });
      thumbPath = null;
    }

    const { data: photo, error: photoErr } = await supabaseAdmin
      .from("photos")
      .insert({
        project_id: data.projectId,
        uploaded_by: userId,
        storage_path: data.storagePath,
        thumb_path: thumbPath,
        size_bytes: data.sizeBytes,
        caption: data.caption,
        phase: "walkthrough",
        tags: [],
        taken_at: data.takenAt,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
      } as any)
      .select("id")
      .single();
    if (photoErr || !photo) {
      console.error("[walkthrough] server photo row failed", photoErr, { walkthroughId: data.walkthroughId, storagePath: data.storagePath });
      throw new Error(photoErr?.message ?? "Could not save walkthrough photo");
    }

    const photoId = (photo as any).id as string;
    const { error: linkErr } = await supabaseAdmin
      .from("walkthrough_photos" as any)
      .insert({
        walkthrough_id: data.walkthroughId,
        photo_id: photoId,
        created_by: userId,
        offset_seconds: data.offsetSeconds,
        spoken_note: null,
        position: data.position,
      } as any);
    if (linkErr) {
      console.error("[walkthrough] server photo link failed", linkErr, { walkthroughId: data.walkthroughId, photoId });
      await supabaseAdmin.from("photos").update({ phase: "walkthrough" } as any).eq("id", photoId);
      // Keep the photo row and return it. Finish/list recovery finds it again
      // by phase and attaches it to walkthrough_photos. Either way the photo is
      // already in the project's gallery - an unlinked capture is a walkthrough
      // that lost a frame, not a photo the user lost.
      return { photoId, linkPending: true };
    }

    console.log("[walkthrough] server photo linked", { walkthroughId: data.walkthroughId, photoId, position: data.position });
    return { photoId };
  }

export async function finishWalkthroughSessionService(ctx: AuthedContext, data: any) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();
    console.log("[walkthrough] server finish requested", {
      walkthroughId: data.walkthroughId,
      userId,
      durationSeconds: data.durationSeconds,
      transcriptChars: (data.liveTranscript ?? "").trim().length,
    });

    console.log("[walkthrough] Creating DB record", { walkthroughId: data.walkthroughId, userId, mode: "finish-update" });

    const { data: walk, error: walkErr } = await supabaseAdmin
      .from("walkthroughs" as any)
      .select("id, project_id, created_by, started_at, title, summary_markdown, source")
      .eq("id", data.walkthroughId)
      .maybeSingle();
    if (walkErr || !walk || (walk as any).created_by !== userId) {
      console.error("[walkthrough] server finish unauthorized", walkErr, { walkthroughId: data.walkthroughId, userId });
      throw new Error("Walkthrough not found or access denied");
    }
    // There is no session to finish on a summary, and doing so would overwrite
    // its AI body with a transcript fallback built from a null transcript.
    if ((walk as any).source !== "recorded") {
      throw new Error("This walkthrough is a summary and has no recording session");
    }

    const endedAt = new Date();
    const endedAtIso = endedAt.toISOString();
    const transcript = (data.liveTranscript ?? "").trim();

    console.log("[walkthrough] Linking photos", { walkthroughId: data.walkthroughId, userId, mode: "recover-orphans" });
    try {
      const existingLinks = await readWalkthroughLinks(supabaseAdmin, data.walkthroughId);
      const existingPhotoIds = new Set(existingLinks.map((l) => l.photo_id));
      const estimatedStart = new Date(endedAt.getTime() - Math.max(1, data.durationSeconds) * 1000);
      const dbStartedAt = (walk as any).started_at ? new Date((walk as any).started_at) : estimatedStart;
      const startedAt = Number.isFinite(dbStartedAt.getTime()) ? dbStartedAt : estimatedStart;
      const recoveryStartMs = Math.min(startedAt.getTime(), estimatedStart.getTime()) - 5 * 60 * 1000;
      const lowerBound = new Date(recoveryStartMs).toISOString();
      const { data: candidates, error: candidateErr } = await supabaseAdmin
        .from("photos")
        .select("id, created_at, caption, storage_path, phase")
        .eq("project_id", (walk as any).project_id)
        .eq("uploaded_by", userId)
        .or(WALKTHROUGH_CANDIDATE_SCAN)
        .gte("created_at", lowerBound)
        .lte("created_at", endedAtIso)
        .order("created_at", { ascending: true });
      if (candidateErr) {
        console.error("[walkthrough] server orphan photo scan failed", candidateErr, { walkthroughId: data.walkthroughId, userId });
      } else {
        // The time window bounds this scan but does not make it precise - a
        // camera upload during the recording is exactly what it would catch.
        // See WALKTHROUGH_CANDIDATE_SCAN.
        const candidateRows = ((candidates as any[]) ?? [])
          .filter(isWalkthroughCapture)
          .filter((p) => !existingPhotoIds.has(p.id));
        if (candidateRows.length) {
          const candidateIds = candidateRows.map((p) => p.id);
          const { data: alreadyLinked } = await supabaseAdmin
            .from("walkthrough_photos" as any)
            .select("photo_id")
            .in("photo_id", candidateIds);
          const linkedElsewhere = new Set(((alreadyLinked as any[]) ?? []).map((l) => l.photo_id));
          const rows = candidateRows
            .filter((p: any) => !linkedElsewhere.has(p.id))
            .map((p: any, i: number) => ({
              walkthrough_id: data.walkthroughId,
              photo_id: p.id,
              created_by: userId,
              offset_seconds: Math.max(0, Math.round((new Date(p.created_at).getTime() - startedAt.getTime()) / 1000)),
              spoken_note: null,
              position: existingLinks.length + i,
            }));
          if (rows.length) {
            const { error: linkErr } = await supabaseAdmin
              .from("walkthrough_photos" as any)
              .upsert(rows as any, { onConflict: "walkthrough_id,photo_id", ignoreDuplicates: true });
            if (linkErr) console.error("[walkthrough] server orphan photo link failed", linkErr, { walkthroughId: data.walkthroughId, count: rows.length });
            else {
              await supabaseAdmin
                .from("photos")
                .update({ phase: "walkthrough" } as any)
                .in("id", rows.map((r: { photo_id: string }) => r.photo_id));
              console.log("[walkthrough] server orphan photos linked", { walkthroughId: data.walkthroughId, count: rows.length });
            }
          }
        }
      }
    } catch (recoverErr) {
      console.error("[walkthrough] server orphan photo recovery threw", recoverErr, { walkthroughId: data.walkthroughId, userId });
    }

    let linksForFallback = await readWalkthroughLinks(supabaseAdmin, data.walkthroughId);
    if (transcript && linksForFallback.some((l) => !l.spoken_note?.trim())) {
      linksForFallback = linksForFallback.map((link, index) => {
        if (link.spoken_note?.trim()) return link;
        return {
          ...link,
          spoken_note: estimateSpokenNote(
            transcript,
            link.offset_seconds ?? 0,
            linksForFallback[index + 1]?.offset_seconds ?? null,
            data.durationSeconds,
          ) || compactSpokenNote(transcript),
        };
      });
      await Promise.all(
        linksForFallback
          .filter((link) => link.spoken_note?.trim())
          .map((link) =>
            supabaseAdmin
              .from("walkthrough_photos" as any)
              .update({ spoken_note: link.spoken_note })
              .eq("walkthrough_id", data.walkthroughId)
              .eq("photo_id", link.photo_id),
          ),
      );
      console.log("[walkthrough] server live transcript linked to photo notes", { walkthroughId: data.walkthroughId, userId, photos: linksForFallback.length });
    }
    const fallbackMarkdown = buildFallbackWalkthroughMarkdown({
      title: (walk as any).title,
      transcript,
      durationSeconds: data.durationSeconds,
      links: linksForFallback,
    });

    const { error } = await supabaseAdmin
      .from("walkthroughs" as any)
      .update({
        duration_seconds: data.durationSeconds,
        ended_at: endedAtIso,
        status: "ready",
        transcript: transcript || null,
        summary_markdown: (walk as any).summary_markdown ?? fallbackMarkdown,
      } as any)
      .eq("id", data.walkthroughId);
    if (error) {
      console.error("[walkthrough] server finish update failed", error, { walkthroughId: data.walkthroughId, userId });
      throw new Error(error.message);
    }

    console.log("[walkthrough] server finish saved", { walkthroughId: data.walkthroughId, userId, linkedPhotos: linksForFallback.length });
    return { ok: true };
  }

export async function ensureWalkthroughPhotoLinksService(ctx: AuthedContext, data: any) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();
    console.log("[walkthrough] Linking photos", { walkthroughId: data.walkthroughId, requested: data.photos.length, userId });

    const { data: walk, error: walkErr } = await supabaseAdmin
      .from("walkthroughs" as any)
      .select("id, project_id, created_by")
      .eq("id", data.walkthroughId)
      .maybeSingle();
    if (walkErr || !walk || (walk as any).created_by !== userId) {
      console.error("[walkthrough] server ensure links unauthorized", walkErr, { walkthroughId: data.walkthroughId, userId });
      throw new Error("Walkthrough not found or access denied");
    }

    if (!data.photos.length) return { linkedCount: 0 };

    const photoIds = Array.from(new Set(data.photos.map((p: { photoId: string }) => p.photoId))) as string[];
    const { data: validPhotos, error: photoErr } = await supabaseAdmin
      .from("photos")
      .select("id")
      .eq("project_id", (walk as any).project_id)
      .eq("uploaded_by", userId)
      .in("id", photoIds);
    if (photoErr) throw new Error(photoErr.message);

    const validIds = new Set(((validPhotos as any[]) ?? []).map((p) => p.id));
      const rows = data.photos
      .filter((p: { photoId: string }) => validIds.has(p.photoId))
      .map((p: { photoId: string; offsetSeconds: number; position?: number }, i: number) => ({
        walkthrough_id: data.walkthroughId,
        photo_id: p.photoId,
        created_by: userId,
        offset_seconds: p.offsetSeconds,
        spoken_note: null,
        position: p.position ?? i,
      }));

    if (validIds.size) {
      await supabaseAdmin
        .from("photos")
        .update({ phase: "walkthrough" } as any)
        .in("id", Array.from(validIds));
    }

    if (!rows.length) return { linkedCount: 0 };
    const { error: linkErr } = await supabaseAdmin
      .from("walkthrough_photos" as any)
      .upsert(rows as any, { onConflict: "walkthrough_id,photo_id", ignoreDuplicates: true });
    if (linkErr) {
      console.error("[walkthrough] server ensure links failed", linkErr, { walkthroughId: data.walkthroughId, userId });
      throw new Error(linkErr.message);
    }

    console.log("[walkthrough] server ensured photo links", { walkthroughId: data.walkthroughId, linkedCount: rows.length, userId });
    return { linkedCount: rows.length };
  }

export async function updateWalkthroughVideoPathService(ctx: AuthedContext, data: any) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();
    const { data: walk } = await supabaseAdmin
      .from("walkthroughs" as any)
      .select("id, created_by, project_id, source")
      .eq("id", data.walkthroughId)
      .maybeSingle();
    if (!walk || (walk as any).created_by !== userId) throw new Error("Walkthrough not found or access denied");
    if ((walk as any).source !== "recorded") throw new Error("A summary has no video");
    // Same client-supplied-path problem as `saveWalkthroughPhotoService`: the
    // stored path is later signed with the service role, so it must be inside
    // this caller's own upload prefix.
    const expectedPrefix = `${userId}/${(walk as any).project_id}/`;
    if (
      typeof data.videoPath !== "string" ||
      !data.videoPath.startsWith(expectedPrefix) ||
      data.videoPath.includes("..")
    ) {
      console.error("[walkthrough] rejected out-of-prefix video path", {
        walkthroughId: data.walkthroughId,
        videoPath: data.videoPath,
      });
      throw new Error("Invalid video path");
    }
    const { error } = await supabaseAdmin
      .from("walkthroughs" as any)
      .update({ video_path: data.videoPath, video_mime_type: data.videoMimeType } as any)
      .eq("id", data.walkthroughId);
    if (error) throw new Error(error.message);
    console.log("[walkthrough] server video path saved", { walkthroughId: data.walkthroughId, userId });
    return { ok: true };
  }

export async function setWalkthroughStatusService(ctx: AuthedContext, data: any) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();
    const { data: walk } = await supabaseAdmin
      .from("walkthroughs" as any)
      .select("id, created_by")
      .eq("id", data.walkthroughId)
      .maybeSingle();
    if (!walk || (walk as any).created_by !== userId) throw new Error("Walkthrough not found or access denied");
    const { error } = await supabaseAdmin
      .from("walkthroughs" as any)
      .update({ status: data.status } as any)
      .eq("id", data.walkthroughId);
    if (error) throw new Error(error.message);
    console.log("[walkthrough] server status saved", { walkthroughId: data.walkthroughId, status: data.status, userId });
    return { ok: true };
  }

export async function listProjectWalkthroughsService(ctx: AuthedContext, data: { projectId: string }) {
    const { supabase, userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();
    console.log("[walkthrough] server list requested", { projectId: data.projectId, userId });

    // Use the user's RLS-scoped client only for the access check, then read the
    // walkthrough tables with the admin client. This keeps project permissions
    // intact while avoiding walkthrough-specific RLS gaps from hiding freshly
    // saved cards on Android/web.
    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (projectErr || !project) {
      console.error("[walkthrough] server list project access failed", projectErr, { projectId: data.projectId, userId });
      throw new Error("Project not found or access denied");
    }

    try {
      await recoverOrphanWalkthroughPhotosForProject(supabaseAdmin, { projectId: data.projectId, userId });
    } catch (recoverErr) {
      console.error("[walkthrough] server list orphan recovery threw", recoverErr, { projectId: data.projectId, userId });
    }

    const { data: wt, error: wtErr } = await supabaseAdmin
      .from("walkthroughs" as any)
      .select("id, title, created_at, duration_seconds, status, source, summary_markdown, share_token, video_path, video_mime_type")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false })
      // Recordings and AI summaries share this one list. At 10, a handful of
      // summaries would push real recordings off the tab entirely and cap the
      // tab's badge at a number that is simply wrong.
      .limit(50);
    if (wtErr) {
      console.error("[walkthrough] server list walkthroughs failed", wtErr, { projectId: data.projectId, userId });
      throw new Error(wtErr.message);
    }

    const wtList = ((wt as any[]) ?? []) as Array<any>;
    if (!wtList.length) {
      console.log("[walkthrough] server list complete", { projectId: data.projectId, userId, count: 0 });
      return [] as Array<any>;
    }

    const ids = wtList.map((w) => w.id);
    const { data: wp, error: wpErr } = await supabaseAdmin
      .from("walkthrough_photos" as any)
      .select("walkthrough_id, photo_id, position, offset_seconds")
      .in("walkthrough_id", ids)
      .order("position", { ascending: true });
    if (wpErr) console.error("[walkthrough] server list photo links failed", wpErr, { projectId: data.projectId, userId });

    const firstByWt = new Map<string, string>();
    const countByWt = new Map<string, number>();
    for (const row of ((wp as any[]) ?? [])) {
      if (!firstByWt.has(row.walkthrough_id)) firstByWt.set(row.walkthrough_id, row.photo_id);
      countByWt.set(row.walkthrough_id, (countByWt.get(row.walkthrough_id) ?? 0) + 1);
    }

    const photoIds = Array.from(new Set(Array.from(firstByWt.values())));
    const phMap = new Map<string, { storage_path: string; image_url: string | null }>();
    const signedPhotoMap: Record<string, string> = {};
    if (photoIds.length) {
      const { data: phs, error: phErr } = await supabaseAdmin
        .from("photos")
        .select("id, storage_path, image_url")
        .in("id", photoIds);
      if (phErr) console.error("[walkthrough] server list thumbnail photos failed", phErr, { projectId: data.projectId, userId });
      for (const p of ((phs as any[]) ?? [])) phMap.set(p.id, p);
      const toSign = Array.from(phMap.values()).filter((p) => !p.image_url).map((p) => p.storage_path);
      if (toSign.length) {
        const { data: urls, error: signErr } = await supabaseAdmin.storage.from("site-photos").createSignedUrls(toSign, 60 * 60);
        if (signErr) console.error("[walkthrough] server list thumbnail signing failed", signErr, { projectId: data.projectId, userId });
        urls?.forEach((u, i) => { if (u.signedUrl) signedPhotoMap[toSign[i]] = u.signedUrl; });
      }
    }

    const videoPaths = wtList.map((w) => w.video_path).filter(Boolean) as string[];
    const signedVideoMap: Record<string, string> = {};
    if (videoPaths.length) {
      const { data: urls, error: signErr } = await supabaseAdmin.storage.from("site-videos").createSignedUrls(videoPaths, 60 * 60);
      if (signErr) console.error("[walkthrough] server list video signing failed", signErr, { projectId: data.projectId, userId });
      urls?.forEach((u, i) => { if (u.signedUrl) signedVideoMap[videoPaths[i]] = u.signedUrl; });
    }

    const result = wtList.map((w) => {
      const pid = firstByWt.get(w.id);
      const ph = pid ? phMap.get(pid) : undefined;
      return {
        ...w,
        thumb_url: ph ? (ph.image_url ?? signedPhotoMap[ph.storage_path] ?? null) : null,
        photo_count: countByWt.get(w.id) ?? 0,
        video_signed_url: w.video_path ? signedVideoMap[w.video_path] ?? null : null,
      };
    });

    console.log("[walkthrough] server list complete", { projectId: data.projectId, userId, count: result.length });
    return result;
}

function compactSpokenNote(transcript: string, maxWords = 120) {
  const words = transcript.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return null;
  const snippet = words.slice(0, maxWords).join(" ").trim();
  return words.length > maxWords ? `${snippet}…` : snippet;
}

/**
 * Map spoken words to a specific photo. Without word-level timestamps we
 * slice the transcript proportionally by time (with a small look-back so
 * narration that *precedes* the shutter is included). If timing info is
 * missing we split evenly across `total` photos so each photo still gets
 * its own distinct span - never the whole transcript.
 */
function estimateSpokenNote(
  transcript: string,
  startSeconds: number,
  endSeconds: number | null,
  durationSeconds: number,
  index: number = 0,
  total: number = 1,
) {
  const words = transcript.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return null;

  const totalCount = Math.max(1, total);
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : (endSeconds && endSeconds > startSeconds ? endSeconds : 0);

  let startRatio: number;
  let endRatio: number;
  if (duration > 0 && Number.isFinite(startSeconds)) {
    const perPhoto = duration / totalCount;
    const windowStart = Math.max(0, startSeconds - Math.min(8, perPhoto / 2));
    const windowEnd = Math.min(
      duration,
      endSeconds && endSeconds > startSeconds ? endSeconds : startSeconds + Math.max(10, perPhoto),
    );
    startRatio = Math.min(0.95, Math.max(0, windowStart / duration));
    endRatio = Math.min(1, Math.max(startRatio + 0.02, windowEnd / duration));
  } else {
    const share = 1 / totalCount;
    startRatio = Math.min(0.95, index * share);
    endRatio = Math.min(1, (index + 1) * share);
  }

  const start = Math.min(words.length - 1, Math.floor(words.length * startRatio));
  const end = Math.min(words.length, Math.max(start + 6, Math.ceil(words.length * endRatio)));
  const slice = words.slice(start, end).join(" ").trim();
  return slice || null;
}

const transcribeSchema = z.object({
  walkthroughId: z.string().uuid(),
  audioBase64: z.string().min(1),
  mimeType: z.string().min(1).max(100),
});

function extensionForAudioMime(mimeType: string) {
  const mime = mimeType.split(";")[0]?.toLowerCase() ?? "";
  if (mime.includes("mp4") || mime.includes("m4a")) return "mp4";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("webm")) return "webm";
  return "webm";
}

/**
 * Transcribe the completed walkthrough recording through Gemini STT,
 * then persist both the full transcript and estimated narration context
 * beside each captured photo.
 */
export async function transcribeWalkthroughService(
  ctx: AuthedContext,
  data: { walkthroughId: string; audioBase64: string; mimeType: string },
) {
    const { userId } = ctx;
    const stt = transcriptionEndpoint(TRANSCRIPTION_MODEL);

    const supabaseAdmin = getSupabaseAdmin();
    const { data: walk, error: wErr } = await supabaseAdmin
      .from("walkthroughs" as any)
      .select("id, created_by, title, transcript, duration_seconds, summary_markdown")
      .eq("id", data.walkthroughId)
      .single();
    if (wErr || !walk) throw new Error("Walkthrough not found");
    if ((walk as any).created_by !== userId) throw new Error("Not authorized");

    console.log("[walkthrough] server transcription requested", {
      walkthroughId: data.walkthroughId,
      userId,
      mimeType: data.mimeType,
      base64Chars: data.audioBase64.length,
    });

    const bytes = Buffer.from(data.audioBase64, "base64");
    if (bytes.byteLength < 2048) throw new Error("Recording was empty");

    const form = new FormData();
    const fileName = `walkthrough-${data.walkthroughId}.${extensionForAudioMime(data.mimeType)}`;
    form.append("model", stt.model);
    form.append("file", new Blob([bytes], { type: data.mimeType }), fileName);

    const res = await fetch(stt.url, {
      method: "POST",
      headers: stt.headers,
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Transcription failed: ${res.status} ${txt.slice(0, 200)}`);
    }

    const json = (await res.json()) as { text?: string };
    const transcript = (json.text ?? "").replace(/\s+/g, " ").trim();
    const finalTranscript = transcript || ((walk as any).transcript ?? "").trim();

    if (finalTranscript) {
      const { data: links, error: linkErr } = await supabaseAdmin
        .from("walkthrough_photos" as any)
        .select("photo_id, offset_seconds, position, spoken_note")
        .eq("walkthrough_id", data.walkthroughId)
        .order("position", { ascending: true });
      if (linkErr) throw new Error(linkErr.message);

      const rows = ((links as any[]) ?? []);
      const rowsWithNotes = rows.map((row, i) => {
        const existing = row.spoken_note?.trim();
        const note = existing || estimateSpokenNote(
          finalTranscript,
          row.offset_seconds ?? 0,
          rows[i + 1]?.offset_seconds ?? null,
          (walk as any).duration_seconds ?? 0,
          i,
          rows.length,
        );
        return { ...row, spoken_note: note };
      });
      await Promise.all(rowsWithNotes.map((row) => {
        if (!row.spoken_note?.trim()) return Promise.resolve(null);
        return supabaseAdmin
          .from("walkthrough_photos" as any)
          .update({ spoken_note: row.spoken_note })
          .eq("walkthrough_id", data.walkthroughId)
          .eq("photo_id", row.photo_id);
      }));
      const transcriptFallbackMarkdown = buildFallbackWalkthroughMarkdown({
        title: (walk as any).title,
        transcript: finalTranscript,
        durationSeconds: (walk as any).duration_seconds ?? 0,
        links: rowsWithNotes,
      });
      await supabaseAdmin
        .from("walkthroughs" as any)
        .update({
          transcript: finalTranscript,
          summary_markdown: transcriptFallbackMarkdown,
          status: "ready",
        } as any)
        .eq("id", data.walkthroughId);
      console.log("[walkthrough] server transcription saved photo narration", { walkthroughId: data.walkthroughId, userId, photos: rowsWithNotes.length, transcriptChars: finalTranscript.length });
    } else if (transcript) {
      await supabaseAdmin
        .from("walkthroughs" as any)
        .update({ transcript })
        .eq("id", data.walkthroughId);
    }

    return { transcript: finalTranscript };
}

/**
 * Take the raw spoken transcript + the list of photos captured during the walk,
 * and produce a clean, client-ready Markdown report. Photos are referenced
 * inline as `![Photo N](photo:<photo_id>)` so the renderer can hydrate them.
 */
export async function generateWalkthroughReportService(ctx: AuthedContext, data: any) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();
    const apiKey = process.env.GEMINI_API_KEY;

    console.log("[walkthrough] Generating report", { walkthroughId: data.walkthroughId, userId });
    console.log("[walkthrough] server report generation requested", { walkthroughId: data.walkthroughId, userId });
    const { data: walk, error: wErr } = await supabaseAdmin
      .from("walkthroughs" as any)
      .select("id, project_id, title, transcript, duration_seconds, started_at, created_by, share_token, source")
      .eq("id", data.walkthroughId)
      .single();
    if (wErr || !walk) throw new Error("Walkthrough not found");
    if ((walk as any).created_by !== userId) throw new Error("Not authorized");
    // Before reserveAutoReport, deliberately: a summary must never burn an Auto
    // Report slot. It has no transcript to report on, and it is available on
    // plans that have no Auto Report allowance at all - reserving here would
    // throw the Pro paywall at a user for regenerating something they own.
    if ((walk as any).source === "summary") {
      throw new Error("This is a summary - use Regenerate summary instead.");
    }

    // Auto Reports are Pro/Team only and metered per user per month (Pro 100,
    // Team unlimited). Checked before any LLM work so an over-quota caller
    // never burns a request, and after the ownership check so the error can't
    // be used to probe for walkthroughs the caller doesn't own.
    //
    // The slot is RESERVED here rather than recorded at the end: the model call
    // below takes tens of seconds, and a plain check-then-record let concurrent
    // requests all pass the same count. Released in the catch if generation
    // fails, so a failed run still costs nothing.
    const { quota, reservationId } = await reserveAutoReport(
      ctx.supabase,
      data.walkthroughId,
      userId,
    );
    try {

      const { data: links } = await supabaseAdmin
      .from("walkthrough_photos" as any)
      .select("photo_id, offset_seconds, spoken_note, position")
      .eq("walkthrough_id", data.walkthroughId)
      .order("position", { ascending: true });
    let linkRows = (links as any[] | null) ?? [];

    const { data: projectRow } = await supabaseAdmin
      .from("projects")
      .select("name, location, street, city, state")
      .eq("id", (walk as any).project_id)
      .maybeSingle();

    let photosMeta: Array<{ id: string; caption: string | null; taken_at: string | null }> = [];
    if (linkRows.length) {
      const ids = linkRows.map((l) => l.photo_id);
      const { data: phRows } = await supabaseAdmin
        .from("photos")
        .select("id, caption, taken_at")
        .in("id", ids);
      photosMeta = (phRows as any[]) ?? [];
    }
    const photoById = new Map(photosMeta.map((p) => [p.id, p]));

    const fmt = (s: number) => {
      const m = Math.floor(s / 60);
      const r = s % 60;
      return `${m}:${r.toString().padStart(2, "0")}`;
    };

    const rawTranscript = ((walk as any).transcript ?? "").trim();
    const durationSeconds = (walk as any).duration_seconds ?? 0;
    if (rawTranscript && linkRows.some((l) => !l.spoken_note?.trim())) {
      linkRows = linkRows.map((l, i) => {
        if (l.spoken_note?.trim()) return l;
        return {
          ...l,
          spoken_note: estimateSpokenNote(
            rawTranscript,
            l.offset_seconds ?? 0,
            linkRows[i + 1]?.offset_seconds ?? null,
            durationSeconds,
            i,
            linkRows.length,
          ),
        };
      });
      await Promise.all(
        linkRows
          .filter((l) => l.spoken_note?.trim())
          .map((l) =>
            supabaseAdmin
              .from("walkthrough_photos" as any)
              .update({ spoken_note: l.spoken_note })
              .eq("walkthrough_id", data.walkthroughId)
              .eq("photo_id", l.photo_id),
          ),
      );
    }

    const photoLines = linkRows.map((l, i) => {
      const meta = photoById.get(l.photo_id);
      const note = l.spoken_note ? `  spoken near this photo: "${l.spoken_note.trim()}"` : "";
      return `- Photo ${i + 1} (id=${l.photo_id}) captured at ${fmt(l.offset_seconds ?? 0)}${note}${
        meta?.caption ? ` - caption: ${meta.caption}` : ""
      }`;
    }).join("\n");

    const projectLine = projectRow
      ? `Project: ${(projectRow as any).name}${
          (projectRow as any).location || (projectRow as any).street
            ? ` - ${(projectRow as any).location ?? [(projectRow as any).street, (projectRow as any).city, (projectRow as any).state].filter(Boolean).join(", ")}`
            : ""
        }`
      : "";

    const hasSpeech = rawTranscript.length > 0;

    const userPrompt = `${projectLine}

You are formatting the field notes a technician spoke while walking the site.
Your job is ONLY to organize and lightly tidy what the technician actually said
into a clean, neutral, professional Markdown report. You are a transcriber and
typesetter, not an analyst.

STRICT RULES:
- Use ONLY information present in the transcript and the spoken notes attached
  to each photo. Do not add any other content.
- Do NOT add interpretations, opinions, "technical observations", severity
  ratings, recommendations, next steps, risk callouts, or any advice that the
  speaker did not explicitly say.
- Do NOT analyze, judge, or describe the photos themselves - you cannot see
  them. Only use the spoken notes tied to each photo.
- Do NOT invent measurements, brand names, model numbers, defects, locations,
  dates, or any other facts.
- Fix obvious filler words, false starts, and grammar. Keep the speaker's
  meaning and wording. Do not paraphrase aggressively.
- Use neutral, professional language. No marketing tone, no emojis.
- If the transcript is empty or doesn't cover something, simply omit that part
  rather than guessing.

Required structure:
# ${(walk as any).title ?? "Walkthrough Note"}

## Summary
One short, neutral sentence that restates (not interprets) what the technician
covered. If there is not enough material for a sentence, omit this section.

## Notes
Organize what the technician actually said into short bullet points. Group
bullets by area, room, or system ONLY when the speaker grouped them that way
(using ### subheadings for those groups). Otherwise just one flat bullet list.
Each bullet should closely reflect the speaker's own words.

PHOTO RULES:
- ${linkRows.length} photo(s) were captured during this walkthrough.
- Reference photos inline using exactly this syntax (do not invent ids):
  ![Photo N](photo:<photo_id>)
- Place each photo right after the bullet that matches the spoken note tied
  to it. Use each photo at most once.
- If a photo has a spoken note, put it under the photo as plain italic text
  using the speaker's words verbatim or a tight quote: *"…"*.
- If a photo has no spoken note, still include it inline at the matching
  timestamp but with no caption.

Available photos:
${photoLines || "(none)"}

Raw spoken transcript:
"""
${hasSpeech ? rawTranscript : "(no speech captured)"}
"""

Walk duration: ${fmt((walk as any).duration_seconds ?? 0)}.

${hasSpeech
  ? "Write the final Markdown report only. No preamble, no closing remarks, no AI commentary."
  : `The technician did not speak (or audio failed). Write a minimal report with the title and a "## Photos" section that lists every available photo inline using the ![Photo N](photo:<id>) syntax with no captions. Do NOT invent any findings.`}`;

    let markdown = "";
    if (apiKey) {
      try {
        const ep = chatEndpoint(MODEL);
        const res = await fetch(ep.url, {
          method: "POST",
          headers: ep.headers,
          body: JSON.stringify({
            model: ep.model,
            messages: [
              { role: "system", content: "You are a neutral transcriber/typesetter for field notes. You only reorganize what the technician said into clean Markdown. You never add analysis, opinions, recommendations, severities, or any content the speaker did not explicitly say." },
              { role: "user", content: userPrompt },
            ],
          }),
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`AI error ${res.status}: ${txt.slice(0, 200)}`);
        }
        const json = await res.json();
        markdown = json.choices?.[0]?.message?.content ?? "";
      } catch (aiErr) {
        console.warn("[walkthrough] AI report generation failed; using deterministic fallback", aiErr, { walkthroughId: data.walkthroughId, userId });
      }
    } else {
      console.warn("[walkthrough] GEMINI_API_KEY missing; using deterministic fallback", { walkthroughId: data.walkthroughId, userId });
    }

    if (!markdown.trim()) {
      markdown = buildFallbackWalkthroughMarkdown({
        title: (walk as any).title,
        transcript: rawTranscript,
        durationSeconds,
        links: linkRows,
      });
    }

    // Deterministic safety net: guarantee every captured photo appears in the
    // final report. The LLM sometimes omits photo references or invents ids;
    // we detect which real photo ids it actually used and append any missing
    // ones in a clean gallery section with timestamp + spoken note.
    const usedIds = new Set<string>();
    const photoRefRe = /!\[[^\]]*\]\(photo:([^)\s]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = photoRefRe.exec(markdown)) !== null) {
      if (photoById.has(m[1])) usedIds.add(m[1]);
    }
    // Strip any invented photo refs that don't match real ids.
    markdown = markdown.replace(photoRefRe, (full, id) =>
      photoById.has(id) ? full : "",
    );

    const missing = linkRows.filter((l) => !usedIds.has(l.photo_id));
    if (missing.length) {
      const gallery = missing
        .map((l, i) => {
          const idx = linkRows.findIndex((x) => x.photo_id === l.photo_id) + 1;
          const ts = fmt(l.offset_seconds ?? 0);
          const note = l.spoken_note?.trim();
          return `### Photo ${idx} · ${ts}\n\n![Photo ${idx}](photo:${l.photo_id})\n${
            note ? `\n*"${note.replace(/"/g, '\\"')}"*\n` : ""
          }`;
        })
        .join("\n");
      const header = usedIds.size > 0 ? "\n\n## Additional Photos\n\n" : "\n\n## Photos\n\n";
      markdown = `${markdown.trim()}${header}${gallery}`;
    }

    // Auto-issue a share token on first successful report so the public link
    // works immediately. Toggle still controls visibility client-side via the
    // share switch; the token is rotated when the user disables it.
    const existingToken = (walk as any).share_token ?? null;
    const ensuredToken = existingToken ?? crypto.randomUUID();

    await supabaseAdmin
      .from("walkthroughs" as any)
      .update({
        summary_markdown: markdown,
        status: "ready",
        share_token: ensuredToken,
      })
      .eq("id", data.walkthroughId);

      // The reservation taken above IS the meter - nothing more to record. It
      // deliberately counts deterministic-fallback reports too (AI unavailable
      // / key missing): the user still received a generated report, and not
      // charging for it would let a degraded provider hand out unlimited free
      // generations.
      void quota;

      console.log(`[walkthrough] Success - ID: ${data.walkthroughId}`);
      console.log("[walkthrough] server report generation saved", { walkthroughId: data.walkthroughId, userId });
      return { markdown };
    } catch (err) {
      // Generation failed, so the slot was never consumed - hand it back rather
      // than charging for a report the user never received.
      await releaseAutoReport(reservationId);
      throw err;
    }
}

const tokenSchema = z.object({
  walkthroughId: z.string().uuid(),
  enable: z.boolean(),
});

export async function setWalkthroughShareService(
  ctx: AuthedContext,
  data: { walkthroughId: string; enable: boolean },
) {
    const { supabase, userId } = ctx;
    const { data: walk } = await supabase
      .from("walkthroughs" as any)
      .select("id, created_by, share_token")
      .eq("id", data.walkthroughId)
      .maybeSingle();
    if (!walk || (walk as any).created_by !== userId) throw new Error("Not authorized");
    const token = data.enable
      ? ((walk as any).share_token ?? crypto.randomUUID())
      : null;
    await supabase
      .from("walkthroughs" as any)
      .update({ share_token: token })
      .eq("id", data.walkthroughId);
    return { token };
}

const publicSchema = z.object({ token: z.string().uuid() });

/**
 * Read a published walkthrough by share token. No auth - uses the admin client
 * because anonymous visitors are the target audience and RLS would block them.
 */
export async function getPublicWalkthroughService(data: { token: string }) {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: walk } = await supabaseAdmin
      .from("walkthroughs" as any)
      .select("id, title, summary_markdown, transcript, duration_seconds, started_at, project_id, status, source")
      .eq("share_token", data.token)
      .maybeSingle();
    if (!walk) {
      return {
        walkthrough: null,
        project: null,
        photoUrls: {} as Record<string, string>,
        photoSteps: [] as Array<{
          photo_id: string;
          offset_seconds: number;
          spoken_note: string | null;
          position: number;
          caption: string | null;
          taken_at: string | null;
          image_url: string;
        }>,
      };
    }

    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("name, location, street, city, state, deleted_at")
      .eq("id", (walk as any).project_id)
      .maybeSingle();

    /*
     * Trashing the project revokes its shared walkthrough. Nothing on any public
     * path filtered `deleted_at`, so a walkthrough - audio, transcript, every
     * captured photo - kept serving after the job was deleted. Returned as the
     * same empty shape as an unknown token so the share page renders its normal
     * "not available" state rather than a half-populated one.
     */
    if ((project as any)?.deleted_at) {
      return {
        walkthrough: null,
        project: null,
        photoUrls: {} as Record<string, string>,
        photoSteps: [] as Array<{
          photo_id: string;
          offset_seconds: number;
          spoken_note: string | null;
          position: number;
          caption: string | null;
          taken_at: string | null;
          image_url: string;
        }>,
      };
    }

    const { data: links } = await supabaseAdmin
      .from("walkthrough_photos" as any)
      .select("photo_id, offset_seconds, spoken_note, position")
      .eq("walkthrough_id", (walk as any).id)
      .order("position", { ascending: true });
    const linkRows = ((links as any[]) ?? []);
    const photoIds = Array.from(new Set(linkRows.map((l) => l.photo_id).filter(Boolean)));

    const photoUrls: Record<string, string> = {};
    const photoMeta = new Map<string, { caption: string | null; taken_at: string | null; image_url: string }>();
    if (photoIds.length) {
      const { data: phRows } = await supabaseAdmin
        .from("photos")
        .select("id, storage_path, image_url, caption, taken_at")
        .in("id", photoIds);
      const rows = (phRows as any[]) ?? [];
      const toSign = rows.filter((r) => !r.image_url && r.storage_path).map((r) => r.storage_path);
      const signedMap = new Map<string, string>();
      if (toSign.length) {
        const { data: signed } = await supabaseAdmin.storage
          .from("site-photos")
          .createSignedUrls(toSign, 60 * 60 * 24 * 7);
        (signed ?? []).forEach((s, i) => {
          if (s.signedUrl) signedMap.set(toSign[i], s.signedUrl);
        });
      }
      for (const r of rows) {
        const imageUrl = r.image_url ?? signedMap.get(r.storage_path) ?? "";
        photoUrls[r.id] = imageUrl;
        photoMeta.set(r.id, {
          caption: r.caption ?? null,
          taken_at: r.taken_at ?? null,
          image_url: imageUrl,
        });
      }
    }

    const publicWalk = {
      id: (walk as any).id,
      title: (walk as any).title,
      summary_markdown: (walk as any).summary_markdown,
      duration_seconds: (walk as any).duration_seconds,
      started_at: (walk as any).started_at,
      project_id: (walk as any).project_id,
      status: (walk as any).status,
      // The share page needs this to suppress a "0:00" duration and the
      // "Walkthrough Note" label on something that was never walked.
      source: ((walk as any).source ?? "recorded") as string,
    };

    const rawTranscript = ((walk as any).transcript ?? "").trim();
    const durationSeconds = (walk as any).duration_seconds ?? 0;
    const photoSteps = linkRows.map((l, i) => {
      const meta = photoMeta.get(l.photo_id);
      const note = l.spoken_note?.trim() || estimateSpokenNote(
        rawTranscript,
        l.offset_seconds ?? 0,
        linkRows[i + 1]?.offset_seconds ?? null,
        durationSeconds,
        i,
        linkRows.length,
      );
      return {
        photo_id: l.photo_id,
        offset_seconds: l.offset_seconds ?? 0,
        spoken_note: note,
        position: l.position ?? 0,
        caption: meta?.caption ?? null,
        taken_at: meta?.taken_at ?? null,
        image_url: meta?.image_url ?? "",
      };
    });

    return {
      walkthrough: publicWalk,
      project,
      photoUrls,
      photoSteps,
    };
  }

export async function createReportFromWalkthroughService(
  ctx: AuthedContext,
  data: z.infer<typeof createReportFromWalkInputSchema>,
) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();
    const apiKey = process.env.GEMINI_API_KEY;

    // Auto Reports are Pro and Team. This path used to be reachable with no
    // plan check at all: the recorder UI is behind a Pro gate, so nothing
    // *visible* got through, but the RPC itself was open to any authenticated
    // caller holding a walkthrough id.
    //
    // Asserted, not reserved. generateWalkthroughReportService already spends a
    // quota slot for this same walkthrough moments earlier, and the structured
    // project report is the second half of that one generation, not a second
    // one - reserving here would bill a Pro account twice for one recording.
    await assertAutoReportAllowed(ctx.supabase, userId);

    const { data: walk, error: wErr } = await supabaseAdmin
      .from("walkthroughs" as any)
      .select("id, project_id, created_by, title, transcript, duration_seconds, started_at, source")
      .eq("id", data.walkthroughId)
      .single();
    if (wErr || !walk) throw new Error("Walkthrough not found");
    if ((walk as any).created_by !== userId) throw new Error("Not authorized");
    // A summary has no transcript, so this would build a document out of an
    // empty string and present it as a walkthrough report.
    if ((walk as any).source === "summary") {
      throw new Error("A summary has no recording to build a report from");
    }

    const projectId = (walk as any).project_id as string;
    const walkTitle = (walk as any).title as string | null;
    const transcript = ((walk as any).transcript ?? "").toString().trim();

    const { data: projectRow } = await supabaseAdmin
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .maybeSingle();
    const projectName = ((projectRow as any)?.name ?? null) as string | null;

    const photosPerPage = await resolveReportPhotosPerPage(userId, data.photosPerPage);

    // Idempotency: if a report already exists for this walkthrough (marker in
    // summary), return it instead of creating a duplicate.
    const marker = `wid:${(walk as any).id}`;
    const { data: existing } = await (supabaseAdmin as any)
      .from("project_reports")
      .select("id")
      .eq("project_id", projectId)
      .eq("created_by", userId)
      .ilike("summary", `%${marker}%`)
      .maybeSingle();
    if (existing?.id) {
      return { reportId: existing.id as string, alreadyExisted: true };
    }

    const { data: links } = await supabaseAdmin
      .from("walkthrough_photos" as any)
      .select("photo_id, offset_seconds, spoken_note, position")
      .eq("walkthrough_id", (walk as any).id)
      .order("position", { ascending: true });
    const linkRows = ((links as any[]) ?? []).filter((l) => l.photo_id);

    let photoCaptions = new Map<string, string | null>();
    if (linkRows.length) {
      const ids = linkRows.map((l) => l.photo_id);
      const { data: phRows } = await supabaseAdmin
        .from("photos")
        .select("id, caption")
        .in("id", ids);
      for (const r of (phRows as any[]) ?? []) photoCaptions.set(r.id, r.caption ?? null);
    }

    const photoList = linkRows.map((l, i) => ({
      index: i,
      photo_id: l.photo_id as string,
      offset: l.offset_seconds ?? 0,
      spoken_note: (l.spoken_note ?? "").toString().trim(),
      caption: photoCaptions.get(l.photo_id) ?? null,
    }));

    // Section budget. The report paginates one section per page and then
    // batches that section's photos `photosPerPage` at a time, so the number of
    // sections is the number of pages - and a section holding one photo is a
    // page holding one photo no matter what density the author set. The model
    // is told this number, and consolidateReportSections enforces it afterwards
    // for the runs where it does not comply.
    const maxPhotoSections = Math.max(
      1,
      Math.min(MAX_AUTO_REPORT_PHOTO_SECTIONS, Math.ceil(photoList.length / photosPerPage)),
    );

    // ---- AI structuring ----
    let ai: AiReportShape | null = null;
    if (apiKey) {
      const userPrompt = buildAutoReportPrompt({
        projectName,
        walkTitle,
        durationSeconds: (walk as any).duration_seconds ?? 0,
        transcript,
        photos: photoList,
        photosPerPage,
        maxPhotoSections,
      });

      try {
        const ep = chatEndpoint(MODEL);
        const res = await fetch(ep.url, {
          method: "POST",
          headers: ep.headers,
          body: JSON.stringify({
            model: ep.model,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: AUTO_REPORT_SYSTEM_PROMPT },
              { role: "user", content: userPrompt },
            ],
          }),
        });
        if (res.ok) {
          const json = await res.json();
          const raw = json.choices?.[0]?.message?.content ?? "";
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && Array.isArray(parsed.sections)) {
            /*
             * Every string the model returns is folded through
             * `normalizeDashesTrimmed` here, at the one point model output
             * becomes our data. Models write long dashes by reflex, and this
             * text is stored verbatim: the title alone shows up on the reports
             * index, the project screen, the builder, the share page and the
             * PDF bookmark. CLAUDE.md forbids that character everywhere, and
             * no lint over tracked files can catch text written at runtime.
             */
            ai = {
              title:
                normalizeDashesTrimmed(parsed.title) ||
                `${projectName ?? "Site"} Walkthrough Report`,
              subtitle: normalizeDashesTrimmed(parsed.subtitle),
              introduction: normalizeDashesTrimmed(parsed.introduction),
              sections: parsed.sections.map((s: any) => ({
                title: normalizeDashesTrimmed(s?.title) || "Section",
                body: normalizeDashesTrimmed(s?.body),
                photo_indices: Array.isArray(s?.photo_indices)
                  ? s.photo_indices.filter((n: any) => Number.isInteger(n) && n >= 0 && n < photoList.length)
                  : [],
              })),
              conclusion: normalizeDashesTrimmed(parsed.conclusion),
            };
          }
        } else {
          const txt = await res.text().catch(() => "");
          console.warn("[walkthrough→report] AI structuring failed", res.status, txt.slice(0, 200));
        }
      } catch (e) {
        console.warn("[walkthrough→report] AI structuring threw", e);
      }
    }

    if (!ai) {
      ai = buildFallbackAiReport({
        walkTitle: walkTitle ?? "",
        projectName,
        transcript,
        photoCount: photoList.length,
      });
    }

    // Distribute photos into sections; append any leftovers into a final gallery.
    const usedIdx = new Set<number>();
    const sectionsForDb: Array<{ title: string; body: string; photos: Array<{ photo_id: string; caption: string }> }> = [];

    // Introduction section
    if (ai.introduction?.trim()) {
      sectionsForDb.push({ title: "Introduction", body: ai.introduction, photos: [] });
    }

    for (const s of ai.sections) {
      const photoObjs = s.photo_indices
        .filter((i) => !usedIdx.has(i))
        .map((i) => {
          usedIdx.add(i);
          const p = photoList[i];
          return { photo_id: p.photo_id, caption: p.spoken_note || p.caption || "" };
        });
      sectionsForDb.push({ title: s.title, body: s.body, photos: photoObjs });
    }

    const leftover = photoList.filter((p) => !usedIdx.has(p.index));
    if (leftover.length) {
      sectionsForDb.push({
        title: sectionsForDb.some((s) => s.photos.length) ? "Additional photos" : "Photos",
        body: "",
        photos: leftover.map((p) => ({ photo_id: p.photo_id, caption: p.spoken_note || p.caption || "" })),
      });
    }

    // Fold thin and surplus photo sections together before the Conclusion is
    // appended, so the closing prose is never a merge target. Without this a
    // model that ignored the section budget still produces one photo per page,
    // whatever density the author chose.
    const consolidated = consolidateReportSections(sectionsForDb, {
      photosPerPage,
      maxPhotoSections,
    });
    if (consolidated.length !== sectionsForDb.length) {
      console.log("[walkthrough→report] consolidated sections", {
        walkthroughId: data.walkthroughId,
        before: sectionsForDb.length,
        after: consolidated.length,
        photosPerPage,
      });
    }
    sectionsForDb.length = 0;
    sectionsForDb.push(...consolidated);

    if (ai.conclusion?.trim()) {
      sectionsForDb.push({ title: "Conclusion", body: ai.conclusion, photos: [] });
    }

    // Cover photos: first up to 3 captured photos, if any
    const coverPhotoIds = photoList.slice(0, 3).map((p) => p.photo_id);

    // Summary field carries the subtitle for cover rendering + hidden marker
    // for idempotency lookups on re-run.
    const summary = `${ai.subtitle || ""}\n\n<!-- ${marker} -->`.trim();

    const { data: inserted, error: insErr } = await (supabaseAdmin as any)
      .from("project_reports")
      .insert({
        project_id: projectId,
        created_by: userId,
        title: ai.title,
        summary,
        photo_ids: photoList.map((p) => p.photo_id),
        include_project_info: true,
        allow_download: true,
        photos_per_page: photosPerPage,
        cover_enabled: true,
        cover_show_project_name: true,
        cover_show_address: true,
        cover_show_date: true,
        cover_show_author: true,
        cover_photo_ids: coverPhotoIds,
      })
      .select("id")
      .single();
    if (insErr || !inserted) throw new Error(insErr?.message ?? "Failed to create report");
    const reportId = (inserted as any).id as string;

    if (sectionsForDb.length) {
      const rows = sectionsForDb.map((s, i) => ({
        report_id: reportId,
        position: i,
        title: s.title,
        body: s.body,
        photos: s.photos,
      }));
      const { error: secErr } = await (supabaseAdmin as any)
        .from("project_report_sections")
        .insert(rows);
      if (secErr) {
        console.warn("[walkthrough→report] section insert failed", secErr);
      }
    }

    console.log("[walkthrough→report] created", { walkthroughId: data.walkthroughId, reportId, sections: sectionsForDb.length, photos: photoList.length });
    return { reportId, alreadyExisted: false };
  }
