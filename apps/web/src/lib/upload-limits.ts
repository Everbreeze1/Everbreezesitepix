import { formatBytes } from "@/hooks/use-storage-usage";

/**
 * Storage rejects any object larger than the project-wide upload limit. That
 * limit lives in the Supabase dashboard (Storage → Settings) and is not
 * readable from the browser, so `VITE_MAX_UPLOAD_MB` lets a deploy declare the
 * configured value. The fallback is Supabase's own 50 MB default, which is what
 * applies until someone raises it.
 *
 * Worth checking because the recorders out-record it. At their hardcoded
 * bitrates - 1.2 Mbps video + 96 kbps audio for a walkthrough, 2 Mbps + 96 kbps
 * for a project video - every tier's maximum-length recording clears 50 MB:
 * a 10-minute walkthrough lands near 97 MB, a 5-minute Starter video near 79 MB.
 */
const DEFAULT_MAX_UPLOAD_MB = 50;

function configuredMaxMb(): number {
  const parsed = Number(import.meta.env.VITE_MAX_UPLOAD_MB);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_MB;
}

export const MAX_UPLOAD_BYTES = Math.round(configuredMaxMb() * 1024 * 1024);

/**
 * ADVISORY ONLY - never gate an upload on this.
 *
 * Until `VITE_MAX_UPLOAD_MB` is set the limit is an assumption, and refusing to
 * upload on a wrong assumption would break a feature that works. Callers warn,
 * attempt the upload anyway, and keep the blob when the attempt fails.
 */
export function isOverUploadLimit(bytes: number): boolean {
  return bytes > MAX_UPLOAD_BYTES;
}

/** Plain-language warning for a recording that looks too big to accept. */
export function overUploadLimitMessage(bytes: number): string {
  return `This recording is ${formatBytes(bytes)}, over the ${formatBytes(
    MAX_UPLOAD_BYTES,
  )} upload limit - storage will likely reject it. Download a copy so a failed upload doesn't lose it.`;
}
