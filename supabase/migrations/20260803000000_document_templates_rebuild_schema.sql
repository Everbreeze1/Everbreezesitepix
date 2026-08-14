-- SitePix example-template library rebuild - part 1 of 2: schema.
--
-- Split from a single migration into two after a deadlock ran hitting it as
-- one transaction: this file only ALTERs document_templates (needs a brief
-- AccessExclusiveLock), so it stays fast and contentious for as short a
-- window as possible. Part 2 (the DELETE + INSERTs) needs no table-level
-- lock at all once this has run, so it cannot deadlock against normal app
-- traffic the way the combined script could.
--
-- Run this file, let it finish, then run
-- 20260803000001_document_templates_rebuild_seed.sql separately. If you hit
-- SQLSTATE 40P01 (deadlock detected) again, close any other tab/query
-- touching document_templates (Supabase Studio’s own Table Editor keeps a
-- live connection on whatever table it has open) and re-run - everything
-- here is idempotent.

-- 0. Schema for ownerless built-in templates, carried over from the deleted
--    20260730000000_document_template_examples.sql. Example templates are
--    modelled as `team_id IS NULL AND created_by IS NULL` - readable by every
--    authenticated user, writable by nobody (the pre-existing FOR ALL policy
--    can never match a NULL created_by), so duplicating is the only way to get
--    an editable copy.
ALTER TABLE public.document_templates ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.document_templates ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS document_templates_slug_key
  ON public.document_templates(slug);

DROP POLICY IF EXISTS "Anyone can read example document templates" ON public.document_templates;
CREATE POLICY "Anyone can read example document templates"
  ON public.document_templates FOR SELECT TO authenticated
  USING (team_id IS NULL AND created_by IS NULL);

-- 1. Retire the superseded seeds. Deleted rather than archived: they are
--    ownerless built-ins (team_id IS NULL AND created_by IS NULL), so nobody's
--    own work is at risk. Documents already created FROM them are unaffected -
--    project_pages copies the HTML at creation time and does not reference the
--    template row.
DELETE FROM public.document_templates
WHERE created_by IS NULL
  AND team_id IS NULL
  AND slug IN ('example-001-timesheet', 'example-002-prebuilt-report-2up', 'example-003-prebuilt-report-3up', 'example-004-prebuilt-report-4up', 'example-adjusting-claim-notes-chronology', 'example-adjusting-property-damage-assessment', 'example-cleaning-invoice-with-photos', 'example-cleaning-job-checklist-qa', 'example-general-construction-change-order-register', 'example-general-construction-daily-log', 'example-photo-report-generic', 'example-restoration-damage-assessment-scope', 'example-roofing-final-invoice-warranty-card', 'example-roofing-inspection-report');

-- Also catch the pre-existing untracked "Photo Report" row that
-- 20260731080000 adopted, in case that migration never ran.
DELETE FROM public.document_templates
WHERE created_by IS NULL AND team_id IS NULL AND slug IS NULL AND name = 'Photo Report';

