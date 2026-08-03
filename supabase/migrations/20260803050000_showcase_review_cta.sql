-- Let a showcase ask for a review.
--
-- Review links already exist (team_review_links, configured in Settings) and
-- already render on the public *report* page. The showcase is the better home
-- for them: when a job finishes you send the customer a page of their finished
-- work, and that is the natural moment to ask — far better than a bare email.
--
-- It needs to be per-showcase rather than always-on because a showcase serves
-- two jobs. A per-job page goes to a customer who just paid you, where the ask
-- belongs. A portfolio goes to a prospect who has not hired you yet, where
-- "leave us a review" makes no sense. Defaults on, since generating from a
-- project (the per-job case) is the common path.
--
-- Apply via the SitePix Supabase SQL editor. Safe to re-run.

ALTER TABLE public.showcases
  ADD COLUMN IF NOT EXISTS show_reviews boolean NOT NULL DEFAULT true;
