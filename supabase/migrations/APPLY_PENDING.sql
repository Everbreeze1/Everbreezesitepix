-- =============================================================================
-- APPLY PENDING — run this one file, top to bottom, in the Supabase SQL editor.
-- =============================================================================
--
-- This is a CONVENIENCE AGGREGATE, not a migration. It contains the five
-- migrations that are written but not yet applied, in dependency order:
--
--   20260803020000_feedback_signals.sql
--   20260803030000_feedback_prompt_events.sql
--   20260803040000_issue_reports_description_fix.sql
--   20260803050000_showcase_review_cta.sql
--   20260804000000_portfolio_site.sql
--
-- (20260803010000_showcase_brochure.sql is already applied.)
--
-- Those five files remain the source of truth. This exists because applying
-- them one at a time has repeatedly hit lock contention, and the ordering
-- matters: 04 repairs a column that 02 creates.
--
-- WHY THIS IS URGENT
-- ------------------
-- The application code already reads these columns. Until this runs:
--   * the Showcase builder fails with "Couldn't open this showcase", because
--     getShowcase selects `show_reviews` (PART 4 below);
--   * submitting feedback fails, because it writes `description`/`kind`/
--     `feature`/`sentiment`/`source` (PARTS 1 and 3);
--   * the Portfolio page fails outright and the project list with it, because
--     listShowcases now selects `slug`/`on_site`/`featured` and getMyPortfolio
--     reads a `portfolios` table that does not exist yet (PART 5).
-- The in-app feedback prompt degrades quietly rather than erroring, because its
-- telemetry is deliberately fire-and-forget.
--
-- BEFORE YOU RUN
-- --------------
-- Close any open SitePix browser tabs. ALTER TABLE needs an AccessExclusiveLock
-- and the running app holds read locks on these same tables — that is what
-- produced the earlier "40P01: deadlock detected".
--
-- IF IT STILL DEADLOCKS
-- ---------------------
-- Run the PARTs one at a time by selecting each block. Every statement is
-- idempotent, so re-running any part, or the whole file, is safe regardless of
-- how far a previous attempt got.
-- =============================================================================

-- Fail fast instead of queueing behind app traffic. A lock timeout leaves
-- nothing applied — close the tabs and run again.
SET lock_timeout = '5s';


-- === PART 1 — feedback columns on issue_reports ============================
-- The table predates this migrations folder and the checked-in generated types
-- did not match it, so everything here converges the table to the shape the app
-- writes rather than assuming a starting point.

