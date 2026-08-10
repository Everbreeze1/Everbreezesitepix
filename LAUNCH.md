# LAUNCH — owner runbook

Everything in this file needs a human with dashboard credentials. None of it can
be done from the repo, and none of it happens automatically on deploy.

The site is already live and serving paying customers, so this is not a
pre-launch checklist in the usual sense — it is the list of things that are
currently wrong or missing in production. Work it top to bottom; the sections
are ordered by blast radius.

Legend: **[BLOCKER]** = a live customer is exposed or a core flow is broken
right now. **[HIGH]** = ship this week. **[MEDIUM]** = ship this month.

> `docs/` is gitignored, so `docs/ops.md` referenced below exists only on the
> owner's workstation. This file is the committed one.

---

## 1. Supabase — `ulmgvtuqjlzzadlwtiog`

### 1.1 ~~[BLOCKER] Run `20260811000000_lock_down_anon_reads.sql`~~ — DONE, VERIFIED

Anyone with the publishable (anon) key — which is in the JavaScript bundle of the
public website, so: anyone — could read `team_invites`, `walkthroughs` and
`walkthrough_photos` without logging in. That included invite `token`s and
walkthrough `share_token`s. A harvested share token returned a 6 MB customer PDF
from the public API. A harvested invite token was an unauthenticated account
takeover.

**This migration has been applied to production and re-verified since.** All
three tables now answer an anonymous caller with `401` /
`42501 permission denied`, and `scripts/verify-anon-exposure.mjs` probes all 55
tables and reports none readable. Authenticated reads and the public share path
were both re-checked afterwards and still work (see 1.2).

Re-run the check any time — it is the regression test for this whole class of bug:

```bash
node scripts/verify-anon-exposure.mjs   # exits non-zero if anything is exposed
```

Run it again after **every** migration that adds a table: Supabase's default
privileges grant `anon` access to new tables in `public` automatically, so a new
table is exposed the moment it exists unless the migration revokes it. That
default is precisely how this incident happened.

### 1.2 [BLOCKER] Decide whether to rotate already-leaked share tokens

The migration closed the hole. It did **not** invalidate tokens that were already
readable for as long as the hole was open, and there is no way to know whether
anyone harvested them. Rotating them invalidates **every walkthrough share link
you have ever sent a customer**.

Confirmed still true after 1.1: a share token harvested from the anonymous dump
*before* the lockdown still returns the full 6 MB PDF from
`GET /v1/walkthroughs/<token>/pdf` unauthenticated. That is by design — the
public share path runs on the service-role client, which is why locking out
`anon` did not break it — but it does mean **the 31 leaked tokens remain valid
until you rotate them**. Closing the leak did not un-leak what was already taken.

This is a judgement call, not a step to run blindly. If you rotate, tell
customers their old links are dead before you do it, not after. The rotation SQL
is at the bottom of `20260811000000_lock_down_anon_reads.sql`, commented out,
with a backup table so you can map old links to new ones.

### 1.3 [BLOCKER] Run `20260811001000_schema_drift_repair.sql` — STILL OUTSTANDING

Production is missing two migrations it was believed to have. Verified against
the live database after 1.1 landed:

| object | migration | state in production |
| --- | --- | --- |
| `feedback_signals` table | `20260803020000` | **missing** (`PGRST205`) |
| `showcases.brochure_enabled` | `20260803010000` | **missing** (`42703`) |
| `showcases.intro_html`, `outro_html`, `accent_color`, `show_contact` | `20260803010000` | present |
| `showcase_sections` table | `20260803010000` | present |
| `issue_reports.description/kind/feature/sentiment/source` | `20260803040001` | present |

So `20260803010000` was applied *partially* — which is exactly the failure mode
that hand-applying migrations produces, and the reason for 1.4.

Run this **separately from 1.1**, and only after closing every SitePix browser tab —
it takes `AccessExclusiveLock` on `showcases`/`showcase_items`, which has
deadlocked on previous attempts because the running app holds read locks on the
same tables.

If it reports `40P01: deadlock detected`, close all tabs, wait a minute, run it
again. It is written to be re-runnable.

### 1.4 [BLOCKER] Capture the real production schema

`walkthroughs`, `photos`, `projects` and `profiles` are created by **no
migration in this repo**. The schema in `supabase/migrations/` cannot rebuild
production, so there is currently no disaster-recovery path and no way to stand
up a staging copy.

