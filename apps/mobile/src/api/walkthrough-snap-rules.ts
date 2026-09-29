/**
 * The parts of walkthrough snapping that do not touch the camera, kept apart
 * so they can be tested without a device. See `walkthrough-snaps.ts` for the
 * why.
 */

export type WalkthroughSnap = {
  /** Outbox row id this snap will be queued under; also its idempotency key. */
  id: string;
  /** Seconds into the recording when the snap was pressed. */
  offsetSeconds: number;
  /** When it was pressed (ISO). */
  capturedAt: string;
  /** The still, or the frame taken from the recording; null until there is one. */
  uri: string | null;
  width: number | null;
  height: number | null;
  exif: Record<string, unknown> | null;
  /** True when the photo is to be taken from the recording at `offsetSeconds`. */
  needsFrame: boolean;
};

/**
 * Whether a snap on this platform has to come from the recording.
 *
 * Android: yes, always. expo-camera binds no ImageCapture in video mode, so a
 * still while recording cannot succeed there.
 */
export function snapNeedsFrame(platform: string): boolean {
  return platform === "android";
}

/** "0:42", "12:05": where in the recording a snap sits. */
export function formatSnapOffset(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
