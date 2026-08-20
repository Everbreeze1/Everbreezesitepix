import { toast } from "sonner";

/**
 * How long to wait on the OS share sheet before giving the caller its turn back.
 *
 * `navigator.share()` is specified to reject when it cannot show a sheet, and on
 * a phone it does. On desktop it is not reliable: Chrome and Edge on Windows
 * hand back a promise that simply never settles when the sheet fails to appear -
 * no window, no rejection, nothing. Anything awaiting it waits forever, which is
 * how the photo bar's Share button used to spin until the page was reloaded.
 *
 * Twelve seconds is longer than a person needs to pick an app out of the sheet,
 * so a real share is never cut short. Timing out is deliberately silent: the
 * sheet may well be open and waiting, and a toast claiming otherwise over the
 * top of it would be a lie.
 */
const SHARE_SHEET_TIMEOUT_MS = 12_000;

/**
 * The window a share has to start in, after the click that asked for it.
 *
 * Browsers only honour `navigator.share()` while the user gesture that led to
 * it is still live (five seconds in Chrome). Downloading the image first spends
 * that budget, so the fetch is capped well inside it: a slow photo means we
 * share the link instead of the file, rather than reaching the share call too
 * late for the browser to accept it.
 */
const FETCH_BUDGET_MS = 2_500;

/** Resolve when `p` settles or the timeout fires, whichever comes first. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<{ settled: boolean; error?: any }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ settled: false }), ms);
    p.then(
      () => {
        clearTimeout(timer);
        resolve({ settled: true });
      },
      (error) => {
        clearTimeout(timer);
        resolve({ settled: true, error });
      },
    );
  });
}

/**
 * Open the OS native share sheet for a photo. Falls back to copying the
 * image URL to the clipboard when Web Share isn't available.
 *
 * Always resolves. Never leaves a caller's spinner running.
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

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  if (canShare) {
    // 1. Try sharing as a file so the native sheet shows Photos/Messages/WhatsApp etc.
    try {
      const controller = new AbortController();
      const cutoff = setTimeout(() => controller.abort(), FETCH_BUDGET_MS);
      let file: File | null = null;
      try {
        const res = await fetch(url, { signal: controller.signal });
        const blob = await res.blob();
        const fileName =
          (title?.replace(/[^a-z0-9\-_.]+/gi, "_") || "photo") +
          (blob.type === "image/png" ? ".png" : ".jpg");
        file = new File([blob], fileName, { type: blob.type || "image/jpeg" });
      } finally {
        clearTimeout(cutoff);
      }
      const canShareFiles =
        file !== null &&
        typeof (navigator as any).canShare === "function" &&
        (navigator as any).canShare({ files: [file] });
      if (canShareFiles) {
        const outcome = await withTimeout(
          (navigator as any).share({ files: [file], title, text }),
          SHARE_SHEET_TIMEOUT_MS,
        );
        // Cancelling the sheet is a completed share as far as we are concerned.
        if (!outcome.settled || !outcome.error || outcome.error?.name === "AbortError") return;
      }
    } catch {
      /* fall through to URL share */
    }

    // 2. Fall back to sharing the URL only. Wrapped, because `share()` can also
    // throw synchronously rather than returning a promise to reject.
    try {
      const outcome = await withTimeout(
        navigator.share({ title, text, url }),
        SHARE_SHEET_TIMEOUT_MS,
      );
      if (!outcome.settled) return; // sheet is presumably up; saying anything here would be a guess
      if (!outcome.error || outcome.error?.name === "AbortError") return;
    } catch {
      /* fall through to the clipboard */
    }
  }

  // 3. Final fallback - copy link.
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  } catch {
    toast.error("Sharing not supported on this device");
  }
}
