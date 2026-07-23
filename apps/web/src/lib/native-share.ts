import { toast } from "sonner";

/**
 * Open the OS native share sheet for a photo. Falls back to copying the
 * image URL to the clipboard when Web Share isn't available.
 */
export async function sharePhotoNative(opts: {
  url: string;
  title?: string;
  text?: string;
}): Promise<void> {
  const { url, title, text } = opts;
  if (!url) {
    toast.error("Photo not ready to share yet");
    return;
  }

  // 1. Try sharing as a file so the native sheet shows Photos/Messages/WhatsApp etc.
  try {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const fileName =
          (title?.replace(/[^a-z0-9\-_.]+/gi, "_") || "photo") +
          (blob.type === "image/png" ? ".png" : ".jpg");
        const file = new File([blob], fileName, { type: blob.type || "image/jpeg" });
        const canShareFiles =
          typeof (navigator as any).canShare === "function" &&
          (navigator as any).canShare({ files: [file] });
        if (canShareFiles) {
          await (navigator as any).share({ files: [file], title, text });
          return;
        }
      } catch {
        /* fall through to URL share */
      }
      // 2. Fall back to sharing the URL only.
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err: any) {
        if (err?.name === "AbortError") return; // user cancelled
      }
    }
  } catch {
    /* ignore */
  }

  // 3. Final fallback — copy link.
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  } catch {
    toast.error("Sharing not supported on this device");
  }
}
