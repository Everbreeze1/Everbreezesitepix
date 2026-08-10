/**
 * Verify that no table leaks rows to an anonymous caller.
 *
 * "Anonymous" here means the publishable key with no Authorization header — and since
 * that key ships inside the browser bundle, anonymous is equivalent to "anyone on the
 * internet". Any table that returns rows to this script is world-readable.
 *
 * This is the regression test for the RLS exposure found on team_invites, walkthroughs
 * and walkthrough_photos. Run it after applying the RLS migration, and again after any
 * future migration that adds a table.
 *
 * Usage: node scripts/verify-anon-exposure.mjs
 * Exits non-zero if anything is readable, so it can gate a deploy.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnv(file) {
  const out = {};
  let text;
  try {
    text = readFileSync(path.join(repoRoot, file), "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = readEnv(".env");
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (checked env and .env).");
  process.exit(2);
}

/**
 * Tables that are legitimately readable without authentication, if any.
 * Keep this list empty unless there is a deliberate, reviewed reason — public share
 * pages are served by the service-role client through `pub()` RPC ops, not by anon
 * reads, so they do not need an entry here.
 */
const INTENTIONALLY_PUBLIC = new Set([]);

const TABLES = [
  "admin_audit_log", "ai_analyses", "api_audit_logs", "api_idempotency_keys",
  "auto_report_generations", "checklist_item_photos", "checklist_template_items",
  "checklist_templates", "document_templates", "feedback_prompt_events", "feedback_signals",
  "issue_reports", "label_set_items", "label_sets", "labels", "notifications",
  "photo_comments", "photos", "platform_admins", "portfolios", "profiles",
  "project_blueprint_applications", "project_boards", "project_checklist_items",
  "project_checklists", "project_document_folders", "project_documents",
  "project_group_members", "project_groups", "project_pages", "project_report_sections",
  "project_reports", "project_site_logs", "project_template_checklists",
  "project_template_items", "project_templates", "project_workflow_items",
  "project_workflow_phases", "project_workflows", "projects", "report_templates",
  "showcase_items", "showcase_sections", "showcases", "tasks", "team_invites",
  "team_members", "team_review_links", "teams", "text_snippets", "walkthrough_photos",
  "walkthroughs", "workflow_template_items", "workflow_template_phases", "workflow_templates",
];

const leaks = [];
const errors = [];

for (const table of TABLES) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: { apikey: ANON_KEY, Prefer: "count=exact", Range: "0-0" },
    });
  } catch (err) {
    errors.push(`${table}: ${err.message}`);
    continue;
  }

  // 404 = table does not exist; 401/403 = correctly denied; 200/206 with rows = exposed.
  if (res.status === 404) continue;
  const range = res.headers.get("content-range") ?? "";
  const total = range.includes("/") ? range.split("/")[1] : null;

  if (res.status < 300 && total && total !== "0" && !INTENTIONALLY_PUBLIC.has(table)) {
    leaks.push({ table, rows: Number(total) });
  }
}

for (const line of errors) console.error(`  network error — ${line}`);

if (leaks.length === 0) {
  console.log(`OK — ${TABLES.length} tables probed, none readable by an anonymous caller.`);
  process.exit(errors.length ? 2 : 0);
}

console.error(`\nFAIL — ${leaks.length} table(s) readable by ANY anonymous caller:\n`);
for (const { table, rows } of leaks) {
  console.error(`  ${table.padEnd(32)} ${rows} rows`);
}
console.error(
  "\nThe publishable key is in the browser bundle, so these rows are public to the internet.\n" +
    "Fix the SELECT policy and the anon table grant for each table above.",
);
process.exit(1);
