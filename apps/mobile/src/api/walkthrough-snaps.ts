import { Platform } from "react-native";
import type { CameraView } from "expo-camera";
import { createVideoPlayer } from "expo-video";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { Coords } from "./photo-meta";
import { snapNeedsFrame, type WalkthroughSnap } from "./walkthrough-snap-rules";
import { persistCapture } from "@/offline/media";
import { enqueue, newOutboxId } from "@/offline/outbox";
import type { WalkthroughPhotoPayload } from "@/offline/handlers";

export {
  calibrateSnapOffsets,
  countMissingFrames,
  encoderDelaySeconds,
  formatSnapOffset,
  missingFramesNotice,
  snapNeedsFrame,
  type WalkthroughSnap,
} from "./walkthrough-snap-rules";

/**
 * Photos snapped during a walkthrough recording.
 *
 * WHY THIS IS NOT JUST `takePictureAsync`
 *
 * On Android, expo-camera's CameraView in `mode="video"` binds CameraX's
 * Preview and VideoCapture use cases only; ImageCapture is bound in picture
 * mode alone (ExpoCameraView.kt, `createCamera`). So a still taken while a
 * walkthrough is recording is sent to an unbound use case and fails, every
 * time. That is why Jon's snaps "do not save" and no shot ever appeared.
 * Switching the camera to picture mode would end the recording, so there is
 * no still to be had from the camera while it records.
 *
 * What there is, is the recording. Each snap on Android marks its moment,
 * and when the recording stops the frame at that moment is pulled out of the
 * video on the phone (expo-video's `generateThumbnailsAsync`, which asks
 * Android's MediaMetadataRetriever for the closest frame) and saved as the
 * photo. iOS keeps its photo output bound while recording, so a real still is
 * taken there; if that ever fails it falls back to the same frame, so a snap
 * is never lost to the camera.
 *
 * Either way each snap is copied into the outbox's own storage and sent by the
 * offline queue like every other photo. That happens at Stop, alongside the
 * recording, rather than at the snap: the frames come from the finished video,
 * and each snap's offset is first corrected for the encoder's late start
 * (`encoderDelaySeconds`). A walk recorded with no signal has no walkthrough
 * yet, so its snaps carry the queued video's row id and are linked to the
 * walkthrough when that row makes it.
 */

/** How long to wait for a recording's length before going without it. */
const DURATION_TIMEOUT_MS = 4000;

/** A still that has not arrived by now is not coming; mark the frame instead. */
const STILL_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * A snap at `offsetSeconds` into the recording, before it has a picture: what
 * the strip shows the instant the button is pressed.
 */
export function newWalkthroughSnap(offsetSeconds: number): WalkthroughSnap {
  return {
    id: newOutboxId(),
    offsetSeconds,
    capturedAt: new Date().toISOString(),
    uri: null,
    width: null,
    height: null,
    exif: null,
    needsFrame: true,
  };
}

/**
 * Take the still for a snap, where the platform can.
 *
 * Never throws: a snap that cannot be a still stays a frame to take from the
 * recording at Stop, which is what Android always does.
 */
export async function captureSnapStill(
  camera: CameraView | null,
  snap: WalkthroughSnap,
): Promise<WalkthroughSnap> {
  if (!camera || snapNeedsFrame(Platform.OS)) return snap;
  try {
    const picture = await withTimeout(
      camera.takePictureAsync({ exif: true, quality: 1, shutterSound: false }),
      STILL_TIMEOUT_MS,
    );
    if (!picture?.uri) return snap;
    return {
      ...snap,
      uri: picture.uri,
      width: picture.width,
      height: picture.height,
      exif: (picture.exif as Record<string, unknown> | undefined) ?? null,
      needsFrame: false,
    };
  } catch {
    return snap;
  }
}

/**
 * The length of a finished recording, in seconds, read from the file itself.
 * Null when it cannot be read in time; the caller then goes by the clock.
 */
export async function readVideoDuration(videoUri: string): Promise<number | null> {
  const player = createVideoPlayer(videoUri);
  try {
    if (player.duration > 0) return player.duration;
    return await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        sub.remove();
        resolve(player.duration > 0 ? player.duration : null);
      }, DURATION_TIMEOUT_MS);
      const sub = player.addListener("sourceLoad", ({ duration }) => {
        clearTimeout(timer);
        sub.remove();
        resolve(duration > 0 ? duration : null);
      });
    });
  } catch {
    return null;
  } finally {
    player.release();
  }
}

/**
 * Fill in every snap that is waiting for its frame, from the finished
 * recording. A frame that cannot be read leaves that snap without a file; the
 * rest still save.
 */
export async function extractSnapFrames(
  videoUri: string,
  snaps: WalkthroughSnap[],
  durationSeconds: number,
): Promise<WalkthroughSnap[]> {
  const waiting = snaps.filter((s) => s.needsFrame && !s.uri);
  if (!waiting.length) return snaps;

  const player = createVideoPlayer(videoUri);
  const filled = new Map<string, WalkthroughSnap>();
  try {
    // A snap in the last instant can sit past the final frame; step back a
    // little so the closest frame is one that exists.
    const last = Math.max(0, durationSeconds - 0.2);
    for (const snap of waiting) {
      try {
        const [thumb] = await player.generateThumbnailsAsync(
          Math.min(Math.max(0, snap.offsetSeconds), last),
        );
        if (!thumb) continue;
        const rendered = await ImageManipulator.manipulate(thumb).renderAsync();
        const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
        filled.set(snap.id, {
          ...snap,
          uri: saved.uri,
          width: saved.width,
          height: saved.height,
        });
      } catch {
        // This one frame is lost; the others are not.
      }
    }
  } finally {
    player.release();
  }
  return snaps.map((s) => filled.get(s.id) ?? s);
}

/**
 * Queue every snap that has a file, linked to its walkthrough at its offset.
 *
 * Queued, not uploaded: the rows survive the app closing and a dead signal,
 * and drain in the background with the queue banner showing them, like any
 * photo from the camera. Returns how many were queued.
 */
export async function queueWalkthroughSnaps(options: {
  userId: string;
  projectId: string;
  /** Null when the walkthrough is still to be made by the queued video. */
  walkthroughId: string | null;
  /** The queued `walkthrough_video` row that makes it. */
  videoRowId?: string | null;
  snaps: WalkthroughSnap[];
  deviceCoords?: Coords | null;
  projectCoords?: Coords | null;
}): Promise<number> {
  let queued = 0;
  for (let position = 0; position < options.snaps.length; position += 1) {
    const snap = options.snaps[position];
    if (!snap.uri) continue;
    let localUri: string;
    try {
      localUri = persistCapture(snap.uri, snap.id);
    } catch {
      continue;
    }
    const payload: WalkthroughPhotoPayload = {
      userId: options.userId,
      projectId: options.projectId,
      walkthroughId: options.walkthroughId ?? "",
      videoRowId: options.videoRowId ?? null,
      offsetSeconds: snap.offsetSeconds,
      position,
      width: snap.width,
      height: snap.height,
      exif: snap.exif,
      capturedAt: snap.capturedAt,
      deviceCoords: options.deviceCoords ?? null,
      projectCoords: options.projectCoords ?? null,
    };
    await enqueue({
      id: snap.id,
      kind: "walkthrough_photo",
      projectId: options.projectId,
      localUri,
      payload,
    });
    queued += 1;
  }
  return queued;
}