```bash
# One-time, from the repo root. Asks for the database password
# (Supabase dashboard → Settings → Database → Database password).
npx supabase login
npx supabase link --project-ref ulmgvtuqjlzzadlwtiog
npx supabase db pull
```

`db pull` writes a new timestamped migration containing everything production
has that the repo does not. Read it before committing — it will be large, and
it will contain the tables above plus anything else added through the dashboard.

Note that nine tables referenced by migrations or generated types do not exist
in production at all (`project_label_events`, `photo_shares`, `voice_usage`,
`conversations`, `messages`, `subscriptions`, `portfolio_items`,
`project_page_shares`, `showcase_shares`). `db pull` will make that visible;
decide per table whether it is dead code or a missing feature.

### 1.5 [HIGH] Push the versioned auth config

`supabase/config.toml` now carries the auth settings that used to exist only in
the dashboard: site URL, redirect allow-list, JWT expiry, refresh-token
rotation, email confirmations, an 8-character minimum password, and per-IP auth
rate limits.

**Writing that file changed nothing in production.** It applies only when you
run:

```bash
npx supabase config push
```

Read `supabase/config.toml` end to end before you do. Two specific risks:

- `config push` writes the **whole** auth block. Google and Apple sign-in are
  deliberately not declared in the file for exactly this reason — but confirm
  in the dashboard (**Authentication → Sign In / Providers**) that both are
  still enabled immediately after the push, and re-enable them if not.
- The Send Email auth hook (`/v1/auth/send-email` → Resend) is likewise not
  declared. Confirm under **Authentication → Hooks** that it is still pointed at
  `https://api.everbreezesitepix.com/v1/auth/send-email` after the push.

If you would rather not risk it, set the same values by hand instead:
**Authentication → URL Configuration** for site URL and redirect URLs,
**Authentication → Sign In / Providers → Email** for confirmations and password
length, **Authentication → Rate Limits** for the rest.

### 1.6 [HIGH] Backups and PITR

**Settings → Database → Backups.** Confirm daily backups are on, and enable
**Point-in-Time Recovery** (paid add-on). Without PITR the recovery granularity
is one day, and — given 1.4 — a restore is currently the *only* way back.

Write down the retention window here once you have set it: `________`

---

## 2. DNS and email deliverability

Measured from this workstation on 2026-08-11:

```
everbreezesitepix.com   TXT   v=spf1 include:secureserver.net -all
everbreezesitepix.com   MX    everbreezesitepix-com.mail.protection.outlook.com
_dmarc.everbreezesitepix.com        (no record)
resend._domainkey.everbreezesitepix.com   (NXDOMAIN)
send.everbreezesitepix.com                (NXDOMAIN)
```

**What this means.** The API sends every transactional email — signup
confirmations, password resets, team invites, field reports — through Resend
from an address at `everbreezesitepix.com`. The SPF record authorises GoDaddy
(`secureserver.net`) and **nothing else**, and it ends in `-all`, which is a
hard fail instruction. Resend is not authorised, there is no DKIM key, and with
no DMARC record there is no reporting either. Gmail and Outlook will reject or
spam-folder that mail. Until this is fixed, a customer who forgets their
password cannot get back in.

### 2.1 [BLOCKER] Authorise Resend

Resend dashboard → **Domains → Add Domain**. Resend will issue the exact records;
add them at GoDaddy → **My Products → DNS**. Two shapes are possible depending
on what Resend offers you:

**Option A — dedicated sending subdomain (recommended).** Resend gives you
records for `send.everbreezesitepix.com`. This leaves the root SPF untouched,
so it cannot break Microsoft 365 mail:

| Type  | Host                        | Value                                       |
| ----- | --------------------------- | ------------------------------------------- |
| MX    | `send`                      | *(the `feedback-smtp.*.amazonses.com` host Resend shows)*, priority 10 |
| TXT   | `send`                      | `v=spf1 include:amazonses.com ~all`          |
| TXT   | `resend._domainkey`         | *(the long `p=…` DKIM key Resend shows)*     |

Then set `EMAIL_FROM` in Railway to an address at the subdomain, e.g.
`Everbreeze SitePix <info@send.everbreezesitepix.com>`.

**Option B — keep sending from the root domain.** Then the root SPF must be
edited to include Resend, keeping GoDaddy:

