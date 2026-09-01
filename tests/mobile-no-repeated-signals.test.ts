import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A row says a thing once.
 *
 * Not a style rule. Every one of these was a real screen saying the same fact
 * two or three times a few points apart, and the cost is not only clutter: a
 * screen reader reads every copy. The portfolio card announced "1 photo, Crewe
 * England, live. Live."
 *
 * Where a signal IS deliberately doubled, it stays. `ListRow`'s unread state
 * draws a dot AND tints the row, and its own comment argues the case: a dot is
 * easy to miss on a list held at arm's length in daylight, and a tint alone
 * disappears for anyone who cannot separate it from the card behind it. That
 * pair is a decision. Three copies of a number was not.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the home notifications row", () => {
  const home = () => read("apps/mobile/app/(app)/(tabs)/index.tsx");

  it("states the count once, in the subtitle", () => {
    /*
     * It used to carry "9 unread" in the subtitle, a "9" count badge, and the
     * unread dot. The badge was the third copy of a number the subtitle
     * already gives in words.
     */
    const s = home().replace(/\s+/g, " ");
    expect(s).toContain('subtitle={unread === 0 ? "Nothing unread" : `${unread} unread`}');
    expect(s).not.toContain("<CountBadge count={unread}");
  });

  it("keeps the dot and tint, which are a documented pair", () => {
    // Removing these instead would have been the wrong half to cut.
    expect(home()).toContain("unread={unread > 0}");
    const row = read("apps/mobile/src/ui/ListRow.tsx");
    expect(row).toContain("Not yet read: a dot and a tinted ground.");
  });
});

describe("the write-up actions", () => {
  const screen = () => read("apps/mobile/app/(app)/summary/[summaryId].tsx");

  it("gives every action an icon", () => {
    /*
     * "Rename" was the only one of four without one, which made it read as the
     * odd item in the stack rather than as a peer.
     */
    const s = screen().replace(/\s+/g, " ");
    for (const label of ["Rename", "Edit the write-up", "Delete write-up"]) {
      const at = s.indexOf(`label="${label}"`);
      expect(at, `${label} is no longer on this screen`).toBeGreaterThan(-1);
      /*
       * Bounded by this Button's own closing tag, not by a character count.
       * A fixed window reached into the NEXT button and found ITS icon, so
       * deleting the Rename icon still passed - which is the exact regression
       * this test exists for.
       */
      const end = s.indexOf("/>", at);
      expect(end, `${label} has no closing tag`).toBeGreaterThan(at);
      expect(s.slice(at, end), label).toContain("icon={");
    }
  });

  it("uses the app's one rename icon rather than a third", () => {
    /*
     * `PenLine` is what Rename already uses on a document folder and on a
     * snippet. Introducing a different glyph here would have made three icons
     * for one verb.
     */
    const s = screen().replace(/\s+/g, " ");
    expect(s).toContain('label="Rename" icon={PenLine}');

    for (const [file, needle] of [
      ["apps/mobile/app/(app)/project/[id]/documents.tsx", "icon={PenLine}"],
      ["apps/mobile/src/ui/SnippetSheet.tsx", "icon={PenLine}"],
    ] as const) {
      expect(read(file), file).toContain(needle);
    }
  });

  it("does not use one glyph for two different verbs on one screen", () => {
    /*
     * The reason the body editor moved to `NotebookPen`: renaming and rewriting
     * are different actions and were drawing the same pen. `NotebookPen`
     * already means "something written up" in `DailyLogCard`, so it is the
     * closer fit for the body anyway.
     */
    const s = screen().replace(/\s+/g, " ");
    expect(s).toContain('label="Edit the write-up" icon={NotebookPen}');
    expect(read("apps/mobile/src/ui/DailyLogCard.tsx")).toContain("icon={NotebookPen}");
  });
});

describe("the portfolio card", () => {
  it("leaves the published state to the badge", () => {
    // Guarded here as well as in mobile-portfolio.test.ts, because the two
    // halves live in different files and drifting apart loses the state.
    const view = read("apps/mobile/src/api/portfolio-view.ts");
    expect(view).not.toContain('parts.push(isPublished(project) ? "live" : "draft")');
    expect(read("apps/mobile/app/(app)/portfolio.tsx")).toContain(
      'label={isPublished(project) ? "Live" : "Draft"}',
    );
  });
});

