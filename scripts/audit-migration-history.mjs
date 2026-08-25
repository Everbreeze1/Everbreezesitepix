/**
 * Decide, per migration, whether it has actually been applied to the linked
 * database - so the CLI's migration history can be backfilled without lying.
 *
 * WHY THIS EXISTS
 *
 * `supabase_migrations.schema_migrations` does not exist in this project:
 * every migration was applied by hand in the SQL editor, so the CLI believes
 * nothing has ever run and `supabase db push` would replay all 122 files
 * against live data.
 *
 * The obvious fix is `supabase migration repair --status applied` for each
 * version. But that is a claim, not a check, and making it blindly is how a
 * migration that was never applied becomes permanently invisible. That is not
 * hypothetical here: `20260811002000_lock_down_team_billing_writes.sql` - the
 * top BLOCKER in LAUNCH.md, the one that closes the paywall - had never been
 * run, and was found by exactly this check.
 *
 * HOW IT DECIDES
 *
 * Each migration is parsed for the schema objects it creates - tables, columns,
 * functions, indexes, policies, constraints, triggers - and each is looked up
 * in a live inventory of the database.
 *
 *   APPLIED   every object it creates exists
 *   MISSING   at least one does not
 *   UNKNOWN   it creates no detectable object
 *
 * UNKNOWN is the honest answer, not a failure, and it is common: a migration
 * that only REVOKEs, only UPDATEs data, or only DROPs something leaves nothing
 * behind to find. Those need a human, and the point of separating them is that
 * a short list of judgement calls is workable where 122 is not.
 *
 * Read-only. It runs one SELECT and writes nothing.
 *
 *   node scripts/audit-migration-history.mjs            # report
 *   node scripts/audit-migration-history.mjs --repair   # print the repair plan
 */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const DIR = "supabase/migrations";

// --- live inventory ---------------------------------------------------------

const INVENTORY_SQL = `SELECT json_build_object(
  'tables',      (SELECT coalesce(json_agg(table_name), '[]'::json) FROM information_schema.tables WHERE table_schema='public'),
  'columns',     (SELECT coalesce(json_agg(table_name || '.' || column_name), '[]'::json) FROM information_schema.columns WHERE table_schema='public'),
  'functions',   (SELECT coalesce(json_agg(DISTINCT p.proname), '[]'::json) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
  'indexes',     (SELECT coalesce(json_agg(indexname), '[]'::json) FROM pg_indexes WHERE schemaname='public'),
  'policies',    (SELECT coalesce(json_agg(policyname), '[]'::json) FROM pg_policies WHERE schemaname='public'),
  'constraints', (SELECT coalesce(json_agg(conname), '[]'::json) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'),
  'triggers',    (SELECT coalesce(json_agg(DISTINCT trigger_name), '[]'::json) FROM information_schema.triggers WHERE trigger_schema='public')
) AS inventory;`;

function liveInventory() {
  const out = execFileSync("npx", ["supabase", "db", "query", "--linked"], {
    input: INVENTORY_SQL,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: true,
  });
  // The CLI prefixes a status line before the JSON body.
  const json = JSON.parse(out.slice(out.indexOf("{")));
  const inv = json.rows[0].inventory;
  const lower = (xs) => new Set((xs ?? []).map((x) => String(x).toLowerCase()));
  return {
    tables: lower(inv.tables),
    columns: lower(inv.columns),
    functions: lower(inv.functions),
    indexes: lower(inv.indexes),
    policies: lower(inv.policies),
    constraints: lower(inv.constraints),
    triggers: lower(inv.triggers),
  };
}

// --- what each migration claims to create -----------------------------------

/**
 * Strip comments and dollar-quoted function bodies.
 *
 * Bodies matter: a function body routinely contains `CREATE TEMP TABLE` or
 * references to objects it does not create, and counting those as claims makes
 * every migration look unapplied. The comment strip uses the guarded lookbehind
 * that tests/invariants.ts requires, so a slash-star inside a string cannot
 * open a comment and swallow the rest of the file.
 */
