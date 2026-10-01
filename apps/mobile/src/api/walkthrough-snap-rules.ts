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

/**
 * The most a recording's start can lag the Record press. Anything larger is a
 * misread length, not the encoder, and is not trusted.
 */
export const MAX_ENCODER_DELAY_SECONDS = 5;

/**
 * How late the video began after Record was pressed.
 *
 * A snap's offset is timed from the press, but the encoder takes a moment to
 * start, so the video is that much shorter than the time on the clock and
 * every frame taken at a snap's offset comes from just after the moment that
 * was snapped. Measured at Stop as the clock's length less the video's own.
 * Zero when the video's length is not known.
 */
export function encoderDelaySeconds(
  wallSeconds: number,
  videoSeconds: number | null | undefined,
): number {
  if (!videoSeconds || !Number.isFinite(videoSeconds) || videoSeconds <= 0) return 0;
  if (!Number.isFinite(wallSeconds)) return 0;
  const delay = wallSeconds - videoSeconds;
  if (delay <= 0 || delay > MAX_ENCODER_DELAY_SECONDS) return 0;
  return delay;
}

/** Every snap moved back by the encoder's delay, never before the start. */
export function calibrateSnapOffsets(
  snaps: WalkthroughSnap[],
  delaySeconds: number,
): WalkthroughSnap[] {
  if (!delaySeconds) return snaps;
  return snaps.map((s) => ({ ...s, offsetSeconds: Math.max(0, s.offsetSeconds - delaySeconds) }));
}

/** Snaps still without a picture after their frames were taken from the video. */
export function countMissingFrames(snaps: WalkthroughSnap[]): number {
  return snaps.filter((s) => !s.uri).length;
}

/** "3 photos could not be taken from the video", or null when none were lost. */
export function missingFramesNotice(missing: number): string | null {
  if (missing <= 0) return null;
  return `${missing} ${missing === 1 ? "photo" : "photos"} could not be taken from the video`;
}
