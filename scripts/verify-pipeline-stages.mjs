/**
 * Read-only verification that the pipeline migrations actually landed, and that
 * the thing the client complained about can no longer happen.
 *
 * The complaint was two-part: a project could stand in more than one column of
 * one board at the same time, and near-duplicate boards piled up with nothing
 * merging them. Both came from a board being a saved list of tag ids. The fix
 * moved columns into `public.pipeline_stages` and gave the project one scalar
 * `pipeline_stage_id`.
 *
 * The migrations are applied by hand in the Supabase SQL editor, so "did it
 * run" and "did every part of it run" are different questions: a statement that
 * errored halfway down the file leaves a database with the table but not the
 * unique index, and nothing in the app would say so until the second "Kitchen
 * Remodels" board appeared.
 *
 * Writes nothing. Every check is a select.
 *
 * Run with: node scripts/verify-pipeline-stages.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function env(rel) {
  const out = {};
  let text;
  try {
    text = readFileSync(path.join(repoRoot, rel), "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const cfg = env("apps/api/.env");
const URL = process.env.EVERLUMEN_SUPABASE_URL ?? cfg.EVERLUMEN_SUPABASE_URL;
const KEY =
  process.env.EVERLUMEN_SUPABASE_SERVICE_ROLE_KEY ?? cfg.EVERLUMEN_SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error("Missing EVERLUMEN_SUPABASE_URL / EVERLUMEN_SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const db = createClient(URL, KEY, { auth: { persistSession: false } });

const results = [];
const ok = (name, detail = "") => results.push({ pass: true, name, detail });
const bad = (name, detail) => results.push({ pass: false, name, detail });
const skip = (name, detail) => results.push({ pass: true, skipped: true, name, detail });

/** The same rule as the unique indexes and as packages/shared/src/pipeline-stages.ts. */
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

