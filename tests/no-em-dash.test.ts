import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * No em dashes anywhere in the repo.
 *
 * The site copy was littered with them ("filed here too - create them from
 * Create document", and so on), which reads as machine-written rather than as
 * something the team wrote. They were all replaced with a plain hyphen in one
 * sweep; this test is what stops them coming back, one AI-assisted edit at a
 * time.
 *
 * It scans every tracked file, not just user-facing strings, on purpose: an em
 * dash in a comment is the same tell, and a rule with no exceptions is one
 * nobody has to reason about before hitting save.
 *
 * There is no allowlist, not even for this file, which is why the patterns
 * below are assembled from fragments rather than written out literally: a scan
 * that has to exempt its own definition is a scan somebody will eventually hide
 * something behind.
 */

const ROOT = resolve(__dirname, "..");

const ch = (code: number) => String.fromCharCode(code);

/** Every way an em dash reaches a rendered page. */
const BANNED: Array<{ pattern: RegExp; label: string }> = [
  { pattern: new RegExp(ch(0x2014), "g"), label: "em dash (U+2014)" },
  // Reached for as substitutes, and just as much of a tell.
  { pattern: new RegExp(ch(0x2015), "g"), label: "horizontal bar (U+2015)" },
  { pattern: new RegExp(`${ch(0x2e3a)}|${ch(0x2e3b)}`, "g"), label: "two/three-em dash" },
  // HTML and URL encodings of the same character. The SVG placeholder images in
  // the document-template migrations carry theirs inside a data: URI, where a
  // scan for the raw character never sees it.
  {
    pattern: new RegExp(["&m" + "dash;", "&#" + "8212;", "&#x" + "2014;"].join("|"), "gi"),
    label: "HTML-encoded em dash",
  },
  { pattern: new RegExp("%E2%80" + "%94", "gi"), label: "URL-encoded em dash" },
];

/*
 * Escaped forms stay legal on purpose.
 *
 * A few places have to keep MATCHING an em dash without ever emitting one: the
 * PDF text sanitisers fold it to a hyphen before drawing, and the bulk-add
 * parser strips it off pasted bullet lines. Those are the fix, not the problem,
 * and they write it as a unicode escape rather than as the character itself.
 */

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 1 << 28 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

describe("house style: no em dashes", () => {
  it("no tracked file contains an em dash", () => {
    const offenders: string[] = [];

    for (const rel of trackedFiles()) {
      let buf: Buffer;
      try {
        buf = readFileSync(join(ROOT, rel));
      } catch {
        continue; // unreadable (submodule, or raced with a delete); nothing to scan
      }
      if (buf.includes(0)) continue; // binary: images, fonts

      const lines = buf.toString("utf8").split(/\r?\n/);
      for (const { pattern, label } of BANNED) {
        lines.forEach((line, i) => {
          pattern.lastIndex = 0;
          if (pattern.test(line)) {
            offenders.push(`${rel}:${i + 1} (${label}) ${line.trim().slice(0, 100)}`);
          }
        });
        pattern.lastIndex = 0;
      }
    }

    expect(
      offenders,
      [
        `Em dashes found in ${offenders.length} place(s).`,
        `Use a plain hyphen "-", or split the sentence in two.`,
        `If you genuinely need to MATCH the character (a sanitiser, a parser),`,
        `write it as a unicode escape rather than pasting the character in.`,
        "",
        offenders.join("\n"),
      ].join("\n"),
    ).toEqual([]);
  });
});
