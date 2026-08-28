import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { twMerge } from "tailwind-merge";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const DIALOG = read("apps/web/src/components/ui/dialog.tsx");
const EDIT_PROJECT = read("apps/web/src/features/projects/components/EditProjectDialog.tsx");
const CLAMP = "max-h-[calc(100dvh-2rem)]";

const FULL_SCREEN_DIALOGS = [
  "apps/web/src/features/photos/components/PhotoAnnotator.tsx",
  "apps/web/src/features/photos/components/VideoPlayerDialog.tsx",
  "apps/web/src/features/photos/components/CameraCapture.tsx",
  "apps/web/src/features/photos/components/WalkthroughRecorder.tsx",
  "apps/web/src/features/photos/components/ScanCrop.tsx",
];

/**
 * A dialog is fixed and centred on the viewport, so one taller than the window
 * is not merely cramped: it hangs off the top and the bottom at the same time,
 * and because nothing on the page scrolls it, its footer is unreachable. Edit
 * project hit this first (eleven fields and a footer), but the clamp belongs on
 * the primitive so the next long form cannot repeat it.
 */
describe("dialogs stay inside the viewport", () => {
  it("clamps DialogContent to the window height and scrolls the overflow", () => {
    expect(DIALOG).toContain(CLAMP);
    expect(DIALOG).toMatch(/overflow-y-auto/);
  });

  it("lets a dialog that sizes itself opt out with a class cn() can collapse", () => {
    for (const rel of FULL_SCREEN_DIALOGS) {
      expect(read(rel), rel).toMatch(/max-h-\[100dvh\]/);
    }
    // The opt-out has to be one tailwind-merge actually resolves. max-h-none is
    // not in the same conflict group as an arbitrary max-h here, so it would
    // leave both declarations in the class list and let stylesheet order decide.
    expect(twMerge(CLAMP, "max-h-[100dvh]").match(/max-h-\S+/g)).toEqual(["max-h-[100dvh]"]);
    for (const rel of FULL_SCREEN_DIALOGS) {
      expect(read(rel), `${rel} must not opt out with max-h-none`).not.toMatch(/max-h-none/);
    }
  });

  it("pins the Edit project footer and scrolls only the fields", () => {
    // Save changes and Move to Trash sit outside the scrolling region, so they
    // are on screen whatever the window height is.
    expect(EDIT_PROJECT).toMatch(
      /<DialogContent className="flex max-h-\[calc\(100dvh-2rem\)\] flex-col[^"]*overflow-hidden/,
    );
    expect(EDIT_PROJECT).toMatch(/<DialogHeader className="shrink-0/);
    expect(EDIT_PROJECT).toMatch(/<div className="min-h-0 flex-1 [^"]*overflow-y-auto/);
    expect(EDIT_PROJECT).toMatch(/<DialogFooter className="shrink-0/);
  });

  it("never lets a self-sized dialog inherit the clamp by accident", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".tsx")) files.push(full);
      }
    };
    walk(join(ROOT, "apps/web/src"));

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const re = /<DialogContent[\s\S]{0,400}?className="([^"]*)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const cls = m[1];
        const setsHeight = /\b(h-screen|h-\[100dvh\]|h-\[100vh\]|h-full)\b/.test(cls);
        // Whatever it sets, cn() has to leave exactly one max-height behind.
        const resolved = twMerge(CLAMP, cls).match(/max-h-\S+/g) ?? [];
        if (setsHeight && (resolved.length !== 1 || resolved[0] === CLAMP)) {
          offenders.push(`${relative(ROOT, file)}: ${resolved.join(" ") || "(clamped)"}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