async function main() {
  /* ------------------------------------------------- 1. the schema exists */
  const { data: stages, error: stageErr } = await db
    .from("pipeline_stages")
    .select("id, board_id, name, color, position");
  if (stageErr) {
    bad("public.pipeline_stages exists", `${stageErr.code ?? ""} ${stageErr.message}`.trim());
    report();
    return;
  }
  ok("public.pipeline_stages exists", `${stages.length} stage(s)`);

  const { data: projects, error: projErr } = await db
    .from("projects")
    .select("id, name, status, created_by, pipeline_stage_id")
    .is("deleted_at", null);
  if (projErr) {
    bad("projects.pipeline_stage_id exists", `${projErr.code ?? ""} ${projErr.message}`.trim());
    report();
    return;
  }
  ok("projects.pipeline_stage_id exists", `${projects.length} live project(s)`);

  const { data: boards, error: boardErr } = await db
    .from("project_boards")
    .select("id, team_id, name, created_at");
  if (boardErr) {
    bad("project_boards readable", boardErr.message);
    report();
    return;
  }
  ok("project_boards readable", `${boards.length} pipeline(s)`);

  /* ------------------------------- 2. the exclusivity the client asked for */
  // Structural rather than checked: `pipeline_stage_id` is one column holding
  // one uuid. This states it against real rows so the guarantee is visible in
  // the output rather than only in the schema.
  const stageIds = new Set(stages.map((s) => s.id));
  const placed = projects.filter((p) => p.pipeline_stage_id);
  const orphaned = placed.filter((p) => !stageIds.has(p.pipeline_stage_id));
  if (orphaned.length) {
    bad(
      "every placed project points at a stage that exists",
      `${orphaned.length} orphan(s), e.g. ${orphaned[0].name}`,
    );
  } else {
    ok(
      "a project is in exactly one column",
      `${placed.length} placed, ${projects.length - placed.length} in no pipeline`,
    );
  }

  /* --------------------- 2b. nobody is standing on another team's board */
  // `public.tags` has no team_id, so the original backfill matched tag ids
  // across team boundaries and placed other teams' projects on this board.
  // RLS hid both sides from each other, which is why it went unnoticed: the
  // owners simply saw no stage, and could not clear one either.
  const { data: members } = await db.from("team_members").select("team_id, user_id");
  const teamsOf = new Map();
  for (const m of members ?? []) {
    teamsOf.set(m.user_id, [...(teamsOf.get(m.user_id) ?? []), m.team_id]);
  }
  const stageBoard = new Map(stages.map((s) => [s.id, s.board_id]));
  const boardTeam = new Map(boards.map((b) => [b.id, b.team_id]));
  const strays = placed.filter((p) => {
    const team = boardTeam.get(stageBoard.get(p.pipeline_stage_id));
    return !(teamsOf.get(p.created_by) ?? []).includes(team);
  });
  if (strays.length) {
    bad(
      "no project sits on another team's board",
      `${strays.length} stray(s), e.g. "${strays[0].name}" - apply 20260920000000_pipeline_stage_team_scope.sql`,
    );
  } else {
    ok("no project sits on another team's board");
  }

  /* ---------------------------------- 3. every pipeline has columns to show */
  const byBoard = new Map();
  for (const s of stages) byBoard.set(s.board_id, [...(byBoard.get(s.board_id) ?? []), s]);
  const emptyBoards = boards.filter((b) => !byBoard.has(b.id));
  if (emptyBoards.length) {
    bad(
      "every pipeline has at least one stage",
      `${emptyBoards.length} empty, e.g. "${emptyBoards[0].name}" - step 3 of 20260917000000 may not have run`,
    );
  } else {
    ok("every pipeline has at least one stage");
  }

  /* ------------------------------------------- 4. the duplicates are gone */
  const boardKeys = new Map();
  for (const b of boards) {
    const key = `${b.team_id}::${norm(b.name)}`;
    boardKeys.set(key, [...(boardKeys.get(key) ?? []), b.name]);
  }
  const dupBoards = [...boardKeys.values()].filter((names) => names.length > 1);
  if (dupBoards.length) {
    bad(
      "no team holds two pipelines with the same name",
      `${dupBoards.length} clash(es), e.g. ${dupBoards[0].join(" / ")} - step 5 of 20260917000000 may not have run`,
    );
  } else {
    ok("no team holds two pipelines with the same name");
  }

  const dupStages = [];
  for (const [boardId, list] of byBoard) {
    const seen = new Map();
    for (const s of list) {
      const k = norm(s.name);
      if (seen.has(k)) dupStages.push(`${boardId}: ${seen.get(k)} / ${s.name}`);
      else seen.set(k, s.name);
    }
  }
  if (dupStages.length) bad("no pipeline holds two stages that read the same", dupStages[0]);
  else ok("no pipeline holds two stages that read the same");

  /* ------------------ 5. the unique indexes, not just the current row set */
  // A clean row set proves the merge ran. It does not prove the index that
  // stops the *next* duplicate exists, and that index is the whole answer to
  // "hard-block, or just a one-time migration". PostgREST cannot see pg_indexes,
  // so this one stays a manual step.
  skip(
    "unique indexes present",
    "confirm in the SQL editor: select indexname from pg_indexes where indexname in ('project_boards_team_normalized_name_key','pipeline_stages_board_normalized_name_key')",
  );

  /* --------------------------- 6. has the tag column been dropped yet */
  const { error: tagErr } = await db.from("project_boards").select("tag_ids").limit(1);
  if (tagErr) {
    ok(
      "project_boards.tag_ids is gone",
      "tags can no longer become stages by any path (20260918000000 applied)",
    );
  } else {
    skip(
      "project_boards.tag_ids is gone",
      "still present - apply 20260918000000_project_boards_drop_tag_ids.sql once the new build is live",
    );
  }

  /* --------------------------------------- 7. the backfill kept the work */
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const perBoard = new Map();
  for (const p of placed) {
    const s = stageById.get(p.pipeline_stage_id);
    if (!s) continue;
    perBoard.set(s.board_id, (perBoard.get(s.board_id) ?? 0) + 1);
  }
  const summary = boards
    .map((b) => `${b.name}: ${perBoard.get(b.id) ?? 0} in ${(byBoard.get(b.id) ?? []).length}`)
    .join(", ");
  ok("projects per pipeline", summary || "no pipelines yet");

  report();
}

function report() {
  console.log("");
  let failures = 0;
  for (const r of results) {
    const mark = r.skipped ? "-" : r.pass ? "PASS" : "FAIL";
    if (!r.pass) failures++;
    console.log(`  ${mark.padEnd(4)}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
  }
  console.log("");
  console.log(failures === 0 ? "Pipeline migration verified." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
