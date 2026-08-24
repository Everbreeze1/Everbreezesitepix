-- Portfolio Site: showcases stop being the whole deliverable and become the
-- *units* of a mini-site.
--
-- Client feedback on the brochure builder (20260803010000_showcase_brochure):
-- "Right now our showcase / portfolio it looks like a very beautiful report.
--  It's like a mini site that should be created."
--
-- That is an information-architecture gap, not a styling one. A showcase today
-- is one long document delivered by a raw token URL - it has a beginning and an
-- end, no front door, no way to move between projects, and it is noindex. A site
-- has a home page, rooms you can walk between, and a way back.
--
-- So this adds the layer above showcases:
--
--   portfolios          one per team. The mini-site itself: branded slug, hero,
--                       about copy, services, service areas, contact + CTA, and
--                       an embed key for the website gallery/map widgets.
--
--   showcases.*         the metadata a *browsable* collection needs that a
--                       standalone document never did: a slug for a real URL,
--                       a service type and products to filter by, a summary for
--                       the card, and a location so the map has a pin.
--
-- Location is DENORMALISED onto the showcase rather than joined from projects,
-- for the same reason project_id is not a FK on showcase_sections: a published
-- portfolio must keep rendering after the underlying project is deleted.
--
-- ---------------------------------------------------------------------------
-- IF YOU HIT "40P01: deadlock detected"
-- ---------------------------------------------------------------------------
-- Same cause and same fix as the brochure migration: ALTER TABLE needs an
-- AccessExclusiveLock, the SQL editor runs the whole script as ONE transaction,
-- and the live app reads these tables in the opposite order. Close any open
-- Everlumen tabs, then run the PARTS BELOW ONE AT A TIME. Everything is
-- idempotent, so re-running any part - or the whole file - is safe.
--
-- Apply via the Everlumen Supabase SQL editor (or `supabase db push`).
-- ---------------------------------------------------------------------------

SET lock_timeout = '5s';


-- === PART 1 - the portfolios table =========================================
-- Minimal CREATE followed by ADD COLUMN IF NOT EXISTS - the same shape the
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
  -- CREATE rather than below because a portfolio without one is unroutable -
  -- there is no sane "add it later" path for it.
  slug          text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.portfolios
  -- Nullable here, and SET NULL in the repair block below - deliberately unlike
  -- showcases.created_by. A showcase belongs to whoever built it, but the
  -- portfolio is the *company's* public website: cascading would delete a live
  -- marketing site (and free its slug for anyone to claim) the day the employee
  -- who first opened the page leaves. Attribution only; nothing reads it.
  ADD COLUMN IF NOT EXISTS created_by      uuid,

  -- Branding. Seeded from the owner's profile on first create, but editable -
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
  -- the index below - a column-level UNIQUE cannot be re-run idempotently here.
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
-- by an index - so the plain indexes an earlier cut created were pure
-- duplication. Dropped rather than left to cost every write forever.
DROP INDEX IF EXISTS public.portfolios_slug_idx;
DROP INDEX IF EXISTS public.portfolios_embed_key_idx;

-- Reserved words that would collide with existing top-level routes, so a team
-- cannot claim /p/login-shaped paths if the URL scheme is ever flattened.
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


-- === PART 2 - site metadata on showcases ===================================
-- This is the statement most likely to deadlock, because showcases is read on
-- every list-page load. Run it on its own if the whole file keeps failing.
ALTER TABLE public.showcases
  ADD COLUMN IF NOT EXISTS slug          text,
  -- The filter facet on the gallery: "Roofing", "Kitchen Remodel", …
  ADD COLUMN IF NOT EXISTS service_type  text,
  ADD COLUMN IF NOT EXISTS products_used text[] NOT NULL DEFAULT '{}',
  -- Card copy. tagline is the *document's* standfirst and is often a street
  -- address; a card needs one line about the job itself.
  ADD COLUMN IF NOT EXISTS summary       text,
  ADD COLUMN IF NOT EXISTS city          text,
  ADD COLUMN IF NOT EXISTS state         text,
  ADD COLUMN IF NOT EXISTS latitude      double precision,
  ADD COLUMN IF NOT EXISTS longitude     double precision,
  -- Whether this showcase appears on the portfolio site / embeds. Defaults true
  -- so every showcase that already exists shows up the moment a team publishes,
  -- rather than presenting them with an empty site they have to populate twice.
  ADD COLUMN IF NOT EXISTS on_site       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS featured      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS position      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_on  date;

