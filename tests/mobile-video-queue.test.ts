import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Site videos are queued, not uploaded while someone waits.
 *
 * Jon (2026-09-29): "when i shot a video for a few seconds, the whole screen
 * was doing a count down on saving the video ... Videos should be saved fast."
 * The recorder uploaded inline behind a full-screen "Uploading video 42%". It
 * now hands the clip to the offline outbox, as photos go, and closes at once;
 * the drain sends it in the background with the queue banner showing it.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const RECORDER = "apps/mobile/app/(app)/project/[id]/walkthrough-record.tsx";

describe("a site video after Stop", () => {
  const screen = () => read(RECORDER);
  const siteBranch = () => {
    const s = screen();
    const at = s.indexOf("    if (siteVideo) {");
    // Ends where the walkthrough's own save takes over.
    return s.slice(at, s.indexOf("    await saveWalkthrough(", at));
  };

  it("is moved into app storage and queued as a video_upload", () => {
    const branch = siteBranch();
    expect(branch).toContain("persistRecording(videoUri, id)");
    expect(branch).toContain('kind: "video_upload"');
    expect(branch).toContain("requestSync()");
    // Back first; the move and the queue write run after, off the way out.
    expect(branch.indexOf("leaveForCamera();")).toBeLessThan(branch.indexOf("setTimeout("));
    expect(branch.indexOf("setTimeout(")).toBeLessThan(branch.indexOf("persistRecording("));
    // Back to the project even when the recorder was the first screen open.
    expect(screen()).toContain("goBack(`/project/${projectId}`)");
  });

  it("goes back to the camera on Stop with nothing drawn over the live view", () => {
    // Jon (2026-09-29): "The circling thing is still happening when i save a video."
    const s = screen();
    expect(s).not.toContain("Saving video</Text>");
    expect(s).toContain('stage === "saving" && !siteVideo && { opacity: 0.5 }');
    const stop = s.slice(
      s.indexOf("  function stop() {"),
      s.indexOf("  function leaveForCamera()"),
    );
    expect(stop).toContain('siteVideo && Platform.OS === "android"');
    expect(stop).toContain("setTimeout(leaveForCamera, SITE_VIDEO_LEAVE_MS)");
    // Leaving is once only, however many paths ask for it.
    expect(s).toMatch(/function leaveForCamera\(\) \{\s*if \(left\.current\) return;/);
  });

  it("says a failed save on the camera, since the recorder has already gone", () => {
    const branch = siteBranch();
    expect(branch).toContain("leaveCaptureNotice(");
    expect(branch).not.toContain("setError(");
  });

  it("does not upload, count up a percentage or raise an alert on the way out", () => {
    const branch = siteBranch();
    expect(branch).not.toContain("saveSiteVideo");
    expect(branch).not.toContain("onProgress");
    expect(branch).not.toContain("setStatus(`Uploading");
    expect(screen()).not.toContain("Alert.alert");
  });

  it("never draws the full-screen saving page for a site video", () => {
    expect(screen()).toContain('if (stage === "saving" && !siteVideo) {');
  });

  it("keeps the per-plan length limit on the recording", () => {
    const s = screen();
    expect(s).toContain(
      "const maxSeconds = siteVideo ? videoMaxSeconds(team?.plan) : MAX_DURATION_SECONDS;",
    );
    expect(s).toContain("maxDuration: maxSeconds");
  });
});

describe("the queue delivers it", () => {
  it("knows the kind and has a handler for it", () => {
    expect(read("apps/mobile/src/offline/outbox.ts")).toContain('| "video_upload"');
    const handlers = read("apps/mobile/src/offline/handlers.ts");
    expect(handlers).toContain("video_upload: async (row)");
    // Keyed on the row id, so a repeated send overwrites the same object.
    expect(handlers).toContain(
      "storagePath: queuedSiteVideoPath(payload.userId, payload.projectId, row.id)",
    );
  });

  it("writes the videos row only once for a path, however often it is sent", () => {
    const api = read("apps/mobile/src/api/project-videos.ts");
    const save = api.slice(api.indexOf("export async function saveSiteVideo"));
    expect(save).toContain('.eq("storage_path", path)');
    expect(save.indexOf('.eq("storage_path", path)')).toBeLessThan(save.indexOf(".insert("));
  });

  it("tells the camera it was saved, without holding the screen", () => {
    const capture = read("apps/mobile/app/(app)/project/[id]/capture.tsx");
    expect(capture).toContain("const text = takeCaptureNotice();");
  });
});
