#!/usr/bin/env node
/**
 * SSR regression test for the public walkthrough share route.
 *
 * Imports the built Vercel function entry (Nitro `vercel` preset, Build
 * Output API v3) and invokes its `fetch` handler in-process. Asserts that:
 *   1. The handler returns a Response (no thrown exception, no h3-swallowed
 *      `{"unhandled":true,"message":"HTTPError"}` 500).
 *   2. The status is < 500 (we expect 200 — the route renders the
 *      "Walkthrough unavailable" fallback for an unknown token).
 *
 * This guards against operator-precedence / nullish-coalescing bugs in the
 * share route loader (see prior fix in share.walkthroughs.$token.tsx).
 *
 * Run after `npm run build`. The `test:ssr` npm script does both.
 */

import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const ENTRY = resolve(
  process.cwd(),
  "apps/web/.vercel/output/functions/__server.func/index.mjs",
);

const entryPath = ENTRY;

if (!existsSync(entryPath)) {
  console.error(`✗ Built server entry not found at ${ENTRY}`);
  console.error("  Run `npm run build` first, or use `npm run test:ssr`.");
  process.exit(1);
}

const TEST_TOKEN = "00000000-0000-0000-0000-000000000000";
const URL_PATH = `/share/walkthroughs/${TEST_TOKEN}`;

// Minimal Vercel Node function context shim — the handler only touches
// context.waitUntil, everything else (static assets, ISR headers) is handled
// by Vercel's routing layer, not this function.
const context = { waitUntil() {} };

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

let worker;
try {
  worker = (await import(pathToFileURL(entryPath).href)).default;
} catch (err) {
  fail(`Failed to import built server entry: ${err?.stack ?? err}`);
}

if (typeof worker?.fetch !== "function") {
  fail("Built server entry has no default.fetch export");
}

const request = new Request(`https://test.local${URL_PATH}`, { method: "GET" });

let response;
try {
  response = await worker.fetch(request, context);
} catch (err) {
  fail(`SSR fetch threw: ${err?.stack ?? err}`);
}

if (!(response instanceof Response)) {
  fail(`SSR fetch did not return a Response (got ${typeof response})`);
}

const body = await response.text();

if (response.status >= 500) {
  fail(`SSR returned ${response.status} for ${URL_PATH}\n--- body ---\n${body.slice(0, 1000)}`);
}

if (body.includes('"unhandled":true') && body.includes('"message":"HTTPError"')) {
  fail(
    `SSR returned h3-swallowed HTTPError envelope for ${URL_PATH}\n--- body ---\n${body.slice(0, 1000)}`,
  );
}

// Sanity: the share route's fallback markup should be present for an unknown
// token. If it isn't we likely served the wrong document (e.g. asset 404 path).
if (!body.includes("Walkthrough") && !body.includes("walkthrough")) {
  fail(
    `SSR response for ${URL_PATH} does not look like the share route.\n--- body (first 1000) ---\n${body.slice(0, 1000)}`,
  );
}

console.log(`✓ SSR ${URL_PATH} → ${response.status} (${body.length} bytes)`);