CREATE TABLE IF NOT EXISTS public.issue_reports (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.issue_reports
  ADD COLUMN IF NOT EXISTS user_id     uuid,
  ADD COLUMN IF NOT EXISTS email       text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS url         text,
  ADD COLUMN IF NOT EXISTS user_agent  text,
  ADD COLUMN IF NOT EXISTS status      text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS kind        text NOT NULL DEFAULT 'bug',
  ADD COLUMN IF NOT EXISTS feature     text,
  ADD COLUMN IF NOT EXISTS sentiment   text,
  ADD COLUMN IF NOT EXISTS source      text NOT NULL DEFAULT 'page',
  ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now();


-- === PART 2 — repair: fold `message` into `description` ====================
-- An earlier cut of the feedback migration assumed a `message` column that does
-- not exist on the deployed table, and its retry then created an empty one.
-- This makes `description` the single text column, preserving anything written
-- to `message` in between.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'issue_reports'
      AND column_name = 'description' AND is_nullable = 'NO'
  ) THEN
    -- A one-tap thumbs signal carries no text.
    ALTER TABLE public.issue_reports ALTER COLUMN description DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'issue_reports'
      AND column_name = 'message'
  ) THEN
    UPDATE public.issue_reports
       SET description = message
     WHERE message IS NOT NULL AND message <> ''
       AND (description IS NULL OR description = '');
    ALTER TABLE public.issue_reports DROP COLUMN message;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_reports_kind_check') THEN
    ALTER TABLE public.issue_reports ADD CONSTRAINT issue_reports_kind_check
      CHECK (kind IN ('bug', 'idea', 'praise'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_reports_sentiment_check') THEN
    ALTER TABLE public.issue_reports ADD CONSTRAINT issue_reports_sentiment_check
      CHECK (sentiment IS NULL OR sentiment IN ('good', 'bad'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_reports_source_check') THEN
    ALTER TABLE public.issue_reports ADD CONSTRAINT issue_reports_source_check
      CHECK (source IN ('page', 'prompt'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS issue_reports_feature_idx
  ON public.issue_reports(feature, created_at DESC);
CREATE INDEX IF NOT EXISTS issue_reports_kind_idx
  ON public.issue_reports(kind, created_at DESC);

GRANT SELECT, INSERT ON public.issue_reports TO authenticated;
GRANT ALL ON public.issue_reports TO service_role;

ALTER TABLE public.issue_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own issue reports" ON public.issue_reports;
CREATE POLICY "Users insert own issue reports" ON public.issue_reports
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users view own issue reports" ON public.issue_reports;
CREATE POLICY "Users view own issue reports" ON public.issue_reports
  FOR SELECT TO authenticated USING (user_id = auth.uid());


-- === PART 3 — prompt funnel telemetry ======================================
-- Separate table on purpose: an impression is not feedback, and mixing them
-- would mean every triage query needs a filter forever.

CREATE TABLE IF NOT EXISTS public.feedback_prompt_events (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature    text NOT NULL,
  event      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feedback_prompt_events_event_check'
  ) THEN
    ALTER TABLE public.feedback_prompt_events
      ADD CONSTRAINT feedback_prompt_events_event_check
      CHECK (event IN ('shown', 'dismissed', 'answered'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS feedback_prompt_events_feature_idx
  ON public.feedback_prompt_events(feature, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_prompt_events_event_idx
  ON public.feedback_prompt_events(event, created_at DESC);

GRANT SELECT, INSERT ON public.feedback_prompt_events TO authenticated;
GRANT ALL ON public.feedback_prompt_events TO service_role;

ALTER TABLE public.feedback_prompt_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own prompt events" ON public.feedback_prompt_events;
CREATE POLICY "Users insert own prompt events" ON public.feedback_prompt_events
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users view own prompt events" ON public.feedback_prompt_events;
CREATE POLICY "Users view own prompt events" ON public.feedback_prompt_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());


-- === PART 4 — showcase review CTA ==========================================
-- This is the one currently breaking the Showcase builder: getShowcase selects
-- `show_reviews`, so until this column exists every load fails.

ALTER TABLE public.showcases
  ADD COLUMN IF NOT EXISTS show_reviews boolean NOT NULL DEFAULT true;


-- === PART 5 — portfolio site ===============================================
-- Showcases stop being the whole deliverable and become the *units* of a
-- mini-site: a `portfolios` table (one per team) plus the metadata a browsable
-- collection needs on each showcase — a slug for a real URL, a service type and
-- products to filter by, and a location for the map pin.
--
-- Full rationale lives in 20260804000000_portfolio_site.sql, which remains the
-- source of truth. 5a–5e below are its PART 1–5 verbatim; if the aggregate
-- deadlocks, run them one sub-part at a time.

-- --- 5a: the portfolios table ---
-- Minimal CREATE followed by ADD COLUMN IF NOT EXISTS — the same shape the
-- issue_reports migration uses. This is NOT stylistic:
--
--   CREATE TABLE IF NOT EXISTS is a no-op on a table that already exists.
--
-- So a single full table definition silently skips every later correction on
-- any database that ran an earlier cut of this file: the table keeps whatever
-- shape it was first created with, forever, while the file still claims to be
-- idempotent. Splitting it means re-running actually CONVERGES.
CREATE TABLE IF NOT EXISTS public.portfolios (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- One site per team. The UNIQUE constraint is what makes "get or create my
  -- portfolio" a safe upsert rather than a read-then-insert race.
  team_id       uuid NOT NULL UNIQUE REFERENCES public.teams(id) ON DELETE CASCADE,
  -- The public URL: /p/<slug>. Globally unique, lowercase, hyphenated. In the
  -- CREATE rather than below because a portfolio without one is unroutable —
  -- there is no sane "add it later" path for it.
  slug          text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.portfolios
  -- Nullable here, and SET NULL in the repair block below — deliberately unlike
  -- showcases.created_by. A showcase belongs to whoever built it, but the
  -- portfolio is the *company's* public website: cascading would delete a live
  -- marketing site (and free its slug for anyone to claim) the day the employee
  -- who first opened the page leaves. Attribution only; nothing reads it.
  ADD COLUMN IF NOT EXISTS created_by      uuid,

  -- Branding. Seeded from the owner's profile on first create, but editable —
  -- the marketing name on a portfolio is often not the legal entity name.
  ADD COLUMN IF NOT EXISTS business_name   text,
  ADD COLUMN IF NOT EXISTS logo_url        text,
  ADD COLUMN IF NOT EXISTS accent_color    text,

  -- Above the fold.
  ADD COLUMN IF NOT EXISTS hero_headline   text,
  ADD COLUMN IF NOT EXISTS hero_subhead    text,
  ADD COLUMN IF NOT EXISTS hero_photo_id   uuid,

  -- Body copy + the two lists that drive filtering and local credibility.
  ADD COLUMN IF NOT EXISTS about_html      text,
  ADD COLUMN IF NOT EXISTS services        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS service_areas   text[] NOT NULL DEFAULT '{}',

  -- Contact block + primary call to action.
  ADD COLUMN IF NOT EXISTS phone           text,
  ADD COLUMN IF NOT EXISTS email           text,
  ADD COLUMN IF NOT EXISTS address         text,
  ADD COLUMN IF NOT EXISTS website_url     text,
  ADD COLUMN IF NOT EXISTS cta_label       text,
  ADD COLUMN IF NOT EXISTS cta_url         text,

  ADD COLUMN IF NOT EXISTS show_map        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_reviews    boolean NOT NULL DEFAULT true,

  -- Nothing is publicly reachable until this flips. Separate from showcases'
  -- own revoked_at so unpublishing the site does not revoke existing share
  -- links people may already have sent to customers.
  ADD COLUMN IF NOT EXISTS published       boolean NOT NULL DEFAULT false,

  -- Embeds are keyed separately from the slug so the contractor can rotate the
  -- widget key (breaking third-party embeds) without changing their site URL,
  -- and so a scraped embed key never reveals the admin surface. UNIQUE lives in
  -- the index below — a column-level UNIQUE cannot be re-run idempotently here.
  ADD COLUMN IF NOT EXISTS embed_key       uuid NOT NULL DEFAULT gen_random_uuid(),

  ADD COLUMN IF NOT EXISTS seo_title       text,
  ADD COLUMN IF NOT EXISTS seo_description text;

-- Named to match what the old inline `embed_key ... UNIQUE` produced, so this
-- is a no-op on databases that already carry that constraint.
CREATE UNIQUE INDEX IF NOT EXISTS portfolios_embed_key_key ON public.portfolios(embed_key);

-- Repair for databases created by an earlier cut of this file, where created_by
-- was NOT NULL and cascaded. Both are corrected in place; on a fresh database
-- the column is already nullable and this only attaches the foreign key.
DO $$
DECLARE
  fk_name   text;
  fk_action "char";
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'portfolios'
      AND column_name = 'created_by' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.portfolios ALTER COLUMN created_by DROP NOT NULL;
  END IF;

  SELECT c.conname, c.confdeltype INTO fk_name, fk_action
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.portfolios'::regclass
    AND c.contype = 'f'
    AND a.attname = 'created_by'
  LIMIT 1;

  -- confdeltype: 'n' = SET NULL, 'c' = CASCADE, 'a' = NO ACTION, 'r' = RESTRICT
  IF fk_name IS NOT NULL AND fk_action <> 'n' THEN
    EXECUTE format('ALTER TABLE public.portfolios DROP CONSTRAINT %I', fk_name);
    fk_name := NULL;
  END IF;

  IF fk_name IS NULL THEN
    ALTER TABLE public.portfolios
      ADD CONSTRAINT portfolios_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- slug and embed_key are both UNIQUE, and a UNIQUE constraint is already backed
-- by an index — so the plain indexes an earlier cut created were pure
-- duplication. Dropped rather than left to cost every write forever.
DROP INDEX IF EXISTS public.portfolios_slug_idx;
DROP INDEX IF EXISTS public.portfolios_embed_key_idx;

ALTER TABLE public.portfolios DROP CONSTRAINT IF EXISTS portfolios_slug_format;
ALTER TABLE public.portfolios
  ADD CONSTRAINT portfolios_slug_format
  CHECK (
    slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
    AND slug NOT IN (
      'admin','api','app','embed','help','login','logout','p','pricing',
      'privacy-policy','share','signup','sitemap','static','support','www'
    )
  );

-- --- 5b: site metadata on showcases ---
-- Most deadlock-prone statement in this file; showcases is read on every load.
ALTER TABLE public.showcases
  ADD COLUMN IF NOT EXISTS slug          text,
  ADD COLUMN IF NOT EXISTS service_type  text,
  ADD COLUMN IF NOT EXISTS products_used text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS summary       text,
  ADD COLUMN IF NOT EXISTS city          text,
  ADD COLUMN IF NOT EXISTS state         text,
  ADD COLUMN IF NOT EXISTS latitude      double precision,
  ADD COLUMN IF NOT EXISTS longitude     double precision,
  ADD COLUMN IF NOT EXISTS on_site       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS featured      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS position      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_on  date;

CREATE UNIQUE INDEX IF NOT EXISTS showcases_team_slug_idx
  ON public.showcases(team_id, slug) WHERE slug IS NOT NULL;

-- Key order mirrors listShowcasesService/compareCardRows exactly. `featured` is
-- deliberately absent: it used to lead the sort and fought drag-to-reorder, so
-- ordering is `position` alone now and featured is just a badge. The DROP makes
-- this correct even if an earlier attempt created the old shape.
DROP INDEX IF EXISTS public.showcases_site_order_idx;
CREATE INDEX IF NOT EXISTS showcases_site_order_idx
  ON public.showcases(team_id, on_site, position, created_at DESC);

-- --- 5c: backfill slugs so existing showcases are reachable ---
-- Row-at-a-time on purpose: de-duplication must consider slugs that ALREADY
-- exist, not just the ones generated in this pass. 5b creates the UNIQUE index
-- before this runs and the app assigns slugs at creation, so a showcase created
-- between 5b and 5c would collide with a set-based backfill and abort the whole
-- file with a 23505. The slugify expression mirrors slugify() in
-- apps/api/src/domains/portfolio/slug.ts (fold accents, drop apostrophes, cap
-- at 50) so backfilled URLs match the ones the app generates from here on.
DO $$
DECLARE
  r         RECORD;
  base      text;
  candidate text;
  n         int;
BEGIN
  FOR r IN
    SELECT id, team_id, title
    FROM public.showcases
    WHERE slug IS NULL
    ORDER BY created_at, id
  LOOP
    base := trim(both '-' from left(
      trim(both '-' from regexp_replace(
        translate(
          lower(translate(r.title, '''’', '')),
          'àáâãäåāăąèéêëēĕėęěìíîïĩīĭįıòóôõöøōŏőùúûüũūŭůűųçćĉċčñńņňýÿŷ',
          'aaaaaaaaaeeeeeeeeeiiiiiiiiiooooooooouuuuuuuuuucccccnnnnyyy'
        ),
        '[^a-z0-9]+', '-', 'g'
      )),
      50
    ));

    IF base IS NULL OR base = '' THEN
      base := 'showcase-' || left(r.id::text, 8);
    END IF;

    candidate := base;
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM public.showcases
      WHERE team_id = r.team_id AND slug = candidate
    ) LOOP
      n := n + 1;
      candidate := base || '-' || n::text;
    END LOOP;

    UPDATE public.showcases SET slug = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- --- 5d: updated_at trigger ---
DROP TRIGGER IF EXISTS portfolios_updated_at_trg ON public.portfolios;
CREATE TRIGGER portfolios_updated_at_trg
  BEFORE UPDATE ON public.portfolios
  FOR EACH ROW EXECUTE FUNCTION public.showcases_set_updated_at();

-- --- 5e: grants and RLS ---
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolios TO authenticated;
GRANT ALL ON public.portfolios TO service_role;

ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members view their portfolio" ON public.portfolios;
CREATE POLICY "Team members view their portfolio" ON public.portfolios
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = portfolios.team_id AND tm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners and admins manage the portfolio" ON public.portfolios;
CREATE POLICY "Owners and admins manage the portfolio" ON public.portfolios
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = portfolios.team_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = portfolios.team_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
    )
  );


-- === VERIFY ================================================================
-- Expect: show_reviews = true, portfolios_ready = true, showcase_slugs_missing
-- = 0, and issue_reports listing description/kind/feature/sentiment/source with
-- NO `message` column.

SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'showcases' AND column_name = 'show_reviews'
) AS showcases_ready;

SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'portfolios'
) AS portfolios_ready;

-- Any showcase without a slug is unreachable on the portfolio site, so PART 5's
-- backfill must leave this at zero.
SELECT count(*) AS showcase_slugs_missing FROM public.showcases WHERE slug IS NULL;

-- created_by must be nullable with ON DELETE SET NULL ('n'), so that removing
-- the employee who set the site up does not delete the company's website.
SELECT
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='portfolios' AND column_name='created_by')
    AS created_by_nullable,          -- expect YES
  (SELECT c.confdeltype FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.portfolios'::regclass
      AND c.contype = 'f' AND a.attname = 'created_by')
    AS created_by_on_delete;         -- expect n

-- REVIEW ONLY — nothing here is changed automatically.
--
-- Slugs written by the FIRST cut of the backfill used plain lower(), which
-- mangled accents ("Cafe" with an acute became caf-...), turned apostrophes
-- into hyphens (dave-s-roofing), and had no length cap. This lists any slug
-- that today's slugify would not have produced.
--
-- Rewriting them is deliberately NOT automatic: a slug is a public URL, and
-- changing one 404s every link already sent to a customer. If a row appears
-- here and the page has not been shared yet, edit it in
-- Portfolio -> Projects -> the project -> "Page address".
SELECT s.title, s.slug AS current_slug, c.canonical AS todays_slugify_would_give
FROM public.showcases s
CROSS JOIN LATERAL (
  -- Mirrors PART 5c exactly, fallback included, so canonical is never blank.
  SELECT COALESCE(
    NULLIF(
      trim(both '-' from left(
        trim(both '-' from regexp_replace(
          translate(
            lower(translate(s.title, '''’', '')),
            'àáâãäåāăąèéêëēĕėęěìíîïĩīĭįıòóôõöøōŏőùúûüũūŭůűųçćĉċčñńņňýÿŷ',
            'aaaaaaaaaeeeeeeeeeiiiiiiiiiooooooooouuuuuuuuuucccccnnnnyyy'
          ),
          '[^a-z0-9]+', '-', 'g'
        )),
        50
      )),
      ''
    ),
    'showcase-' || left(s.id::text, 8)
  ) AS canonical
) c
WHERE s.slug IS NOT NULL
  AND (
    -- Differs from what slugify would produce. LIKE is safe unescaped since
    -- canonical is [a-z0-9-] only, and the PREFIX match deliberately keeps
    -- legitimate "-2"/"-3" de-duplication suffixes out of the report.
    s.slug NOT LIKE c.canonical || '%'
    -- Over the 50-char cap. Needs its own clause: an uncapped slug still
    -- *starts with* the capped canonical, so the prefix test alone misses it.
    OR length(s.slug) > 50
    -- Empty, or carrying characters that have no business in a URL.
    OR s.slug !~ '^[a-z0-9][a-z0-9-]*$'
  );

SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'issue_reports'
ORDER BY ordinal_position;
