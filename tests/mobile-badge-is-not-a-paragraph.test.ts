import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { templateUsabilityWarning } from "../apps/mobile/src/api/workflow-template-edit";

/*
 * A Badge holds a state, not a sentence.
 *
 * `Badge` renders its label with `numberOfLines={1}` in the `overline` variant,
 * which is right for what it is for: "3 required left", "All required
 * answered", "Shared". The workflow template editor put a whole sentence in one
 * and it rendered, in caps, as
 *
 *     NO PHASE HAS ANY STEPS YET, SO THERE WOULD BE ...
 *
 * The warning existed to say what was wrong with the template and was cut off
 * immediately before saying it. Seen on a device; the accessibility tree
 * carries the full string whatever width it is drawn at, so nothing but the
 * pixels showed it.
 */

const ROOT = process.cwd();
const APP = join(ROOT, "apps/mobile/app");

/**
 * Source with comments removed.
 *
 * These guards are about what the app renders, and a comment explaining an old
 * string is not a rendered string. The first version of the sign-off check
 * failed on the note directly above the fix, which quotes the wording it
 * replaced - the test was reading prose and calling it code.
 *
 * The lookbehind is not decoration. `tests/invariants.test.ts` refuses a
 * stripper without it, because a naive one opens a comment at any slash-star -
 * `accept="image/*"` among them - and runs to the next star-slash, deleting
 * real code. A `not.toMatch` then passes because the forbidden code is sitting
 * in the hole. My first version of this helper was the naive form and that
 * invariant caught it.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/(?<![\w"\x27])\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("badges carry short states", () => {
  it("Badge still truncates to one line, which is what makes this matter", () => {
    // If Badge ever wraps, this whole guard can go.
    const badge = readFileSync(join(ROOT, "apps/mobile/src/ui/Badge.tsx"), "utf8");
    expect(badge).toContain("numberOfLines={1}");
  });

  it("no screen puts a sentence-shaped variable in a badge label", () => {
    /*
     * Matched on the names a sentence tends to travel under - `warning`,
     * `message`, `reason`, `body` - rather than on length, which cannot be seen
     * from the source. A short state is usually a literal or a count.
     */
    const offenders: string[] = [];
    for (const file of walk(APP)) {
      const source = code(file);
      for (const m of source.matchAll(/<Badge[^>]*label=\{(\w+)[^}]*\}/g)) {
        if (/^(warning|message|reason|body|note|explanation)$/.test(m[1])) {
          offenders.push(`${relative(APP, file).split(sep).join("/")}: label={${m[1]}}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the workflow warning is a sentence, which is why it could not be a badge", () => {
    /*
     * Ties the guard to the real string. If this is ever shortened to something
     * badge-sized, the reasoning above stops applying and should be revisited.
     */
    const warning = templateUsabilityWarning(1, 0);
    expect(warning).toBeTruthy();
    expect(warning!.length).toBeGreaterThan(40);
    expect(warning).toMatch(/\.$/);
  });

  it("the editor renders it as wrapping text", () => {
    const screen = code(join(APP, "(app)/workflow-template/[templateId].tsx"));
    expect(screen).not.toMatch(/<Badge[^>]*label=\{warning\}/);
    expect(screen).toMatch(/\{warning\}/);
  });
});

describe("a toggle says what it does", () => {
  it("the sign-off control does not stutter", () => {
    /*
     * "Sign-off off" read as a typo on screen, and neither "Sign-off on" nor
     * "Sign-off off" said what the setting controls: whether the phase must be
     * signed off before the job moves past it.
     */
    const screen = code(join(APP, "(app)/workflow-template/[templateId].tsx"));
    expect(screen).not.toContain('"Sign-off off"');
    expect(screen).toContain('"Needs sign-off"');
    expect(screen).toContain('"No sign-off"');
  });
});