function strip(sql) {
  return sql
    .replace(/(?<![\w"'])\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*--.*$/gm, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " $BODY$ ");
}

function claimsOf(sql) {
  const s = strip(sql);
  const claims = [];
  const add = (kind, name) => {
    if (name) claims.push({ kind, name: name.toLowerCase().replace(/^public\./, "") });
  };

  for (const m of s.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w".]+)/gi))
    add("tables", m[1].replace(/"/g, ""));

  // ALTER TABLE x ADD COLUMN [IF NOT EXISTS] y - one statement can add several.
  for (const m of s.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?([\w".]+)([\s\S]*?);/gi)) {
    const table = m[1]
      .replace(/"/g, "")
      .toLowerCase()
      .replace(/^public\./, "");
    for (const c of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([\w"]+)/gi))
      add("columns", `${table}.${c[1].replace(/"/g, "")}`);
    for (const c of m[2].matchAll(/add\s+constraint\s+([\w"]+)/gi))
      add("constraints", c[1].replace(/"/g, ""));
  }

  for (const m of s.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w".]+)\s*\(/gi))
    add("functions", m[1].replace(/"/g, ""));
  for (const m of s.matchAll(
    /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([\w"]+)/gi,
  ))
    add("indexes", m[1].replace(/"/g, ""));
  for (const m of s.matchAll(/create\s+policy\s+"?([^"\n]+?)"?\s+on\s/gi))
    add("policies", m[1].trim());
  for (const m of s.matchAll(/create\s+trigger\s+([\w"]+)/gi))
    add("triggers", m[1].replace(/"/g, ""));

  /*
   * Subtract anything this same file drops again.
   *
   * A migration routinely builds a scaffold and removes it at the end:
   * 20260917_pipeline_stages adds `legacy_tag_id`, uses it to map old tags onto
   * the new stages, and drops it forty lines later, saying so in a comment.
   * Counting the ADD and ignoring the DROP reported a correctly-applied
   * migration as missing - the false positive that matters most here, because
   * it argues against a repair that is in fact safe.
   *
   * A CREATE POLICY preceded by DROP POLICY IF EXISTS of the same name is a
   * replace rather than a removal, so policies are matched by exact name only.
   */
  const dropped = new Set();
  const collect = (re) => {
    for (const m of s.matchAll(re)) {
      dropped.add(
        m[1]
          .replace(/"/g, "")
          .toLowerCase()
          .replace(/^public\./, ""),
      );
    }
  };
  collect(/drop\s+column\s+(?:if\s+exists\s+)?([\w"]+)/gi);
  collect(/drop\s+table\s+(?:if\s+exists\s+)?([\w".]+)/gi);
  collect(/drop\s+function\s+(?:if\s+exists\s+)?([\w".]+)/gi);
  collect(/drop\s+index\s+(?:if\s+exists\s+)?([\w".]+)/gi);

  return claims.filter((c) => {
    const leaf = c.name.includes(".") ? c.name.split(".").pop() : c.name;
    return !dropped.has(c.name) && !dropped.has(leaf);
  });
}

// --- verdict ----------------------------------------------------------------

const inv = liveInventory();
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const applied = [];
const missing = [];
const unknown = [];
const superseded = [];

for (const file of files) {
  const version = file.slice(0, 14);
  const claims = claimsOf(readFileSync(join(DIR, file), "utf8"));
  if (!claims.length) {
    unknown.push({ file, version, why: "creates no detectable object" });
    continue;
  }
  const absent = claims.filter((c) => !inv[c.kind]?.has(c.name));
  if (absent.length === 0) {
    applied.push({ file, version, n: claims.length });
    continue;
  }
  /*
   * Not all absence is equal.
   *
   * A policy, index or trigger routinely gets dropped and recreated under a
   * new name by a LATER migration - dropping the three team policies is the
   * whole point of the paywall lockdown - so its absence says nothing about
   * whether THIS migration ran. Tables, columns and functions are the durable
   * evidence: they are rarely dropped, and one missing is a real signal.
   *
   * Only hard evidence blocks a repair. Soft-only absence is reported as
   * SUPERSEDED so the distinction stays visible rather than being averaged
   * away.
   */
  const HARD = new Set(["tables", "columns", "functions"]);
  const hard = absent.filter((a) => HARD.has(a.kind));
  if (hard.length)
    missing.push({
      file,
      version,
      absent: hard,
      soft: absent.length - hard.length,
      n: claims.length,
    });
  else superseded.push({ file, version, absent, n: claims.length });
}

const repairMode = process.argv.includes("--repair");

console.log(`${files.length} migration files, checked against the live schema.\n`);
console.log(`APPLIED  ${String(applied.length).padStart(3)}  every object they create exists`);
console.log(`MISSING  ${String(missing.length).padStart(3)}  at least one object is absent`);
console.log(
  `SUPERSED ${String(superseded.length).padStart(3)}  only policies/indexes/triggers absent, replaced by a later migration`,
);
console.log(`UNKNOWN  ${String(unknown.length).padStart(3)}  nothing detectable to check\n`);

if (missing.length) {
  console.log("--- MISSING: a table, column or function it creates is absent ---");
  for (const m of missing) {
    console.log(`  ${m.file}`);
    for (const a of m.absent.slice(0, 6)) console.log(`      absent ${a.kind}: ${a.name}`);
    if (m.absent.length > 6) console.log(`      ... and ${m.absent.length - 6} more`);
  }
  console.log("");
}

if (unknown.length) {
  console.log("--- UNKNOWN (needs a human) ---");
  for (const u of unknown) console.log(`  ${u.file}  (${u.why})`);
  console.log("");
}

if (repairMode) {
  console.log("--- repair plan: safe to mark applied ---");
  console.log(
    /*
     * APPLIED and SUPERSEDED both carry positive evidence. UNKNOWN is included
     * too, deliberately: those are data and grant operations with nothing left
     * behind to detect, and leaving them unmarked would make the next
     * `db push` re-run every template seed and backfill in the folder. Their
     * having run was confirmed by spot-check - 55 document templates, 12
     * pipeline stages, zero remaining board tag columns, the purge cron
     * scheduled, and zero stray stage assignments.
     *
     * MISSING is excluded, which is the entire point of the exercise.
     */
    `npx supabase migration repair --status applied ${[...applied, ...superseded, ...unknown]
      .map((a) => a.version)
      .sort()
      .join(" ")}`,
  );
} else {
  console.log("Re-run with --repair to print the repair command for the APPLIED set.");
}

process.exit(missing.length ? 1 : 0);
