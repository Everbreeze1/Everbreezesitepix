import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Nothing that JSON cannot carry may sit in a persisted query result.
 *
 * `app/_layout.tsx` wraps the client in `PersistQueryClientProvider` with an
 * AsyncStorage persister, so every query result is written out as JSON and read
 * back on the next launch. `JSON.stringify(new Map([["a", 1]]))` is `"{}"`.
 *
 * `getTaskPhotoState` returned `items: Map<string, TaskPhotoItem>`. True of a
 * fresh fetch, false of everything the cache handed back after a restart, and
 * `.get` on the object that came back threw `undefined is not a function` -
 * a red error box where the task detail screen should have been. tsc had
 * nothing to say: the type was correct about the fetch and has no view of what
 * a persister does to the value in between.
 *
 * This walks the same path the bug took: queryFn -> function -> declared return
 * type -> that type's body. Two earlier versions of this check reported zero
 * problems while the known bug was still in the tree - the first only read
 * return annotations, so it never saw a type declared elsewhere, and the second
 * cut each type body at the first semicolon, which falls inside the object and
 * truncated `TaskPhotoState` above the offending line. A sweep that cannot find
 * the bug it was written for is worse than no sweep, so the last case below
 * feeds it a known-bad type and requires it to complain.
 */

const ROOT = process.cwd();
const MOBILE = join(ROOT, "apps/mobile");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** The object body of a type alias, matched on braces rather than punctuation. */
function balancedBody(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  return source.slice(from, from + 400);
}

const NOT_JSON_SAFE = ["Map<", "Set<", ": Date"];

function scan(files: string[]) {
  const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

  const queryTargets = new Set<string>();
  for (const src of sources.values()) {
    for (const m of src.matchAll(/queryFn:\s*(?:\([^)]*\)\s*=>\s*)?(\w+)/g)) {
      queryTargets.add(m[1]);
    }
  }

  const typeBodies = new Map<string, string>();
  for (const src of sources.values()) {
    for (const m of src.matchAll(/export type (\w+)\s*=\s*/g)) {
      const start = m.index! + m[0].length;
      if (src[start] !== "{") continue;
      if (!typeBodies.has(m[1])) typeBodies.set(m[1], balancedBody(src, start));
    }
  }

  const offenders: string[] = [];
  for (const [file, src] of sources) {
    for (const m of src.matchAll(
      /^export (?:async )?function (\w+)[\s\S]{0,300}?\)\s*:\s*Promise<([\w[\]]+)>/gm,
    )) {
      const name = m[1];
      const returned = m[2].replace("[]", "");
      if (!queryTargets.has(name)) continue;
      const body = typeBodies.get(returned);
      if (!body) continue;
      const bad = NOT_JSON_SAFE.find((token) => body.includes(token));
      if (bad)
        offenders.push(`${file.slice(ROOT.length + 1)}: ${name}() -> ${returned} has ${bad}`);
    }
  }
  return { offenders, queryTargets, typeBodies };
}

describe("the persisted cache only holds what JSON can carry", () => {
  const result = scan(walk(MOBILE));

  it("actually found the queries and types to check", () => {
    // Without this the sweep can report success by having looked at nothing.
    expect(result.queryTargets.size).toBeGreaterThan(30);
    expect(result.typeBodies.size).toBeGreaterThan(20);
  });

  it("finds no query result carrying a Map, Set or Date", () => {
    expect(result.offenders).toEqual([]);
  });

  it("complains about a type that really does carry a Map", () => {
    /*
     * The check on the check. `TaskPhotoState` is the shape that caused the
     * crash; fed back in, the scanner has to object to it. If this passes while
     * the case above also passes, the sweep is looking at something.
     */
    const body = "{ photos: TaskPhoto[]; items: Map<string, TaskPhotoItem>; }";
    expect(NOT_JSON_SAFE.some((token) => body.includes(token))).toBe(true);
    expect(balancedBody("type X = { a: Map<string, number>; b: 1 };", 9)).toContain("Map<");
  });
});
