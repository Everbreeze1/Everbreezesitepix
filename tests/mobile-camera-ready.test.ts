import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTimeout } from "../apps/mobile/src/lib/capture-batch";
import {
  leaveCaptureNotice,
  listenCaptureNotice,
  takeCaptureNotice,
} from "../apps/mobile/src/lib/capture-notice";

/*
 * Jon (2026-09-29): "when I take a picture or a video the camera window stays
 * open and doesnt reset. if i try to snap more pictures it wont allow me and
 * error out." And: "Once i snap a photo the edit window should open with all
 * edit and sharing capabilities for that photo i just took."
 *
 * On Android expo-camera unbinds every camera before binding a view's own,
 * and again when a view goes, so the recorder pushed over the camera left it
 * with nothing bound. The camera now lets go before the recorder opens, is
 * remade once it closes, waits for `onCameraReady`, runs one shot at a time
 * and remakes itself after a failed shot.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const CAMERA = "apps/mobile/app/(app)/project/[id]/capture.tsx";
const EDITOR = "apps/mobile/src/components/ShotEditor.tsx";

describe("the camera is ready for the next shot", () => {
  const s = read(CAMERA);

  it("only holds the camera while it is the screen in front", () => {
    expect(s).toContain("const focused = useIsFocused();");
    expect(s).toContain("{cameraLive ? (");
    expect(s).toContain("key={cameraKey}");
    expect(s).toContain("setTimeout(restartCamera, CAMERA_REBIND_MS)");
  });

  it("lets go of the camera before the recorder opens", () => {
    const change = s.slice(s.indexOf("  function changeMode("), s.indexOf("const noticeTimer"));
    expect(change.indexOf("setCameraLive(false);")).toBeLessThan(change.indexOf("router.push("));
  });

  it("waits for the camera, takes one shot at a time and recovers from a failed one", () => {
    expect(s).toContain("onCameraReady={() => {");
    expect(s).toContain("onMountError={() => {");
    const shot = s.slice(
      s.indexOf("  async function takeShot() {"),
      s.indexOf("  async function pickFromLibrary"),
    );
    expect(shot).toContain("if (busy || shooting.current) return;");
    expect(shot).toContain("withTimeout(");
    expect(shot).toContain("restartCamera();");
    expect(shot).toMatch(/finally \{\s*shooting\.current = false;\s*setShutterBusy\(false\);/);
  });

  it("gives up on a camera call that never answers", async () => {
    vi.useFakeTimers();
    const stuck = withTimeout(new Promise<never>(() => {}), 1000);
    vi.advanceTimersByTime(1001);
    await expect(stuck).rejects.toThrow("Timed out");
    vi.useRealTimers();
    await expect(withTimeout(Promise.resolve(3), 1000)).resolves.toBe(3);
  });
});

describe("each photo opens its editor, with no pile", () => {
  const s = read(CAMERA);
  const editor = read(EDITOR);

  it("opens the editor on the shot just saved, over the live camera", () => {
    const save = s.slice(
      s.indexOf("  function saveShot("),
      s.indexOf("  async function storeShot("),
    );
    expect(save).toContain("void storeShot(shot.id);");
    expect(save).toContain("setEditingId(shot.id);");
    // Drawn in the camera's own tree, not in place of it, so the camera stays bound.
    expect(s).not.toMatch(/if \(editingShot && projectId\) \{\s*return/);
    expect(s).toContain("{editingShot && projectId ? (");
  });

  it("shows the last photo only, with no count", () => {
    expect(s).not.toContain("savedCount");
    expect(s).not.toContain("savedBadge");
  });

  it("has every edit and share tool, and one tap back to the camera", () => {
    for (const id of ["voice", "note", "tags", "annotate", "crop", "share", "retake", "delete"]) {
      expect(editor).toContain(`id: "${id}"`);
    }
    expect(editor).toContain('accessibilityLabel="Back to camera"');
    expect(editor).toContain("Back to camera</Text>");
    expect(editor).toContain('BackHandler.addEventListener("hardwareBackPress"');
    // Before/After on the photo, and the tools on the right on a tablet.
    expect(editor).toContain("onPhaseChange(");
    expect(editor).toContain("{wide ? (");
    expect(s).toContain("onShare={() => void shareShot(editingShot.id)}");
    expect(s).toContain("<PhotoShareSheet");
  });
});

describe("the recorder's notice reaches a camera that is listening", () => {
  it("delivers at once to a listener, and waits otherwise", () => {
    const heard: string[] = [];
    const stop = listenCaptureNotice((text) => heard.push(text));
    leaveCaptureNotice("Video saved");
    expect(heard).toEqual(["Video saved"]);
    expect(takeCaptureNotice()).toBeNull();
    stop();
    leaveCaptureNotice("Later");
    expect(heard).toEqual(["Video saved"]);
    expect(takeCaptureNotice()).toBe("Later");
  });
});
