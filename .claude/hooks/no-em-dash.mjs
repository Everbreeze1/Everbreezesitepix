/*
 * PreToolUse guard: refuse any edit that would write an em dash into the repo.
 *
 * `tests/no-em-dash.test.ts` is the backstop and runs in CI, but by then the
 * character is already committed and the whole file has to be swept again. This
 * catches it at the moment of writing, which is where it actually gets
 * introduced: an assistant drafting UI copy.
 *
 * Reads the tool call as JSON on stdin, exits 2 to block. Exit 0 lets the write
 * through, and anything unparseable is let through too - a broken hook must not
 * be able to wedge the editor.
 *
 * The patterns are assembled from fragments so this file does not match itself.
 */

const ch = (code) => String.fromCharCode(code);

const BANNED = [
  { re: new RegExp(ch(0x2014)), label: "an em dash (U+2014)" },
  { re: new RegExp(ch(0x2015)), label: "a horizontal bar (U+2015)" },
  { re: new RegExp(`${ch(0x2e3a)}|${ch(0x2e3b)}`), label: "a two/three-em dash" },
  {
    re: new RegExp(["&m" + "dash;", "&#" + "8212;", "&#x" + "2014;"].join("|"), "i"),
    label: "an HTML-encoded em dash",
  },
  { re: new RegExp("%E2%80" + "%94", "i"), label: "a URL-encoded em dash" },
];

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const input = payload?.tool_input ?? {};

  // Only the text being written matters. `old_string` is quoted from a file that
  // may still hold one, and blocking on that would make the cleanup edit itself
  // impossible.
  const written = [
    input.content,
    input.new_string,
    input.new_source,
    ...(Array.isArray(input.edits) ? input.edits.map((e) => e?.new_string) : []),
  ].filter((v) => typeof v === "string");

  const found = [
    ...new Set(BANNED.filter(({ re }) => written.some((t) => re.test(t))).map((b) => b.label)),
  ];
  if (found.length === 0) process.exit(0);

  process.stderr.write(
    [
      `Blocked: this edit would write ${found.join(" and ")} into ${input.file_path ?? "a file"}.`,
      "",
      `This repo does not use em dashes anywhere - UI copy, comments, prompts, SQL.`,
      `See the "Writing style" section of CLAUDE.md; tests/no-em-dash.test.ts fails CI on one.`,
      "",
      `Rewrite the text before retrying: split the sentence in two, use a comma, colon or`,
      `parentheses, or use a plain hyphen "-". If you need to MATCH the character rather`,
      `than emit it (a sanitiser, a parser), write it as a unicode escape instead.`,
    ].join("\n"),
  );
  process.exit(2);
});
