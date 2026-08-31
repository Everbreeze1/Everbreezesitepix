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

export async function createWalkthroughSession(
  projectId: string,
  title: string,
): Promise<{ id: string }> {
  const result = await api.rpc<{ id: string }>(
    "createWalkthroughSession",
    { projectId, title },
    { idempotencyKey: randomUUID() },
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
}): Promise<void> {
  const storagePath = `${options.userId}/${options.projectId}/${randomUUID()}.jpg`;
  const { sizeBytes, thumbPath } = await uploadPhotoObject(options.asset, storagePath);

  const meta = resolvePhotoMeta(
    readExifMeta(options.asset.exif),
    options.deviceCoords ?? null,
    options.projectCoords ?? null,
  );

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
      takenAt: meta.taken_at,
      latitude: meta.latitude,
      longitude: meta.longitude,
    },
    { idempotencyKey: randomUUID() },
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
 */
export async function transcribeWalkthrough(
  walkthroughId: string,
  storagePath: string,
  mimeType: string,
): Promise<{ ok: boolean; message: string | null }> {
  try {
    await api.rpc(
      "transcribeWalkthrough",
      {
        walkthroughId,
        storagePath,
        bucket: WALKTHROUGH_VIDEO_BUCKET,
        mimeType,
      },
      // AI work, and charged for. A retry after a dropped response would pay
      // for the same transcription twice without this.
      { idempotencyKey: randomUUID() },
    );
    return { ok: true, message: null };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not transcribe the recording",
    };
  }
}

export async function generateWalkthroughReport(walkthroughId: string): Promise<void> {
  await api.rpc(
    "generateWalkthroughReport",
    { walkthroughId },
    // Report generation is AI work and charged for. Without a key, a retry
    // after a dropped response pays for the same report twice.
    { idempotencyKey: randomUUID() },
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
  );
  return {
    reportId: result?.reportId ?? null,
    // Absent is treated as "new", which is the safe direction for the wording:
    // saying a report was created when one already existed is a smaller error
    // than telling somebody nothing happened when it did.
    alreadyExisted: Boolean(result?.alreadyExisted),
  };
}
