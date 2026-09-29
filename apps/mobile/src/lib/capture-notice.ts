/**
 * A one-line notice for the camera to show when it is back on screen.
 *
 * The video recorder is pushed over the camera and closes itself the moment a
 * clip is queued. `router.back()` carries no params, so the recorder leaves its
 * "Video saved" line here and the camera picks it up when it regains focus,
 * in its own small notice pill rather than an alert that has to be dismissed.
 */
let pending: string | null = null;

export function leaveCaptureNotice(text: string): void {
  pending = text;
}

/** The waiting notice, once: reading it clears it. */
export function takeCaptureNotice(): string | null {
  const text = pending;
  pending = null;
  return text;
}
