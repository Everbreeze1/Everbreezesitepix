import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A screen names itself once.
 *
 * `PageHeader` draws a large title AND pads for the status bar, which is right
 * for a tab: tabs run with the navigator header switched off, so each one owns
 * its top area. Under a navigator header it is wrong twice over - the name
 * appears in the nav bar and again in 32pt directly below it, and the
 * safe-area inset is added on top of the one the nav bar already applied,
 * which is where a band of empty space under the header comes from.
 *
 * Four screens were doing it. Three repeated the same word (Assistant,
 * Comments, Trash). The fourth was worse and is the reason this is a test
 * rather than four edits: `activity.tsx` showed "Team activity" in the nav bar
 * and "Activity" as a heading, so the screen had two different names at once -
 * and its own file comment asserted it was a tab, which it is not. Nothing in
 * the file said otherwise, because its title is registered in `_layout.tsx`.
 *
 * That is what makes this worth automating: whether a screen has a header is
 * not visible from the screen's own source.
 */

const ROOT = process.cwd();
const APP = join(ROOT, "apps/mobile/app");
const read = (p: string) => readFileSync(p, "utf8");
/** `foo/index` and `foo` are the same route to the navigator. */
const stripIndex = (k: string) => (k.endsWith("/index") ? k.slice(0, -6) : k);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Route key as `_layout.tsx` writes it, e.g. `project/[id]/checklists`. */
function routeKey(file: string): string {
  return relative(join(APP, "(app)"), file).split(sep).join("/").slice(0, -4);
}

describe("no screen draws two headers", () => {
  const layout = read(join(APP, "(app)/_layout.tsx"));

  /*
   * Parsed by splitting on the tag rather than with one regex over the whole
   * file. A lazy pattern spanning `<Stack.Screen ... title:` walks straight
   * past an entry that has no title of its own - the `(tabs)` line, which sets
   * only `headerShown` - and pairs that name with the NEXT screen's title. The
   * regex version silently failed to register `activity` at all, so this suite
   * passed while the bug it exists for was reintroduced.
   */
  const titled = new Map<string, string>();
  const headerless = new Set<string>();
  for (const chunk of layout.split("<Stack.Screen").slice(1)) {
    const element = chunk.slice(0, chunk.indexOf("/>") + 1);
    const name = element.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const title = element.match(/title:\s*"([^"]+)"/)?.[1];
    if (title) titled.set(name, title);
    if (element.includes("headerShown: false")) headerless.add(name);
  }

  const users = walk(APP).filter((f) => read(f).includes("<PageHeader"));

  it("finds the PageHeader screens at all, so this cannot pass vacuously", () => {
    expect(users.length).toBeGreaterThan(0);
  });

  for (const file of users) {
    const key = routeKey(file);
    it(`${key} has no navigator header above its PageHeader`, () => {
      const source = read(file);

      // A header the screen asks for itself.
      const ownHeader = source.includes("<Stack.Screen") && !source.includes("headerShown: false");
      expect(ownHeader, `${key} sets its own Stack.Screen title and a PageHeader`).toBe(false);

      // A header the LAYOUT gives it, which the file itself cannot show you.
      // Tabs are exempt: the tabs group runs with headerShown false.
      const isTab = file.split(sep).join("/").includes("/(tabs)/");
      const fromLayout =
        (titled.has(key) || titled.has(stripIndex(key))) &&
        !headerless.has(key) &&
        !headerless.has(stripIndex(key));
      expect(
        isTab || !fromLayout,
        `${key} is registered in _layout.tsx as "${titled.get(key) ?? titled.get(stripIndex(key))}" and also draws a PageHeader`,
      ).toBe(true);
    });
  }
});

describe("the screens that were fixed keep their subtitle", () => {
  /*
   * The subtitle was the only part of the double header worth keeping: "2
   * questions in this thread" says something a nav bar cannot. Dropping it
   * along with the duplicate title would have been a quiet loss.
   */
  const CASES: [string, string][] = [
    ["(app)/assistant.tsx", "threadSummary"],
    ["(app)/photo/[id]/comments.tsx", "commentsSummary"],
    ["(app)/trash.tsx", "trashSummary"],
    ["(app)/activity.tsx", "Your team, most recent first"],
  ];

  for (const [file, needle] of CASES) {
    it(`${file} still says what the nav bar cannot`, () => {
      const s = read(join(APP, file));
      expect(s).toContain("<ScreenNote");
      expect(s).toContain(needle);
    });
  }

  it("ScreenNote renders nothing rather than an empty gap", () => {
    // Every call site passes an undefined value while its query loads.
    const s = read(join(ROOT, "apps/mobile/src/ui/PageHeader.tsx"));
    expect(s).toContain("if (!text) return null;");
  });
});

describe("a screen does not say the same thing twice", () => {
  /*
   * The other half of naming a screen once.
   *
   * Removing the duplicate 32pt title left a subtler repeat behind. The note
   * under the nav bar is a summary of the list, and the summary for an empty
   * list is the same sentence the empty state is titled with - so the Trash
   * screen read
   *
   *     Trash            (nav bar)
   *     Nothing deleted  (note)
   *     Nothing deleted  (empty state, 24pt, under an icon)
   *
   * Seen on a device after the header fix landed. The empty state wins: it says
   * the same words and then explains the sixty days, so the note stands down
   * while the list is empty.
   */
  const read = (p: string) => readFileSync(join(APP, p), "utf8");

  it("the trash note stands down when there is nothing in it", () => {
    const s = read("(app)/trash.tsx");
    expect(s).toMatch(/\(query\.data \?\? \[\]\)\.length === 0/);
  });

  it("the comments note stands down when there are none", () => {
    expect(read("(app)/photo/[id]/comments.tsx")).toMatch(/comments\.length === 0/);
  });

  it("the empty summaries really do collide, which is why this matters", async () => {
    /*
     * Asserted against the real functions rather than described in prose: if
     * somebody reworded either summary so it no longer collided, the guards
     * above would be protecting nothing and should be reconsidered.
     */
    const { trashSummary } = await import("../apps/mobile/src/api/trash-view");
    const { commentsSummary } = await import("../apps/mobile/src/api/photo-comments-view");

    expect(trashSummary([])).toBe("Nothing deleted");
    expect(read("(app)/trash.tsx")).toContain('title="Nothing deleted"');

    expect(commentsSummary(0)).toBe("No comments yet");
    expect(read("(app)/photo/[id]/comments.tsx")).toContain('title="No comments yet"');
  });

  it("still shows the note once there is something to summarise", () => {
    // The note is the point of the screen when the list is not empty; this must
    // not have quietly turned into "never show a note".
    expect(read("(app)/trash.tsx")).toContain("trashSummary(query.data ?? [])");
    expect(read("(app)/photo/[id]/comments.tsx")).toContain("commentsSummary(comments.length)");
  });
});
