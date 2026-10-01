import { AI_TIMEOUT_MS } from "@everlumen/api-client";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { readExifMeta, resolvePhotoMeta, type Coords } from "./photo-meta";
import { uploadPhotoObject, type CapturedAsset } from "./photos";

/**
 * Walkthroughs: a recorded walk of the site with photos snapped along the way.
 *
 * Unlike photos and checklists, most of this goes through `/v1/rpc` rather than
 * RLS. The session lifecycle writes across several tables and kicks off AI work,
 * which is privileged, so the ops are the contract. See docs/api.md section 3.
 */

export type WalkthroughSummary = {
  id: string;
  title: string;
  status: string | null;
  duration_seconds: number | null;
  created_at: string;
  video_path: string | null;
  transcript: string | null;
  summary_markdown: string | null;
  /** First photo of the walk, signed, for the card's poster frame. */
  thumb_url?: string | null;
  photo_count?: number;
};

/** Video bucket and path shape, matching what the web recorder writes. */
export const WALKTHROUGH_VIDEO_BUCKET = "site-videos";

export function walkthroughVideoPath(
  userId: string,
  projectId: string,
  walkthroughId: string,
  extension: string,
): string {
  return `${userId}/${projectId}/walkthroughs/${walkthroughId}.${extension}`;
}

/**
 * How long one walkthrough may record, per plan, as the web recorder allows
 * (`WALKTHROUGH_MAX_SECONDS` in ProjectDetailPage): 10 minutes on Starter, 15
 * on Pro, 20 on Team. A staff workspace counts as Team, as it does on web.
 */
export const WALKTHROUGH_MAX_SECONDS: Record<string, number> = {
  starter: 600,
  pro: 900,
  team: 1200,
};

export function walkthroughMaxSeconds(plan: string | null | undefined, isInternal = false): number {
  const tier = isInternal ? "team" : (plan ?? "starter");
  return WALKTHROUGH_MAX_SECONDS[tier] ?? WALKTHROUGH_MAX_SECONDS.starter;
}

/**
 * How long the phone waits for a transcript. A whole walk is transcribed in
 * one call, and a fifteen-minute walk takes the server well past the usual AI
 * timeout: hanging up early reports a failure for work that is still going.
 */
export const WALKTHROUGH_TRANSCRIBE_TIMEOUT_MS = 5 * 60_000;

/**
 * Make the walkthrough row.
 *
 * `startedAt` is when Record was pressed. The recorder makes the row at Record
 * when it has signal, as web does, so the row's own start time is right; a
 * walk recorded with none is made later by the offline queue, and passes the
 * real start along. `idempotencyKey` is the queue row's, so a retry after a
 * lost response makes one walkthrough rather than two.
 */
export async function createWalkthroughSession(
  projectId: string,
  title: string,
  options: { startedAt?: string; idempotencyKey?: string } = {},
): Promise<{ id: string }> {
  const result = await api.rpc<{ id: string }>(
    "createWalkthroughSession",
    { projectId, title, ...(options.startedAt ? { startedAt: options.startedAt } : {}) },
    { idempotencyKey: options.idempotencyKey ?? randomUUID() },
  );
  return result;
}

export async function listProjectWalkthroughs(projectId: string): Promise<WalkthroughSummary[]> {
  const result = await api.rpc<WalkthroughSummary[] | { walkthroughs?: WalkthroughSummary[] }>(
    "listProjectWalkthroughs",
    { projectId },
  );
  // The op has returned both shapes across versions; accept either rather than
  // rendering an empty list when only the wrapper changed.
  if (Array.isArray(result)) return result;
  return result?.walkthroughs ?? [];
}

/**
 * Who recorded each walkthrough on a job, keyed by walkthrough id.
 *
 * The list op does not return `created_by`, and the card needs it to say who
 * walked the site. Read over RLS: it is two columns of rows the person can
 * already see. A failure here costs the card its "by" line and nothing else,
 * so it answers empty rather than throwing.
 */
export async function listWalkthroughAuthors(projectId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("walkthroughs")
    .select("id, created_by")
    .eq("project_id", projectId);
  if (error) return new Map();
  return new Map(
    ((data as { id: string; created_by: string | null }[]) ?? [])
      .filter((row) => row.created_by)
      .map((row) => [row.id, row.created_by!]),
  );
}

/**
 * Upload one photo snapped during a recording and register it against the
 * session at its offset.
 *
 * The object goes up over RLS with the same compression and thumbnail rules as
 * any other capture; the row is written by the op, which also creates the
 * `walkthrough_photos` link. Doing the row insert here as well would produce
 * two photos for one capture.
 */
