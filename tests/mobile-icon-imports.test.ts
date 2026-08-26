import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * Mobile icons are imported one file at a time, never from the barrel.
 *
 * `import { Camera } from "lucide-react-native"` is what anyone would write and
 * it is what this test exists to stop. Metro does not tree-shake, so that
 * import pulls the module re-exporting all ~1600 icons and every one of them
 * lands in the Hermes bundle. Measured on the Android export the day the icons
 * went in: 6.2MB with the barrel, 4.5MB with per-icon imports, and a grep of
 * the barrel build found `AlarmClockCheck` and `CloudDrizzle` in an app that
 * uses neither.
 *
 * The failure is invisible everywhere it would normally be caught. It
 * typechecks, it lints, it bundles, and the app behaves identically; the only
 * symptom is 1.7MB of download and cold-start parse that nobody attributes to
 * the commit that added it. So the guard is a test rather than a convention in
 * a README.
 *
 * `apps/mobile/src/ui/icons.ts` is the one place allowed to name the package,
 * and `src/ui/Icon.tsx` may import the `LucideIcon` type from it, since a
 * type-only import is erased before the bundler ever sees it.
 */

const ROOT = resolve(__dirname, "..");
const MOBILE = "apps/mobile/";

/** The registry itself, and the type-only import in the Icon wrapper. */
const ALLOWED = new Set(["apps/mobile/src/ui/icons.ts", "apps/mobile/src/ui/Icon.tsx"]);

/** A value import of the package root, which is the one that costs 1.7MB. */
const BARREL = /(?:^|\n)\s*import\s+(?!type\b)[^;]*?from\s+["']lucide-react-native["']/;

/**
 * Any import naming the package, allowed or not, so the allowlist stays honest.
 *
 * Subpaths count: the registry only ever imports
 * `lucide-react-native/dist/esm/icons/<name>`, and matching the bare specifier
 * alone would report it as a stale entry.
 */
const ANY_MENTION = /from\s+["']lucide-react-native(?:\/[^"']*)?["']/;

function mobileSourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z", "apps/mobile"], { cwd: ROOT, maxBuffer: 1 << 28 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
}

describe("mobile icon imports", () => {
  it("never imports values from the lucide-react-native barrel", () => {
    const offenders = mobileSourceFiles().filter((file) => {
      if (ALLOWED.has(file)) return false;
      return BARREL.test(readFileSync(join(ROOT, file), "utf8"));
    });

    expect(
      offenders,
      `Import icons from "@/ui/icons" instead. The barrel ships all ~1600 lucide icons because Metro does not tree-shake, which cost 1.7MB of Hermes bundle when it was last measured. Add the icon to apps/mobile/src/ui/icons.ts if it is not there yet.`,
    ).toEqual([]);
  });

  it("keeps the allowlist to files that actually name the package", () => {
    /*
     * An allowlist entry that no longer mentions the package is a hole left
     * open for the next file to be added under the same name.
     */
    const stale = [...ALLOWED].filter(
      (file) => !ANY_MENTION.test(readFileSync(join(ROOT, file), "utf8")),
    );

    expect(stale, "Remove these from ALLOWED: they no longer import the package.").toEqual([]);
  });

  it("routes every icon the app uses through the registry", () => {
    const registry = readFileSync(join(ROOT, MOBILE, "src/ui/icons.ts"), "utf8");
    const exported = new Set(
      [...registry.matchAll(/export \{ default as (\w+) \}/g)].map((match) => match[1]),
    );

    /*
     * Every name imported from `@/ui/icons` has to exist there. A missing one
     * is `undefined` at runtime, which React renders as a blank space rather
     * than throwing, so a mistyped icon name ships as a control with no glyph.
     */
    const missing = new Map<string, string[]>();

    for (const file of mobileSourceFiles()) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const match of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+["']@\/ui\/icons["']/g)) {
        const names = match[1]
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
          .filter((name) => !name.startsWith("type "));
        const absent = names.filter((name) => !exported.has(name));
        if (absent.length) missing.set(file, absent);
      }
    }

    expect(Object.fromEntries(missing)).toEqual({});
  });
});
