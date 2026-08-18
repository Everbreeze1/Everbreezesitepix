#!/usr/bin/env node
/**
 * READ ONLY. Checks every Stripe Price the app is configured to charge against
 * what apps/web/src/lib/pricing.ts advertises. Makes no writes of any kind.
 *
 *   node scripts/verify-stripe-prices.mjs
 *
 * Run it after ANY price change, and before trusting a deploy. The failure it
 * exists to catch is silent: Stripe cannot edit a Price's amount, so changing
 * one in the dashboard creates a NEW Price with a NEW id. Miss the env var
 * update and /pricing advertises one number while checkout bills another, with
 * no error anywhere.
 *
 * Also catches the annual rounding trap. The page prints the rounded monthly
 * rate times twelve ($79 -> $63 -> $756), so a Price built from 79 * 0.8 * 12 =
 * $758.40 disagrees with the number the customer just read by a couple of
 * dollars - close enough to look like a rounding artefact rather than a bug.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const env = Object.fromEntries(
  readFileSync(`${ROOT}/apps/api/.env`, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const mod = await import(pathToFileURL(`${ROOT}/node_modules/stripe/cjs/stripe.cjs.node.js`).href);
const stripe = new (mod.default ?? mod)(env.STRIPE_SECRET_KEY);

/*
 * Mirrors PLANS in apps/web/src/lib/pricing.ts. Deliberately re-stated rather
 * than imported: this script is the independent check, and importing the very
 * module under test would make a wrong constant agree with itself.
 */
const r = (n) => Math.round(n * 0.8);
const EXPECT = [
  { var: "STRIPE_PRICE_STARTER", label: "Starter monthly", interval: "month", included: 1, flat: 24, per: 19 },
  { var: "STRIPE_PRICE_PRO", label: "Pro monthly", interval: "month", included: 3, flat: 79, per: 24 },
  { var: "STRIPE_PRICE_TEAM", label: "Team monthly", interval: "month", included: 3, flat: 179, per: 24 },
  { var: "STRIPE_PRICE_STARTER_ANNUAL", label: "Starter annual", interval: "year", included: 1, flat: r(24) * 12, per: r(19) * 12 },
  { var: "STRIPE_PRICE_PRO_ANNUAL", label: "Pro annual", interval: "year", included: 3, flat: r(79) * 12, per: r(24) * 12 },
  { var: "STRIPE_PRICE_TEAM_ANNUAL", label: "Team annual", interval: "year", included: 3, flat: r(179) * 12, per: r(24) * 12 },
];

let bad = 0;
for (const e of EXPECT) {
  const id = env[e.var];
  if (!id) {
    console.log(`FAIL  ${e.label.padEnd(16)} ${e.var} is not set`);
    bad++;
    continue;
  }

  let price;
  try {
    price = await stripe.prices.retrieve(id, { expand: ["tiers"] });
  } catch (err) {
    console.log(`FAIL  ${e.label.padEnd(16)} ${id} could not be read: ${err.message}`);
    bad++;
    continue;
  }

  const problems = [];
  if (price.active !== true) problems.push(`archived (active=${price.active})`);
  if (price.billing_scheme !== "tiered") problems.push(`billing_scheme=${price.billing_scheme}, want tiered`);
  if (price.tiers_mode !== "graduated") problems.push(`tiers_mode=${price.tiers_mode}, want graduated`);
  if (price.recurring?.interval !== e.interval) problems.push(`interval=${price.recurring?.interval}, want ${e.interval}`);
  if (price.currency !== "usd") problems.push(`currency=${price.currency}`);

  const tiers = price.tiers ?? [];
  if (tiers.length !== 2) problems.push(`${tiers.length} tiers, want 2`);
  const [t1, t2] = tiers;
  if (t1) {
    if (t1.up_to !== e.included) problems.push(`tier1 up_to=${t1.up_to}, want ${e.included}`);
    if ((t1.flat_amount ?? 0) !== e.flat * 100) problems.push(`tier1 flat=$${(t1.flat_amount ?? 0) / 100}, want $${e.flat}`);
    if ((t1.unit_amount ?? 0) !== 0) problems.push(`tier1 per-unit=$${(t1.unit_amount ?? 0) / 100}, want $0`);
  }
  if (t2) {
    if (t2.up_to !== null) problems.push(`tier2 up_to=${t2.up_to}, want unlimited`);
    if ((t2.unit_amount ?? 0) !== e.per * 100) problems.push(`tier2 per-unit=$${(t2.unit_amount ?? 0) / 100}, want $${e.per}`);
    if ((t2.flat_amount ?? 0) !== 0) problems.push(`tier2 flat=$${(t2.flat_amount ?? 0) / 100}, want $0`);
  }

  if (problems.length) {
    bad++;
    console.log(`FAIL  ${e.label.padEnd(16)} ${id}`);
    for (const p of problems) console.log(`        - ${p}`);
  } else {
    console.log(`OK    ${e.label.padEnd(16)} ${id}  flat $${e.flat} for ${e.included}, then $${e.per}/seat`);
  }
}

console.log(bad ? `\n${bad} price(s) do NOT match the app.` : "\nAll 6 prices match the app exactly.");
process.exit(bad ? 1 : 0);
