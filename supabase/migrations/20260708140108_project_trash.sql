-- Project-level trash: soft-delete entire projects, restore, and purge >60d.
-- Run this against the Everlumen backend.

-- The original projects table uses `created_by` as the owner column. Newer
-- trash/permission code expects `owner_id`, so we add it and backfill it.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE public.projects
  SET owner_id = created_by
WHERE owner_id IS NULL AND created_by IS NOT NULL;

-- Keep owner_id in sync with created_by so new inserts don't leave it NULL.
CREATE OR REPLACE FUNCTION public.sync_project_owner_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.owner_id := NEW.created_by;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_project_owner_id ON public.projects;
CREATE TRIGGER trg_sync_project_owner_id
  BEFORE INSERT OR UPDATE OF created_by ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.sync_project_owner_id();

-- Now add the soft-delete column for the project trash.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Index for "active projects for an owner" queries.
CREATE INDEX IF NOT EXISTS idx_projects_owner_active
  ON public.projects(owner_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- Index for trash-listing queries.
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at
  ON public.projects(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Make sure photos already have the soft-delete and hidden columns from the
-- photo-bulk-actions migration. These are idempotent so they are safe to repeat.
ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Index for "active photos in a project" queries.
CREATE INDEX IF NOT EXISTS idx_photos_project_active
  ON public.photos(project_id, taken_at DESC NULLS LAST, created_at DESC)
  WHERE deleted_at IS NULL;

-- Index for per-project trash listing.
CREATE INDEX IF NOT EXISTS idx_photos_deleted_at
  ON public.photos(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Purge function: removes photos and projects that have been in trash > 60 days.
-- Called by pg_cron (or the /api/public/hooks/purge-trash endpoint).
CREATE OR REPLACE FUNCTION public.purge_expired_trash()
RETURNS TABLE (photos_purged int, projects_purged int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ph_count int := 0;
  pj_count int := 0;
BEGIN
  WITH del AS (
    DELETE FROM public.photos
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - interval '60 days'
    RETURNING 1
  )
  SELECT count(*) INTO ph_count FROM del;

  WITH del AS (
    DELETE FROM public.projects
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - interval '60 days'
    RETURNING 1
  )
  SELECT count(*) INTO pj_count FROM del;

  photos_purged := ph_count;
  projects_purged := pj_count;
  RETURN NEXT;
END;
$$;
