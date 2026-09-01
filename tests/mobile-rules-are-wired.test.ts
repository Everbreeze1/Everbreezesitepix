import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A rule nobody calls is a feature nobody has.
 *
 * The mobile port keeps its decisions in import-free `*-view.ts` and
 * `*-rules.ts` modules so they can be tested without a device. That is worth
 * doing, and it has one failure mode nothing else in this repo catches:
 *
 *   `tsc` and `npm test` both pass, completely, on a rule module that is
 *   perfectly correct, thoroughly tested, and wired to no screen at all.
 *
 * It happened twice in one session. Document folders shipped with an API layer,
 * a rules module and 22 tests, and the Documents screen was never connected to
 * any of it - while the device-testing runbook told somebody to go and test
 * creating folders. Writing up a selection of photos shipped the same way.
 * Both were green the whole time.
 *
 * So this asserts the other direction: every exported rule is reachable from
 * something that is not a test. "Reachable" means used by app code or by
 * another export in its own module - a helper called by its own neighbours is
 * fine, a helper called only by its own spec file is not.
 */

const ROOT = process.cwd();
const MOBILE = join(ROOT, "apps/mobile");

/**
 * Source with comments removed.
 *
 * Not optional here. These modules are heavily commented and the comments name
 * the functions they explain, so a rule mentioned in a screen's own doc comment
 * counted as "used by that screen" - which is exactly backwards, because the
 * comment is usually the thing left behind when the wiring is removed. The
 * first version of this test passed a mutation that unwired `groupByFolder`,
 * for precisely that reason.
 *
 * The lookbehind is required by `tests/invariants.test.ts`: an unguarded
 * slash-star opens a comment inside `accept="image/*"` and swallows the file.
 */
const stripComments = (src: string) =>
  src.replace(/(?<![\w"'])\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".expo") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** The import-free decision modules. */
function ruleModules(): string[] {
  return walk(MOBILE).filter((f) => /[\\/](?:[\w-]+-view|[\w-]+-rules)\.ts$/.test(f));
}

/**
 * Rules that are exported, tested, and deliberately not called yet.
 *
 * Each needs a reason. This is not a place to park something forgotten: an
 * entry here is a claim that the rule is written ahead of a screen on purpose,
 * or that the screen it was written for took a different route.
 */
const ALLOWED = new Map<string, string>([
  [
    "trash-view.ts:deleteRefusal",
    // Written for `softDeleteProject`, which restricts to `owner_id`. The phone
    // trashes through the offline outbox instead, and RLS there allows any
    // teammate (`are_teammates(auth.uid(), created_by)`), so an owner-only
    // refusal would block something the server permits. The two paths really do
    // have different permission semantics; that is a server question, not a
    // client one.
    "the phone trashes via the outbox, where RLS allows any teammate",
  ],
  ["photo-ai-view.ts:analysisSummary", "written before the analysis screen chose its own wording"],
  [
    "photo-shares-view.ts:exposureSummary",
    "the sheet counts live links itself; kept for a photo-row badge",
  ],
  [
    "pipeline-view.ts:stageOnBoard",
    "the phone shows one board at a time and never needs the lookup",
  ],
  [
    "push-view.ts:deviceLabel",
    "written for a 'signed in on' device list the phone does not have yet",
  ],
  ["portfolio-view.ts:taglineError", "the phone does not edit the portfolio tagline"],
  ["push-view.ts:canPrompt", "the OS prompt is driven by expo-notifications' own permission state"],
  [
    "report-view.ts:comprehensiveTitleError",
    "the whole-job report is generated without asking for a title",
  ],
  ["report-view.ts:photosPerPageError", "page density is not offered on the phone yet"],
  ["task-watchers-view.ts:addWarning", "the section explains watching once, rather than per add"],
]);

describe("every rule is wired to something", () => {
  const modules = ruleModules();
  const all = walk(MOBILE).map((f) => ({ path: f, src: stripComments(readFileSync(f, "utf8")) }));

  it("found the rule modules to check", () => {
    // The vacuity guard: a glob that matched nothing would report a clean run.
    expect(modules.length).toBeGreaterThan(20);
  });

  it("no exported rule is reachable only from its own tests", () => {
    const offenders: string[] = [];

    for (const file of modules) {
      const src = stripComments(readFileSync(file, "utf8"));
      const name = file.split(/[\\/]/).pop()!;

      for (const match of src.matchAll(/^export function (\w+)/gm)) {
        const fn = match[1];
        const word = new RegExp(`\\b${fn}\\b`);

        // Used by a neighbour inside its own module? More than the declaration.
        const internal = (src.match(new RegExp(`\\b${fn}\\b`, "g")) ?? []).length > 1;
        // Used anywhere else under apps/mobile?
        const external = all.some((f) => f.path !== file && word.test(f.src));

        if (internal || external) continue;
        const key = `${name}:${fn}`;
        if (ALLOWED.has(key)) continue;
        offenders.push(`${key} (${relative(ROOT, file).replace(/\\/g, "/")})`);
      }
    }

    /*
     * A failure here is not "delete this function". It is nearly always the
     * screen that is missing: the rule was written, tested and then never
     * connected. Wire it, or add it to ALLOWED with a reason.
     */
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist honest", () => {
    // An entry that has since been wired should be removed, otherwise the list
    // grows into a place where real misses can hide.
    const stale: string[] = [];
    for (const key of ALLOWED.keys()) {
      const [name, fn] = key.split(":");
      const file = modules.find((f) => f.endsWith(name));
      if (!file) {
        stale.push(`${key} (module gone)`);
        continue;
      }
      const src = stripComments(readFileSync(file, "utf8"));
      const internal = (src.match(new RegExp(`\\b${fn}\\b`, "g")) ?? []).length > 1;
      const external = all.some((f) => f.path !== file && new RegExp(`\\b${fn}\\b`).test(f.src));
      if (internal || external) stale.push(`${key} is wired now`);
    }
    expect(stale).toEqual([]);
  });

  it("every allowlist entry gives a reason", () => {
    for (const [key, reason] of ALLOWED) {
      expect(reason.length, key).toBeGreaterThan(20);
    }
  });
});