```
v=spf1 include:secureserver.net include:amazonses.com -all
```

plus the `resend._domainkey` TXT record. Only ever have **one** SPF TXT record
on a name — two is a permanent SPF failure. Edit the existing record; do not add
a second.

Copy the DKIM value exactly, including any trailing characters. GoDaddy's editor
silently truncates very long values in some browsers — after saving, verify:

```bash
nslookup -type=TXT resend._domainkey.everbreezesitepix.com
```

Finally, click **Verify** in Resend and wait for the domain to go green.

### 2.2 [BLOCKER] Add DMARC

Start at `p=none` so nothing is rejected while you watch the reports:

| Type | Host     | Value                                                          |
| ---- | -------- | -------------------------------------------------------------- |
| TXT  | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@everbreezesitepix.com; fo=1` |

The `rua` mailbox must actually exist and be readable. After two weeks of clean
reports, move to `p=quarantine`, then `p=reject`. Do not start at `p=reject` —
you will bin your own mail.

### 2.3 Verify end to end

Send a real password reset to a Gmail address and to an Outlook address. Open
the message → **Show original** / **View message details** and confirm all three
of `spf=pass`, `dkim=pass`, `dmarc=pass`. Anything less and you are not done.

---

## 3. Vercel — `apps/web`

### 3.1 [HIGH] Confirm the security headers actually shipped

`apps/web/vercel.json` is new. **It is at `apps/web/`, not the repo root, on
purpose**: this Vercel project's Root Directory is `apps/web`, and Vercel reads
`vercel.json` from the Root Directory. A file at the repo root would be silently
ignored.

After the next deploy:

```bash
curl -sI https://www.everbreezesitepix.com/ | grep -iE \
  'strict-transport|content-type-options|referrer-policy|permissions-policy|content-security|frame-options'
```

Expect `Strict-Transport-Security`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`,
`Content-Security-Policy-Report-Only`, `X-Frame-Options: DENY` and
`Content-Security-Policy: frame-ancestors 'none'`.

Then confirm the embed product is **not** blocked — the whole point of the
per-path rule:

```bash
curl -sI https://www.everbreezesitepix.com/embed/gallery/SOME_KEY | grep -iE 'frame'
```

Expect **no** `X-Frame-Options` and **no** `frame-ancestors`. If either appears,
every customer who pasted the embed snippet into their own website now has a
blank box, and this must be rolled back immediately.

### 3.2 [HIGH] Promote the CSP from report-only to enforcing

The Content-Security-Policy ships as `Content-Security-Policy-Report-Only`. In
that mode the browser reports violations and blocks nothing, so a mistake in the
allowlist is invisible to customers rather than a white screen. **Do not skip
the observation period.** The allowlist was derived by reading the code, not by
watching real traffic, and the code loads from Supabase, the Railway API, Google
Maps, Google Fonts and cdnjs, plus `blob:`/`data:` for client-side image and PDF
work.

1. Deploy and leave it in report-only for at least a week of normal use,
   including a full walkthrough recording, a map view, a PDF export and a
   Stripe checkout.
2. Collect the violations. Cheapest option: open DevTools → Console on the live
   site and read the `[Report Only]` warnings. Better: point them at Sentry by
   appending `; report-uri <your Sentry CSP endpoint>` to the policy value.
3. Add whatever legitimately appears to the right directive. Note that
   `style-src 'unsafe-inline'` is not removable — Tailwind v4 and Radix both
   inject inline styles at runtime — and `script-src 'unsafe-inline'` is
   currently required too, because the app ships an inline theme-bootstrap
   script and TanStack Start emits inline hydration scripts.
4. Only when a week is quiet, rename the header key in `apps/web/vercel.json`
   from `Content-Security-Policy-Report-Only` to `Content-Security-Policy` —
   keeping the separate `frame-ancestors` header as it is — and deploy.

### 3.3 [MEDIUM] HSTS `preload` is a one-way door

The header now says `max-age=63072000; includeSubDomains; preload`. Sending it
is harmless. **Submitting the domain to the preload list at
https://hstspreload.org is effectively permanent** and forces HTTPS on every
subdomain of `everbreezesitepix.com`, including any GoDaddy or Microsoft 365
subdomain that might still serve plain HTTP. Inventory your subdomains first.
`api.everbreezesitepix.com` is HTTPS-only and fine.

### 3.4 Environment variables

