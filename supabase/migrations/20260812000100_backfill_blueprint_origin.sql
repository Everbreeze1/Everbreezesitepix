-- Reconstruct blueprint origin for projects set up before the ledger existed.
--
-- OPT-IN AND MANUAL. This file is NOT idempotent in the usual "re-running
-- changes nothing" sense — it is guarded so a second run inserts nothing, but it
-- WRITES INFERRED HISTORY, and an inference is not an observation. Read the
-- preview in PART 1, satisfy yourself the pairs are right, and only then run
-- PART 2. Nothing else in the app depends on this having been run.
--
-- WHY IT IS POSSIBLE AT ALL: applying a blueprint copies checklists and
-- workflows while recording where each came from —
-- `project_checklists.template_id` (20260611000428:74) and
-- `project_workflows.template_id` (20260616050717:128). A blueprint's contents
-- are `project_template_items(project_template_id, kind, ref_id)`. Joining those
-- two recovers "this project holds items belonging to that blueprint".
--
-- THREE LIMITATIONS THE UI MUST NOT PAPER OVER, which is why every row written
-- here carries origin = 'inferred' and the project header renders those as
-- "Detected from its checklists" rather than "Set up from":
--
--   1. `counts` UNDER-REPORTS. Only checklists and workflows keep a template
--      pointer that predates this work, so documents/reports/label_sets are
--      recorded as 0 even when the blueprint created them. The popover will show
--      fewer items than actually landed.
--   2. `created_at` IS THE ARTIFACT'S TIMESTAMP, not the apply's. It is the
--      earliest created_at among the matched rows — close, but not the moment
--      someone pressed Apply.
--   3. A DIRECT TEMPLATE APPLY IS INDISTINGUISHABLE FROM A BLUEPRINT APPLY.
--      `template_id` is also written when a checklist template is applied on its
--      own (ProjectChecklists' own apply path, and ApplyTemplateDialog). If a
--      project got a checklist directly, and some blueprint happens to contain
--      that same checklist template, this will infer that blueprint. Requiring
--      TWO matching items would cut that false-positive rate sharply but would
--      also miss every genuine single-item blueprint; the threshold is a
--      judgement call, so PART 1 shows `matched_items` and you can add
--      `WHERE matched_items > 1` if your library makes that the safer trade.
--
-- Apply via the SitePix Supabase SQL editor. Requires 20260812000000 first.

-- === PART 1 — PREVIEW. Run this alone, read it, then decide. ===============

WITH candidate AS (
  SELECT
    src.project_id,
    src.blueprint_id,
    count(*) FILTER (WHERE src.kind = 'checklist')            AS checklists,
    count(*) FILTER (WHERE src.kind = 'workflow')             AS workflows,
    count(*)                                                  AS matched_items,
    min(src.created_at)                                       AS first_at,
    (array_agg(src.created_by ORDER BY src.created_at))[1]    AS applied_by
  FROM (
    SELECT pc.project_id, pc.created_at, pc.created_by, pti.project_template_id AS blueprint_id,
           'checklist' AS kind
      FROM public.project_checklists pc
      JOIN public.project_template_items pti
        ON pti.ref_id = pc.template_id AND pti.kind = 'checklist'
     WHERE pc.template_id IS NOT NULL
    UNION ALL
    -- The legacy attachment table, which predates project_template_items and is
    -- still processed first by applyProjectBlueprintService.
    SELECT pc.project_id, pc.created_at, pc.created_by, ptc.project_template_id,
           'checklist'
      FROM public.project_checklists pc
      JOIN public.project_template_checklists ptc
        ON ptc.checklist_template_id = pc.template_id
     WHERE pc.template_id IS NOT NULL
    UNION ALL
    SELECT pw.project_id, pw.created_at, pw.created_by, pti.project_template_id,
           'workflow'
      FROM public.project_workflows pw
      JOIN public.project_template_items pti
        ON pti.ref_id = pw.template_id AND pti.kind = 'workflow'
     WHERE pw.template_id IS NOT NULL
  ) src
  GROUP BY src.project_id, src.blueprint_id
)
SELECT p.name  AS project,
       pt.name AS blueprint,
       c.checklists,
       c.workflows,
       c.matched_items,
       c.first_at
  FROM candidate c
  JOIN public.projects p           ON p.id  = c.project_id
  JOIN public.project_templates pt ON pt.id = c.blueprint_id
 WHERE NOT EXISTS (
         SELECT 1 FROM public.project_blueprint_applications x
          WHERE x.project_id = c.project_id AND x.blueprint_id = c.blueprint_id)
 ORDER BY c.first_at DESC;


-- === PART 2 — THE INSERT. Only after reading PART 1. =======================
-- Identical CTE. The NOT EXISTS guard makes a second run a no-op and stops this
-- from ever duplicating a real, observed apply.
--
-- To be stricter about false positives, add `AND c.matched_items > 1` to the
-- final WHERE — see limitation 3 in the header.

/*  Uncomment to run.

INSERT INTO public.project_blueprint_applications
  (blueprint_id, blueprint_name, project_id, applied_by, counts, failed_count, created_at, origin)
WITH candidate AS (
  SELECT
    src.project_id,
    src.blueprint_id,
    count(*) FILTER (WHERE src.kind = 'checklist')            AS checklists,
    count(*) FILTER (WHERE src.kind = 'workflow')             AS workflows,
    count(*)                                                  AS matched_items,
    min(src.created_at)                                       AS first_at,
    (array_agg(src.created_by ORDER BY src.created_at))[1]    AS applied_by
  FROM (
    SELECT pc.project_id, pc.created_at, pc.created_by, pti.project_template_id AS blueprint_id,
           'checklist' AS kind
      FROM public.project_checklists pc
      JOIN public.project_template_items pti
        ON pti.ref_id = pc.template_id AND pti.kind = 'checklist'
     WHERE pc.template_id IS NOT NULL
    UNION ALL
    SELECT pc.project_id, pc.created_at, pc.created_by, ptc.project_template_id,
           'checklist'
      FROM public.project_checklists pc
      JOIN public.project_template_checklists ptc
        ON ptc.checklist_template_id = pc.template_id
     WHERE pc.template_id IS NOT NULL
    UNION ALL
    SELECT pw.project_id, pw.created_at, pw.created_by, pti.project_template_id,
           'workflow'
      FROM public.project_workflows pw
      JOIN public.project_template_items pti
        ON pti.ref_id = pw.template_id AND pti.kind = 'workflow'
     WHERE pw.template_id IS NOT NULL
  ) src
  GROUP BY src.project_id, src.blueprint_id
)
SELECT c.blueprint_id,
       pt.name,
       c.project_id,
       c.applied_by,
       -- Documents/reports/label_sets are knowingly 0: nothing recorded them
       -- before this work, and guessing would be worse than under-reporting.
       jsonb_build_object(
         'checklists', c.checklists,
         'workflows',  c.workflows,
         'documents',  0,
         'reports',    0,
         'label_sets', 0),
       0,
       c.first_at,
       'inferred'
  FROM candidate c
  JOIN public.project_templates pt ON pt.id = c.blueprint_id
 WHERE NOT EXISTS (
         SELECT 1 FROM public.project_blueprint_applications x
          WHERE x.project_id = c.project_id AND x.blueprint_id = c.blueprint_id);

*/

-- === VERIFY (after running PART 2) =========================================
-- SELECT origin, count(*) FROM public.project_blueprint_applications
--  GROUP BY origin ORDER BY origin;
