import * as tus from "tus-js-client";
import { supabase, SITEPIX_SUPABASE_URL } from "@/integrations/sitepix/client";

/**
 * Supabase's resumable endpoint speaks TUS and requires chunks of exactly this
 * size — not a tunable. It doubles as the threshold below which resumable
 * uploads buy nothing: a blob that fits in one chunk gains no resume points,
 * and the protocol's extra creation round-trip just makes it slower.
 */
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

/**
 * Gives up after roughly 38 seconds of retries. Long enough to ride out a
 * tunnel or a cell handover on a job site, short enough that a genuinely dead
 * connection still surfaces while the user is looking at the screen.
 */
const RETRY_DELAYS = [0, 3000, 5000, 10000, 20000];

export type UploadProgress = {
  /** 0-100, rounded. */
  percent: number;
  bytesUploaded: number;
  bytesTotal: number;
};

export type ResumableUploadOptions = {
  bucket: string;
  path: string;
  blob: Blob;
  contentType: string;
  upsert?: boolean;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
};

function reportProgress(
  onProgress: ((p: UploadProgress) => void) | undefined,
  bytesUploaded: number,
  bytesTotal: number,
) {
  onProgress?.({
    percent: bytesTotal > 0 ? Math.round((bytesUploaded / bytesTotal) * 100) : 0,
    bytesUploaded,
    bytesTotal,
  });
}

/**
 * Upload a blob to Storage, resuming across network drops when it is big enough
 * to warrant it.
 *
 * `storage.upload()` is a single-shot PUT: a 300 MB walkthrough that dies at
 * 80% on site LTE starts over from zero. TUS splits the same transfer into 6 MB
 * chunks the server acknowledges individually, so a drop costs one chunk rather
 * than the whole upload, and it retries on its own. Small blobs still take the
 * plain path — one chunk has nothing to resume to.
 *
 * Throws on failure so callers can hold onto the blob and offer a retry.
 */
export async function uploadWithResume(opts: ResumableUploadOptions): Promise<void> {
  const { bucket, path, blob, contentType, upsert = false, onProgress, signal } = opts;

  if (blob.size <= TUS_CHUNK_SIZE) {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, blob, { contentType, upsert });
    if (error) throw error;
    reportProgress(onProgress, blob.size, blob.size);
    return;
  }

  if (!SITEPIX_SUPABASE_URL)
    throw new Error("Storage is not configured (VITE_SUPABASE_URL unset).");
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error("Your session expired — sign in again to upload.");

  reportProgress(onProgress, 0, blob.size);

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(blob, {
      endpoint: `${SITEPIX_SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: RETRY_DELAYS,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-upsert": upsert ? "true" : "false",
      },
      // Send the first chunk with the creation request — saves a round trip,
      // and Supabase expects it.
      uploadDataDuringCreation: true,
      // Without this the localStorage fingerprint outlives the upload and the
      // next attempt at the same object tries to resume something already gone.
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType,
        cacheControl: "3600",
      },
      chunkSize: TUS_CHUNK_SIZE,
      onError: reject,
      onProgress: (bytesUploaded, bytesTotal) =>
        reportProgress(onProgress, bytesUploaded, bytesTotal),
      onSuccess: () => resolve(),
    });

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException("Upload cancelled", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          void upload.abort();
          reject(new DOMException("Upload cancelled", "AbortError"));
        },
        { once: true },
      );
    }

    /*
     * Pick up an interrupted attempt at this same object if one is on record.
     * Best-effort: fingerprints live in localStorage, so this recovers a reload
     * mid-upload but not a different browser. A failed lookup is not a reason
     * to refuse the upload, so fall through to a fresh start either way.
     */
    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0 && previous[0]) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(() => upload.start());
  });
}
