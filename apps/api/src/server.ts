/**
 * Standalone Node HTTP server for @sitepix/api.
 * Deployable independently of apps/web — run with `npm run dev` / `npm start`
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

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = new Hono();

app.use(
  "*",
  cors({
    origin: allowedOrigins.length ? allowedOrigins : "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-Id"],
  }),
);

app.get("/v1/health", (c) =>
  c.json(healthHandler(), 200, { "Cache-Control": "no-store" }),
);

app.post("/v1/rpc", (c) => handleRpc(c.req.raw));
app.post("/v1/auth/send-email", (c) => handleAuthSendEmail(c.req.raw));
app.post("/v1/email/field-report", (c) => handleFieldReportEmail(c.req.raw));
app.post("/v1/hooks/purge-trash", (c) => handlePurgeTrash(c.req.raw));
app.post("/v1/hooks/archive-old-photos", (c) => handleArchiveOldPhotos(c.req.raw));
app.post("/v1/billing/webhook", (c) => handleStripeWebhook(c.req.raw));
app.get("/v1/reports/:token/pdf", (c) => handleReportPdf(c.req.param("token")));
app.get("/v1/walkthroughs/:token/pdf", (c) => handleWalkthroughPdf(c.req.param("token")));

// Legacy aliases — kept for existing Supabase Auth Hook / cron configs. Do not use in new clients.
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

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`sitepix-api listening on http://localhost:${info.port}`);
});
