#!/usr/bin/env node
/**
 * SSR regression test for the public, anonymous routes.
 *
 * Imports the built Vercel function entry (Nitro `vercel` preset, Build Output
 * API v3) and invokes its `fetch` handler in-process. For each route it asserts:
 *   1. The handler returns a Response (no thrown exception, no h3-swallowed
 *      `{"unhandled":true,"message":"HTTPError"}` 500).
 *   2. The status is < 500 — every one of these routes is expected to render a
 *      graceful "unavailable" state for unknown ids, not blow up.
 *   3. The body looks like the intended route rather than some other document.
 *
 * This originally guarded one operator-precedence bug in the walkthrough share
 * loader. It now covers the portfolio site and its embeds too, because those
 * routes load data in a *route loader* — so a loader that throws takes down a
 * page a search engine is crawling, rather than flashing an error inside an
 * already-rendered shell the way the older client-fetching share pages do.
 *
 * The API is not reachable from this harness, so every loader here exercises
 * its catch path. That is exactly the case worth pinning: a marketing page must
 * degrade to "unavailable", never to a 500.
 *
 * Run after `npm run build`. The `test:ssr` npm script does both.
 */

import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const ENTRY = resolve(process.cwd(), "apps/web/.vercel/output/functions/__server.func/index.mjs");

if (!existsSync(ENTRY)) {
  console.error(`✗ Built server entry not found at ${ENTRY}`);
  console.error("  Run `npm run build` first, or use `npm run test:ssr`.");
  process.exit(1);
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** `expect` is matched case-insensitively; at least one entry must be present. */
const ROUTES = [
  { path: `/share/walkthroughs/${NIL_UUID}`, expect: ["walkthrough"] },
  // Matched against the route's own <title>, not the URL. "showcase" used to
  // pass on the path segment alone, so the assertion stayed green through the
  // rename without ever reading a byte the route actually rendered. This body
  // is streamed, so the head is the only server-rendered text there is.
  { path: `/share/showcases/${NIL_UUID}`, expect: ["<title>project"] },
  // The two field records. Both fetch client-side, so the server renders only
  // the shell — the assertion is that the shell renders at all. `RecordDocument`
  // reads `window` nowhere, and this is what keeps it that way.
  { path: `/share/checklists/${NIL_UUID}`, expect: ["<title>shared checklist"] },
  { path: `/share/workflows/${NIL_UUID}`, expect: ["<title>shared workflow"] },
  // What a printed QR code opens. Same client-fetching shape as the two above,
  // and the one route here a stranger reaches by pointing a phone at a wall —
  // so "the shell renders at all" is the difference between a scan showing
  // "unavailable" and a scan showing a 500.
  { path: `/share/projects/${NIL_UUID}`, expect: ["<title>shared project"] },
  { path: "/p/a-portfolio-that-does-not-exist", expect: ["portfolio"] },
  { path: "/p/a-portfolio-that-does-not-exist/some-project", expect: ["project"] },
  { path: `/embed/gallery/${NIL_UUID}`, expect: ["gallery"] },
  { path: `/embed/map/${NIL_UUID}`, expect: ["map"] },
  {
    // Pure server handler, no React — asserts the snippet contractors paste is
    // actually served rather than falling through to the SPA shell.
    path: "/embed.js",
    expect: ["sitepix:embed:height", "data-sitepix"],
  },
  {
    // Enumerates published portfolios; must survive the API being unreachable.
    path: "/sitemap.xml",
    expect: ["<urlset"],
  },
];

// Minimal Vercel Node function context shim — the handler only touches
// context.waitUntil, everything else (static assets, ISR headers) is handled by
// Vercel's routing layer, not this function.
const context = { waitUntil() {} };

const failures = [];
function fail(msg) {
  console.error(`✗ ${msg}`);
  failures.push(msg);
}

let worker;
try {
  worker = (await import(pathToFileURL(ENTRY).href)).default;
} catch (err) {
  console.error(`✗ Failed to import built server entry: ${err?.stack ?? err}`);
  process.exit(1);
}

if (typeof worker?.fetch !== "function") {
  console.error("✗ Built server entry has no default.fetch export");
  process.exit(1);
}

for (const route of ROUTES) {
  let response;
  try {
    response = await worker.fetch(
      new Request(`https://test.local${route.path}`, { method: "GET" }),
      context,
    );
  } catch (err) {
    fail(`SSR fetch threw for ${route.path}: ${err?.stack ?? err}`);
    continue;
  }

  if (!(response instanceof Response)) {
    fail(`SSR fetch did not return a Response for ${route.path} (got ${typeof response})`);
    continue;
  }

  const body = await response.text();

  if (response.status >= 500) {
    fail(`SSR returned ${response.status} for ${route.path}\n--- body ---\n${body.slice(0, 800)}`);
    continue;
  }

  if (body.includes('"unhandled":true') && body.includes('"message":"HTTPError"')) {
    fail(
      `SSR returned h3-swallowed HTTPError envelope for ${route.path}\n--- body ---\n${body.slice(0, 800)}`,
    );
    continue;
  }

  const haystack = body.toLowerCase();
  if (!route.expect.some((needle) => haystack.includes(needle.toLowerCase()))) {
    fail(
      `SSR response for ${route.path} does not look like that route (wanted one of ${route.expect.join(", ")}).\n--- body (first 800) ---\n${body.slice(0, 800)}`,
    );
    continue;
  }

  console.log(`✓ SSR ${route.path} → ${response.status} (${body.length} bytes)`);
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} of ${ROUTES.length} SSR routes failed`);
  process.exit(1);
}

console.log(`\n✓ all ${ROUTES.length} SSR routes rendered`);
