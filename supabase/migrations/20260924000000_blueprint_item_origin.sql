-- PER-ITEM BLUEPRINT ORIGIN.
--
-- Applying a blueprint fans out into project_checklists, project_reports,
-- project_workflows and project_pages, and every row it writes is
-- indistinguishable from one typed by hand. The only provenance we kept was
-- the ledger row in project_blueprint_applications, which records THAT a
-- blueprint was applied and how many of each kind it made - never WHICH rows.
--
-- The project header worked around that by inferring: it read the blueprint's
-- contents, took the source template ids, and badged any project row whose
-- `template_id` matched. Three things are wrong with that, and the client hit
-- all three:
--
--   1. A checklist a user adds by hand from the same template is badged as
--      blueprint-sourced. The inference cannot tell the two apart.
--   2. The panel's counts are the `counts` jsonb frozen at apply time, while
--      each tab counts what is there now. Add one report by hand and the panel
--      says "1 report" while the Reports tab says 2, forever. Counts have to be
--      derived from the items, not remembered.
--   3. Editing a blueprint changes the badges on projects it was applied to
--      months ago, because the inference reads the blueprint as it is NOW.
--      That directly contradicts the snapshot rule those projects rely on.
--
-- This records the fact instead of guessing at it. One nullable column per
-- table pointing at the ledger row, written at apply time.
--
-- Apply via the Everlumen Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent: safe to re-run, and a no-op once it has run.

-- ---------------------------------------------------------------------------
-- 1. The columns.
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL, not CASCADE: deleting the audit trail must never delete
-- a crew's checklist. The row survives and simply stops claiming an origin.
ALTER TABLE public.project_checklists
  ADD COLUMN IF NOT EXISTS blueprint_application_id uuid
    REFERENCES public.project_blueprint_applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blueprint_origin_inferred boolean NOT NULL DEFAULT false;

ALTER TABLE public.project_reports
  ADD COLUMN IF NOT EXISTS blueprint_application_id uuid
    REFERENCES public.project_blueprint_applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blueprint_origin_inferred boolean NOT NULL DEFAULT false;

ALTER TABLE public.project_workflows
  ADD COLUMN IF NOT EXISTS blueprint_application_id uuid
    REFERENCES public.project_blueprint_applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blueprint_origin_inferred boolean NOT NULL DEFAULT false;

ALTER TABLE public.project_pages
  ADD COLUMN IF NOT EXISTS blueprint_application_id uuid
    REFERENCES public.project_blueprint_applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blueprint_origin_inferred boolean NOT NULL DEFAULT false;

-- `tasks` is not written by the apply service today, so every task is manual.
-- The column goes on anyway so the UI has one rule for every kind rather than
-- a special case that has to be unpicked the first time a blueprint carries
-- tasks.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS blueprint_application_id uuid
    REFERENCES public.project_blueprint_applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blueprint_origin_inferred boolean NOT NULL DEFAULT false;

-- Partial indexes: the overwhelming majority of rows are manual and NULL here,
-- and the only question ever asked is "which rows belong to this application".
CREATE INDEX IF NOT EXISTS project_checklists_blueprint_application_idx
  ON public.project_checklists (blueprint_application_id)
  WHERE blueprint_application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_reports_blueprint_application_idx
  ON public.project_reports (blueprint_application_id)
  WHERE blueprint_application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_workflows_blueprint_application_idx
  ON public.project_workflows (blueprint_application_id)
  WHERE blueprint_application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_pages_blueprint_application_idx
  ON public.project_pages (blueprint_application_id)
  WHERE blueprint_application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_blueprint_application_idx
  ON public.tasks (blueprint_application_id)
  WHERE blueprint_application_id IS NOT NULL;

COMMENT ON COLUMN public.project_checklists.blueprint_application_id IS
  'The apply that created this row. NULL means added manually.';
COMMENT ON COLUMN public.project_checklists.blueprint_origin_inferred IS
  'True when set by the 20260924000000 backfill by matching template_id, not observed at apply time.';

-- ---------------------------------------------------------------------------
-- 2. Backfill, best effort, flagged as inferred.
-- ---------------------------------------------------------------------------
-- Everything below is a GUESS, and it is marked as one. The rule: a row is
-- attributed to an application when it sits on that application's project, its
-- template is one the blueprint carries, and it was created within a minute of
-- the apply. The time window is what stops a checklist added by hand from the
-- same template a week later from being swept up.
--
-- `blueprint_application_id IS NULL` on every UPDATE is what makes this
-- idempotent and what stops it ever overwriting a recorded fact with a guess.

-- The templates each blueprint carries, from both storage shapes, as a CTE
-- repeated per statement rather than a temp table. A temp table declared
-- ON COMMIT DROP is dropped at the end of the enclosing transaction, and a
-- script pasted into the SQL editor is not guaranteed to be one - so the
-- second statement could find it gone. A CTE has no such dependency.
--
-- The legacy join table predates project_template_items and a blueprint can
-- hold both, so the backfill reads the same union the apply service reads.

