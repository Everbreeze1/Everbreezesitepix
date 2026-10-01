import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatSnapOffset, snapNeedsFrame } from "../apps/mobile/src/api/walkthrough-snap-rules";

/*
 * Jon, 2026-09-29: "when I do a walkthrough the photos that I snap do not save
 * and I dont see a shot of what i snapped."
 *
 * On Android, expo-camera in video mode binds no ImageCapture use case, so
 * `takePictureAsync` during a recording could never succeed: every snap failed
 * and nothing showed. The fix takes Android's snaps from the recording at their
 * offset, shows every snap in a strip at once, and queues each through the
 * offline outbox linked to its walkthrough.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const SCREEN = "apps/mobile/app/(app)/project/[id]/walkthrough-record.tsx";

describe("where a snap's picture comes from", () => {
  it("Android takes it from the recording, since it cannot take a still while recording", () => {
    expect(snapNeedsFrame("android")).toBe(true);
    expect(snapNeedsFrame("ios")).toBe(false);
  });

  it("labels a snap with its place in the recording", () => {
    expect(formatSnapOffset(0)).toBe("0:00");
    expect(formatSnapOffset(42.7)).toBe("0:42");
    expect(formatSnapOffset(725)).toBe("12:05");
    expect(formatSnapOffset(-3)).toBe("0:00");
  });

  it("pulls the frame out of the video on the phone with an installed module", () => {
    const src = read("apps/mobile/src/api/walkthrough-snaps.ts");
    expect(src).toContain("generateThumbnailsAsync");
    expect(src).toContain('from "expo-video"');
    // And never lets one snap's failure throw out of the recording.
    expect(src).toMatch(/captureSnapStill[\s\S]*catch/);
  });
});

describe("the recorder", () => {
  it("shows every snap in a strip the moment it is pressed", () => {
    const src = read(SCREEN);
    expect(src).toContain("<SnapStrip snaps={shots} />");
    const snap = src.slice(
      src.indexOf("const snap = useCallback"),
      src.indexOf("async function start"),
    );
    // The placeholder goes into the list before the still is awaited.
    expect(snap.indexOf("newWalkthroughSnap")).toBeGreaterThan(-1);
    expect(snap.indexOf("setShots")).toBeLessThan(snap.indexOf("await captureSnapStill"));
  });

  it("no longer calls takePictureAsync itself or uploads snaps inline", () => {
    const src = read(SCREEN);
    expect(src).not.toMatch(/\.takePictureAsync\(/);
    expect(src).not.toContain("saveWalkthroughPhoto(");
    expect(src).toContain("queueWalkthroughSnaps");
    expect(src).toContain("extractSnapFrames");
  });

  it("queues the walk at Stop instead of saving it inline", () => {
    const src = read(SCREEN);
    const save = src.slice(src.indexOf("  async function saveWalkthrough("));
    // Into the outbox before anything that needs the network or takes time.
    expect(save.indexOf("persistRecording(videoUri, id)")).toBeGreaterThan(-1);
    expect(save.indexOf('kind: "walkthrough_video"')).toBeLessThan(
      save.indexOf("extractSnapFrames("),
    );
    // Snaps are linked to the same walk, by its row when it has no id yet.
    expect(save).toContain("videoRowId: id");
    expect(save).toContain("finishHeld(id)");
    // The old inline chain and its retry button are gone.
    expect(src).not.toContain("Try saving the walkthrough again");
    expect(src).not.toContain("uploadWalkthroughVideo(");
    expect(src).not.toContain("transcribeWalkthrough(");
    expect(src).not.toContain("router.replace(");
  });

  it("puts a tablet's controls in a column on the right", () => {
    const src = read(SCREEN);
    expect(src).toMatch(/const rail = !siteVideo && Math\.min\(winWidth, winHeight\) >= 600/);
    expect(src).toContain("styles.rightRail");
  });
});

describe("the queue", () => {
  it("has a walkthrough photo kind with a handler", () => {
    expect(read("apps/mobile/src/offline/outbox.ts")).toContain('| "walkthrough_photo"');
    const handlers = read("apps/mobile/src/offline/handlers.ts");
    expect(handlers).toMatch(/walkthrough_photo: async \(row\)/);
    expect(handlers).toMatch(/uploadId: row\.id/);
  });

  it("keys the save on the row, so a retry converges on one photo", () => {
    const src = read("apps/mobile/src/api/walkthroughs.ts");
    expect(src).toContain("idempotencyKey: uploadId");
    expect(src).toMatch(
      /const storagePath = `\$\{options\.userId\}\/\$\{options\.projectId\}\/\$\{uploadId\}\.jpg`/,
    );
  });
});
