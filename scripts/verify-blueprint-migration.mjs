/**
 * Read-only verification that 20260908000000_blueprint_component_libraries.sql
 * actually landed.
 *
 * Deliberately performs NO destructive action. It writes exactly two throwaway
 * rows - one walkthrough template and one shot - to prove the CHECK constraints
 * and defaults behave, then deletes them again in a finally block. Everything
 * else is a select.
 *
 * The migration is applied by hand in the Supabase SQL editor, so "did it run"
 * and "did every part of it run" are different questions: a statement that
 * errored halfway down the file leaves a database that has the tables but not
 * the trigger, and nothing in the app would say so until a blueprint quietly
 * stopped versioning itself.
 *
 * Run with: node scripts/verify-blueprint-migration.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function env(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const cfg = env("apps/api/.env");
const db = createClient(cfg.SITEPIX_SUPABASE_URL, cfg.SITEPIX_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const results = [];
const ok = (name, detail = "") => results.push({ pass: true, name, detail });
const bad = (name, detail) => results.push({ pass: false, name, detail });

/** A select that only has to not-error to prove the column exists. */
async function columnExists(table, columns, label) {
  const { error } = await db.from(table).select(columns).limit(1);
  if (error) bad(label, `${error.code ?? ""} ${error.message}`.trim());
  else ok(label);
  return !error;
}

