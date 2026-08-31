import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The mobile client must SEND the fields the services actually require.
 *
 * `tests/mobile-rpc-shapes.test.ts` guards the other direction - that the phone
 * reads the field names a service returns. This one guards the request, and it
 * exists because the unguarded direction failed in production:
 *
 *   createPhotoShare   `allowDownload: z.boolean()` is required, with no
 *                      default and no `.optional()`. The phone sent only
 *                      `photoId` and `expiresInHours`, the registry runs
 *                      `.parse()` before the service, and so EVERY photo Share
 *                      tap on the phone was rejected before any code ran.
 *
 * Nothing caught it. The op name was real, both fields sent were real, every
 * table and column existed, and TypeScript was satisfied because the client
 * declares its own request types and they typecheck against themselves. It is
 * the same failure shape as the API-host outage: correct-looking code that only
 * fails against the live server.
 *
 * So this reads BOTH sides - the zod schema for what is required, the mobile
 * source for what is sent - and compares them. Neither side is a copy of the
 * contract; they are the contract.
 */

const ROOT = process.cwd();

/**
 * Source with comments removed.
 *
 * Necessary here, not cosmetic: a comma inside a comment sitting between two
 * object properties splits the property list in the wrong place, and the
 * parser below then reads the first word of the prose as a field name. That
 * produced a false positive on `createPhotoComment` the first time this ran.
 *
 * The lookbehind is required by `tests/invariants.test.ts`: an unguarded `/*`
 * opens a comment at any slash-star, including the one inside `accept="image/*"`,
 * and then swallows everything to the next star-slash.
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

/** The `{...}` literal starting at or after `from`, brace-balanced. */
function balanced(src: string, from: number): string | null {
  const start = src.indexOf("{", from);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

/** Split an object literal into its top-level entries, ignoring nested commas. */
function topEntries(literal: string): string[] {
  const inner = literal.slice(1, -1);
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of inner) {
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
    } else buf += ch;
  }
  out.push(buf);
  return out.map((e) => e.trim()).filter(Boolean);
}

/** Every `*InputSchema` and the top-level keys it demands. */
function requiredFields(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const file of walk(join(ROOT, "apps/api/src"))) {
    const src = stripComments(readFileSync(file, "utf8"));
    const re = /export const (\w*InputSchema)\s*=\s*z\.object\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const literal = balanced(src, m.index + m[0].length - 1);
      if (!literal) continue;
      const required: string[] = [];
      for (const entry of topEntries(literal)) {
        const key = /^([A-Za-z_]\w*)\s*:/.exec(entry);
        if (!key) continue;
        const value = entry.slice(key[0].length);
        // A field with a default or marked optional does not have to be sent.
        if (/\.optional\(\)|\.default\(|\.nullish\(\)/.test(value)) continue;
        required.push(key[1]);
      }
      map.set(m[1], required);
    }
  }
  return map;
}

/** Op name to schema name, read from the registry's own `.parse()` wiring. */
function opSchemas(): Map<string, string> {
  const src = stripComments(
    readFileSync(join(ROOT, "apps/api/src/domains/rpc/registry.ts"), "utf8"),
  );
  const map = new Map<string, string>();
  const re = /^ {2}(\w+):\s*(?:authed|pub\w*)\(\s*\n?\s*\(d\)\s*=>\s*(\w+InputSchema)\.parse/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) map.set(m[1], m[2]);
  return map;
}

type Site = { op: string; sent: Set<string>; file: string };

/** Every `rpc("op", { ... })` in the mobile app whose payload is a literal. */
function callSites(): { sites: Site[]; skipped: number } {
  const sites: Site[] = [];
  let skipped = 0;
  for (const file of walk(join(ROOT, "apps/mobile"))) {
    const src = stripComments(readFileSync(file, "utf8"));
    const re = /rpc(?:<[^>]*>)?\(\s*"(\w+)"\s*,/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const literal = balanced(src, m.index + m[0].length - 1);
      if (!literal) {
        skipped += 1;
        continue;
      }
      const entries = topEntries(literal);
      // A spread hides its keys from a static read. Counted, not guessed at.
      if (entries.some((e) => e.startsWith("..."))) {
        skipped += 1;
        continue;
      }
      const sent = new Set<string>();
      for (const entry of entries) {
        const key = /^([A-Za-z_]\w*)/.exec(entry);
        if (key) sent.add(key[1]);
      }
      sites.push({ op: m[1], sent, file: relative(ROOT, file).replace(/\\/g, "/") });
    }
  }
  return { sites, skipped };
}

describe("every mobile request carries the fields its schema requires", () => {
  const required = requiredFields();
  const schemaFor = opSchemas();
  const { sites, skipped } = callSites();

  it("read enough of both sides to be meaningful", () => {
    /*
     * The vacuity guard. Every assertion below is "no offenders found", which
     * is exactly what a parser that silently matched nothing would also report.
     */
    expect(required.size).toBeGreaterThan(100);
    expect(schemaFor.size).toBeGreaterThan(100);
    expect(sites.length).toBeGreaterThan(15);
  });

  it("sends every required field", () => {
    const offenders: string[] = [];
    for (const site of sites) {
      const schema = schemaFor.get(site.op);
      if (!schema) continue;
      const fields = required.get(schema);
      if (!fields?.length) continue;
      const missing = fields.filter((f) => !site.sent.has(f));
      if (missing.length) {
        offenders.push(`${site.op} omits ${missing.join(", ")} (${site.file})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("calls ops that are actually registered", () => {
    // Cheap, and the same class of bug one step earlier: an op name that does
    // not resolve is a 404 the client reports as "Request failed".
    const known = new Set(schemaFor.keys());
    const registry = stripComments(
      readFileSync(join(ROOT, "apps/api/src/domains/rpc/registry.ts"), "utf8"),
    );
    const unknown = sites
      .map((s) => s.op)
      .filter((op) => !known.has(op) && !registry.includes(`  ${op}:`));
    expect(Array.from(new Set(unknown))).toEqual([]);
  });

  it("names what it could not check, so the gap is visible", () => {
    /*
     * Payloads built from a variable or carrying a spread cannot be read
     * statically. That is a real limit rather than a pass, and it is asserted
     * so a refactor that pushed every call through a helper would show up here
     * as coverage collapsing rather than as a green run.
     */
    expect(skipped).toBeLessThan(sites.length);
  });
});
