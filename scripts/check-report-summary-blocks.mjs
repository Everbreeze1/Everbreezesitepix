// What the Summary rows on a job actually are, and what the Report would quote
// from them.
//
//   node scripts/check-report-summary-blocks.mjs [name-fragment]
//
// Written for the 194 Daniels Drive complaint: "the report shows four
// near-identical 'Summary' blocks in its body instead of one". Four blocks can
// come from two different histories - one walkthrough summarised four times, or
// a photo-only summary generated four times - and which one it was decides
// nothing about the fix (it covers both) but everything about whether the fix
// can be shown to work on this job's real data.
//
// So this reads the live rows and prints, per project:
//   - every walkthrough_summaries row, with what it is keyed to
//   - what currentSummaries() keeps out of them, which is what a Report
//     generated now would quote
//   - every Report already filed, with the number of <h3> blocks its stored
//     HTML carries under "Walkthrough Summaries"
//
// That last one matters on its own: content_html is written at generation time,
// so a Report generated before the fix keeps its four blocks until somebody
// regenerates it. Nothing here is going to change that, and nothing here should
// be read as the fix having failed when an old document still shows four.
//
// READ ONLY. Every request is a GET. It uses the service role key from
// apps/api/.env because a summary a restricted member cannot see is still a row
// the Report's author would have quoted, so the point is to see all of them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NEEDLE = process.argv[2] ?? "daniels";

function loadEnv(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv("apps/api/.env");
const BASE = process.env.SITEPIX_SUPABASE_URL ?? env.SITEPIX_SUPABASE_URL;
const KEY = process.env.SITEPIX_SUPABASE_SERVICE_ROLE_KEY ?? env.SITEPIX_SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) {
  console.error("Missing SITEPIX_SUPABASE_URL / SITEPIX_SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

async function rest(query) {
  const res = await fetch(`${BASE}/rest/v1/${query}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`${res.status} on ${query}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** The rule under test, imported from the service so this cannot drift from it. */
const { currentSummaries } = await import(
  path.join(ROOT, "apps/api/src/domains/projects/comprehensive-report.ts")
).catch(async () => {
  // The service is TypeScript; run the rule through vitest's loader if a plain
  // import cannot take it.
  console.warn("(could not import the service directly - selection preview skipped)");
  return { currentSummaries: null };
});

const projects = await rest(
  `projects?select=id,name&name=ilike.*${encodeURIComponent(NEEDLE)}*&order=name`,
);
if (!projects.length) {
  console.log(`No project matching ${JSON.stringify(NEEDLE)}.`);
  process.exit(0);
}

for (const project of projects) {
  console.log(`\n${"=".repeat(72)}\n${project.name}  [${project.id}]\n${"=".repeat(72)}`);

  const rows = await rest(
    `walkthrough_summaries?select=id,walkthrough_id,title,status,created_at,markdown,photo_notes` +
      `&project_id=eq.${project.id}&order=created_at.desc`,
  );
  console.log(`\nwalkthrough_summaries: ${rows.length} row(s), newest first\n`);
  for (const r of rows) {
    const notes = Array.isArray(r.photo_notes) ? r.photo_notes.length : 0;
    const keyedTo = r.walkthrough_id
      ? `walk ${r.walkthrough_id.slice(0, 8)}`
      : notes
        ? `${notes} photo(s)`
        : "nothing";
    console.log(
      `  ${r.created_at}  ${r.id.slice(0, 8)}  keyed to ${keyedTo.padEnd(16)}` +
        `  ${String((r.markdown ?? "").length).padStart(5)} chars  ${JSON.stringify(r.title)}`,
    );
    console.log(`      opens: ${JSON.stringify((r.markdown ?? "").replace(/\s+/g, " ").slice(0, 100))}`);
  }

  if (currentSummaries) {
    const withProse = rows.filter((r) => (r.markdown ?? "").trim());
    const kept = currentSummaries(withProse);
    console.log(
      `\n  -> a Report generated now quotes ${kept.length} of ${rows.length}: ` +
        kept.map((r) => `${r.id.slice(0, 8)} (${r.created_at.slice(0, 10)})`).join(", "),
    );
  }

  const pages = await rest(
    `project_pages?select=id,title,created_at,content_html&project_id=eq.${project.id}` +
      `&source_template=eq.report&order=created_at.desc`,
  );
  console.log(`\nReports already filed: ${pages.length}\n`);
  for (const page of pages) {
    const html = page.content_html ?? "";
    const section = html.split("<h2>Walkthrough Summaries</h2>")[1] ?? "";
    const blocks = [...section.matchAll(/<h3>(.*?)<\/h3>/g)].map((m) =>
      m[1].replace(/&middot;/g, "-"),
    );
    console.log(`  ${page.created_at}  ${JSON.stringify(page.title)}  blocks=${blocks.length}`);
    for (const b of blocks) console.log(`      ${b}`);
  }
}

console.log(
  `\nA Report filed before the fix keeps the blocks it was generated with. ` +
    `Regenerate it to see the new selection.`,
);
