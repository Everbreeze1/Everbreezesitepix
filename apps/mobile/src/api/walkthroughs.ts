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

export async function generateWalkthroughReport(walkthroughId: string): Promise<void> {
  await api.rpc(
    "generateWalkthroughReport",
    { walkthroughId },
    // Report generation is AI work and charged for. Without a key, a retry
    // after a dropped response pays for the same report twice.
    { idempotencyKey: randomUUID() },
  );
}

/** Signed playback URL for a stored recording. */
export async function signWalkthroughVideo(videoPath: string): Promise<string | null> {
  const { data } = await supabase.storage
    .from(WALKTHROUGH_VIDEO_BUCKET)
    .createSignedUrl(videoPath, 60 * 60);
  return data?.signedUrl ?? null;
}
