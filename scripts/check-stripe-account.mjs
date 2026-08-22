/**
 * Answer one question: does this Stripe secret key belong to the account that
 * holds our customers?
 *
 * WHY
 *
 * `createBillingPortalSession` has returned HTTP 500 on every call since
 * 2026-08-13, after working fine until 2026-08-03 - four failures, two
 * customers, both team owners with valid ids and active subscriptions. It fails
 * in ~330ms, which is too fast to be a timeout and is exactly what Stripe does
 * when it does not recognise a customer.
 *
 * The reason it is hard to see: every `stripe_customer_id` in our database
 * stays syntactically valid no matter which account the key belongs to. Point
 * the API at a different Stripe account and nothing looks broken - the ids are
 * still there, the plans still say "team", the subscription statuses still say
 * "active". Only the API calls fail, one button at a time.
 *
 * The local apps/api/.env key is account acct_1TwmiPEbTYVRi4sY, and every
 * customer in our database belongs to a DIFFERENT account. Whether production
 * is broken depends entirely on which key Railway holds, which cannot be read
 * from here.
 *
 * HOW TO USE IT
 *
 *   1. Railway -> the API service -> Variables -> copy STRIPE_SECRET_KEY.
 *   2. Run, pasting that value (do not commit it anywhere):
 *
 *        STRIPE_SECRET_KEY="sk_live_..." node scripts/check-stripe-account.mjs
 *
 *   3. Run it again with no variable set to check the local .env key instead.
 *
 * READ ONLY. Every Stripe call here is a retrieve or a list. It creates,
 * updates and deletes nothing.
 */
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = (p) => {
  const out = {};
  try {
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // optional
  }
  return out;
};

const cfg = env("apps/api/.env");
const key = process.env.STRIPE_SECRET_KEY || cfg.STRIPE_SECRET_KEY;
if (!key) {
  console.error("No STRIPE_SECRET_KEY in the environment or apps/api/.env.");
  process.exit(2);
}
const fromEnv = !!process.env.STRIPE_SECRET_KEY;

const stripe = new Stripe(key);
const db = createClient(cfg.SITEPIX_SUPABASE_URL, cfg.SITEPIX_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const checks = [];
const ok = (name, detail = "") => checks.push({ pass: true, name, detail });
const bad = (name, detail = "") => checks.push({ pass: false, name, detail });

console.log(`Key source : ${fromEnv ? "STRIPE_SECRET_KEY environment variable" : "apps/api/.env"}`);
console.log(
  `Key mode   : ${key.startsWith("sk_live") ? "LIVE" : key.startsWith("sk_test") ? "TEST" : "unknown"}`,
);

let account = null;
try {
  account = await stripe.accounts.retrieve();
  console.log(`Account    : ${account.id}  ${account.business_profile?.name ?? ""}`);
  ok("key is valid", account.id);
} catch (e) {
  bad("key is valid", `${e.code ?? e.type}: ${e.message}`);
}
console.log("");

// --- can this key see our customers? ----------------------------------------

const { data: teams, error } = await db
  .from("teams")
  .select("id, name, plan, subscription_status, stripe_customer_id, stripe_subscription_id");
if (error) {
  bad("read teams", error.message);
} else {
  const withStripe = (teams ?? []).filter((t) => t.stripe_customer_id || t.stripe_subscription_id);
  console.log(`Teams with Stripe ids: ${withStripe.length} of ${teams.length}`);

  let visible = 0;
  let missing = 0;
  for (const t of withStripe) {
    const parts = [];
    if (t.stripe_customer_id) {
      try {
        await stripe.customers.retrieve(t.stripe_customer_id);
        parts.push("customer OK");
      } catch (e) {
        parts.push(`customer ${e.code ?? e.type}`);
      }
    }
    if (t.stripe_subscription_id) {
      try {
        const s = await stripe.subscriptions.retrieve(t.stripe_subscription_id);
        parts.push(`subscription ${s.status}`);
      } catch (e) {
        parts.push(`subscription ${e.code ?? e.type}`);
      }
    }
    const bothFound = !parts.some((p) => p.includes("resource_missing"));
    if (bothFound) visible += 1;
    else missing += 1;
    console.log(`  ${bothFound ? "OK  " : "MISS"} ${t.name.padEnd(30)} ${parts.join(" · ")}`);
  }
  console.log("");

  if (withStripe.length === 0) {
    ok("this key can see our customers", "no team has Stripe ids yet");
  } else if (missing === 0) {
    ok("this key can see our customers", `${visible}/${withStripe.length}`);
  } else {
    bad(
      "this key can see our customers",
      `${missing} of ${withStripe.length} invisible to ${account?.id ?? "this key"} - THIS IS THE BUG`,
    );
  }
}

// --- the price ids must live in the same account -----------------------------

const priceVars = [
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_TEAM",
  "STRIPE_PRICE_STARTER_ANNUAL",
  "STRIPE_PRICE_PRO_ANNUAL",
  "STRIPE_PRICE_TEAM_ANNUAL",
];
let priceMissing = 0;
let priceChecked = 0;
for (const name of priceVars) {
  const id = process.env[name] || cfg[name];
  if (!id) continue;
  priceChecked += 1;
  try {
    await stripe.prices.retrieve(id);
  } catch (e) {
    priceMissing += 1;
    console.log(`  price ${name} -> ${e.code ?? e.type}`);
  }
}
if (priceChecked === 0) ok("price ids", "none configured locally to check");
else if (priceMissing === 0)
  ok("every configured price id exists in this account", `${priceChecked} checked`);
else
  bad(
    "every configured price id exists in this account",
    `${priceMissing} of ${priceChecked} missing - checkout would fail too`,
  );

// --- webhooks ----------------------------------------------------------------

try {
  const hooks = await stripe.webhookEndpoints.list({ limit: 20 });
  const ours = hooks.data.filter((h) => /everbreezesitepix|railway/i.test(h.url ?? ""));
  if (ours.length) {
    ok(
      "a webhook endpoint points at our API",
      ours.map((h) => `${h.url} (${h.status})`).join(", "),
    );
  } else if (hooks.data.length) {
    bad(
      "a webhook endpoint points at our API",
      `${hooks.data.length} endpoint(s) exist but none match our domain: ${hooks.data.map((h) => h.url).join(", ")}`,
    );
  } else {
    bad(
      "a webhook endpoint points at our API",
      "this account has NO webhook endpoints - subscription changes would never reach us",
    );
  }
} catch (e) {
  bad("a webhook endpoint points at our API", `${e.code ?? e.type}: ${e.message}`);
}

// ---------------------------------------------------------------------------

console.log("");
for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  -  ${c.detail}` : ""}`);
}
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);

if (failed) {
  console.log("");
  console.log("If 'this key can see our customers' failed, the key and the data are from");
  console.log("different Stripe accounts. Fix the KEY, not the data: repointing");
  console.log("stripe_customer_id values at a different account's customers would detach");
  console.log("every live subscription from the team that pays for it.");
}
process.exit(failed ? 1 : 0);
