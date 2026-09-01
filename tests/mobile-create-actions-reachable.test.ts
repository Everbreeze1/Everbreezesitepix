import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Making one more of something must not get harder the more you have.
 *
 * Reported from a device: on a job with twenty reports, "Start a report" sat
 * below all twenty, so creating the twenty-first meant scrolling past the
 * twenty. The action's reach was shrinking as the data grew - which is the
 * worst direction for it to move, because the screens that most need a new
 * item are the busy ones.
 *
 * The header is the one place a list cannot push off screen. `checklists.tsx`
 * had it right already: a `Plus` in `headerRight` and no button under the
 * rows. Everything else is now measured against that.
 *
 * Not every action below a list is this bug, and the list of exemptions below
 * matters as much as the rule. An action scoped to one row belongs with that
 * row, and a rare expensive one is fine at the foot of the screen.
 */

const ROOT = process.cwd();
const APP = join(ROOT, "apps/mobile/app/(app)");
const read = (p: string) => readFileSync(p, "utf8");

/** Screens whose main create action now lives in the navigation header. */
const FIXED: [string, string][] = [
  ["project/[id]/reports.tsx", "Start a report"],
  ["project/[id]/site-logs.tsx", "Start a log"],
  ["project/[id]/documents.tsx", "New page"],
  ["project/[id]/checklists.tsx", "Start a checklist from a template"],
  ["templates.tsx", "New template"],
  ["groups.tsx", "New group"],
  ["labels.tsx", "New label"],
  ["portfolio.tsx", "Start an empty page"],
  ["team.tsx", "Invite somebody"],
  ["collaborators.tsx", "Invite a firm"],
  ["template/[id].tsx", "Add an item"],
];

describe("the create action is in the header", () => {
  for (const [file, label] of FIXED) {
    it(`${file} offers "${label}" from the header`, () => {
      const s = read(join(APP, file)).replace(/\s+/g, " ");
      expect(s).toContain("headerRight");
      expect(s).toContain(`accessibilityLabel="${label}"`);
    });
  }

  it("and no longer repeats it under the list", () => {
    /*
     * Both would be the duplication problem in a new place, and the one under
     * the list is the copy that scrolls away.
     */
    for (const [file, label] of FIXED) {
      const s = read(join(APP, file)).replace(/\s+/g, " ");
      expect(s, `${file} still has a button under the list`).not.toContain(`label="${label}"`);
    }
  });
});

describe("the exemptions are deliberate", () => {
  /*
   * Recorded so they are not "fixed" later. Each is an action below a list
   * that belongs there.
   */
  const EXEMPT: [string, string][] = [
    // Rare, expensive, once per job, and it needs room to say "Writing the
    // report" while several LLM calls run. An icon cannot say that.
    ["project/[id]/reports.tsx", "Write a whole-job report"],
    // Scoped to ONE phase. A single header button could not know which.
    ["workflow-template/[templateId].tsx", "Add a step"],
    // Opens an inline field that needs the width, and filing happens once a
    // job rather than every visit.
    ["project/[id]/documents.tsx", "New folder"],
    // Archiving is a once-per-template decision, not something reached for
    // while adding checks.
    ["template/[id].tsx", "Archive"],
    // Scoped to ONE phase, like the step button above it.
    ["workflow-template/[templateId].tsx", "Add a step"],
  ];

  for (const [file, label] of EXEMPT) {
    it(`${file} keeps "${label}" below the list on purpose`, () => {
      expect(read(join(APP, file))).toContain(label);
    });
  }
});

describe("no new screen buries its create action", () => {
  it("sweeps every screen with a list", () => {
    /*
     * The tripwire. A create-shaped button appearing after the first list in a
     * file is the shape being banned; anything genuinely exempt goes in the
     * list above with its reason, not silently.
     */
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (name.endsWith(".tsx")) out.push(full);
      }
      return out;
    };

    const allowed = new Set(EXEMPT_LABELS);
    const offenders: string[] = [];

    for (const file of walk(APP)) {
      const s = read(file);
      const listAt = Math.min(
        ...["<FlatList", "<ListGroup>", ".map("]
          .map((t) => s.indexOf(t))
          .filter((i) => i >= 0)
          .concat([Number.POSITIVE_INFINITY]),
      );
      if (!Number.isFinite(listAt)) continue;

      for (const m of s.matchAll(/label="((?:Start|New|Add|Create|Invite) [^"]*)"/g)) {
        if (m.index! <= listAt) continue;
        if (allowed.has(m[1])) continue;
        offenders.push(`${file.slice(APP.length + 1)} -> ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** Labels allowed to sit below a list, each justified in the block above. */
const EXEMPT_LABELS = [
  "Write a whole-job report",
  "Add a step",
  "New folder",
  "Add photo evidence",
  "Add block",
  "New project instead",
  "Add an item to this phase",
  // A submit button inside a modal sheet, not an action below a list.
  "Create and add items",
];
