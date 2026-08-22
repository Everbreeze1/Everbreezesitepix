import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * The Project map shows status in two places: the filter row at the top right
 * and the legend over the map. They were two hand-written lists, and they drifted
 * - the legend learned about Archived while the filter row kept offering only
 * three, so the map painted a colour there was no way to filter by.
 *
 * Both now read one STATUSES array. These tests are what keeps that true: they
 * fail if a second list appears, or if a status joins the vocabulary without a
 * colour, a word and a badge to render it with.
 *
 * Source text, like the rest of tests/invariants.test.ts, because the repo has
 * no React + Google Maps harness to assert against a rendered page.
 */

const ROOT = resolve(__dirname, "..");
const MAP_PAGE = "apps/web/src/features/projects/pages/MapPage.tsx";
const src = readFileSync(join(ROOT, MAP_PAGE), "utf8");

/** The entries of a `const NAME = [...] as const;` array literal. */
const arrayEntries = (name: string) => {
  const body = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(src)?.[1];
  if (body == null) return null;
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
};

/** The keys of a `const NAME: Record<...> = { ... };` object literal. */
const recordKeys = (name: string) => {
  const start = src.indexOf(`const ${name}`);
  if (start < 0) return null;
  // After the `=`, not after the declaration: statusBadgeStyle's own type
  // annotation is `Record<string, { bg: string; text: string }>`, whose braces
  // come first and would otherwise be read as the object literal.
  const assign = src.indexOf("=", start);
  const open = src.indexOf("{", assign);
  let depth = 0;
  let end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}") depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  const body = src.slice(open + 1, end);
  // Top-level keys only: nested objects (the badge styles) must not contribute.
  const keys: string[] = [];
  let nest = 0;
  for (const line of body.split("\n")) {
    const key = nest === 0 ? /^\s*([a-z_]+):/.exec(line)?.[1] : null;
    if (key) keys.push(key);
    nest += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return keys;
};

describe("Project map status vocabulary", () => {
  it("declares the four statuses a project can hold", () => {
    expect(arrayEntries("STATUSES")).toEqual(["active", "on_hold", "completed", "archived"]);
  });

  it.each(["statusColor", "statusLabel", "statusBadgeStyle"])(
    "gives every status a %s entry",
    (record) => {
      const statuses = arrayEntries("STATUSES");
      expect(statuses).not.toBeNull();
      const keys = recordKeys(record);
      expect(keys).not.toBeNull();
      for (const status of statuses!) expect(keys).toContain(status);
    },
  );

  it("builds the filter row and the legend from that one list", () => {
    // The chips: `[...STATUSES, "all" as const].map(`. The legend: `STATUSES.map(`.
    expect(src).toContain('[...STATUSES, "all" as const].map(');
    expect(src).toContain("{STATUSES.map((s) => (");
  });

  it("keeps no second list of statuses to drift from the first", () => {
    /*
     * A literal array of status strings anywhere else in the file is the exact
     * shape of the bug: the old LEGEND_STATUSES, or the old hand-written chip
     * rows, each spelling the vocabulary out a second time.
     */
    const others = [...src.matchAll(/\[\s*"(?:active|on_hold|completed|archived)"[^\]]*\]/g)]
      .map((m) => m[0])
      .filter((literal) => !literal.startsWith('["active", "on_hold", "completed", "archived"]'));
    expect(others).toEqual([]);
  });

  it("names Archived rather than printing the raw status", () => {
    // "archived" reaching the UI unlabelled is the unfriendly-identifier bug.
    expect(recordKeys("statusLabel")).toContain("archived");
    expect(/archived: "Archived"/.test(src)).toBe(true);
  });
});
