import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(__dirname, "..", "supabase/migrations");

/**
 * Replays DROP and CREATE across the migrations in filename order.
 *
 * A migrations folder is append-only history, not a description of the
 * database. 20260911000000 still literally contains its four `FOR ALL`
 * policies; 20260913000000 drops them and writes narrower ones in their place.
 * Grepping the text would report a defect no database has - and, far worse in
 * the other direction, would miss a permission a later file quietly re-widened.
 */
function livePolicies(namePrefix: string) {
  const live = new Map<string, { file: string; name: string; table: string; cmd: string }>();
  const dropRe = new RegExp(
    String.raw`DROP POLICY IF EXISTS\s+"(${namePrefix}[^"]*)"\s+ON\s+public\.([a-z_]+)`,
    "gi",
  );
  const createRe = new RegExp(
    String.raw`CREATE POLICY\s+"(${namePrefix}[^"]*)"\s+ON\s+public\.([a-z_]+)\s+FOR\s+([A-Z]+)`,
    "gi",
  );

  for (const f of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(dropRe)) live.delete(`${m[2]}::${m[1]}`);
    for (const m of sql.matchAll(createRe)) {
      const [, name, table, cmd] = m;
      live.set(`${table}::${name}`, { file: f, name, table, cmd: cmd.toUpperCase() });
    }
  }
  return [...live.values()];
}

/** Tables that get their access from `are_teammates`, and those given back. */
function policyTables() {
  const teammate = new Set<string>();
  const restricted = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(
      /CREATE POLICY\s+"([^"]+)"\s+ON\s+public\.([a-z_]+)([\s\S]*?);/gi,
    )) {
      const [, , table, body] = m;
      if (/are_teammates/.test(body)) teammate.add(table);
      if (/member_can_reach_project/.test(body)) restricted.add(table);
    }
  }
  return { teammate, restricted };
}

/** Withheld on purpose, each for a reason stated in 20260912000000. */
const EXCLUDED: Record<string, string> = {
  photo_shares: "publishing a client's photos outside the company is not scoped labour's call",
  project_blueprint_applications:
    "an admin-only provenance ledger, read from Settings, which Restricted cannot open",
};

/*
 * `are_teammates()` was the single source of shared access for nineteen tables.
 * 20260911000000 narrowed it so a Restricted member stops seeing everything,
 * then handed access back per assignment - but only for six of them. The other
 * thirteen silently went dark, and would have stayed dark until the first
 * person was actually made Restricted and found empty tabs.
 *
 * That is not catchable by reading one file: the take-away and the give-back
 * live in different migrations, and the affected tables are spread across a
 * dozen more. So it is checked mechanically instead.
 */
describe("family: narrowing are_teammates must not strand a table", () => {
  it("every teammate-guarded table is either given back or explicitly excluded", () => {
    const { teammate, restricted } = policyTables();
    const stranded = [...teammate].filter((t) => !restricted.has(t) && !(t in EXCLUDED)).sort();
    expect(stranded).toEqual([]);
  });

  it("the exclusion list stays honest - nothing on it is also granted", () => {
    const { restricted } = policyTables();
    expect(Object.keys(EXCLUDED).filter((t) => restricted.has(t))).toEqual([]);
  });

  it("the give-back covers the tables a crew uses daily", () => {
    const { restricted } = policyTables();
    // walkthrough_photos was the proof the first pass was unfinished: the
    // walkthrough row was granted and the photos hanging off it were not, so
    // the tab opened empty rather than closed.
    for (const t of ["photos", "tasks", "walkthrough_photos", "project_pages", "ai_analyses"]) {
      expect(restricted.has(t), `${t} is unreachable for a Restricted member`).toBe(true);
    }
  });
});

/*
 * Section 4 gives Restricted no destructive actions. 20260911000000 said so in
 * a comment and then wrote four policies `FOR ALL`, which is SELECT, INSERT,
 * UPDATE *and DELETE* - granting the exact thing the comment withheld, on
 * videos, walkthroughs, project_checklists and project_checklist_items.
 *
 * `FOR ALL` is the trap: it reads as "all the working verbs" and quietly
 * includes the one verb this role must never have. Silent when wrong, too - a
 * Restricted member deleting a walkthrough would have looked like it worked.
 */
describe("family: Restricted gets no destructive actions", () => {
  it("no live Restricted policy is FOR ALL or FOR DELETE", () => {
    const bad = livePolicies("Restricted members ")
      .filter((p) => p.cmd === "ALL" || p.cmd === "DELETE")
      .map((p) => `${p.file}: "${p.name}" is FOR ${p.cmd}`);
    expect(bad).toEqual([]);
  });

  it("the four tightened tables keep read, create and edit", () => {
    const byTable = new Map<string, Set<string>>();
    for (const p of livePolicies("Restricted members ")) {
      if (!byTable.has(p.table)) byTable.set(p.table, new Set());
      byTable.get(p.table)!.add(p.cmd);
    }
    for (const t of ["videos", "walkthroughs", "project_checklists", "project_checklist_items"]) {
      const cmds = byTable.get(t);
      expect(cmds, `${t} has no Restricted policy at all`).toBeDefined();
      // Losing DELETE must not have cost them the ability to do the job.
      for (const cmd of ["SELECT", "INSERT", "UPDATE"]) {
        expect(cmds!.has(cmd), `${t} lost ${cmd}`).toBe(true);
      }
    }
  });

  it("the replay is actually finding policies, not passing on an empty list", () => {
    // The first version of this file had its regex escaping eaten in transit,
    // matched nothing, and reported a clean bill of health. A guard that can
    // pass vacuously is worse than no guard.
    expect(livePolicies("Restricted members ").length).toBeGreaterThan(20);
  });
});
