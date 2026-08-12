-- Pre-generated photo thumbnails.
--
-- Grid tiles used to be produced on read by Supabase's image-transformation
-- endpoint (`transform: { width }` on a signed URL). That endpoint is metered
-- by *distinct origin image per billing cycle* rather than by request, and the
-- Pro plan includes 100. With only ~12 MB of photos stored, browsing the
-- gallery alone put the organization at 170% and tripped EXCEEDING USAGE
-- LIMITS -- which, with a spend cap enabled, throttles the project instead of
-- billing for the overage. The meter scales with how many distinct photos get
-- looked at, so it gets worse with every customer, not better.
--
-- Writing a thumbnail beside the original at upload time takes the meter off
-- the read path entirely. Storage is the resource in surplus here (0.012 of
-- 100 GB used), and it also lets readers go back to the batch
-- `createSignedUrls` call: the batch endpoint rejects `transform`, which is the
-- only reason the API was issuing one signing request per photo.
--
-- Nullable on purpose. Photos uploaded before this shipped have no thumbnail,
-- and readers fall back to signing the full-size object -- never to
-- transforming it, which is the behaviour being retired.

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS thumb_path text;

COMMENT ON COLUMN public.photos.thumb_path IS
  'Storage path of the pre-generated thumbnail in the site-photos bucket, derived as "<storage_path>.thumb.jpg". NULL for photos uploaded before thumbnails existed; readers fall back to storage_path.';
