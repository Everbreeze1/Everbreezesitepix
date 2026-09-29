/**
 * A one-line notice for the camera to show when it is back on screen.
 *
 * The video recorder is pushed over the camera and closes itself the moment a
 * clip is stopped. `router.back()` carries no params, so the recorder leaves its
 * "Video saved" line here. The camera shows it at once when it is listening
 * (it stays mounted under the recorder), or picks it up when it regains
 * focus, in its own small notice pill rather than an alert that has to be
 * dismissed.
 */
let pending: string | null = null;
const listeners = new Set<(text: string) => void>();

export function leaveCaptureNotice(text: string): void {
  if (listeners.size > 0) {
    pending = null;
    for (const listener of listeners) listener(text);
    return;
  }
  pending = text;
}

/** The waiting notice, once: reading it clears it. */
export function takeCaptureNotice(): string | null {
  const text = pending;
  pending = null;
  return text;
}

/**
 * Hear notices as they are left, for as long as the camera is mounted. The
 * recorder finishes queueing a clip after it has already closed, so its line
 * can arrive while the camera is on screen.
 */
export function listenCaptureNotice(listener: (text: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
