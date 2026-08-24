import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import type { AuthedContext } from "../../lib/user-context";
import { chatComplete, summarizePhotosReportService } from "../ai/service";
import { cleanCaption, normalizeDashesTrimmed } from "@everlumen/shared";
import { buildWalkthroughNarration, transcriptWindow, type NarrationSource } from "./narration";

/**
 * A walkthrough Summary: the AI write-up, as an object in its own right.
 *
 * It used to be a `walkthroughs` row with `source = 'summary'`, and the client
 * named every symptom of that: "opening an 'AI Summary' from Reports loads at a
 * /walkthroughs/{id} URL with the tab title 'Walkthrough,' even when there's no
 * video. These need to be separate object types before anything else on this
 * list will hold together."
 *
 * Two shape decisions carry the rest of the brief.
 *
 * **The notes live with their photos.** `photo_notes` is one ordered array of
 * `{ photoId, note, spoken }`, not a narration list beside a photo list. "each
 * note sitting directly next to its matching photo, not narration and photos in
 * two separate lists like the current build" is a data problem before it is a
 * layout one: two arrays in the database become two lists on the page however
 * they are styled.
 *
 * **The prose carries no gallery.** `markdown` is the written summary and
 * nothing else. The old composer appended a `## Photos` section of
 * `![](photo:id)` refs, which every reader then had to strip back out
 * (`cleanWalkthroughMarkdown`) so the real gallery could own the photos. The
 * photos belong in `photo_notes`; the markdown is text.
 *
 * Together those two make the ordering fix trivial - "make that text show first
 * for summary and the pictures after" is now just: render `markdown`, then
 * render `photo_notes`.
 */

/** Photos one summary may cover. Matches the picker's own cap. */
const MAX_SUMMARY_PHOTOS = 50;

/**
 * How long a signed photo URL lasts, by who is looking.
 *
 * An hour is plenty for someone with the app open: they loaded the page, the
 * URLs were minted for that load, and a refresh mints new ones.
 *
 * A shared link is a different thing entirely. It goes in an email and gets
 * opened when the client gets round to it, which is not within the hour - and
 * an expired URL is not an error page, it is a summary full of broken images,
 * which is worse because it looks like the product is broken rather than the
 * link being stale. A week is what the shared walkthrough already uses.
 */
const SIGNED_URL_TTL_OWNER = 60 * 60;
const SIGNED_URL_TTL_SHARED = 60 * 60 * 24 * 7;

export interface SummaryPhotoNote {
  photoId: string;
  /** Seconds into the recording. 0 for a summary built from photos alone. */
  offsetSeconds: number;
  /** What was done in this shot. Always present. */
  note: string;
  /**
   * What was said on camera near this moment, or null when nobody spoke.
   *
   * The distinction is load-bearing: it is what lets the UI render a narrated
   * shot differently from a silent one instead of showing the same card either
   * way.
   */
  spoken: string | null;
}