-- Checklists. `template_id` exists here, so this is the one kind the guess can
-- actually be made for with any confidence.
WITH refs AS (
  SELECT project_template_id AS blueprint_id, checklist_template_id AS ref_id, 'checklist'::text AS kind
    FROM public.project_template_checklists
  UNION ALL
  SELECT project_template_id, ref_id, kind
    FROM public.project_template_items
)
UPDATE public.project_checklists c
   SET blueprint_application_id = a.id,
       blueprint_origin_inferred = true
  FROM public.project_blueprint_applications a
  JOIN refs r
    ON r.blueprint_id = a.blueprint_id
   AND r.kind = 'checklist'
 WHERE c.blueprint_application_id IS NULL
   AND c.project_id = a.project_id
   AND c.template_id = r.ref_id
   AND c.created_at BETWEEN a.created_at - interval '1 minute'
                        AND a.created_at + interval '1 minute';

-- Workflows. Same rule, same column.
WITH refs AS (
  SELECT project_template_id AS blueprint_id, checklist_template_id AS ref_id, 'checklist'::text AS kind
    FROM public.project_template_checklists
  UNION ALL
  SELECT project_template_id, ref_id, kind
    FROM public.project_template_items
)
UPDATE public.project_workflows w
   SET blueprint_application_id = a.id,
       blueprint_origin_inferred = true
  FROM public.project_blueprint_applications a
  JOIN refs r
    ON r.blueprint_id = a.blueprint_id
   AND r.kind = 'workflow'
 WHERE w.blueprint_application_id IS NULL
   AND w.project_id = a.project_id
   AND w.template_id = r.ref_id
   AND w.created_at BETWEEN a.created_at - interval '1 minute'
                        AND a.created_at + interval '1 minute';

-- Pages. No template_id column, but `source_template` carries
-- 'document_template:<uuid>' for exactly the pages a blueprint's document
-- sections create, so the same match is available one string-concat away.
WITH refs AS (
  SELECT project_template_id AS blueprint_id, checklist_template_id AS ref_id, 'checklist'::text AS kind
    FROM public.project_template_checklists
  UNION ALL
  SELECT project_template_id, ref_id, kind
    FROM public.project_template_items
)
UPDATE public.project_pages p
   SET blueprint_application_id = a.id,
       blueprint_origin_inferred = true
  FROM public.project_blueprint_applications a
  JOIN refs r
    ON r.blueprint_id = a.blueprint_id
   AND r.kind = 'document'
 WHERE p.blueprint_application_id IS NULL
   AND p.project_id = a.project_id
   AND p.source_template = 'document_template:' || r.ref_id::text
   AND p.created_at BETWEEN a.created_at - interval '1 minute'
                        AND a.created_at + interval '1 minute';

-- Reports. `project_reports.source_template` holds the BARE report template id
-- and is typed `uuid`; `project_pages.source_template` is `text` holding
-- 'document_template:<uuid>'. The two columns share a name and NOTHING else -
-- not the encoding and not even the type - so this join is deliberately
-- different from the one above, and casting either side to match the other is
-- how the first attempt at this migration failed with
-- "operator does not exist: uuid = text".
WITH refs AS (
  SELECT project_template_id AS blueprint_id, checklist_template_id AS ref_id, 'checklist'::text AS kind
    FROM public.project_template_checklists
  UNION ALL
  SELECT project_template_id, ref_id, kind
    FROM public.project_template_items
)
UPDATE public.project_reports rp
   SET blueprint_application_id = a.id,
       blueprint_origin_inferred = true
  FROM public.project_blueprint_applications a
  JOIN refs r
    ON r.blueprint_id = a.blueprint_id
   AND r.kind = 'report'
 WHERE rp.blueprint_application_id IS NULL
   AND rp.project_id = a.project_id
   AND rp.source_template = r.ref_id
   AND rp.created_at BETWEEN a.created_at - interval '1 minute'
                         AND a.created_at + interval '1 minute';

-- ---------------------------------------------------------------------------
-- 3. Report what happened, so running this in the SQL editor is not silent.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_n integer; w_n integer; p_n integer; r_n integer; apps integer;
BEGIN
  SELECT count(*) INTO apps FROM public.project_blueprint_applications;
  SELECT count(*) INTO c_n FROM public.project_checklists WHERE blueprint_application_id IS NOT NULL;
  SELECT count(*) INTO w_n FROM public.project_workflows  WHERE blueprint_application_id IS NOT NULL;
  SELECT count(*) INTO p_n FROM public.project_pages      WHERE blueprint_application_id IS NOT NULL;
  SELECT count(*) INTO r_n FROM public.project_reports    WHERE blueprint_application_id IS NOT NULL;
  RAISE NOTICE 'blueprint origin: % application(s); tagged % checklist(s), % workflow(s), % page(s), % report(s).',
    apps, c_n, w_n, p_n, r_n;
END $$;
