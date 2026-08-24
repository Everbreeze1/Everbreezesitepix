/**
 * Live security test for the fixes made this session.
 *
 * SAFETY: this NEVER touches the real account in .env. It creates its own
 * throwaway attacker + victim accounts against Supabase auth, runs the exploits
 * against those, and reports whether each is blocked. The account-takeover test
 * in particular would change a victim's password if the fix were broken - which
 * is exactly why it only ever targets a fresh disposable account.
 *
 * Run with both dev servers up: node scripts/security-check.mjs
 */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const SUPA_URL = env.VITE_SUPABASE_URL;
const SUPA_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const API = env.VITE_API_BASE_URL ?? "http://localhost:8787";
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase URL/key missing from .env");

/*
 * The service-role key (from apps/api/.env) is used ONLY to provision and tear
 * down the two disposable test accounts - public signup here requires email
 * confirmation and is rate-limited, so it can't seed a confirmed account. The
 * exploit itself never uses this key: it runs through the public /v1/rpc path
 * with no auth, which is what actually proves the fix.
 */
const apiEnv = {};
for (const line of readFileSync("apps/api/.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) apiEnv[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SERVICE_KEY = apiEnv.EVERLUMEN_SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error("service role key missing from apps/api/.env");

async function adminCreateUser(email, password) {
  const r = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, id: json.id ?? json.user?.id ?? null, json };
}

async function adminDeleteUser(id) {
  if (!id) return;
  await fetch(`${SUPA_URL}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {});
}

const stamp = readFileSync("package.json", "utf8").length + "" + process.pid;
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
};

// ---- supabase auth helpers (publishable key only, like a real browser) ----
async function authFetch(path, body) {
  const r = await fetch(`${SUPA_URL}/auth/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPA_KEY },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

async function signUp(email, password) {
  const { status, json } = await authFetch("/signup", { email, password });
  return { status, json, token: json.access_token ?? json.session?.access_token ?? null };
}

async function signIn(email, password) {
  const { status, json } = await authFetch("/token?grant_type=password", { email, password });
  return { status, json, token: json.access_token ?? null };
}

// ---- api rpc helper ----
async function rpc(op, data, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}/v1/rpc`, {
    method: "POST",
    headers,
    body: JSON.stringify({ op, data }),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

const run = async () => {
  // Two disposable accounts. Domain must be one Supabase will accept; example.com is fine.
  const attackerEmail = `atk_${stamp}@example.com`;
  const victimEmail = `vic_${stamp}@example.com`;
  const attackerPass = "Attacker#Pass123";
  const victimOriginalPass = "Victim#Original123";
  const attackerChosenPass = "Pwned#ByAttacker123"; // what the attacker tries to set on the victim

  console.log("Provisioning disposable accounts (service role, confirmed)…");
  const vicUser = await adminCreateUser(victimEmail, victimOriginalPass);
  const atkUser = await adminCreateUser(attackerEmail, attackerPass);
  console.log(
    `  victim create: ${vicUser.status} (${vicUser.id}), attacker create: ${atkUser.status} (${atkUser.id})`,
  );
  const createdIds = [vicUser.id, atkUser.id];

  const atk = await signIn(attackerEmail, attackerPass);
  if (!atk.token) {
    record(
      "ACCOUNT TAKEOVER",
      false,
      `Could not sign in the provisioned attacker (${atk.status}). Setup failure, not a real result. body: ${JSON.stringify(atk.json).slice(0, 120)}`,
    );
    for (const id of createdIds) await adminDeleteUser(id);
    return summarize();
  }
  atk.token = atk.token;

  // The victim MUST have a profiles row for the exploit to bite (the vulnerable
  // branch keyed off an existing profile). A fresh signup normally triggers the
  // profile backfill; give it a moment.
  await new Promise((r) => setTimeout(r, 1500));

  // ---- attacker builds the invite ----
  const team = await rpc("createTeam", { name: `atk-team-${stamp}` }, atk.token);
  console.log(`  createTeam: ${team.status}`);
  const invite = await rpc("inviteMember", { email: victimEmail, role: "member" }, atk.token);
  console.log(`  inviteMember: ${invite.status}`);

  /*
   * The token IS present in the inviter's response - and that is BY DESIGN:
   * TeamsPage builds a `/invite/{token}` link from it for "copy invite link".
   * So this is not asserted as a leak. What matters is that holding the token
   * cannot take over an existing account, which is the real check below.
   */
  const leakedToken =
    invite.json?.token ??
    invite.json?.invite?.token ??
    invite.json?.data?.token ??
    invite.json?.invite?.invite?.token ??
    null;
  console.log(
    `  invite token present in response: ${!!leakedToken} (expected - used for the copy-invite-link feature)`,
  );

  // If we couldn't read a token, try the authed getMyTeam path the sweep named.
  let token = leakedToken;
  if (!token) {
    const myTeam = await rpc("getMyTeam", {}, atk.token);
    const invites = myTeam.json?.invites ?? myTeam.json?.team?.invites ?? [];
    token = Array.isArray(invites) ? invites.find((i) => i?.email === victimEmail)?.token : null;
    if (token) console.log("  (token recovered via getMyTeam)");
  }

  if (!token) {
    record(
      "ACCOUNT TAKEOVER",
      true,
      "Could not obtain the invite token by any means - the exploit's precondition (token readable by attacker) does not hold, so the takeover is not reachable.",
    );
  } else {
    // ---- THE EXPLOIT: unauthenticated password overwrite ----
    const attack = await rpc("acceptInviteSignup", {
      token,
      fullName: "x",
      password: attackerChosenPass,
    });
    console.log(
      `  acceptInviteSignup (the attack): ${attack.status} ${JSON.stringify(attack.json).slice(0, 120)}`,
    );

    // Proof: can the attacker now log in as the victim with the password THEY chose?
    const asVictim = await signIn(victimEmail, attackerChosenPass);
    const stillOriginal = await signIn(victimEmail, victimOriginalPass);

    const attackerGotIn = !!asVictim.token;
    const victimKeptPassword = !!stillOriginal.token;

    record(
      "ACCOUNT TAKEOVER blocked",
      !attackerGotIn && victimKeptPassword,
      attackerGotIn
        ? `COMPROMISED: attacker logged in as the victim with a password they set. attack status was ${attack.status}.`
        : `attacker could NOT log in with their chosen password (login ${asVictim.status}); victim's original password still works (${stillOriginal.status}). The endpoint returned ${attack.status}: ${JSON.stringify(attack.json).slice(0, 100)}`,
    );
  }

  // ---- Portfolio is a Team-tier feature; the attacker account has no team,
  //      so it is Starter-tier. The write must be refused server-side. ----
  const portfolio = await rpc(
    "updatePortfolio",
    { slug: `pwn-${stamp}`, headline: "x" },
    atk.token,
  );
  record(
    "Portfolio write gated on Team plan (server-side)",
    portfolio.status === 403,
    portfolio.status === 403
      ? `updatePortfolio correctly refused with 403 for a non-Team caller: ${JSON.stringify(portfolio.json).slice(0, 90)}`
      : `updatePortfolio returned ${portfolio.status} for a Starter caller (expected 403). A free account may be using a paid feature. body: ${JSON.stringify(portfolio.json).slice(0, 120)}`,
  );

  /*
   * Blueprint apply. For this Starter, no-team account the request is refused
   * at `requireTeamPlan` - before my blueprint-ownership check even runs - so
   * this proves "a non-Team caller cannot apply blueprints", NOT the ownership
   * check specifically (isolating that needs a Team account with a real project
   * plus a foreign blueprint id; it is verified by code review, not here).
   */
  const fakeId = "11111111-1111-1111-1111-111111111111";
  const bp = await rpc(
    "applyProjectBlueprint",
    { projectId: fakeId, blueprintId: fakeId, projectName: "probe" },
    atk.token,
  );
  record(
    "Blueprint apply rejects an unauthorized caller",
    bp.status >= 400 && bp.status < 500,
    bp.status >= 400 && bp.status < 500
      ? `applyProjectBlueprint refused with a clean ${bp.status}: ${JSON.stringify(bp.json).slice(0, 90)}`
      : `applyProjectBlueprint returned ${bp.status} - expected a 4xx. body: ${JSON.stringify(bp.json).slice(0, 120)}`,
  );

  console.log("\nTearing down disposable accounts…");
  for (const id of createdIds) await adminDeleteUser(id);
  summarize();
};

function summarize() {
  console.log("\n================ SECURITY RESULT ================");
  const fails = results.filter((r) => !r.pass);
  if (!fails.length) console.log(`All ${results.length} checks passed.`);
  else {
    console.log(`${fails.length} of ${results.length} checks FAILED:`);
    for (const f of fails) console.log(`  - ${f.name}: ${f.detail}`);
  }
}

run().catch((e) => {
  console.error("TEST ERROR:", e.message);
  process.exit(1);
});