export interface WalkthroughSummaryRow {
  id: string;
  projectId: string;
  /** The recording this summarises, or null when it came from photos alone. */
  walkthroughId: string | null;
  title: string;
  markdown: string | null;
  status: string;
  photoNotes: SummaryPhotoNote[];
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The DB row shape, before the camelCase mapping the client sees.
 *
 * `markdown` is stripped on the way OUT as well as on the way in, and that is
 * not belt-and-braces. Every summary written before the split carries the old
 * format: a `# Title` the page already renders as its own heading, and a
 * `## Photos` gallery of `![](photo:id)` refs. Those refs only ever resolved
 * through a bespoke image component; rendered as plain Markdown they are broken
 * images, and the photos appear again underneath in their own list.
 *
 * Cleaning here fixes all of them at once, on read, without a second migration
 * rewriting rows the user may have edited.
 */
function toSummary(row: any): WalkthroughSummaryRow {
  const markdown = row.markdown ? stripPhotoGallery(row.markdown) : null;
  return {
    id: row.id,
    projectId: row.project_id,
    walkthroughId: row.walkthrough_id ?? null,
    title: row.title,
    markdown: markdown || null,
    status: row.status ?? "ready",
    photoNotes: parsePhotoNotes(row.photo_notes),
    shareToken: row.share_token ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Validate the jsonb before the UI is allowed to trust it. */
export function parsePhotoNotes(value: unknown): SummaryPhotoNote[] {
  if (!Array.isArray(value)) return [];
  const out: SummaryPhotoNote[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const photoId = (raw as any).photoId;
    if (typeof photoId !== "string" || !photoId) continue;
    const note = typeof (raw as any).note === "string" ? (raw as any).note : "";
    const spokenRaw = (raw as any).spoken;
    out.push({
      photoId,
      offsetSeconds: Number((raw as any).offsetSeconds) || 0,
      note,
      spoken: typeof spokenRaw === "string" && spokenRaw.trim() ? spokenRaw : null,
    });
  }
  return out;
}

/**
 * Strip a photo gallery out of prose the model may still have written.
 *
 * The prompts ask for text only, but a model that has seen the old format
 * sometimes appends the `## Photos` section anyway. Leaving it would put the
 * photos back above their own notes, which is the exact complaint.
 */
export function stripPhotoGallery(markdown: string): string {
  return normalizeDashesTrimmed(
    (markdown ?? "")
      // The whole trailing "## Photos" block, however it was titled.
      .replace(/\n#{1,3}\s*(?:Photos?|Photo\s+gallery|Photographic record)\s*\n[\s\S]*$/i, "\n")
      // Any stray inline photo ref that survived.
      .replace(/!\[[^\]]*\]\(photo:[^)]*\)/g, "")
      // A title, which the page's own heading already provides.
      .replace(/^#\s+.*$/m, "")
      .replace(/\n{3,}/g, "\n\n"),
  );
}

// ===========================================================================
// Reading
// ===========================================================================

export const listProjectSummariesInputSchema = z.object({ projectId: z.string().uuid() });

/**
 * The project's summaries, newest first, with a thumbnail for the list.
 *
 * Separate from `listProjectWalkthroughs` on purpose - that one answers "what
 * did we record", this one answers "what have we written up", and the
 * Walkthroughs tab now asks both questions in two sections rather than
 * conflating them into one list of mixed row types.
 */
export async function listProjectSummariesService(
  ctx: AuthedContext,
  data: z.infer<typeof listProjectSummariesInputSchema>,
) {
  const { data: project } = await ctx.supabase
    .from("projects")
    .select("id")
    .eq("id", data.projectId)
    .maybeSingle();
  if (!project) throw new Error("Project not found or access denied");

  const supabaseAdmin = getSupabaseAdmin();
  const { data: rows, error } = await supabaseAdmin
    .from("walkthrough_summaries" as any)
    .select("*")
    .eq("project_id", data.projectId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);

  const summaries = ((rows as any[]) ?? []).map(toSummary);

  // One signed thumbnail per summary: its first photo. The list shows a card,
  // not a gallery, so anything more is bytes nobody looks at.
  const firstIds = summaries.map((s) => s.photoNotes[0]?.photoId).filter(Boolean) as string[];
  const thumbById = await signPhotoUrls(supabaseAdmin, firstIds);

  return summaries.map((s) => ({
    ...s,
    photoCount: s.photoNotes.length,
    thumbUrl: s.photoNotes[0] ? (thumbById.get(s.photoNotes[0].photoId) ?? null) : null,
  }));
}

/** Signed URLs for a set of photo ids, keyed by id. */
async function signPhotoUrls(
  supabaseAdmin: any,
  photoIds: string[],
  ttlSeconds: number = SIGNED_URL_TTL_OWNER,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = Array.from(new Set(photoIds.filter(Boolean)));
  if (!ids.length) return out;

  const { data: rows } = await supabaseAdmin
    .from("photos")
    .select("id, storage_path, image_url")
    .in("id", ids);
  const list = ((rows as any[]) ?? []).filter((r) => r.storage_path || r.image_url);
  const toSign = list.filter((r) => !r.image_url).map((r) => r.storage_path);
  const signed = new Map<string, string>();
  if (toSign.length) {
    const { data: urls } = await supabaseAdmin.storage
      .from("site-photos")
      .createSignedUrls(toSign, ttlSeconds);
    (urls ?? []).forEach((u: any, i: number) => {
      if (u?.signedUrl) signed.set(toSign[i], u.signedUrl);
    });
  }
  for (const r of list) out.set(r.id, r.image_url ?? signed.get(r.storage_path) ?? "");
  return out;
}

export const getSummaryInputSchema = z.object({ summaryId: z.string().uuid() });

/** One summary, with its photos resolved for rendering. */
export async function getWalkthroughSummaryService(
  ctx: AuthedContext,
  data: z.infer<typeof getSummaryInputSchema>,
) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: row, error } = await supabaseAdmin
    .from("walkthrough_summaries" as any)
    .select("*")
    .eq("id", data.summaryId)
    .maybeSingle();
  if (error || !row) throw new Error("Summary not found");

  // Authorisation on the caller's own client: if RLS will not show them the
  // project, they may not read its summary either.
  const { data: project } = await ctx.supabase
    .from("projects")
    .select("id, name")
    .eq("id", (row as any).project_id)
    .maybeSingle();
  if (!project) throw new Error("Summary not found");

  const summary = toSummary(row);
  return {
    summary,
    projectName: (project as any).name ?? null,
    photos: await resolveSummaryPhotos(supabaseAdmin, summary.photoNotes),
  };
}

export interface ResolvedSummaryPhoto extends SummaryPhotoNote {
  imageUrl: string;
  caption: string | null;
  takenAt: string | null;
}

/**
 * The summary's photos, in note order, each with its image and its note.
 *
 * One array out, because one array is what the page renders. A photo whose row
 * has been deleted drops out rather than rendering as a broken tile.
 */
async function resolveSummaryPhotos(
  supabaseAdmin: any,
  notes: SummaryPhotoNote[],
  ttlSeconds: number = SIGNED_URL_TTL_OWNER,
): Promise<ResolvedSummaryPhoto[]> {
  if (!notes.length) return [];
  const ids = notes.map((n) => n.photoId);
  const { data: rows } = await supabaseAdmin
    .from("photos")
    .select("id, storage_path, image_url, caption, taken_at")
    .in("id", ids);
  const byId = new Map(((rows as any[]) ?? []).map((r) => [r.id, r]));
  const urls = await signPhotoUrls(supabaseAdmin, ids, ttlSeconds);

  return notes
    .filter((n) => byId.has(n.photoId))
    .map((n) => {
      const row = byId.get(n.photoId);
      const caption = cleanCaption(row?.caption ?? null);
      return {
        ...n,
        /*
         * A note the technician typed beats no note at all.
         *
         * Summaries migrated out of `walkthroughs` have an empty `note`: the
         * move filled it from `spoken_note`, which is null for a summary
         * nobody walked. Their photos do have captions, so falling back means
         * those cards read as what was photographed rather than "nothing was
         * recorded against this photo" beside a photo that plainly says what it
         * is. `SummaryPhotoNotes` only prints the caption line separately when
         * it differs from the note, so this does not double up.
         */
        note: n.note?.trim() || caption || "",
        imageUrl: urls.get(n.photoId) ?? "",
        caption,
        takenAt: row?.taken_at ?? null,
      };
    });
}

// ===========================================================================
// Writing
// ===========================================================================

export const generateSummaryFromPhotosInputSchema = z.object({
  projectId: z.string().uuid(),
  photoIds: z.array(z.string().uuid()).min(1).max(MAX_SUMMARY_PHOTOS),
  title: z.string().trim().min(1).max(160).optional(),
});

/**
 * A summary written from photos alone - no walk behind it.
 *
 * Lands in `walkthrough_summaries` with a null `walkthrough_id`, which is the
 * whole of what "no video" now means. It no longer has to pretend to be a
 * recording with a duration of zero.
 */
export async function generateSummaryFromPhotosService(
  ctx: AuthedContext,
  data: z.infer<typeof generateSummaryFromPhotosInputSchema>,
) {
  const { data: project } = await ctx.supabase
    .from("projects")
    .select("id")
    .eq("id", data.projectId)
    .maybeSingle();
  if (!project) throw new Error("Project not found or access denied");

  const supabaseAdmin = getSupabaseAdmin();
  const { data: photoRows, error: photoErr } = await supabaseAdmin
    .from("photos")
    .select("id, caption, taken_at")
    .eq("project_id", data.projectId)
    .is("deleted_at", null)
    .in("id", data.photoIds);
  if (photoErr) throw new Error(photoErr.message);

  const byId = new Map(((photoRows as any[]) ?? []).map((p) => [p.id, p]));
  // The order the user picked them in.
  const photos = data.photoIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
  if (!photos.length) throw new Error("No photos found for this summary");

  const title =
    data.title?.trim() ||
    `Summary - ${new Date().toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;

  let markdown = "";
  let aiFailed: string | null = null;
  try {
    const res = await summarizePhotosReportService(ctx, {
      photoIds: photos.map((p: any) => p.id),
      title,
      mode: "summary",
    });
    markdown = stripPhotoGallery(res.markdown ?? "");
  } catch (e: any) {
    // An inactive plan must not quietly produce a row.
    if (e?.status === 403) throw e;
    aiFailed = e?.message ?? "AI unavailable";
    console.error("[summary] AI draft failed", { message: aiFailed, photos: photos.length });
  }
  if (!markdown.trim()) {
    markdown = "## Overview\n\nSummary of the selected site photos.";
  }

  /*
   * Nobody spoke over a set of photos, so every `spoken` is null and the note
   * is the caption the technician typed. A photo with no caption gets no
   * invented activity - the UI says so rather than the data pretending.
   */
  const photoNotes: SummaryPhotoNote[] = photos.map((p: any) => ({
    photoId: p.id,
    offsetSeconds: 0,
    note: cleanCaption(p.caption) ?? "",
    spoken: null,
  }));

  const { data: row, error } = await supabaseAdmin
    .from("walkthrough_summaries" as any)
    .insert({
      project_id: data.projectId,
      walkthrough_id: null,
      created_by: ctx.userId,
      title,
      markdown,
      status: "ready",
      photo_notes: photoNotes as any,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  return { summary: toSummary(row), aiFailed };
}

export const generateSummaryForWalkthroughInputSchema = z.object({
  walkthroughId: z.string().uuid(),
  /** Rebuild even when this walkthrough already has a summary. */
  force: z.boolean().optional(),
});

/**
 * The Fast Summary Report: the write-up of an actual recorded walk.
 *
 * "The Walkthrough Summary should transcribe/listen to what the user says
 * during the video, generate an AI summary of findings, and pull in any photos
 * taken during that walkthrough."
 *
 * All three come from one place. The transcript is already on the walkthrough
 * row by the time this runs (`transcribeWalkthroughService` writes it when the
 * recording finishes); the findings are drafted from it; and the photos come
 * from `walkthrough_photos`, each matched to what was said nearest the moment
 * it was taken.
 *
 * Returns the existing summary untouched unless `force` is set, so the auto
 * publish after a recording cannot produce a second copy on a retry.
 */
export async function generateSummaryForWalkthroughService(
  ctx: AuthedContext,
  data: z.infer<typeof generateSummaryForWalkthroughInputSchema>,
) {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: walk } = await supabaseAdmin
    .from("walkthroughs" as any)
    .select("id, project_id, title, transcript, duration_seconds, created_by, started_at")
    .eq("id", data.walkthroughId)
    .maybeSingle();
  if (!walk) throw new Error("Walkthrough not found");

  const { data: project } = await ctx.supabase
    .from("projects")
    .select("id, name")
    .eq("id", (walk as any).project_id)
    .maybeSingle();
  if (!project) throw new Error("Walkthrough not found");

  if (!data.force) {
    const { data: existing } = await supabaseAdmin
      .from("walkthrough_summaries" as any)
      .select("*")
      .eq("walkthrough_id", data.walkthroughId)
      .order("created_at", { ascending: true })
      .limit(1);
    const first = ((existing as any[]) ?? [])[0];
    if (first) return { summary: toSummary(first), aiFailed: null, created: false };
  }

  // The photos taken during the walk, in the order they were taken.
  const { data: links } = await supabaseAdmin
    .from("walkthrough_photos" as any)
    .select("photo_id, offset_seconds, spoken_note, position")
    .eq("walkthrough_id", data.walkthroughId)
    .order("position", { ascending: true });
  const linkRows = ((links as any[]) ?? []).filter((l) => l.photo_id);

  const captionById = new Map<string, string | null>();
  if (linkRows.length) {
    const { data: phRows } = await supabaseAdmin
      .from("photos")
      .select("id, caption")
      .in(
        "id",
        linkRows.map((l) => l.photo_id),
      );
    for (const p of (phRows as any[]) ?? []) captionById.set(p.id, p.caption ?? null);
  }

  const transcript = ((walk as any).transcript ?? "").trim();
  const durationSeconds = (walk as any).duration_seconds ?? 0;

  /*
   * One model pass produces both halves: the per-photo notes and the headline.
   * Reusing the narration builder rather than writing a second prompt keeps a
   * single description of what a walkthrough sounded like - and it already
   * refuses to invent speech for a moment nobody spoke at.
   */
  const source: NarrationSource = {
    title: (walk as any).title ?? null,
    projectName: (project as any).name ?? null,
    transcript: transcript || null,
    durationSeconds,
    photos: linkRows.map((l) => ({
      photoId: l.photo_id as string,
      offsetSeconds: l.offset_seconds ?? 0,
      spokenNote: l.spoken_note ?? null,
      caption: captionById.get(l.photo_id) ?? null,
    })),
  };
  const narration = await buildWalkthroughNarration(source);

  const photoNotes: SummaryPhotoNote[] = narration.photos.map((p) => ({
    photoId: p.photoId,
    offsetSeconds: p.offsetSeconds,
    note: p.narration,
    spoken: p.spoken,
  }));

  // The findings, as prose. Drawn from what was said, never from the photos -
  // the model cannot see them.
  const { markdown, aiFailed } = await draftWalkthroughFindings(ctx, {
    title: (walk as any).title ?? "Walkthrough",
    projectName: (project as any).name ?? null,
    transcript,
    photoNotes,
    durationSeconds,
    headline: narration.headline,
  });

  const title = summaryTitleFor((walk as any).title, (walk as any).started_at);
  const { data: row, error } = await supabaseAdmin
    .from("walkthrough_summaries" as any)
    .insert({
      project_id: (walk as any).project_id,
      walkthrough_id: data.walkthroughId,
      created_by: (walk as any).created_by ?? ctx.userId,
      title,
      markdown,
      status: "ready",
      photo_notes: photoNotes as any,
      transcript: transcript || null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  return { summary: toSummary(row), aiFailed, created: true };
}

/** "<walk title> - Summary", without doubling the word if it is already there. */
function summaryTitleFor(walkTitle: string | null | undefined, startedAt: string | null): string {
  const base = (walkTitle ?? "").trim();
  if (base && !/summary/i.test(base)) return `${base} - Summary`.slice(0, 160);
  if (base) return base.slice(0, 160);
  const when = startedAt ? new Date(startedAt) : new Date();
  return `Summary - ${when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

const FINDINGS_SYSTEM =
  "You are Everlumen AI writing up a site walkthrough from what the technician said while recording it. " +
  "Output Markdown with ONLY these sections: '## Overview' (2-4 sentences of plain prose saying what was worked on and what was found), " +
  "and '## Findings' (3-6 short bullets of what the technician actually reported, each leading with the component " +
  "and what was done to or found on it, e.g. '- Contactor replaced' or '- Condenser coil heavily soiled'). " +
  "Add '## Follow-ups' ONLY if the technician explicitly mentioned outstanding work; omit the section otherwise. " +
  "Do NOT include a title, and do NOT list or reference the photos - they are shown separately with their own notes. " +
  "STYLE RULES: neutral and factual. Use ONLY what the transcript and the per-photo notes state - this is a " +
  "recording of somebody talking, so it constrains you more tightly than a set of captions would. " +
  "Write about the work rather than about the recording or the photographs: never 'this documents', " +
  "'the walkthrough documents', 'photo documentation' or 'was documented'. " +
  "Never call anything 'critical', a 'code violation' or a 'safety hazard'. " +
  "Never invent defects, measurements, brands, model numbers, recommendations or next steps. " +
  "If there is little to go on, write less rather than padding. " +
  "Never write an em dash; use a comma, a colon or a plain hyphen.";

/**
 * The written half of the Fast Summary Report.
 *
 * Deliberately has no photo section: the photos are in `photo_notes` and the
 * page renders them under this text. A gallery here would put pictures above
 * their own notes again, which is the layout the client asked to have reversed.
 */
async function draftWalkthroughFindings(
  ctx: AuthedContext,
  args: {
    title: string;
    projectName: string | null;
    transcript: string;
    photoNotes: SummaryPhotoNote[];
    durationSeconds: number;
    headline: string;
  },
): Promise<{ markdown: string; aiFailed: string | null }> {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  if (!args.transcript && !args.photoNotes.length) {
    return {
      markdown: `## Overview\n\nA ${fmt(args.durationSeconds)} walkthrough was recorded. No narration or photos were captured.`,
      aiFailed: null,
    };
  }

  try {
    // Reuses the shared photo-summary drafter when there is no speech: with
    // nothing said, the photos and their captions are all there is to go on,
    // and that service already knows how to be brief about thin material.
    if (!args.transcript) {
      const res = await summarizePhotosReportService(ctx, {
        photoIds: args.photoNotes.map((p) => p.photoId),
        title: args.title,
        mode: "summary",
      });
      return { markdown: stripPhotoGallery(res.markdown ?? ""), aiFailed: null };
    }

    const spokenLines = args.photoNotes
      .map((p, i) =>
        p.spoken ? `- Photo ${i + 1} at ${fmt(p.offsetSeconds)}: "${p.spoken}"` : null,
      )
      .filter(Boolean)
      .join("\n");

    const markdown = await chatComplete(
      FINDINGS_SYSTEM,
      `${args.projectName ? `Project: ${args.projectName}\n` : ""}Walkthrough: ${args.title}
Length: ${fmt(args.durationSeconds)}. Photos captured: ${args.photoNotes.length}.

What was said near each photo:
${spokenLines || "(nothing was said near a photo)"}

Full spoken transcript:
"""
${args.transcript}
"""

Write the Markdown sections only.`,
    );
    return { markdown: stripPhotoGallery(markdown), aiFailed: null };
  } catch (e: any) {
    if (e?.status === 403) throw e;
    const aiFailed = e?.message ?? "AI unavailable";
    console.error("[summary] walkthrough findings draft failed", { message: aiFailed });
    /*
     * The deterministic floor. The headline already came from the narration
     * builder, which falls back rather than throwing, so there is always
     * something honest to show.
     */
    const spoken = args.photoNotes.filter((p) => p.spoken).length;
    return {
      markdown:
        `## Overview\n\n${args.headline}\n\n` +
        `A ${fmt(args.durationSeconds)} walkthrough with ${args.photoNotes.length} ` +
        `${args.photoNotes.length === 1 ? "photo" : "photos"}` +
        (spoken ? `, ${spoken} of them narrated on camera.` : ", recorded without narration.") +
        (args.transcript ? `\n\n## What was said\n\n${args.transcript}` : ""),
      aiFailed,
    };
  }
}

// ===========================================================================
// Editing, sharing, deleting
// ===========================================================================

export const updateSummaryInputSchema = z.object({
  summaryId: z.string().uuid(),
  title: z.string().trim().min(1).max(160).optional(),
  markdown: z.string().max(200_000).optional(),
});

export async function updateWalkthroughSummaryService(
  ctx: AuthedContext,
  data: z.infer<typeof updateSummaryInputSchema>,
) {
  const patch: Record<string, unknown> = {};
  if (data.title !== undefined) patch.title = data.title;
  // Strip a gallery a user may have pasted in: the photos are rendered from
  // photo_notes, and a second copy in the prose is the duplication being fixed.
  if (data.markdown !== undefined) patch.markdown = stripPhotoGallery(data.markdown);
  if (!Object.keys(patch).length) return { ok: true as const };

  const { error } = await (ctx.supabase as any)
    .from("walkthrough_summaries")
    .update(patch)
    .eq("id", data.summaryId);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}

export const setSummaryShareInputSchema = z.object({
  summaryId: z.string().uuid(),
  enable: z.boolean(),
});

/** Issue or revoke the summary's own public link, independent of the video's. */
export async function setSummaryShareService(
  ctx: AuthedContext,
  data: z.infer<typeof setSummaryShareInputSchema>,
) {
  const token = data.enable ? crypto.randomUUID() : null;
  const { data: rows, error } = await (ctx.supabase as any)
    .from("walkthrough_summaries")
    .update({ share_token: token })
    .eq("id", data.summaryId)
    .select("share_token");
  if (error) throw new Error(error.message);
  if (!((rows as any[]) ?? []).length) throw new Error("Summary not found");
  return { token };
}

export const deleteSummaryInputSchema = z.object({ summaryId: z.string().uuid() });

export async function deleteWalkthroughSummaryService(
  ctx: AuthedContext,
  data: z.infer<typeof deleteSummaryInputSchema>,
) {
  const { error } = await (ctx.supabase as any)
    .from("walkthrough_summaries")
    .delete()
    .eq("id", data.summaryId);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}

// ===========================================================================
// Public sharing
// ===========================================================================

export const publicSummaryInputSchema = z.object({ token: z.string().uuid() });

/**
 * A shared summary, for someone with the link and no account.
 *
 * Also the compatibility path for links issued before the split: a
 * `/share/walkthroughs/<token>` URL a client already holds is looked up here as
 * well as in `walkthroughs`, because the token came across with the row.
 */
export async function getPublicSummaryService(data: { token: string }) {
  const supabaseAdmin = getSupabaseAdmin();
  const empty = { summary: null, project: null, photos: [] as ResolvedSummaryPhoto[] };

  const { data: row } = await supabaseAdmin
    .from("walkthrough_summaries" as any)
    .select("*")
    .eq("share_token", data.token)
    .maybeSingle();
  if (!row) return empty;

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("name, location, street, city, state, deleted_at")
    .eq("id", (row as any).project_id)
    .maybeSingle();
  // Trashing the project revokes its shared summary, the same rule the shared
  // walkthrough follows.
  if ((project as any)?.deleted_at) return empty;

  const summary = toSummary(row);
  return {
    summary: {
      id: summary.id,
      title: summary.title,
      markdown: summary.markdown,
      createdAt: summary.createdAt,
      photoCount: summary.photoNotes.length,
      hasSpeech: summary.photoNotes.some((n) => n.spoken),
    },
    project,
    photos: await resolveSummaryPhotos(supabaseAdmin, summary.photoNotes, SIGNED_URL_TTL_SHARED),
  };
}