export async function saveWalkthroughPhoto(options: {
  userId: string;
  projectId: string;
  walkthroughId: string;
  asset: CapturedAsset;
  offsetSeconds: number;
  position: number;
  deviceCoords?: Coords | null;
  projectCoords?: Coords | null;
  /**
   * Stable id for this save, from the offline outbox row. The same id gives
   * the same storage path and the same idempotency key, so a retry after a
   * lost response converges on one photo instead of writing two.
   */
  uploadId?: string;
  /** When the snap was taken (ISO): the photo's time when it carries no EXIF. */
  capturedAt?: string;
}): Promise<void> {
  const uploadId = options.uploadId ?? randomUUID();
  const storagePath = `${options.userId}/${options.projectId}/${uploadId}.jpg`;
  const { sizeBytes, thumbPath } = await uploadPhotoObject(options.asset, storagePath);

  const meta = resolvePhotoMeta(
    readExifMeta(options.asset.exif),
    options.deviceCoords ?? null,
    options.projectCoords ?? null,
  );
  const takenAt = readExifMeta(options.asset.exif).takenAt ?? options.capturedAt ?? meta.taken_at;

  await api.rpc(
    "saveWalkthroughPhoto",
    {
      projectId: options.projectId,
      walkthroughId: options.walkthroughId,
      storagePath,
      thumbPath,
      sizeBytes,
      caption: `Walkthrough +${Math.round(options.offsetSeconds)}s`,
      offsetSeconds: Math.max(0, Math.round(options.offsetSeconds)),
      position: options.position,
      takenAt,
      latitude: meta.latitude,
      longitude: meta.longitude,
    },
    { idempotencyKey: uploadId },
  );
}

/**
 * Stream the recording into storage.
 *
 * A walkthrough video is tens of megabytes, so it is uploaded natively from
 * disk to a signed URL rather than read into JavaScript first. Turning a 60MB
 * file into an ArrayBuffer to hand to supabase-js is how a phone runs out of
 * memory holding a copy of something it already has on disk.
 *
 * `sessionType: "background"` lets iOS carry the transfer on after the app is
 * suspended, which is what happens when someone pockets the phone the moment
 * they stop recording.
 */