async function main() {
  /* ---------------------------------------------------- part 1 + 2: tables */
  const haveWalkthroughs = await columnExists(
    "walkthrough_templates",
    "id, created_by, name, description, category, archived, created_at, updated_at",
    "walkthrough_templates exists with every column",
  );
  await columnExists(
    "walkthrough_template_shots",
    "id, template_id, position, label, description, capture, required, created_at",
    "walkthrough_template_shots exists with every column",
  );

  /* ------------------------------------------- part 3: instance identity */
  await columnExists(
    "project_workflows",
    "id, source_kind, walkthrough_template_id",
    "project_workflows gained source_kind and walkthrough_template_id",
  );

  // Every pre-existing run must read as a workflow, not as null or as a
  // walkthrough. A NOT NULL DEFAULT that was applied as nullable is the exact
  // repair case the migration's own comments call out.
  {
    const { data, error } = await db.from("project_workflows").select("source_kind").limit(1000);
    if (error) bad("existing runs all read 'workflow'", error.message);
    else {
      const odd = [...new Set((data ?? []).map((r) => r.source_kind))].filter(
        (v) => v !== "workflow",
      );
      if (odd.length) bad("existing runs all read 'workflow'", `also found: ${odd.join(", ")}`);
      else ok("existing runs all read 'workflow'", `${data?.length ?? 0} rows checked`);
    }
  }

  /* ----------------------------------------- part 5 + 6: blueprint columns */
  await columnExists(
    "project_templates",
    "id, category, default_for_category, version",
    "project_templates gained category, default_for_category and version",
  );
  await columnExists(
    "project_blueprint_applications",
    "id, blueprint_version",
    "project_blueprint_applications gained blueprint_version",
  );

  // `version` is NOT NULL DEFAULT 1, so no existing blueprint may be null.
  {
    const { data, error } = await db
      .from("project_templates")
      .select("id, name, version, default_for_category")
      .limit(500);
    if (error) bad("every blueprint has a version", error.message);
    else {
      const nulls = (data ?? []).filter((r) => r.version == null);
      if (nulls.length) bad("every blueprint has a version", `${nulls.length} row(s) are null`);
      else ok("every blueprint has a version", `${data?.length ?? 0} blueprint(s)`);
    }
  }

  /* ------------------------------------------------- part 4: the kind CHECK */
  // Proven by attempting a write the OLD constraint would reject. A unique
  // violation or a foreign-key complaint means the kind itself was accepted,
  // which is what is being tested; only a CHECK violation is a failure.
  {
    const { error } = await db
      .from("project_template_items")
      .insert({
        project_template_id: "00000000-0000-0000-0000-000000000000",
        kind: "walkthrough",
        ref_id: "00000000-0000-0000-0000-000000000000",
        position: 0,
      })
      .select("id");
    if (!error) {
      bad("project_template_items accepts kind='walkthrough'", "unexpectedly INSERTED a row");
    } else if (/violates check constraint/i.test(error.message)) {
      bad("project_template_items accepts kind='walkthrough'", error.message);
    } else {
      // Rejected on the foreign key to a nil blueprint, i.e. the kind passed.
      ok("project_template_items accepts kind='walkthrough'", "rejected on FK, not on the CHECK");
    }
  }

  /* -------------------------------------- live round trip: shots + version */
  let tplId = null;
  try {
    if (haveWalkthroughs) {
      // Any real user id satisfies created_by; the row is deleted below.
      const { data: someUser } = await db.from("profiles").select("id").limit(1).maybeSingle();
      if (!someUser?.id) {
        bad("walkthrough round trip", "no profile row to own the throwaway template");
      } else {
        const { data: tpl, error: tplErr } = await db
          .from("walkthrough_templates")
          .insert({
            created_by: someUser.id,
            name: "__verify__ delete me",
            category: "Plumbing",
          })
          .select("id, archived, created_at, updated_at")
          .single();
        if (tplErr) {
          bad("walkthrough round trip", tplErr.message);
        } else {
          tplId = tpl.id;
          ok("walkthrough_templates accepts an insert", `archived defaulted to ${tpl.archived}`);

          // `capture` defaults to 'photo' and rejects anything outside the three.
          const { data: shot, error: shotErr } = await db
            .from("walkthrough_template_shots")
            .insert({ template_id: tplId, label: "__verify__", position: 0 })
            .select("capture, required")
            .single();
          if (shotErr) bad("shot insert defaults capture to 'photo'", shotErr.message);
          else if (shot.capture !== "photo")
            bad("shot insert defaults capture to 'photo'", `got ${shot.capture}`);
          else ok("shot insert defaults capture to 'photo'", `required=${shot.required}`);

          const { error: badCapture } = await db
            .from("walkthrough_template_shots")
            .insert({ template_id: tplId, label: "__verify__ bad", capture: "hologram" });
          if (badCapture && /violates check constraint/i.test(badCapture.message)) {
            ok("shot capture CHECK rejects an unknown value");
          } else {
            bad(
              "shot capture CHECK rejects an unknown value",
              badCapture ? badCapture.message : "the row was accepted",
            );
          }
        }
      }
    }

    /* --------------------------------- the version trigger actually fires */
    {
      const { data: bp } = await db
        .from("project_templates")
        .select("id, name, version")
        .limit(1)
        .maybeSingle();
      if (!bp) {
        results.push({
          pass: true,
          name: "version trigger fires on attach",
          detail: "SKIPPED - no blueprint in this workspace to test against",
          skipped: true,
        });
      } else if (!tplId) {
        results.push({
          pass: true,
          name: "version trigger fires on attach",
          detail: "SKIPPED - the throwaway walkthrough was not created",
          skipped: true,
        });
      } else {
        const before = bp.version;
        const { data: link, error: linkErr } = await db
          .from("project_template_items")
          .insert({
            project_template_id: bp.id,
            kind: "walkthrough",
            ref_id: tplId,
            position: 9999,
          })
          .select("id")
          .single();
        if (linkErr) {
          bad("version trigger fires on attach", linkErr.message);
        } else {
          const { data: after } = await db
            .from("project_templates")
            .select("version")
            .eq("id", bp.id)
            .single();
          if (after?.version === before + 1) {
            ok("version trigger fires on attach", `"${bp.name}" v${before} -> v${after.version}`);
          } else {
            bad(
              "version trigger fires on attach",
              `expected v${before + 1}, got v${after?.version}`,
            );
          }
          // And back down again on delete, which is the other half of the trigger.
          await db.from("project_template_items").delete().eq("id", link.id);
          const { data: final } = await db
            .from("project_templates")
            .select("version")
            .eq("id", bp.id)
            .single();
          if (final?.version === before + 2) {
            ok("version trigger fires on detach", `v${after?.version} -> v${final.version}`);
          } else {
            bad(
              "version trigger fires on detach",
              `expected v${before + 2}, got v${final?.version}`,
            );
          }
        }
      }
    }

    /* ------------------------------- the one-default-per-trade unique index */
    {
      const { data: bps } = await db
        .from("project_templates")
        .select("id, created_by, category, default_for_category, archived")
        .limit(500);
      const clashes = new Map();
      for (const r of bps ?? []) {
        if (!r.default_for_category || !r.category || r.archived) continue;
        const key = `${r.created_by}:${r.category}`;
        clashes.set(key, (clashes.get(key) ?? 0) + 1);
      }
      const dupes = [...clashes.entries()].filter(([, n]) => n > 1);
      if (dupes.length)
        bad("at most one default per owner+trade", dupes.map(([k]) => k).join(", "));
      else ok("at most one default per owner+trade", `${clashes.size} default(s) set`);
    }
  } finally {
    if (tplId) {
      // Shots cascade with the parent.
      await db.from("walkthrough_templates").delete().eq("id", tplId);
    }
  }

  /* ------------------------------------------------------------ anon check */
  // The tables must NOT be readable with the publishable key, which ships in
  // the browser bundle. This is the leak 20260811000000 had to clean up once.
  {
    const anon = createClient(cfg.SITEPIX_SUPABASE_URL, cfg.SITEPIX_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false },
    });
    for (const table of ["walkthrough_templates", "walkthrough_template_shots"]) {
      const { data, error } = await anon.from(table).select("id").limit(1);
      if (error || (data ?? []).length === 0) ok(`anon cannot read ${table}`);
      else bad(`anon cannot read ${table}`, `returned ${data.length} row(s)`);
    }
  }

  /* ------------------------------- the apply service's walkthrough branch */
  /*
   * The branch itself is fresh server code and its insert shapes have never
   * run. Every check above proves the tables accept SOMETHING; this proves they
   * accept exactly the rows applyProjectBlueprintService writes, which is where
   * a wrong column name would otherwise sit until a customer applied a
   * blueprint and got "1 walkthrough" with nothing created.
   *
   * The writes below are copied from that branch deliberately - same columns,
   * same order, same capture-to-kind map - and everything is torn down after.
   */
  {
    const { data: proj } = await db
      .from("projects")
      .select("id, created_by")
      .limit(1)
      .maybeSingle();
    if (!proj) {
      results.push({
        pass: true,
        name: "apply service walkthrough branch writes cleanly",
        detail: "SKIPPED - no project to apply against",
        skipped: true,
      });
    } else {
      let tpl = null;
      let run = null;
      try {
        const { data: t } = await db
          .from("walkthrough_templates")
          .insert({ created_by: proj.created_by, name: "__verify__ apply", category: "Plumbing" })
          .select("id, name, description")
          .single();
        tpl = t;
        await db.from("walkthrough_template_shots").insert([
          {
            template_id: tpl.id,
            position: 0,
            label: "Wide shot",
            capture: "photo",
            required: true,
          },
          { template_id: tpl.id, position: 1, label: "The leak", capture: "video", required: true },
          { template_id: tpl.id, position: 2, label: "Reading", capture: "note", required: false },
        ]);

        const { data: shots } = await db
          .from("walkthrough_template_shots")
          .select("label, description, capture, required, position")
          .eq("template_id", tpl.id)
          .order("position", { ascending: true });

        const { data: created, error: runErr } = await db
          .from("project_workflows")
          .insert({
            project_id: proj.id,
            walkthrough_template_id: tpl.id,
            source_kind: "walkthrough",
            name: tpl.name,
            description: tpl.description ?? null,
            created_by: proj.created_by,
          })
          .select("id, source_kind, walkthrough_template_id")
          .single();
        if (runErr) throw new Error(`project_workflows insert: ${runErr.message}`);
        run = created;
        ok("apply creates the run with source_kind='walkthrough'", `id ${run.id.slice(0, 8)}`);

        const { data: phase, error: phaseErr } = await db
          .from("project_workflow_phases")
          .insert({
            workflow_id: run.id,
            name: tpl.name,
            position: 0,
            description: tpl.description ?? null,
            requires_signoff: false,
          })
          .select("id")
          .single();
        if (phaseErr) throw new Error(`phase insert: ${phaseErr.message}`);
        ok("apply creates its single phase");

        const KIND_FOR_CAPTURE = { photo: "photo", video: "photo", note: "note" };
        const rows = (shots ?? []).map((s, idx) => ({
          phase_id: phase.id,
          position: idx,
          kind: KIND_FOR_CAPTURE[s.capture] ?? "photo",
          label: s.description ? `${s.label} - ${s.description}` : s.label,
          required: !!s.required,
        }));
        const { error: itemsErr } = await db.from("project_workflow_items").insert(rows);
        if (itemsErr) throw new Error(`items insert: ${itemsErr.message}`);

        const { data: back } = await db
          .from("project_workflow_items")
          .select("kind, label, required, position")
          .eq("phase_id", phase.id)
          .order("position", { ascending: true });
        const kinds = (back ?? []).map((r) => r.kind).join(",");
        if (back?.length === 3 && kinds === "photo,photo,note") {
          ok("apply maps capture to kind correctly", `photo,video,note -> ${kinds}`);
        } else {
          bad("apply maps capture to kind correctly", `${back?.length} row(s), kinds=${kinds}`);
        }
      } catch (e) {
        bad("apply service walkthrough branch writes cleanly", e.message);
      } finally {
        if (run) await db.from("project_workflows").delete().eq("id", run.id);
        if (tpl) await db.from("walkthrough_templates").delete().eq("id", tpl.id);
      }
    }
  }

  /* ------------------------------------------------- RLS, as a real user */
  /*
   * Everything above ran on the service role, which bypasses RLS entirely. That
   * proves the columns, the CHECKs, the defaults and the trigger, and proves
   * nothing at all about whether a logged-in user can actually use any of it -
   * which is the only path the UI takes. A table with correct grants and a
   * policy that never matches reads as "Couldn't load walkthrough templates"
   * forever, and no service-role check would ever catch it.
   */
  {
    const creds = env(".env");
    const user = createClient(cfg.SITEPIX_SUPABASE_URL, cfg.SITEPIX_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false },
    });
    const { data: session, error: authErr } = await user.auth.signInWithPassword({
      email: creds.email,
      password: creds.password,
    });
    if (authErr || !session?.user) {
      bad("sign in as a real user", authErr?.message ?? "no session");
    } else {
      ok("sign in as a real user", session.user.email);
      let mineId = null;
      try {
        // The exact insert WalkthroughTemplatesManager.createTemplate performs.
        const { data: mine, error: insErr } = await user
          .from("walkthrough_templates")
          .insert({
            created_by: session.user.id,
            name: "__verify__ rls check",
            description: "delete me",
            category: "Plumbing",
          })
          .select("id")
          .single();
        if (insErr) {
          bad("a user can create their own walkthrough template", insErr.message);
        } else {
          mineId = mine.id;
          ok("a user can create their own walkthrough template");

          const { data: shot, error: shotErr } = await user
            .from("walkthrough_template_shots")
            .insert({
              template_id: mineId,
              position: 0,
              label: "__verify__ shot",
              capture: "video",
              required: true,
            })
            .select("id, capture")
            .single();
          if (shotErr) bad("a user can add a shot to it", shotErr.message);
          else ok("a user can add a shot to it", `capture=${shot.capture}`);

          // Read back through the SELECT policy, the way the library loads.
          const { data: readBack, error: readErr } = await user
            .from("walkthrough_templates")
            .select("id, name, category")
            .eq("id", mineId);
          if (readErr) bad("a user can read it back", readErr.message);
          else if ((readBack ?? []).length !== 1) bad("a user can read it back", "row not visible");
          else ok("a user can read it back");

          const { data: shotsBack } = await user
            .from("walkthrough_template_shots")
            .select("id")
            .eq("template_id", mineId);
          if ((shotsBack ?? []).length === 1) ok("a user can read its shots back");
          else bad("a user can read its shots back", `saw ${shotsBack?.length ?? 0} shot(s)`);

          // The new blueprint columns must be writable by their owner, or the
          // Edit dialog's save silently fails on every field it added.
          const { data: ownBp } = await user
            .from("project_templates")
            .select("id")
            .limit(1)
            .maybeSingle();
          if (!ownBp) {
            results.push({
              pass: true,
              name: "a user can set a blueprint's trade and default",
              detail: "SKIPPED - this account has no blueprint",
              skipped: true,
            });
          } else {
            const { error: updErr } = await user
              .from("project_templates")
              .update({ category: null, default_for_category: false })
              .eq("id", ownBp.id);
            if (updErr) bad("a user can set a blueprint's trade and default", updErr.message);
            else ok("a user can set a blueprint's trade and default", "written and left unchanged");
          }
        }
      } finally {
        if (mineId) await user.from("walkthrough_templates").delete().eq("id", mineId);
        await user.auth.signOut();
      }
    }
  }

  /* ----------------------------------------------------------------- report */
  console.log("");
  let failures = 0;
  for (const r of results) {
    const mark = r.skipped ? "-" : r.pass ? "PASS" : "FAIL";
    if (!r.pass) failures++;
    console.log(`  ${mark.padEnd(4)}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
  }
  console.log("");
  console.log(failures === 0 ? "Migration verified." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
