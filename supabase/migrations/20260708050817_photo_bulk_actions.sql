-- Photo bulk actions: hide-from-timeline + soft-delete (Trash).
-- Run this against the Everlumen Supabase project.

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS hidden     boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Fast "not in trash" filter used by every project photo query.
CREATE INDEX IF NOT EXISTS idx_photos_project_active
  ON public.photos(project_id, taken_at DESC NULLS LAST, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_photos_deleted_at
  ON public.photos(deleted_at)
  WHERE deleted_at IS NOT NULL;
