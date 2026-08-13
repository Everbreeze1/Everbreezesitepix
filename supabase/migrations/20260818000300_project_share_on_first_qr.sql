-- A project's public link publishes itself the first time its owner opens the
-- QR dialog — and never again after that.
--
-- 20260817000000 gave every project a `share_token` and an off switch
-- (`share_revoked_at`) that starts engaged, on the principle that publishing to
-- the internet is an act rather than a default. That principle stands. What
-- that migration had no way to express is that "off" covers two different
-- situations:
--
--   * nobody has ever said anything about this link   — the column default
--   * the owner turned it off on purpose              — a decision
--
-- Both read `share_revoked_at IS NOT NULL`, so the QR dialog had to treat them
-- alike and ask for a tap either way. Asking in the second case is correct.
-- Asking in the first is asking someone who has just opened "QR code for this
-- job" whether they meant it — which is what the field reported: the point of
-- generating a code is to hand it to a client who cannot sign in, so a code
-- that arrives dead is a code that needs explaining.
--
-- `share_decided_at` records that the question has an answer:
--
--   NULL      — nobody has chosen. Opening the QR dialog publishes, once.
--   NOT NULL  — the owner published or revoked. Only they change it from here,
--               and no amount of opening the dialog will touch it again.
--
-- The publishing happens in `ensureProjectShareService`, as one conditional
-- UPDATE (`… WHERE share_decided_at IS NULL`) on the caller's RLS-scoped
-- client. Being a single statement is what makes it safe: two dialogs opened at
-- once cannot publish twice, and a link its owner switched off can never be
-- resurrected by someone merely looking at it.
--
-- Idempotent. Apply via the SitePix Supabase SQL editor.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS share_decided_at timestamptz;

-- === BACKFILL — one time only ==============================================
-- Every project that exists when this runs is marked as already decided, which
-- means none of them auto-publish: `share_revoked_at` is taken at face value,
-- so a link an owner deliberately switched off in the days since 20260817000000
-- stays off. There is no column that can tell those apart from the blanket
-- backfill that migration performed, and of the two ways to be wrong, leaving
-- an extra tap on a handful of existing projects is the one that cannot expose
-- a customer's job site.
--
-- Everything created from here on starts undecided and publishes on first open.
--
-- If you would rather the projects that already exist behave the same way, run
-- this once — after which the next person to open one of their QR dialogs
-- publishes that project:
--
--   UPDATE public.projects SET share_decided_at = NULL WHERE share_revoked_at IS NOT NULL;
--
-- Guarded on the column's comment rather than on `share_decided_at IS NULL`,
-- because this file is advertised as re-runnable and a bare NULL-guarded UPDATE
-- would, on a second run, mark every project created since the first run as
-- "already decided" — silently switching first-open publishing off for exactly
-- the projects it was written for.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_description d
    JOIN pg_attribute a ON a.attrelid = d.objoid AND a.attnum = d.objsubid
    WHERE d.objoid = 'public.projects'::regclass
      AND a.attname = 'share_decided_at'
  ) THEN
    UPDATE public.projects
       SET share_decided_at = COALESCE(share_revoked_at, now())
     WHERE share_decided_at IS NULL;

    COMMENT ON COLUMN public.projects.share_decided_at IS
      'When the owner last chose to publish or revoke the public link. NULL means nobody has chosen yet and opening the QR dialog publishes it once — see ensureProjectShareService.';
  END IF;
END $$;

-- No grant changes. `projects` was closed to anon and PUBLIC by 20260817000000
-- and a new column inherits that; the public route reads through the service
-- role and returns no token, decided or otherwise.

-- === VERIFY ================================================================
-- Expect: every pre-existing project decided, and `undecided` counting only
-- projects created after this ran.
SELECT count(*)                                            AS projects,
       count(*) FILTER (WHERE share_decided_at IS NULL)    AS undecided,
       count(*) FILTER (WHERE share_revoked_at IS NULL)    AS publicly_shared
FROM public.projects;
--
-- And the comment that guards the backfill, which must exist exactly once:
SELECT col_description('public.projects'::regclass, a.attnum) AS share_decided_at_comment
FROM pg_attribute a
WHERE a.attrelid = 'public.projects'::regclass
  AND a.attname = 'share_decided_at';
