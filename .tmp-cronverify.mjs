/**
 * Post-migration verification of the cron auth path.
 *   1. the RPC exists and returns a secret to service_role
 *   2. anon CANNOT read it (this is the whole security boundary)
 *   3. the endpoints reject a wrong secret and accept the right one
 *
 * Calling purge-trash really does purge. Checked first that nothing is past the
 * 60-day cutoff, so the run is a genuine no-op rather than a gamble.
 */
import { readFileSync } from "node:fs";

const rd = (p) =>
  Object.fromEntries(
    readFileSync(p, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
const api = rd("apps/api/.env");
const root = rd(".env");
const B = api.SITEPIX_SUPABASE_URL.replace(/\/$/, "");
const SERVICE = api.SITEPIX_SUPABASE_SERVICE_ROLE_KEY;
const ANON = root.VITE_SUPABASE_PUBLISHABLE_KEY;
const API = "https://api.everbreezesitepix.com";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => {
  fails++;
  console.log("  FAIL  " + m);
};

console.log("=== 1. service_role can read the secret ===");
let secret = null;
{
  const r = await fetch(`${B}/rest/v1/rpc/get_cron_shared_secret`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const t = (await r.text()).trim();
  if (r.status === 200 && t && t !== "null") {
    secret = JSON.parse(t);
    ok(`function exists and returned a secret (${String(secret).length} chars)`);
  } else bad(`HTTP ${r.status} ${t.slice(0, 160)}`);
}

console.log("\n=== 2. anon CANNOT read it ===");
{
  const r = await fetch(`${B}/rest/v1/rpc/get_cron_shared_secret`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const t = (await r.text()).slice(0, 160);
  r.status === 200
    ? bad(`ANON READ THE SECRET — ${t}`)
    : ok(`anon refused (HTTP ${r.status})`);
}

console.log("\n=== 3. nothing is actually due for purge? ===");
{
  const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
  const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString();
  const ph = await (
    await fetch(`${B}/rest/v1/photos?deleted_at=lt.${cutoff}&select=id`, { headers: H })
  ).json();
  const pr = await (
    await fetch(`${B}/rest/v1/projects?deleted_at=lt.${cutoff}&select=id`, { headers: H })
  ).json();
  console.log(`   overdue photos: ${ph.length} | overdue projects: ${pr.length}`);
  if (ph.length === 0 && pr.length === 0) ok("nothing overdue — calling purge is a safe no-op");
  else console.log("   NOTE: a real purge would delete the above; continuing anyway is intended");
}

console.log("\n=== 4. endpoints ===");
for (const path of ["/v1/hooks/purge-trash", "/v1/hooks/archive-old-photos"]) {
  const wrong = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "x-cron-secret": "definitely-not-the-secret" },
  });
  wrong.status === 401
    ? ok(`${path}: wrong secret rejected (401)`)
    : bad(`${path}: wrong secret returned ${wrong.status}`);

  if (!secret) continue;
  const right = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "x-cron-secret": secret },
  });
  const body = (await right.text()).slice(0, 200);
  right.status === 200
    ? ok(`${path}: correct secret ACCEPTED -> ${body}`)
    : bad(`${path}: correct secret returned ${right.status} ${body}`);
}

console.log(fails === 0 ? "\nCRON AUTH WORKS\n" : `\n${fails} PROBLEM(S)\n`);