describe("the pipeline stage list", () => {
  it("does not repeat the selected chip as a section header", () => {
    /*
     * "Lead/Quoted 0" sat directly under "LEAD/QUOTED (0)". The chip row is the
     * section header on that screen.
     */
    const s = read("apps/mobile/app/(app)/pipelines.tsx").replace(/\s+/g, " ");
    expect(s).not.toContain('title={stage ? `${stage.name} (${inStage.length})` : "Stages"}');
    expect(s).toContain('{stage ? null : <SectionHeader title="Stages" />}');
  });
});

/*
 * Nobody is named by a raw address.
 *
 * The team roster showed the workspace owner as "marklagura223@gmail" above
 * ".com" - broken across its own domain, which reads as a rendering fault
 * rather than as a person. The same fallback was written out six separate
 * times, so the same bug existed in six places and had been fixed in none.
 *
 * `personName` is now the single answer. This suite exists because the fix is
 * the kind that gets undone by somebody writing a seventh one.
 */
describe("every display name goes through one helper", () => {
  const SITES = [
    "apps/mobile/src/api/team-roster.ts",
    "apps/mobile/src/api/subcontractor-view.ts",
    "apps/mobile/src/api/photo-comments-view.ts",
    "apps/mobile/src/api/member-projects-view.ts",
    "apps/mobile/src/api/project-assignees-view.ts",
    "apps/mobile/src/api/task-mentions.ts",
  ];

  for (const file of SITES) {
    it(`${file.split("/").pop()} uses personName`, () => {
      expect(read(file)).toContain("personName(");
    });
  }

  it("and nobody has written a seventh copy of the fallback", () => {
    /*
     * The shape being banned: `x.fullName || x.email` straight into a title.
     * Matched with whitespace normalised, because prettier reflows it and a
     * multi-line regex would quietly stop matching.
     */
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const dir = "apps/mobile/src/api";
    const offenders: string[] = [];
    for (const name of readdirSync(join(ROOT, dir))) {
      if (!name.endsWith(".ts")) continue;
      const file = `${dir}/${name}`;
      // The watcher list is the documented exception, below.
      if (name === "task-watchers-view.ts") continue;
      const s = read(file).replace(/\s+/g, " ");
      if (/(?:full_?[Nn]ame)\??\.?(?:trim\(\))?\s*\|\|\s*\w+\.?\w*\.?email/.test(s)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("except the watcher list, which keeps the whole address on purpose", () => {
    /*
     * Not an oversight, and the one place "making it consistent" would be
     * wrong: the watcher list answers "who is getting mailed about this", and
     * the domain is how you tell a colleague from a subcontractor you are about
     * to copy in.
     */
    const s = read("apps/mobile/src/api/task-watchers-view.ts");
    expect(s).toContain('watcher.email?.trim() || "Teammate"');
    expect(s).toContain('Do not "make this consistent"');
  });
});

/*
 * One action, offered once.
 *
 * Two blue buttons doing the same thing, touching each other at the bottom of
 * the screen, is not "discoverable" - it is a screen that looks unfinished, and
 * it makes the reader stop to work out whether the two differ.
 */
describe("a screen offers each action once", () => {
  it("the walkthroughs FAB hides while the empty state offers the same thing", () => {
    /*
     * With nothing recorded, `ListEmptyComponent` draws "Record one" and the
     * FAB drew "Record" directly beside it. Same destination, same colour,
     * abutting. The project photo grid already hid its FAB on this condition;
     * this screen had not followed it.
     */
    const s = read("apps/mobile/app/(app)/project/[id]/walkthroughs.tsx").replace(/\s+/g, " ");
    expect(s).toContain("{isLoading || walkthroughs.length === 0 ? null : (");
    // The empty state's action is an object prop, not a JSX attribute.
    expect(s).toContain('label: "Record one"');
  });

  it("and so does the project photo FAB, which set the precedent", () => {
    const s = read("apps/mobile/app/(app)/project/[id]/index.tsx").replace(/\s+/g, " ");
    expect(s).toContain("filtered.length === 0 ? null : (");
  });

  it("no other screen floats an unguarded action", () => {
    /*
     * Only two screens have a FAB. If a third appears, it has to answer the
     * same question, so this fails rather than quietly letting it through.
     */
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (name.endsWith(".tsx")) out.push(full);
      }
      return out;
    };
    const withFab = walk(join(ROOT, "apps/mobile/app")).filter((f) =>
      readFileSync(f, "utf8").includes("styles.fab"),
    );
    expect(withFab).toHaveLength(2);
    for (const f of withFab) {
      expect(readFileSync(f, "utf8").replace(/\s+/g, " "), f).toMatch(/length === 0 \? null : \(/);
    }
  });
});

describe("two rows in one list do not share a glyph", () => {
  it("Documents and Site logs are told apart", () => {
    /*
     * Both drew `FileText`, four rows apart in the same card, which is the same
     * as neither having an icon. Site logs is "the day's photos, written up",
     * which is what `NotebookPen` already means on the Daily Log card - so the
     * two places a site log appears now look like each other too.
     */
    const s = read("apps/mobile/app/(app)/project/[id]/index.tsx").replace(/\s+/g, " ");
    expect(s).toContain('icon={FileText} title="Documents"');
    expect(s).toContain('icon={NotebookPen} title="Site logs"');
    expect(read("apps/mobile/src/ui/DailyLogCard.tsx")).toContain("icon={NotebookPen}");
  });
});

/*
 * A row's title gets the width it needs.
 *
 * `ListRow` draws a trailing chevron whenever it is tappable, which is right
 * for a navigation row and wrong for one that already carries its own
 * controls. Three screens had three icon buttons AND the chevron competing
 * with the title for one line, and the title lost: checklist items read
 * "Overall structural c...", which is no way to tell one check from another.
 *
 * A chevron beside three buttons is the least informative of the four - the
 * buttons say what they do, the chevron only says "this row does something".
 */
describe("rows with their own controls drop the chevron", () => {
  const OVERLOADED = [
    "apps/mobile/app/(app)/template/[id].tsx",
    "apps/mobile/app/(app)/workflow-template/[templateId].tsx",
    "apps/mobile/app/(app)/project/[id]/documents.tsx",
  ];

  for (const file of OVERLOADED) {
    it(`${file.split("/").pop()} suppresses it`, () => {
      expect(read(file)).toContain("chevron={false}");
    });
  }

  it("the opt-out exists and defaults to showing it", () => {
    /*
     * Default on, so an ordinary navigation row still looks tappable. Only a
     * row that has earned the exception takes it.
     */
    const row = read("apps/mobile/src/ui/ListRow.tsx");
    expect(row).toContain("chevron = true,");
    expect(row).toContain("{onPress && chevron ?");
  });

  it("finds every row that needs it, measured across the whole element", () => {
    /*
     * Spanning to the NEXT `<ListRow`, not a fixed character window. These
     * elements run to eight thousand characters, so a window sized by guess
     * reported the fix as missing on rows that already had it - a sweep that
     * cries wolf gets ignored, which is worse than no sweep.
     */
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (name.endsWith(".tsx")) out.push(full);
      }
      return out;
    };

    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "apps/mobile/app"))) {
      const s = readFileSync(file, "utf8");
      const parts = s.split("<ListRow");
      for (let i = 1; i < parts.length; i++) {
        const body = parts[i];
        const buttons = (body.match(/<IconButton/g) ?? []).length;
        if (buttons >= 2 && body.includes("onPress=") && !body.includes("chevron={false}")) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/*
 * A full-screen scrim says what tapping it does.
 *
 * Both lightboxes close on a tap anywhere, which is the right gesture and needs
 * no visible button. But the project one carried `accessibilityRole="button"`
 * with no label, and it has the photograph's caption inside it - so a screen
 * reader took the caption as the button's name and announced the picture's
 * description as if it were the action.
 *
 * This slipped past an earlier sweep of mine that accepted a role OR a label.
 * A role without a name is not accessible; it is a button called nothing.
 */
describe("the lightbox scrims are named", () => {
  const SCRIMS = [
    "apps/mobile/app/(app)/(tabs)/gallery.tsx",
    "apps/mobile/app/(app)/project/[id]/index.tsx",
  ];

  for (const file of SCRIMS) {
    it(`${file.split("/").pop()} labels its close target`, () => {
      const s = read(file).replace(/\s+/g, " ");
      const at = s.indexOf("setLightboxId(null)");
      expect(at, "no lightbox in this file any more").toBeGreaterThan(-1);
      expect(s).toContain('accessibilityLabel="Close photo"');
    });
  }

  it("both still close on a tap, which is the gesture that matters", () => {
    for (const file of SCRIMS) {
      expect(read(file).replace(/\s+/g, " "), file).toContain(
        "onPress={() => setLightboxId(null)}",
      );
    }
  });
});
