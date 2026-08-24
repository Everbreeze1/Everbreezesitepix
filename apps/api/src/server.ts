/**
 * Standalone Node HTTP server for @everlumen/api.
 * Deployable independently of apps/web - run with `npm run dev` / `npm start`
 * as a plain Node process (no Docker).
 */
import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  healthHandler,
  handleRpc,
  handleAuthSendEmail,
  handleFieldReportEmail,
  handlePurgeTrash,
  handleArchiveOldPhotos,
  handleReportPdf,
  handleWalkthroughPdf,
  handleStripeWebhook,
} from "./http";

/**
 * Secrets with no safe fallback: Supabase (every route), Stripe (billing +
 * webhook signature checks) and Resend (auth + field-report email). Missing one
 * used to surface as a 500 on the first customer request; the process now
 * refuses to boot instead. That is the safe direction on Railway - a failed
 * boot fails the `/v1/health` healthcheck, so the deploy is never promoted and
 * the previous instance keeps serving.
 */
const REQUIRED_ENV = [
  "EVERLUMEN_SUPABASE_URL",
  "EVERLUMEN_SUPABASE_PUBLISHABLE_KEY",
  "EVERLUMEN_SUPABASE_SERVICE_ROLE_KEY",
  "AUTH_EMAIL_HOOK_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

/**
 * Single-feature keys - the rest of the API works without them, so warn only.
 *
 * GOOGLE_CLOUD_API_KEY (Google Cloud Text-to-Speech, domains/tts/synthesize.ts)
 * is deliberately not listed: the synthesizeBreezeSpeech RPC has no caller in
 * the web app yet, and without the key it returns { error: "not_configured" }
 * rather than throwing. Warning about it on every boot is noise that trains
 * people to ignore this line. Add it back when narration playback ships.
 * Walkthrough speech-to-text runs through GEMINI_API_KEY, not this key.
 */
const OPTIONAL_ENV = [
  "GEMINI_API_KEY", // photo + walkthrough AI, incl. speech-to-text
  "GOOGLE_MAPS_API_KEY", // server-side geocoding + Places lookup for Google Business Profile
] as const;

function checkEnv(): void {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    console.error(`everlumen-api: refusing to start - missing required env: ${missing.join(", ")}`);
    console.error(
      "Set them in the Railway service's Variables tab (docs/ops.md), or apps/api/.env locally.",
    );
    process.exit(1);
  }

  const degraded = OPTIONAL_ENV.filter((name) => !process.env[name]?.trim());
  if (degraded.length) {
    console.warn(
      `everlumen-api: starting without ${degraded.join(", ")} - the features they back will fail closed.`,
    );
  }

  // Monthly checkout reads STRIPE_PRICE_<PLAN>_MONTHLY and falls back to the
  // legacy unsuffixed var, so either name satisfies it. The _ANNUAL ids are a
  // known gap (see lib/stripe.ts) and deliberately not checked here.
  const missingPrices = (["STARTER", "PRO", "TEAM"] as const).filter(
    (plan) => !(process.env[`STRIPE_PRICE_${plan}_MONTHLY`] || process.env[`STRIPE_PRICE_${plan}`]),
  );
  if (missingPrices.length) {
    console.warn(
      `everlumen-api: no monthly Stripe price id for ${missingPrices.join(", ")} - checkout for those plans will fail.`,
    );
  }
}

checkEnv();

/**
 * Railway does not reliably export NODE_ENV=production - it depends on the
 * builder - so keying the guard below on NODE_ENV alone would leave it inert in
 * the one environment it exists to protect. Any of Railway's own injected
 * variables is proof enough that this is not a developer's laptop.
 */
const isProduction =
  process.env.NODE_ENV === "production" ||
  Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * `*` is a fine local-dev default but a dangerous production one - it lets any
 * site read this API's responses. An unset allowlist in production is fatal for
 * the same reason the REQUIRED_ENV list is: `/v1/health` carries no `Origin`
 * header and answers 200 regardless, so merely refusing cross-origin calls
 * would let Railway promote a deploy whose every browser call is CORS-blocked -
 * the live site goes dark behind a green healthcheck. Failing the boot fails
 * the healthcheck instead, and the previous instance keeps serving.
 */
if (isProduction && !allowedOrigins.length) {
  console.error(
    "everlumen-api: refusing to start - ALLOWED_ORIGINS is unset in production. Set it in Railway to the apex + www origins (docs/ops.md).",
  );
  process.exit(1);
}

const corsOrigin: string | string[] = allowedOrigins.length ? allowedOrigins : "*";

const app = new Hono();

