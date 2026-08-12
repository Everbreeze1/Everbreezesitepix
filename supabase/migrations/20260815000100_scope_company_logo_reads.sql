-- Scope SELECT on `company-logos` to the folder's owner.
--
-- 20260618045310 created this bucket public and added a blanket read policy:
--
--     CREATE POLICY "Public read company logos"
--       ON storage.objects FOR SELECT
--       USING (bucket_id = 'company-logos');
--
-- No role restriction and no path predicate, so anyone -- signed in or not --
-- could enumerate every object in the bucket. Supabase's dashboard flags it
-- ("Clients can list all files in this bucket"), and the leak is real if modest:
-- paths are `{auth_user_id}/logo-*.png`, so a listing hands over the full
-- customer count and their user UUIDs.
--
-- It also bought nothing. The bucket is public, so serving a logo over HTTP
-- never consults storage.objects RLS at all, and the app only ever calls
-- `.upload()` and `.getPublicUrl()` -- the latter is client-side string
-- construction that touches no database. Nothing in the product lists,
-- downloads, or signs a URL from this bucket.
--
-- Scoped rather than dropped outright. `upload(..., { upsert: true })` is how
-- both logo paths write (SettingsPage, PortfolioSitePanel), and an upsert that
-- probes for an existing row would fail with no SELECT policy at all. Keeping
-- an owner-scoped SELECT costs nothing and removes the risk of trading an
-- enumeration leak for broken logo uploads. The predicate matches the INSERT,
-- UPDATE and DELETE policies from the same original migration.

DROP POLICY IF EXISTS "Public read company logos" ON storage.objects;

DROP POLICY IF EXISTS "Users read own company logos" ON storage.objects;
CREATE POLICY "Users read own company logos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
