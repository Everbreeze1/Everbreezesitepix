/**
 * Removes anything scripts/verify-restricted-role.mjs left behind.
 *
 * That script tears down in a `finally`, so this only matters if it was killed
 * outright. Matches on the probe email prefix, so it can never touch a real
 * account. Read-only when there is nothing to sweep.
 *
 * Run with: node scripts/sweep-restricted-probe.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = (p) =>
  Object.fromEntries(
    readFileSync(p, "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
  );

const cfg = env("apps/api/.env");
const admin = createClient(cfg.EVERLUMEN_SUPABASE_URL, cfg.EVERLUMEN_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
if (error) {
  console.error("could not list users:", error.message);
  process.exit(1);
}
const probes = (data?.users ?? []).filter((u) => (u.email ?? "").startsWith("restricted-probe+"));
if (!probes.length) {
  console.log("nothing to sweep: no restricted-probe users exist");
  process.exit(0);
}
for (const u of probes) {
  await admin.from("project_assignments").delete().eq("user_id", u.id);
  await admin.from("team_members").delete().eq("user_id", u.id);
  const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
  console.log(delErr ? `FAILED ${u.email}: ${delErr.message}` : `swept ${u.email}`);
}