export async function uploadWalkthroughVideo(options: {
  localUri: string;
  storagePath: string;
  mimeType: string;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const { data, error } = await supabase.storage
    .from(WALKTHROUGH_VIDEO_BUCKET)
    .createSignedUploadUrl(options.storagePath, { upsert: true });

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not start the video upload");
  }

  const file = new File(options.localUri);
  if (!file.exists) throw new Error("The recording is no longer on this device");

  const task = file.createUploadTask(data.signedUrl, {
    httpMethod: "PUT",
    headers: {
      "content-type": options.mimeType,
      "x-upsert": "true",
    },
    mimeType: options.mimeType,
    sessionType: "background",
    onProgress: ({ bytesSent, totalBytes }) => {
      if (totalBytes > 0) options.onProgress?.(Math.round((bytesSent / totalBytes) * 100));
    },
  });

  const result = await task.uploadAsync();
  // The task resolves for any completed response, including a refusal, so the
  // status has to be checked rather than assumed.
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Video upload failed (${result.status})`);
  }
}

export async function updateWalkthroughVideoPath(
  walkthroughId: string,
  videoPath: string,
  videoMimeType: string,
): Promise<void> {
  await api.rpc("updateWalkthroughVideoPath", { walkthroughId, videoPath, videoMimeType });
}

export async function finishWalkthroughSession(
  walkthroughId: string,
  durationSeconds: number,
  liveTranscript?: string,
): Promise<void> {
  await api.rpc(
    "finishWalkthroughSession",
    {
      walkthroughId,
      // The op requires a positive integer, and a recording stopped the instant
      // it started still rounds to zero.
      durationSeconds: Math.max(1, Math.round(durationSeconds)),
      ...(liveTranscript ? { liveTranscript } : {}),
    },
    { idempotencyKey: randomUUID() },
  );
}

/**
 * Ask the server to transcribe the recording it already has.
 *
 * The path, not the bytes. The phone uploaded the video to storage a moment
 * ago; sending it again through `/v1/rpc` as base64 would be a second upload of
 * the same file, a third larger for the encoding, from the worst connection it
 * will ever have.
 *
 * Never throws. Transcription is the one step in the walkthrough lifecycle that
 * can fail without costing the user anything they cannot get back: the video
 * and the photos are already saved, and the transcript can be produced later
 * from the web app. Failing the whole save over it would be the wrong trade.
 *
 * `empty` is a transcription that ran and heard nothing: no speech in the
 * recording, or a server that says it came back empty. Retrying it would pay
 * for the same silence again, so the queue writes it down and moves on.
 */
export async function transcribeWalkthrough(
  walkthroughId: string,
  storagePath: string,
  mimeType: string,
  options: { idempotencyKey?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; message: string | null; empty: boolean }> {
  try {
    const result = await api.rpc<{
      transcript?: string | null;
      empty?: boolean;
      /** "done" | "partial" | "empty" | "failed" | "running" */
      state?: string;
      inProgress?: boolean;
      message?: string;
    }>(
      "transcribeWalkthrough",
      {
        walkthroughId,
        storagePath,
        bucket: WALKTHROUGH_VIDEO_BUCKET,
        mimeType,
      },
      /*
       * AI work, and charged for. A retry after a dropped response would pay
       * for the same transcription twice without the key.
       *
       * The timeout is the other half of that, and it is what stops the dropped
       * response happening in the first place: transcribing a whole recording
       * takes well over the client default, so without it the phone hangs up on
       * work the server is still doing and reports a failure that is not one.
       * The key then rescues the retry - but the person has already been told
       * their recording failed to transcribe.
       */
      {
        idempotencyKey: options.idempotencyKey ?? randomUUID(),
        timeoutMs: options.timeoutMs ?? WALKTHROUGH_TRANSCRIBE_TIMEOUT_MS,
      },
    );
    if (result?.state === "failed") {
      return {
        ok: false,
        message: result.message ?? "Could not transcribe the recording",
        empty: false,
      };
    }
    // Another run of the same transcription is still going: try again later
    // rather than read its unfinished result as an empty one.
    if (result?.inProgress || result?.state === "running") {
      return { ok: false, message: "The transcription is still running", empty: false };
    }
    const empty =
      result?.empty === true ||
      result?.state === "empty" ||
      (typeof result?.transcript === "string" && !result.transcript.trim());
    // "partial" is a transcript with gaps: kept, with the server's sentence.
    return { ok: true, message: result?.message ?? null, empty };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not transcribe the recording",
      empty: false,
    };
  }
}

export async function generateWalkthroughReport(
  walkthroughId: string,
  options: { idempotencyKey?: string } = {},
): Promise<void> {
  await api.rpc(
    "generateWalkthroughReport",
    { walkthroughId },
    // Report generation is AI work and charged for. Without a key, a retry
    // after a dropped response pays for the same report twice; without the
    // timeout, the dropped response is one the client caused by hanging up.
    { idempotencyKey: options.idempotencyKey ?? randomUUID(), timeoutMs: AI_TIMEOUT_MS },
  );
}

export type WalkthroughShot = {
  id: string;
  photo_id: string;
  offset_seconds: number;
  position: number;
  spoken_note: string | null;
  /** Filled in from the `photos` row so the timeline can show a thumbnail. */
  storage_path: string | null;
  thumb_path: string | null;
};

export type WalkthroughDetail = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  duration_seconds: number;
  transcript: string | null;
  summary_markdown: string | null;
  video_path: string | null;
  video_mime_type: string | null;
  share_token: string | null;
  created_at: string;
  shots: WalkthroughShot[];
};

/**
 * One walkthrough with its photo timeline.
 *
 * Read over RLS rather than through an op: this is ordinary owner-scoped
 * reading, and `docs/data-access.md` reserves `/v1` for privileged work.
 */
export async function getWalkthroughDetail(
  walkthroughId: string,
): Promise<WalkthroughDetail | null> {
  const { data: walkthrough, error } = await supabase
    .from("walkthroughs")
    .select(
      "id, project_id, title, status, duration_seconds, transcript, summary_markdown, video_path, video_mime_type, share_token, created_at",
    )
    .eq("id", walkthroughId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!walkthrough) return null;

  const { data: links, error: linkError } = await supabase
    .from("walkthrough_photos")
    .select("id, photo_id, offset_seconds, position, spoken_note")
    .eq("walkthrough_id", walkthroughId)
    .order("position", { ascending: true });

  if (linkError) throw new Error(linkError.message);
  const linkRows = (links as Omit<WalkthroughShot, "storage_path" | "thumb_path">[]) ?? [];

  let shots: WalkthroughShot[] = linkRows.map((row) => ({
    ...row,
    storage_path: null,
    thumb_path: null,
  }));

  if (linkRows.length > 0) {
    /*
     * The paths come from a second read rather than a nested select. The link
     * table has no RLS relationship hint to `photos`, and a photo moved to the
     * trash between recording and viewing simply drops out here, which is the
     * behaviour we want: the timeline entry stays, without a broken tile.
     */
    const { data: photos } = await supabase
      .from("photos")
      .select("id, storage_path, thumb_path")
      .is("deleted_at", null)
      .in(
        "id",
        linkRows.map((row) => row.photo_id),
      );

    const byId = new Map(
      ((photos as { id: string; storage_path: string; thumb_path: string | null }[]) ?? []).map(
        (photo) => [photo.id, photo],
      ),
    );

    shots = linkRows.map((row) => ({
      ...row,
      storage_path: byId.get(row.photo_id)?.storage_path ?? null,
      thumb_path: byId.get(row.photo_id)?.thumb_path ?? null,
    }));
  }

  return { ...(walkthrough as Omit<WalkthroughDetail, "shots">), shots };
}

/** Turn the public share link on or off. */
export async function setWalkthroughShare(
  walkthroughId: string,
  enable: boolean,
): Promise<{ shareToken: string | null }> {
  // `{ token }`. Neither `shareToken` nor `share_token`, both of which were
  // guesses: sharing a walkthrough appeared to succeed and produced no link.
  const result = await api.rpc<{ token?: string | null }>("setWalkthroughShare", {
    walkthroughId,
    enable,
  });
  return { shareToken: result?.token ?? null };
}

/** Signed playback URL for a stored recording. */
export async function signWalkthroughVideo(videoPath: string): Promise<string | null> {
  const { data } = await supabase.storage
    .from(WALKTHROUGH_VIDEO_BUCKET)
    .createSignedUrl(videoPath, 60 * 60);
  return data?.signedUrl ?? null;
}

/**
 * Turn a walkthrough into a report the client actually receives.
 *
 * The end of a chain the phone had only half of. `generateWalkthroughReport`
 * writes the structured report CONTENT onto the walkthrough and stops there -
 * it never touches `project_reports` - so a crew could record a walk, generate
 * its report from the van, and still need a desk to produce the thing anybody
 * outside the company ever sees.
 *
 * Idempotent by design rather than by an idempotency key: the service looks for
 * an existing report for this walkthrough and answers `alreadyExisted` instead
 * of writing a second one. So a second tap is safe, and the screen must not
 * claim it made a new report when it did not.
 *
 * Pro and Team only, enforced server-side. The recorder UI is already behind
 * that gate, so the phone does not re-derive it - it lets the refusal through
 * and shows what the server said.
 */
export async function createReportFromWalkthrough(
  walkthroughId: string,
  photosPerPage?: number,
): Promise<{ reportId: string | null; alreadyExisted: boolean }> {
  const result = await api.rpc<{ reportId?: string; alreadyExisted?: boolean }>(
    "createReportFromWalkthrough",
    {
      walkthroughId,
      ...(photosPerPage ? { photosPerPage } : {}),
    },
    /*
     * The long timeout, like every other op that spends Gemini calls.
     *
     * Without it the client gives up on its default while the server is still
     * writing, and the person is told the report failed - so they tap again,
     * and the second call finds the report the first one did in fact create.
     * The op is idempotent by lookup, so nothing is duplicated; what is lost is
     * their trust in the button.
     */
    { timeoutMs: AI_TIMEOUT_MS },
  );
  return {
    reportId: result?.reportId ?? null,
    // Absent is treated as "new", which is the safe direction for the wording:
    // saying a report was created when one already existed is a smaller error
    // than telling somebody nothing happened when it did.
    alreadyExisted: Boolean(result?.alreadyExisted),
  };
}

/**
 * Rename a walkthrough and edit its notes (the write-up kept on the row).
 *
 * The web detail page's Save: a direct RLS update of `title` and
 * `summary_markdown`, nothing else. The AI Summary is a separate row with its
 * own editor and is not touched.
 */
export async function updateWalkthroughDetails(
  walkthroughId: string,
  patch: { title: string; summary_markdown: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("walkthroughs")
    .update(patch as never)
    .eq("id", walkthroughId);
  if (error) throw new Error(error.message);
}

/**
 * Delete a walkthrough recording.
 *
 * The web's delete: the row goes, and with it the recording's link from this
 * job. The photos taken along the way stay in the project and any AI Summary
 * written from it stays under Walkthroughs, which is what the confirm says.
 */
export async function deleteWalkthrough(walkthroughId: string): Promise<void> {
  const { error } = await supabase.from("walkthroughs").delete().eq("id", walkthroughId);
  if (error) throw new Error(error.message);
}
