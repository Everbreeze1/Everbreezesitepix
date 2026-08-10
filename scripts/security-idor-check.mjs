/**
 * Live IDOR test: can an attacker read a photo they have no access to?
 *
 * Covers the two cross-account photo-access fixes:
 *   1. setShowcaseItems — pointing a showcase at a foreign photo id.
 *   2. getPublicProjectPage — embedding <img data-photo-id="foreign"> in a
 *      shared document so the public route signs it.
 *
 * SAFETY: never touches the real .env account. It provisions its own victim +
 * attacker accounts and their data via the service role, runs the exploits
 * through the real API, then deletes everything it made. The victim photo uses
 * a distinctive storage_path marker so a leak is unambiguous — if that marker
 * appears in an attacker-reachable response, the photo leaked.
 */
import { readFileSync } from "node:fs";

const web = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) web[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const api = {};
for (const line of readFileSync("apps/api/.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) api[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL = web.VITE_SUPABASE_URL;
const PUB = web.VITE_SUPABASE_PUBLISHABLE_KEY;
const SVC = api.SITEPIX_SUPABASE_SERVICE_ROLE_KEY;
const API = web.VITE_API_BASE_URL ?? "http://localhost:8787";
const svcH = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };

const stamp = `${readFileSync("package.json", "utf8").length}${process.pid}`;
const MARKER = `VICTIM-SECRET-${stamp}`; // appears in the victim photo's storage_path
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
};

const created = { users: [], projects: [], photos: [], showcases: [], pages: [] };

// ---- service-role helpers ----
async function adminUser(email, password) {
  const r = await fetch(`${URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: svcH,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const j = await r.json().catch(() => ({}));
  return j.id ?? j.user?.id ?? null;
}
async function restInsert(table, row) {
  const r = await fetch(`${URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...svcH, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`insert ${table} ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  return Array.isArray(j) ? j[0] : j;
}
async function restDelete(table, id) {
  await fetch(`${URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: svcH }).catch(
    () => {},
  );
}
async function signIn(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: PUB },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  return j.access_token ?? null;
}
async function rpc(op, data, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}/v1/rpc`, {
    method: "POST",
    headers,
    body: JSON.stringify({ op, data }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}

async function cleanup() {
  for (const id of created.pages) await restDelete("project_pages", id);
  for (const id of created.showcases) await restDelete("showcases", id);
  for (const id of created.photos) await restDelete("photos", id);
  for (const id of created.projects) await restDelete("projects", id);
  for (const id of created.users)
    await fetch(`${URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: svcH }).catch(
      () => {},
    );
}

const run = async () => {
  console.log("Provisioning victim + attacker and their data (service role)…");
  const victimId = await adminUser(`vic_${stamp}@example.com`, "Victim#Original123");
  const attackerId = await adminUser(`atk_${stamp}@example.com`, "Attacker#Pass123");
  created.users.push(victimId, attackerId);

  const victimProject = await restInsert("projects", {
    created_by: victimId,
    name: `victim-proj-${stamp}`,
    status: "active",
  });
  created.projects.push(victimProject.id);

  const victimPhoto = await restInsert("photos", {
    project_id: victimProject.id,
    uploaded_by: victimId,
    storage_path: `${victimId}/${victimProject.id}/${MARKER}.jpg`,
    size_bytes: 1234,
    caption: "victim private photo",
    phase: "untagged",
  });
  created.photos.push(victimPhoto.id);

  const attackerProject = await restInsert("projects", {
    created_by: attackerId,
    name: `attacker-proj-${stamp}`,
    status: "active",
  });
  created.projects.push(attackerProject.id);

  const atkToken = await signIn(`atk_${stamp}@example.com`, "Attacker#Pass123");
  if (!atkToken) {
    record("IDOR setup", false, "could not sign in the attacker — setup failure");
    return finish();
  }
  console.log(`  victim photo id ${victimPhoto.id} (marker ${MARKER})`);

  // ---------- IDOR 1: showcase points at the victim's photo ----------
  await rpc("createTeam", { name: `atk-team-${stamp}` }, atkToken);
  const showcase = await rpc("createShowcase", { title: `atk-showcase-${stamp}` }, atkToken);
  if (showcase.status === 200 && showcase.json?.id) created.showcases.push(showcase.json.id);

  if (showcase.status !== 200) {
    record(
      "Showcase IDOR",
      true,
      `attacker could not even create a showcase (${showcase.status}: ${JSON.stringify(showcase.json).slice(0, 90)}) — the foreign-photo path is unreachable.`,
    );
  } else {
    const setItems = await rpc(
      "setShowcaseItems",
      { showcaseId: showcase.json.id, items: [{ photoId: victimPhoto.id }] },
      atkToken,
    );
    if (setItems.status === 200) {
      // It was accepted — confirm whether the read actually leaks a signed URL.
      const got = await rpc("getShowcase", { id: showcase.json.id }, atkToken);
      const leaked = JSON.stringify(got.json).includes(MARKER);
      record(
        "Showcase IDOR blocked",
        false,
        `setShowcaseItems ACCEPTED a foreign photo id (200)${leaked ? " and getShowcase returned a signed URL for the victim's photo (marker present)" : ""}. COMPROMISED.`,
      );
    } else {
      record(
        "Showcase IDOR blocked",
        setItems.status === 403,
        `setShowcaseItems refused the foreign photo id with ${setItems.status}: ${JSON.stringify(setItems.json).slice(0, 90)}`,
      );
    }
  }

  // ---------- IDOR 2: shared document embeds the victim's photo id ----------
  const pageRes = await rpc(
    "createProjectPage",
    { projectId: attackerProject.id, title: `atk-page-${stamp}`, template: "blank" },
    atkToken,
  );
  const pageId = pageRes.json?.page?.id ?? pageRes.json?.id ?? null;
  if (pageId) created.pages.push(pageId);

  if (!pageId) {
    record(
      "Page-image IDOR",
      false,
      `could not create a page (${pageRes.status}: ${JSON.stringify(pageRes.json).slice(0, 90)}) — setup failure`,
    );
  } else {
    await rpc(
      "updateProjectPage",
      { pageId, contentHtml: `<p>hi</p><img data-photo-id="${victimPhoto.id}" alt="x">` },
      atkToken,
    );
    const share = await rpc("setProjectPageShare", { pageId, enable: true }, atkToken);
    const token = share.json?.shareToken ?? null;
    if (!token) {
      record(
        "Page-image IDOR",
        false,
        `could not enable sharing (${share.status}) — setup failure`,
      );
    } else {
      // The public, unauthenticated read — this is the attack surface.
      const pub = await rpc("getPublicProjectPage", { token }, null);
      const body = JSON.stringify(pub.json);
      const leaked = body.includes(MARKER);
      record(
        "Page-image IDOR blocked",
        !leaked,
        leaked
          ? "COMPROMISED: the public shared page resolved the victim's foreign photo — its storage marker appears in the response."
          : `public page did NOT resolve the foreign photo (marker absent). status ${pub.status}.`,
      );
    }
  }

  finish();
};

function finish() {
  return cleanup().then(() => {
    console.log("\n================ IDOR RESULT ================");
    const fails = results.filter((r) => !r.pass);
    console.log(
      fails.length
        ? `${fails.length}/${results.length} FAILED`
        : `All ${results.length} checks passed.`,
    );
    console.log("(disposable accounts, projects, photos, showcases and pages all torn down)");
  });
}

run().catch(async (e) => {
  console.error("TEST ERROR:", e.message);
  await cleanup();
  process.exit(1);
});
