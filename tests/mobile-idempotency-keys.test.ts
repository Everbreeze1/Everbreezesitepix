import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * An op marked idempotent gets no protection unless the client sends a key.
 *
 * `beginIdempotency` opens with `if (!options.key) return { kind: "skip" }`, and
 * `idempotencyKeyFrom` returns null when the `Idempotency-Key` header is absent.
 * So `{ idempotent: true }` in the registry is a capability, not a guarantee: it
 * buys exactly nothing until the caller opts in.
 *
 * Nine mobile calls were in that state. They were not obscure ones - they were
 * every op that spends money on Gemini from the phone (`analyzePhoto`,
 * `extractPhotoText`, `describeSiteLogPhotos`, `regenerateWalkthroughSummary`)
 * and every op that sends mail (`inviteMember`, `inviteSubcontractor`,
 * `resendInvite`, `resendMemberConfirmation`, `replyToFeedback`). A retry after
 * a dropped response paid twice, or emailed somebody twice, and the marking
 * that was supposed to prevent it was inert.
 *
 * Unlike the sibling question of AI timeouts - which needs to know whether a
 * service function reaches a provider, and cannot be answered by a regex over
 * function bodies - this one is exactly decidable. The registry says which ops
 * are idempotent. Nothing has to be inferred.
 */

const ROOT = process.cwd();

/** Source with comments removed, so prose about a key is not mistaken for one. */
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

/**
 * Ops the registry marks idempotent.
 *
 * Read per entry rather than by a window of characters: `{ idempotent: true }`
 * sits at the end of an op's own `authed(...)` block, and a fixed-size lookahead
 * would attribute a long op's flag to the short one after it.
 */
function idempotentOps(): Set<string> {
  const src = stripComments(
    readFileSync(join(ROOT, "apps/api/src/domains/rpc/registry.ts"), "utf8"),
  );
  const starts: { op: string; at: number }[] = [];
  for (const m of src.matchAll(/^ {2}(\w+):\s*(?:authed|pub\w*)\(/gm)) {
    starts.push({ op: m[1], at: m.index! });
  }
  const out = new Set<string>();
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1].at : src.length;
    if (src.slice(starts[i].at, end).includes("idempotent: true")) out.add(starts[i].op);
  }
  return out;
}

describe("every idempotent op is called with a key", () => {
  const idempotent = idempotentOps();
  const files = walk(join(ROOT, "apps/mobile/src")).filter((f) => f.endsWith(".ts"));

  it("read the registry properly", () => {
    // Vacuity: an entry pattern that matched nothing would report a clean run.
    expect(idempotent.size).toBeGreaterThan(30);
    expect(files.length).toBeGreaterThan(40);
  });

  it("sends Idempotency-Key wherever the server would honour it", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const m of src.matchAll(/\brpc\s*(?:<[^()]*>)?\s*\(\s*"(\w+)"/g)) {
        const op = m[1];
        if (!idempotent.has(op)) continue;
        /*
         * A generous window rather than a parsed call: these payloads run to
         * several lines and the options object is the last argument. Too small
         * a window reports a false miss, which is the direction that wastes
         * somebody's afternoon.
         */
        const call = src.slice(m.index!, m.index! + 900);
        if (!call.includes("idempotencyKey")) {
          offenders.push(`${op} (${relative(ROOT, file).replace(/\\/g, "/")})`);
        }
      }
    }

    /*
     * The fix is one argument: `{ idempotencyKey: randomUUID() }`, minted per
     * tap. Fresh per tap rather than derived from the payload, because asking
     * for the same thing twice on purpose is usually legitimate - a second
     * analysis of the same photograph, a second invite to somebody who lost the
     * first - while a retry of ONE tap must not be charged twice.
     */
    expect(Array.from(new Set(offenders))).toEqual([]);
  });

  it("never uses a fixed literal as the key", () => {
    /*
     * The hazard is a CONSTANT, not any particular good form.
     *
     * A hardcoded `"daily-log"` would make every call to that op the same
     * request forever: the second one replays the first one's response, and
     * somebody is handed a stale result with no way to force a real run. That
     * is the one shape worth failing on, so this rejects it rather than
     * allowlisting the shapes that are fine.
     *
     * The legitimate forms are more varied than they first look. A fresh
     * `randomUUID()` per tap is the common one. A stable template literal is
     * also correct where repeating the request must NOT repeat the work -
     * `capture-session.ts` keys a daily-log batch by session and index, so a
     * retry replays rather than appending a second copy of the day. An earlier
     * version of this test allowlisted only uuids and failed that on-purpose
     * key, which is a guard telling somebody to break working code.
     */
    for (const file of files) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (!src.includes("idempotencyKey")) continue;
      const name = relative(ROOT, file).replace(/\\/g, "/");

      for (const m of src.matchAll(/idempotencyKey:\s*("[^"]*"|'[^']*')\s*[,}]/g)) {
        expect.fail(`${name} passes a fixed idempotency key: ${m[1]}`);
      }
    }
  });

  it("the server really does skip without a key", () => {
    /*
     * The premise of this whole file, read from the source rather than
     * remembered. If `beginIdempotency` ever started deriving a key from the
     * body, every assertion above would become unnecessary rather than wrong -
     * and it would be worth knowing which.
     */
    const lib = readFileSync(join(ROOT, "apps/api/src/lib/idempotency.ts"), "utf8");
    expect(lib).toContain('if (!options.key) return { kind: "skip" };');

    const audit = readFileSync(join(ROOT, "apps/api/src/lib/audit.ts"), "utf8");
    expect(audit).toContain('request.headers.get("idempotency-key")');
    expect(audit).toContain("if (!key) return null;");
  });
});