**Settings → Environment Variables**, for both Production and Preview:

| Variable                        | Required | Notes                                        |
| ------------------------------- | -------- | -------------------------------------------- |
| `VITE_SUPABASE_URL`             | yes      | `https://ulmgvtuqjlzzadlwtiog.supabase.co`   |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes      | Publishable/anon key — RLS is the protection |
| `VITE_API_BASE_URL`             | yes      | `https://api.everbreezesitepix.com`          |
| `VITE_GOOGLE_MAPS_API_KEY`      | no       | Browser key; restrict by HTTP referrer       |

If `VITE_GOOGLE_MAPS_API_KEY` is not referrer-restricted to
`*.everbreezesitepix.com/*`, fix that in Google Cloud Console now — it is in the
public bundle.

---

## 4. Railway — `apps/api`

### 4.1 Environment variables

**Service → Variables.** `apps/api/.env.example` is the authoritative list and
marks each variable required vs optional. Three that the example file was
missing until now, and that annual checkout throws without:

```
STRIPE_PRICE_STARTER_ANNUAL
STRIPE_PRICE_PRO_ANNUAL
STRIPE_PRICE_TEAM_ANNUAL
```

Confirm they are set in Railway, not only in the local `.env`.

Also re-confirm `ALLOWED_ORIGINS` contains **both** hostnames:

```
ALLOWED_ORIGINS=https://everbreezesitepix.com,https://www.everbreezesitepix.com
```

The site serves from `www`; with only the apex listed, every browser call is
CORS-blocked.

### 4.2 Healthcheck

Already configured — `apps/api/railway.toml` sets `healthcheckPath = "/v1/health"`.
Confirm it is green in the Railway dashboard after each deploy. The server
deliberately refuses to boot when a required variable is missing, so a failed
healthcheck usually means a missing variable, and the logs name it.

### 4.3 [MEDIUM] More than one instance

The service runs as a single instance, so every restart or redeploy is a gap in
availability. Raise the replica count under **Settings → Replicas** once
graceful shutdown is confirmed in the logs (look for a clean `SIGTERM` line on
redeploy rather than an abrupt stop).

### 4.4 [HIGH] Nothing is calling the cron hooks

`POST /v1/hooks/purge-trash` and `POST /v1/hooks/archive-old-photos` exist and
authenticate with an `x-cron-secret` header checked against the Supabase Vault
secret `get_cron_shared_secret`.

**Verified: nothing schedules them.** There is no `cron.schedule` call anywhere
in `supabase/migrations/`, no `crons` entry in the built
`apps/web/.vercel/output/config.json`, and no scheduler service in
`railway.toml`. Deleted projects are therefore never purged from storage and old
photos are never archived — storage grows without bound and the "30 days in
trash" promise is not kept.

Pick one and set it up:

- **Supabase `pg_cron` + `pg_net`** (Database → Extensions, enable both), then
  schedule an HTTP POST to each endpoint with the `x-cron-secret` header. Keeps
  the secret inside Supabase Vault where it already lives.
- **Railway cron service** — a second service on a schedule that `curl`s both
  endpoints.
- **An external scheduler** (cron-job.org, GitHub Actions `schedule:`). Simplest,
  but the secret then lives in a third place.

Whichever you choose, verify by watching the API logs for the hook to fire once,
and confirm a trashed project older than the retention window disappears.

---

## 5. Stripe

- [ ] **Live mode is actually on.** `STRIPE_SECRET_KEY` in Railway must be an
      `sk_live_` key, and the price IDs must be the live-mode ones — test-mode
      price IDs silently fail against a live key.
- [ ] **Prices are graduated tiered, not flat per-unit.** Checkout sends
      `quantity` = total seats. A flat per-unit price bills 5 × the base price
      for a 5-seat team instead of base + 2 extra seats. The required tier
      boundaries are documented on `planToPriceId` in
      `apps/api/src/lib/stripe.ts` and must mirror `apps/web/src/lib/pricing.ts`.
      Check all six prices (3 plans × monthly/annual).
- [ ] **Webhook endpoint** → `https://api.everbreezesitepix.com/v1/billing/webhook`.
      Copy its signing secret into Railway as `STRIPE_WEBHOOK_SECRET` — it is
      per-endpoint, so a re-created endpoint needs a new secret.