-- Slugs are unique per team, not globally - two roofers may both have a
-- "smith-residence". Partial so the many pre-existing NULL slugs don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS showcases_team_slug_idx
  ON public.showcases(team_id, slug) WHERE slug IS NOT NULL;

-- Drives the site's ordered grid. Key order mirrors listShowcasesService and
-- compareCardRows exactly - `featured` is deliberately NOT in here. It used to
-- lead the sort, which fought drag-to-reorder (a card dropped above a featured
-- one snapped back on the next read), so ordering is now `position` alone and
-- `featured` is just a badge. An index that disagrees with the query can't
-- serve the sort at all, so the two have to be changed together.
DROP INDEX IF EXISTS public.showcases_site_order_idx;
CREATE INDEX IF NOT EXISTS showcases_site_order_idx
  ON public.showcases(team_id, on_site, position, created_at DESC);


-- === PART 3 - backfill slugs for existing showcases ========================
-- Without this, every showcase created before today is unreachable on the site
-- (the project route matches on slug).
--
-- This is a row-at-a-time loop rather than one clever UPDATE ... row_number()
-- for a reason that a set-based version gets wrong: the de-duplication has to
-- consider slugs that ALREADY exist, not just the ones being generated in this
-- pass. PART 2 creates the UNIQUE index before this runs, and the app assigns
-- slugs to new showcases at creation - so if anyone creates a showcase between
-- PART 2 and PART 3 (entirely possible; the app is live), a window function
-- that only sees `slug IS NULL` rows will happily generate a duplicate and take
-- the whole migration down with a 23505.
--
-- The loop re-checks the table on every candidate, so it is correct regardless
-- of what is already there. Showcase counts are small and this runs once.
--
-- The slugify expression mirrors slugify() in
-- apps/api/src/domains/portfolio/slug.ts: fold accents, drop apostrophes so
-- "Dave's" becomes daves and not dave-s, collapse everything else to hyphens,
-- and cap at 50 characters. Backfilled URLs have to look like the ones the app
-- generates from here on, or the same job title produces two different slugs
-- depending on when it was created.
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
          -- Apostrophes vanish; every other non-alphanumeric becomes a break.
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


-- --- 5f: backfill map pins from the projects the work came from ---
-- Showcases built before createShowcaseFromProject denormalised location have
-- NULL city/state/lat/lng, so they never get a map pin and never count toward
-- "areas served" - the project map silently renders as nothing.
--
-- The coordinates already exist on the project (geocoded when its address was
-- entered), so this copies them across the same way 5c backfills slugs.
--
-- COALESCE, not assignment: a value the owner typed by hand always wins, and
-- re-running can never overwrite it. DISTINCT ON takes the first section's
-- project, which for a generated showcase is the only one anyway.
UPDATE public.showcases s
SET city      = COALESCE(s.city, p.city),
    state     = COALESCE(s.state, p.state),
    latitude  = COALESCE(s.latitude, p.latitude),
    longitude = COALESCE(s.longitude, p.longitude)
FROM (
  SELECT DISTINCT ON (sec.showcase_id)
         sec.showcase_id, pr.city, pr.state, pr.latitude, pr.longitude
  FROM public.showcase_sections sec
  JOIN public.projects pr ON pr.id = sec.project_id
  WHERE sec.project_id IS NOT NULL
  ORDER BY sec.showcase_id, sec.position
) p
WHERE p.showcase_id = s.id
  AND (s.latitude IS NULL OR s.longitude IS NULL OR s.city IS NULL OR s.state IS NULL);


-- === PART 4 - updated_at trigger ===========================================
-- Reuses the function the showcases table already installed.
DROP TRIGGER IF EXISTS portfolios_updated_at_trg ON public.portfolios;
CREATE TRIGGER portfolios_updated_at_trg
  BEFORE UPDATE ON public.portfolios
  FOR EACH ROW EXECUTE FUNCTION public.showcases_set_updated_at();


-- === PART 5 - grants and row-level security ================================
-- Cheap locks only; safe to run any time.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolios TO authenticated;
GRANT ALL ON public.portfolios TO service_role;

ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;

-- Note there is deliberately NO anon policy. The public site is served by the
-- service-role client in getPublicPortfolioService, exactly like the existing
-- public showcase/report/page reads - that keeps the "is it published?" check
-- in one auditable place instead of spread across RLS predicates.
DROP POLICY IF EXISTS "Team members view their portfolio" ON public.portfolios;
CREATE POLICY "Team members view their portfolio" ON public.portfolios
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = portfolios.team_id AND tm.user_id = auth.uid()
    )
  );

-- The portfolio is the company's public face, so writes are owner/admin only -
-- stricter than showcases, where any member may edit one they created.
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