/**
 * Baseline security headers on **every** response - successes, `onError` 500s
 * and `notFound` 404s alike, which is why they are applied after `next()` on
 * the outermost middleware rather than per route. Handler-owned headers
 * (Content-Type, Cache-Control, the rate-limit headers) are already set by then
 * and are left untouched.
 */
app.use("*", async (c, next) => {
  await next();
  const headers = c.res.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Nothing here renders HTML, and the two PDF routes are opened as top-level
  // tabs by apps/web (`window.open` / `target="_blank"`), never iframed - so a
  // blanket DENY is safe. The deliberately-framed embed product is served by
  // apps/web, not by this API, so it is unaffected.
  headers.set("X-Frame-Options", "DENY");
  // No server-side code path needs these; geocoding uses the Maps HTTP API and
  // walkthrough audio is uploaded by the client, not captured here.
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  headers.set("Content-Security-Policy", cspFor(headers.get("Content-Type")));
});

/**
 * This API only ever returns JSON or a PDF, so nothing legitimately loads a
 * subresource and `default-src 'none'` is the correct baseline for JSON.
 *
 * The PDF routes deliberately get a much weaker policy. They send
 * `Content-Disposition: inline`, so Chrome renders them through a generated
 * plugin document that `<embed>`s the file, and that embed is subject to the
 * PDF response's own CSP - `default-src 'none'` (which covers `object-src`) has
 * historically rendered such tabs blank. A PDF is not a document the browser
 * can be tricked into executing, so `frame-ancestors` is the only directive
 * that buys anything here anyway; the rest is risk without benefit on a
 * customer-facing share link we cannot exercise in a real Chrome from CI.
 * (Compare apps/web, which ships its CSP report-only for the same reason.)
 */
function cspFor(contentType: string | null): string {
  if (contentType?.startsWith("application/pdf")) return "frame-ancestors 'none'";
  return "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
}

app.use(
  "*",
  cors({
    origin: corsOrigin,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-Id"],
  }),
);

app.get("/v1/health", (c) => c.json(healthHandler(), 200, { "Cache-Control": "no-store" }));

app.post("/v1/rpc", (c) => handleRpc(c.req.raw));
app.post("/v1/auth/send-email", (c) => handleAuthSendEmail(c.req.raw));
app.post("/v1/email/field-report", (c) => handleFieldReportEmail(c.req.raw));
app.post("/v1/hooks/purge-trash", (c) => handlePurgeTrash(c.req.raw));
app.post("/v1/hooks/archive-old-photos", (c) => handleArchiveOldPhotos(c.req.raw));
app.post("/v1/billing/webhook", (c) => handleStripeWebhook(c.req.raw));
app.get("/v1/reports/:token/pdf", (c) => handleReportPdf(c.req.param("token")));
app.get("/v1/walkthroughs/:token/pdf", (c) => handleWalkthroughPdf(c.req.param("token")));

// Legacy aliases - kept for existing Supabase Auth Hook / cron configs. Do not use in new clients.
app.post("/api/auth/send-email", (c) => handleAuthSendEmail(c.req.raw));
app.post("/api/email-report", (c) => handleFieldReportEmail(c.req.raw));
app.post("/api/public/hooks/purge-trash", (c) => handlePurgeTrash(c.req.raw));
app.post("/api/public/hooks/archive-old-photos", (c) => handleArchiveOldPhotos(c.req.raw));
app.get("/api/public/reports/:token/pdf", (c) => handleReportPdf(c.req.param("token")));
app.get("/api/public/walkthroughs/:token/pdf", (c) => handleWalkthroughPdf(c.req.param("token")));

app.notFound((c) => c.json({ code: "unknown_op", message: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ code: "internal_error", message: "Internal error" }, 500);
});

const port = Number(process.env.PORT ?? 8787);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`everlumen-api listening on http://localhost:${info.port}`);
});

/** Upper bound on the drain - a walkthrough PDF render is the slowest request. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;

/**
 * Railway sends SIGTERM on every deploy and SIGKILLs shortly after. Without
 * this, in-flight requests are dropped mid-response on each release. Stop
 * accepting connections, let what is already running finish, then exit.
 */
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`everlumen-api: ${signal} received - draining in-flight requests`);

  const force = setTimeout(() => {
    console.error(`everlumen-api: drain exceeded ${SHUTDOWN_TIMEOUT_MS}ms - exiting anyway`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  // Don't let the timer itself hold the loop open once the drain is done.
  force.unref();

  // Idle keep-alive sockets carry no request but would otherwise keep close()
  // waiting for the full timeout on every deploy.
  if ("closeIdleConnections" in server) server.closeIdleConnections();

  server.close((err) => {
    clearTimeout(force);
    if (err) {
      console.error("everlumen-api: error while closing server", err);
      process.exit(1);
    }
    console.log("everlumen-api: shutdown complete");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