- [ ] **Enabled events** must include `checkout.session.completed`,
      `customer.subscription.updated`, `customer.subscription.deleted` and
      `invoice.payment_failed`. The last one is newly handled; without it
      enabled in the dashboard, a failed renewal is invisible to the app and the
      customer silently keeps full access.
- [ ] **Tax.** Decide whether Stripe Tax is on. If you are selling to US
      customers across state lines this is not optional; confirm with an
      accountant rather than guessing.
- [ ] Send a test event from the dashboard for each of the four types and
      confirm a `200` in the Railway logs.

---

## 6. Monitoring

There is currently **no error tracking and no uptime monitoring at all** —
production failures are only visible if a customer reports them.

- [ ] **Sentry.** Create two projects (browser + node), add the DSNs to Vercel
      and Railway. Nothing in the repo reads a Sentry DSN yet, so this needs a
      code change as well as the dashboard work.
- [ ] **Uptime check on `https://api.everbreezesitepix.com/v1/health`** — every
      minute, alerting to a phone. This is the single most valuable alert:
      the API refuses to boot on a missing variable, so a bad deploy shows up
      here immediately.
- [ ] **Uptime check on `https://www.everbreezesitepix.com/`.**
- [ ] **A CSP report endpoint**, once §3.2 is under way.
- [ ] **Supabase database size and storage size alerts** — see §4.4; nothing is
      currently purging anything.

---

## 7. Secret rotation

- [ ] The root `.env` on the owner's workstation contains `email` and `password`
      — a **real login** to a SitePix account, used by the Playwright scripts in
      `scripts/`. That password has been shared. Rotate it, and point the
      scripts at a throwaway account rather than a real customer-visible one.
- [ ] The same workstation's `apps/api/.env` holds a **live `sk_live_` Stripe
      secret key**. If that file has ever been on a shared drive, in a chat, or
      in a screen share, roll the key in the Stripe dashboard
      (**Developers → API keys → Roll**) and update Railway.
- [ ] `SITEPIX_SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely. Rotate it in
      the Supabase dashboard if there is any doubt about where it has been, and
      confirm it appears **only** in Railway — never in Vercel.
- [ ] `AUTH_EMAIL_HOOK_SECRET` and the Vault cron secret, same reasoning.

Rotate Stripe last: it is the one whose rotation is customer-visible if a
webhook is missed mid-swap.

---

## 8. Legal and contact placeholders

`apps/web/src/lib/contact.ts` now holds `[[PLACEHOLDER]]` values for the support,
privacy and legal email addresses, the legal entity name, the registered address
and the governing-law jurisdiction. They render as inert text rather than dead
`mailto:` links, so they are visible in review — but they are visible to
customers too.

- [ ] Decide the real values and fill them in.
- [ ] Create the mailboxes so they do not bounce. They must be on
      `everbreezesitepix.com`; the old footer advertised `hello@sitepix.com`, a
      domain this product does not own.
- [ ] Have someone qualified read the Terms of Service and Privacy Policy before
      you rely on them. In particular the Privacy Policy now discloses that
      customer photos are sent to Google Gemini for AI analysis — confirm that
      matches what you actually do, and that your customers' own contracts allow
      it.

---

## 9. Honestly unverified

Things this runbook asserts on inference rather than measurement. Check them
rather than trusting them:

- **Whether the Vercel project's Root Directory is still `apps/web`.** It is
  documented as such and the header file is placed accordingly, but the setting
  was not read from the dashboard. If it has changed, `apps/web/vercel.json` is
  ignored and the headers never ship. §3.1's `curl` settles it.
- **The Vercel preview-deployment URL pattern**, left commented out in
  `supabase/config.toml`. Sign-in on preview deployments will fail until it is
  filled in.
- **Whether Google/Apple sign-in and the Send Email hook survive
  `supabase config push`.** §1.5 tells you to check immediately after; that
  check has not been performed by anyone yet.
- **The Node version on Railway.** Production web functions run `nodejs24.x`
  (Nitro writes this into the build output), and CI is pinned to match. Nothing
  pins the API's Node version — `apps/api/railpack.json` sets no version and
  `package.json` has no `engines` field, so Railway picks whatever Railpack
  defaults to on the day it builds. That should be pinned.
- **Whether Stripe Tax, GoDaddy's `secureserver.net` include covering Microsoft
  365, and the current backup retention are correct.** All three were reasoned
  about, none were confirmed.
