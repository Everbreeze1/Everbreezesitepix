-- A NOTIFICATION PREFERENCE THE SENDER CAN ACTUALLY READ.
--
-- Settings has had a Notifications screen since the first build: an "Email
-- notifications" master switch, a "Push notifications" switch, and four topic
-- rows. Every one of them was written to `localStorage`
-- (`everlumen:notif-prefs:<uid>`), which lives in one browser on one device and
-- which no server has ever been able to read.
--
-- That was harmless for as long as the product sent no email about work. The
-- assignment notifications added in 20260915000000 end that: a crew member who
-- turns email off would keep receiving it, and the only control left to them is
-- the spam button - which costs the sending domain far more than any of these
-- messages is worth, and takes the invites and password resets down with it.
--
-- So the preference moves somewhere the sender can see it.
--
-- ===========================================================================
-- WHY A COLUMN ON `profiles` AND NOT A TABLE
-- ===========================================================================
-- It is one row per user, always read alongside the name and address the sender
-- is already fetching, and never queried on its own. A table would be a second
-- lookup on the hot path of every email for no gain. `profiles` also already
-- has exactly the RLS this needs - own-row SELECT and UPDATE, from
-- 20260618045310 - so a person can change their own preference from the browser
-- and nobody else's, with no new policy at all.
--
-- ===========================================================================
-- WHY jsonb, AND WHY THE DEFAULT IS AN EMPTY OBJECT
-- ===========================================================================
-- Sparse on purpose. A key appears only when somebody changes it, so `{}` means
-- "has never expressed a preference" - which is every account that exists
-- today - and the reader treats a missing key as the default rather than as
-- off. That is what stops this migration from silently unsubscribing the entire
-- customer base the moment it runs.
--
-- The shape is described once, in TypeScript, at
-- packages/shared/src/notification-prefs.ts. Both the Settings screen and the
-- email sender import it. Deliberately NOT re-stated as a CHECK constraint
-- here: a constraint listing the keys would be a second copy of that shape, it
-- would reject a preference written by a newer build during a rolling deploy,
-- and `parseNotificationPrefs` already drops anything it does not recognise.
--
-- Idempotent, safe to re-run. Apply via the Everlumen Supabase SQL editor
-- (project ulmgvtuqjlzzadlwtiog) or `supabase db push`.

SET lock_timeout = '5s';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.notification_prefs IS
  'Sparse per-user notification switches. A missing key means the default (on). See packages/shared/src/notification-prefs.ts.';

-- No new grants and no new policies. `profiles` is own-row SELECT and UPDATE
-- for `authenticated` (20260618045310), which is exactly right: your
-- preferences are yours to read and yours to change. The email sender reads
-- them with the service-role key alongside the address it is already fetching.

-- === VERIFY ================================================================
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'profiles' AND column_name = 'notification_prefs';
--
-- Every existing row should read as "no preference expressed", not as off:
--
--   SELECT count(*) FILTER (WHERE notification_prefs = '{}'::jsonb) AS untouched,
--          count(*) AS total
--     FROM public.profiles;
--
-- And after switching something off in Settings, that one row should carry it:
--
--   SELECT id, notification_prefs FROM public.profiles
--    WHERE notification_prefs <> '{}'::jsonb;
