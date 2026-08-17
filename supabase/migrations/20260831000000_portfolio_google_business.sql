-- Connect a portfolio to its Google Business Profile.
--
-- Client feedback on the generated mini-site:
--
--   "Also there is no google reviews link. No review link to allow users to see
--    their reviews on google if they have any. They should be able to connect
--    their google business account URL to pull a lot of that information in
--    about their business and use that information to build their mini site
--    without much effort."
--
-- Two separate asks, and they share one answer. A contractor's Google Business
-- Profile already holds the name, address, phone, website, category and star
-- rating that the guided build asks them to retype. Pasting one link should
-- fill the form AND wire up both review links:
--
--   google_reviews_url     "Read our 47 Google reviews" - for prospects, on the
--                          portfolio site.
--   google_review_ask_url  "Leave us a review" - for customers, on the job
--                          report they get when the work is finished. That page
--                          is the only thing the trade actually sends a
--                          customer, so it is the only place the ask can land.
--
-- Both are derived from place_id rather than stored blind, but they are
-- persisted anyway: the public site read runs on the service-role client with
-- no network calls, and re-deriving a URL on every anonymous page view would
-- put a Google dependency in the render path of a marketing page.
--
-- rating / review_count are a CACHE, refreshed when the owner presses Refresh.
-- Google's terms forbid storing Places content indefinitely, so
-- google_synced_at is what lets the UI show "as of <date>" and prompt a refresh
-- rather than presenting a stale number as live.
--
-- Apply via the SitePix Supabase SQL editor. Safe to re-run.

SET lock_timeout = '5s';

ALTER TABLE public.portfolios
  -- The stable Places identifier. Everything else here is derived from it, so
  -- this is the only column that a re-sync treats as the source of truth.
  ADD COLUMN IF NOT EXISTS google_place_id       text,
  -- What the owner pasted / what Google calls the canonical map link. Shown
  -- back to them so "is this the right listing?" is answerable at a glance.
  ADD COLUMN IF NOT EXISTS google_maps_url       text,
  -- The listing's name on Google, which is regularly not the name they typed
  -- into the site ("Everbreeze Heating & Air" vs "Everbreeze Heating And Air").
  -- Kept for the confirmation card only; business_name stays theirs to edit.
  ADD COLUMN IF NOT EXISTS google_name           text,
  ADD COLUMN IF NOT EXISTS google_rating         numeric(2,1),
  ADD COLUMN IF NOT EXISTS google_review_count   integer,
  ADD COLUMN IF NOT EXISTS google_reviews_url    text,
  ADD COLUMN IF NOT EXISTS google_review_ask_url text,
  ADD COLUMN IF NOT EXISTS google_synced_at      timestamptz;

-- One profile per listing is not enforced: two teams may legitimately point at
-- the same place (a franchise and its parent), and a UNIQUE here would hand the
-- first team a way to lock the second out of their own listing. Indexed only
-- for the admin-side lookup.
CREATE INDEX IF NOT EXISTS portfolios_google_place_id_idx
  ON public.portfolios(google_place_id)
  WHERE google_place_id IS NOT NULL;

ALTER TABLE public.portfolios DROP CONSTRAINT IF EXISTS portfolios_google_rating_range;
ALTER TABLE public.portfolios
  ADD CONSTRAINT portfolios_google_rating_range
  CHECK (google_rating IS NULL OR (google_rating >= 0 AND google_rating <= 5));
